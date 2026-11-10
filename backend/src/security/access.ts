import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Who may use the API.
 *
 * - From this computer (loopback or one of its own addresses) no key is needed, as long as the
 *   request is addressed to a name of this computer. That last check stops DNS rebinding: a web page
 *   whose domain is made to point at 127.0.0.1 still sends its own domain in the Host header.
 * - From other computers the browser must present the access key, once, at /api/auth/login; it is
 *   then kept in an HttpOnly cookie. The key is ORQUESTA_ACCESS_TOKEN or data/access-token.
 * - A request sent by a web page from another site is refused (Origin header), so a page open in the
 *   browser cannot drive the API on the user's behalf.
 *
 * Names other than this computer's (a DNS alias, a reverse proxy) go in ORQUESTA_ALLOWED_HOSTS,
 * comma separated.
 *
 * Behind a reverse proxy every request arrives from the proxy, often this same computer, so it would
 * look local. A request with forwarding headers (X-Forwarded-For, Forwarded, X-Real-IP…) is therefore
 * never let in as local: it needs the key. A proxy that adds none of them cannot be told apart, so
 * ORQUESTA_REQUIRE_ACCESS_TOKEN=true asks for the key on every request, this computer included.
 */

export const ACCESS_COOKIE = 'orquesta_access';
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 3600;

let cachedToken: string | null = null;

export function accessTokenFile(): string {
  return path.join(process.cwd(), 'data', 'access-token');
}

/** The access key for other computers, created on first use */
export function accessToken(): string {
  if (cachedToken) return cachedToken;
  const fromEnv = process.env.ORQUESTA_ACCESS_TOKEN?.trim();
  if (fromEnv) return (cachedToken = fromEnv);

  const file = accessTokenFile();
  if (fs.existsSync(file)) {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved) return (cachedToken = saved);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = crypto.randomBytes(18).toString('base64url');
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return (cachedToken = token);
}

export function accessTokenSource(): 'env' | 'file' {
  return process.env.ORQUESTA_ACCESS_TOKEN?.trim() ? 'env' : 'file';
}

export function tokenMatches(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const expected = Buffer.from(accessToken());
  const given = Buffer.from(candidate);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function normalizeAddress(address: string): string {
  let value = address.trim().toLowerCase();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  if (value.startsWith('::ffff:')) value = value.slice(7);
  const zone = value.indexOf('%');
  return zone >= 0 ? value.slice(0, zone) : value;
}

function ownAddresses(): Set<string> {
  const addresses = new Set<string>(['::1']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list ?? []) addresses.add(normalizeAddress(entry.address));
  }
  return addresses;
}

/** The request comes from this computer */
export function isLocalAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const value = normalizeAddress(address);
  return value.startsWith('127.') || ownAddresses().has(value);
}

