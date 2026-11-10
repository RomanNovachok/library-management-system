import 'dotenv/config';
import { createApp } from './app.js';
import { readEnv } from './config/env.js';

const env = readEnv();
const app = createApp(env);

const server = app.listen(env.PORT, () => {
  console.info(`Library API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

server.on('error', (error) => {
  console.error('Failed to start Library API:', error);
  process.exitCode = 1;
});
