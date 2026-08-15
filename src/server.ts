import { createApp } from './api/fastify/app.js';
import { Store } from './store/db.js';
import { loadConfig } from './core/config.js';
import { logger } from './core/logger.js';

const log = logger.child({ module: 'server' });

async function start() {
  const config = loadConfig();
  const port = parseInt(process.env['PORT'] || '8080', 10);
  
  log.info(`Starting Crypto Radar stateless server on port ${port}...`);

  const store = Store.open(config.dataDir);
  try {
    await store.migrate();
    log.info('SQLite store opened and migrated');
    await store.syncModelsFromBucket();
  } catch (err) {
    log.error('Failed to migrate store', { error: String(err) });
    process.exit(1);
  }

  const jwtSecretRaw = process.env['RADAR__JWT_SECRET'];
  let jwtSecret: string;

  if (jwtSecretRaw) {
    jwtSecret = jwtSecretRaw;
  } else if (process.env['NODE_ENV'] === 'production') {
    log.fatal('RADAR__JWT_SECRET must be set in production — refusing to start with default');
    process.exit(1);
  } else {
    jwtSecret = 'dev-secret-change-in-production';
    log.warn('RADAR__JWT_SECRET not set — using dev default (NOT for production)');
  }

  const fastify = await createApp({
    store,
    jwtSecret,
    apiKey: process.env['RADAR__API_KEY'],
    corsOrigin: process.env['CORS_ORIGIN']?.split(',') ?? [
      'https://crypto-radar.vercel.app',
      'http://localhost:5173',
      'http://localhost:4173',
    ],
  });

  let isShuttingDown = false;
  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info(`Received ${signal} signal — initiating graceful shutdown...`);

    try {
      await fastify.close();
      log.info('Fastify server closed successfully');

      if (process.env['RADAR__STORAGE_BUCKET']) {
        log.info('Flushing SQLite store and ML artifacts to GCS bucket...');
        await store.syncToBucket();
        await store.syncModelsToBucket();
      }

      store.close();
      log.info('Database handle closed successfully');

      log.info('Graceful shutdown completed cleanly');
      process.exit(0);
    } catch (err) {
      log.error('Error during graceful shutdown', { error: String(err) });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  try {
    await fastify.listen({ port, host: '0.0.0.0' });
    log.info(`Stateless server listening on http://0.0.0.0:${port}`);
  } catch (err) {
    log.fatal('Failed to start Fastify server', { error: String(err) });
    process.exit(1);
  }
}

start().catch(err => {
  log.fatal('Failed to start server process', { error: String(err) });
  process.exit(1);
});
