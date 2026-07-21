import { isCloudMode } from './config.js';
import { logger } from './logger.js';
import type { TaskPayload } from '../types.js';

const log = logger.child({ module: 'queue' });

type TaskHandler = (payload: TaskPayload) => Promise<void>;

const handlers = new Map<string, TaskHandler>();

/** Register a handler for a queue name */
export function registerTaskHandler(queueName: string, handler: TaskHandler): void {
  handlers.set(queueName, handler);
}

/** Enqueue a task to a queue. In cloud mode, sends it to Google Cloud Tasks. In local mode, runs in-process via setImmediate */
export async function enqueueTask(queueName: string, payload: TaskPayload): Promise<void> {
  if (isCloudMode()) {
    try {
      const { CloudTasksClient } = await import('@google-cloud/tasks');
      const client = new CloudTasksClient();

      const projectId = process.env['GOOGLE_CLOUD_PROJECT'] || 'crypto-radar';
      const location = process.env['RADAR__CLOUD_LOCATION'] || 'us-central1';
      const serviceUrl = process.env['RADAR__SERVICE_URL'];

      if (!serviceUrl) {
        throw new Error('RADAR__SERVICE_URL env var must be set in cloud mode to construct task targets');
      }

      let path = '/api/tasks/gemini-analyze';
      if (queueName === 'crypto-radar-paper-trade') path = '/api/tasks/paper-trade';
      if (queueName === 'crypto-radar-model-retrain') path = '/api/tasks/model-retrain';

      const parent = client.queuePath(projectId, location, queueName);
      const url = `${serviceUrl.replace(/\/$/, '')}${path}`;

      const task = {
        httpRequest: {
          httpMethod: 'POST' as const,
          url,
          headers: {
            'Content-Type': 'application/json',
          },
          body: Buffer.from(JSON.stringify(payload)).toString('base64'),
          oidcToken: {
            serviceAccountEmail: process.env['RADAR__SERVICE_ACCOUNT_EMAIL'] || `${projectId}@appspot.gserviceaccount.com`,
          },
        },
      };

      await client.createTask({ parent, task });
      log.info('Successfully enqueued task to Cloud Tasks', { queue: queueName, url });
    } catch (err) {
      log.error('Failed to enqueue task to Cloud Tasks', { queue: queueName, error: String(err) });
      log.warn('Falling back to local trigger for task', { queue: queueName });
      triggerLocalHandler(queueName, payload);
    }
  } else {
    triggerLocalHandler(queueName, payload);
  }
}

function triggerLocalHandler(queueName: string, payload: TaskPayload): void {
  setImmediate(() => {
    const handler = handlers.get(queueName);
    if (handler) {
      log.info('Running local queue handler', { queue: queueName });
      handler(payload).catch(err => {
        log.error('Error running local queue handler', { queue: queueName, error: String(err) });
      });
    } else {
      log.warn('No handler registered for queue', { queue: queueName });
    }
  });
}
