import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { config } from 'dotenv';
import { join } from 'path';
import { getDb, closeDb } from './db/database.js';
import { flowRoutes } from './routes/flows.js';
import { queryRoutes } from './routes/queries.js';
import { connectionRoutes } from './routes/connections.js';
import { scriptRoutes } from './routes/scripts.js';
import { scheduleRoutes } from './routes/schedules.js';
import { exportRoutes } from './routes/export.js';

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

  // Plugins
  await app.register(cors, {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
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

  // Routes
  await app.register(flowRoutes, { prefix: '/api/flows' });
  await app.register(queryRoutes, { prefix: '/api/queries' });
  await app.register(connectionRoutes, { prefix: '/api/connections' });
  await app.register(scriptRoutes, { prefix: '/api/scripts' });
  await app.register(scheduleRoutes, { prefix: '/api/schedules' });
  await app.register(exportRoutes, { prefix: '/api/export' });

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down...`);
      closeDb();
      await app.close();
      process.exit(0);
    });
  }

  try {
    const { initIo } = await import('./engine/socket.js');
    initIo(app.server);

    await app.listen({ port: PORT, host: HOST });
    app.log.info(`OrquestaFlow API running on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
