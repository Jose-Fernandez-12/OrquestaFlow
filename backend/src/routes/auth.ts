import { FastifyInstance, FastifyRequest } from 'fastify';
import {
  accessCookie, accessToken, accessTokenFile, accessTokenSource, checkAccess, clearedAccessCookie,
  clearLoginFailures, isLocalAddress, loginLockedUntil, recordLoginFailure, tokenMatches,
} from '../security/access.js';

export function accessRequestOf(request: FastifyRequest) {
  return {
    remoteAddress: request.ip,
    host: request.headers.host,
    origin: request.headers.origin,
    cookie: request.headers.cookie,
    authorization: request.headers.authorization,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Whether this browser can use the API, and how
  app.get('/status', async (request) => {
    const decision = checkAccess(accessRequestOf(request));
    return {
      data: {
        authenticated: decision.ok,
        via: decision.ok ? decision.via : null,
        code: decision.ok ? null : decision.code,
        local: isLocalAddress(request.ip),
      },
    };
  });

  // The key typed in a browser of another computer; it stays in an HttpOnly cookie
  app.post<{ Body: { token?: string } }>('/login', async (request, reply) => {
    const lockedUntil = loginLockedUntil(request.ip);
    if (lockedUntil) {
      const minutes = Math.ceil((lockedUntil - Date.now()) / 60_000);
      return reply.status(429).send({ error: `Demasiados intentos fallidos. Vuelve a intentarlo en ${minutes} min.` });
    }
    const token = String(request.body?.token ?? '').trim();
    if (!tokenMatches(token)) {
      recordLoginFailure(request.ip);
      return reply.status(401).send({ error: 'La clave de acceso no es correcta.' });
    }
    clearLoginFailures(request.ip);
    reply.header('Set-Cookie', accessCookie(token, request.protocol === 'https'));
    return { data: { authenticated: true } };
  });

  app.post('/logout', async (_request, reply) => {
    reply.header('Set-Cookie', clearedAccessCookie());
    return { data: { authenticated: false } };
  });

  // The key itself, only for the computer the server runs on, so it can be passed on to others
  app.get('/token', async (request, reply) => {
    const decision = checkAccess(accessRequestOf(request));
    if (!decision.ok || decision.via !== 'local') {
      return reply.status(403).send({ error: 'La clave solo se muestra en el equipo donde corre el servidor.' });
    }
    return { data: { token: accessToken(), source: accessTokenSource(), file: accessTokenFile() } };
  });
}