function configuredHosts(): string[] {
  return (process.env.ORQUESTA_ALLOWED_HOSTS || '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
}

/** A name or address that points at this computer, or one the administrator allowed */
export function isAllowedHostname(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  const name = normalizeAddress(hostname).replace(/\.$/, '');
  const machine = os.hostname().toLowerCase();
  return name === 'localhost'
    || name.endsWith('.localhost')
    || name === machine
    || name === `${machine}.local`
    || isLocalAddress(name)
    || configuredHosts().includes(name);
}

/** "host:port", "[::1]:3001" → the host name alone */
export function hostnameOf(hostHeader: string | null | undefined): string | null {
  if (!hostHeader) return null;
  const value = hostHeader.trim();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  return value.split(':')[0];
}

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  try {
    return isAllowedHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface AccessRequest {
  remoteAddress: string | null | undefined;
  host: string | null | undefined;
  origin: string | null | undefined;
  cookie: string | null | undefined;
  authorization: string | null | undefined;
  /** Request headers, to notice a request relayed by a proxy */
  headers?: Record<string, string | string[] | undefined>;
}

const FORWARDING_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'x-client-ip', 'true-client-ip', 'cf-connecting-ip', 'via'];

/** The request was relayed by a proxy: the real client is somewhere else */
export function isForwarded(headers: AccessRequest['headers']): boolean {
  if (!headers) return false;
  return FORWARDING_HEADERS.some(name => {
    const value = headers[name];
    return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim() !== '';
  });
}

/** ORQUESTA_REQUIRE_ACCESS_TOKEN=true: no request gets in without the key */
export function tokenAlwaysRequired(): boolean {
  return /^(1|true|si|sí|yes)$/i.test(process.env.ORQUESTA_REQUIRE_ACCESS_TOKEN?.trim() || '');
}

function configuredFrontendPorts(): string[] {
  return (process.env.ORQUESTA_FRONTEND_PORTS || '5173,4173')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
}

/**
 * A page of OrquestaFlow itself: one of this computer's names and the port the frontend is served on
 * (5173 in development, 4173 with `vite preview`; others in ORQUESTA_FRONTEND_PORTS). Stricter than
 * isAllowedOrigin, which accepts any port: another program on this computer serving a page on
 * localhost must not be able to read the access key.
 */
export function isFrontendOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return isAllowedHostname(url.hostname) && configuredFrontendPorts().includes(port);
  } catch {
    return false;
  }
}

export type AccessDecision =
  | { ok: true; via: 'token' | 'local' }
  | { ok: false; status: 401 | 403; code: 'auth_required' | 'origin_not_allowed' | 'host_not_allowed'; message: string };

export function presentedToken(req: Pick<AccessRequest, 'cookie' | 'authorization'>): string | null {
  const bearer = req.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || readCookie(req.cookie, ACCESS_COOKIE);
}

export function checkAccess(req: AccessRequest): AccessDecision {
  if (req.origin && !isAllowedOrigin(req.origin)) {
    return {
      ok: false,
      status: 403,
      code: 'origin_not_allowed',
      message: `Petición rechazada: la página ${req.origin} no es de OrquestaFlow. Si es un nombre válido de este servidor, añádelo a ORQUESTA_ALLOWED_HOSTS.`,
    };
  }
  if (tokenMatches(presentedToken(req))) return { ok: true, via: 'token' };

  if (isLocalAddress(req.remoteAddress) && !isForwarded(req.headers) && !tokenAlwaysRequired()) {
    if (isAllowedHostname(hostnameOf(req.host))) return { ok: true, via: 'local' };
    return {
      ok: false,
      status: 403,
      code: 'host_not_allowed',
      message: `Petición rechazada: ${hostnameOf(req.host) || 'el nombre usado'} no es un nombre de este equipo. Si lo es, añádelo a ORQUESTA_ALLOWED_HOSTS.`,
    };
  }
  return {
    ok: false,
    status: 401,
    code: 'auth_required',
    message: 'Este equipo necesita la clave de acceso de OrquestaFlow (Configuración → General en el equipo del servidor).',
  };
}

export function accessCookie(token: string, secure: boolean): string {
  return [
    `${ACCESS_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function clearedAccessCookie(): string {
  return `${ACCESS_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

// ── Failed key attempts, per address ──

const MAX_FAILURES = 10;
const LOCKOUT_MS = 10 * 60_000;
const failures = new Map<string, { count: number; until: number }>();

export function loginLockedUntil(address: string, now = Date.now()): number | null {
  const entry = failures.get(address);
  return entry && entry.until > now ? entry.until : null;
}

export function recordLoginFailure(address: string, now = Date.now()): void {
  const entry = failures.get(address);
  const count = (entry && entry.until <= now && entry.count >= MAX_FAILURES ? 0 : entry?.count ?? 0) + 1;
  failures.set(address, { count, until: count >= MAX_FAILURES ? now + LOCKOUT_MS : 0 });
}

export function clearLoginFailures(address: string): void {
  failures.delete(address);
}
