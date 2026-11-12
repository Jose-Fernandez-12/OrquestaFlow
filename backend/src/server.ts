import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { config } from 'dotenv';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { getDb, closeDb } from './db/database.js';
import { closeAllMssqlPools } from './engine/mssql.js';
import { stopAllSchedulerJobs } from './engine/scheduler.js';
import { stopAllScriptRuns } from './engine/scriptRunner.js';
import { refreshEnvironment } from './engine/python/environment.js';
import { pythonEnvRoutes } from './routes/pythonEnv.js';
import { flowRoutes } from './routes/flows.js';
import { queryRoutes } from './routes/queries.js';
import { connectionRoutes } from './routes/connections.js';
import { scriptRoutes } from './routes/scripts.js';
import { scheduleRoutes } from './routes/schedules.js';
import { exportRoutes } from './routes/export.js';
import { fileManagerRoutes } from './routes/files.js';
import { settingsRoutes } from './routes/settings.js';
import { pythonExportRoutes } from './routes/pythonExport.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { authRoutes, accessRequestOf } from './routes/auth.js';
import { credentialRoutes } from './routes/credentials.js';
import { accessToken, accessTokenSource, accessTokenFile, checkAccess, isAllowedOrigin } from './security/access.js';

config();

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

const app = Fastify({
  logger: true
});

async function start(): Promise<void> {
  // Initialize database
  const { initDb } = await import('./db/database.js');
  await initDb();

  // Initialize scheduler
  const { initScheduler } = await import('./engine/scheduler.js');
  await initScheduler();

  // Old execution history is deleted on start and every few hours (Configuración → General)
  const { startRetention } = await import('./engine/retention.js');
  startRetention();

  // Detect uv / the shared venv / system Python in the background; scripts use the result
  refreshEnvironment().catch(err => app.log.warn(err, 'No se pudo inspeccionar el entorno Python'));

  // Plugins
  // Only pages served from this computer's own names may call the API (see security/access.ts)
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || isAllowedOrigin(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
  });

  // Every request but a few public ones goes through the access check. Preflight requests carry no
  // credentials by design; the CORS plugin above answers them
  const PUBLIC_PATHS = ['/api/health', '/api/auth/status', '/api/auth/login', '/api/auth/logout'];
  // Webhooks are called by other systems and check their own secret
  const PUBLIC_PREFIXES = ['/api/flows/webhook/'];
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return;
    const path = request.url.split('?')[0];
    if (PUBLIC_PATHS.includes(path) || PUBLIC_PREFIXES.some(prefix => path.startsWith(prefix))) return;
    const decision = checkAccess(accessRequestOf(request));
    if (!decision.ok) return reply.status(decision.status).send({ error: decision.message, code: decision.code });
  });

  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB
    }
  });

  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'uploads'),
    prefix: '/uploads/',
    decorateReply: false
  });

  // Serve exported files for download strictly from data/exports (protecting orquesta.sqlite)
  const exportsDir = join(process.cwd(), 'data', 'exports');
  if (!existsSync(exportsDir)) {
    mkdirSync(exportsDir, { recursive: true });
  }

  await app.register(fastifyStatic, {
    root: exportsDir,
    prefix: '/api/files/',
    decorateReply: false,
    setHeaders: (res, path) => {
      res.setHeader('Content-Disposition', 'attachment');
    }
  });

  // Routes
  await app.register(flowRoutes, { prefix: '/api/flows' });
  await app.register(queryRoutes, { prefix: '/api/queries' });
  await app.register(connectionRoutes, { prefix: '/api/connections' });
  await app.register(scriptRoutes, { prefix: '/api/scripts' });
  await app.register(scheduleRoutes, { prefix: '/api/schedules' });
  await app.register(exportRoutes, { prefix: '/api/export' });
  await app.register(fileManagerRoutes, { prefix: '/api/file-manager' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(pythonExportRoutes, { prefix: '/api/flows' });
  await app.register(pythonEnvRoutes, { prefix: '/api/python-env' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(credentialRoutes, { prefix: '/api/credentials' });

  // Health check
  app.get('/api/health', async () => {
    let version = '2.0.1';
    try {
      const pkgPath = join(process.cwd(), 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.version) version = pkg.version;
      }
    } catch {}

    return { status: 'ok', version, timestamp: new Date().toISOString() };
  });

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      try {
        stopAllSchedulerJobs();
        stopAllScriptRuns();
        await closeAllMssqlPools();
        closeDb();
        await app.close();
      } catch (err) {
        app.log.error(err, 'Error during shutdown');
      } finally {
        process.exit(0);
      }
    });
  }

  try {
    const { initIo } = await import('./engine/socket.js');
    initIo(app.server);

    await app.listen({ port: PORT, host: HOST });
    app.log.info(`OrquestaFlow API running on http://${HOST}:${PORT}`);
    // The key itself is shown in Configuración on this computer, never in the log
    accessToken();
    app.log.info(accessTokenSource() === 'env'
      ? 'Acceso desde otros equipos: clave definida en ORQUESTA_ACCESS_TOKEN'
      : `Acceso desde otros equipos: clave en ${accessTokenFile()} (también en Configuración → General)`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
