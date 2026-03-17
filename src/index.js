import 'dotenv/config';
import express from 'express';
import { config } from './config.js';
import { workerPool } from './worker.js';
import { api } from './api.js';

const app = express();
app.use(express.json());

// ── Health check (no auth — used by Docker healthcheck) ───────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', workers: workerPool.count });
});

// ── Internal auth middleware ───────────────────────────────────────────────────
//
// Every /api route requires the shared secret in x-internal-secret.
// This prevents any process outside the Docker network from calling the SFU API.
app.use('/api', (req, res, next) => {
  const secret = req.headers['x-internal-secret'];
  if (secret !== config.http.internalSecret) {
    return res.status(401).json({ error: 'Unauthorized — invalid internal secret' });
  }
  next();
});

app.use('/api', api);

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Boot ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[mediasoup-server] Initialising workers...');
  await workerPool.init();

  app.listen(config.http.port, () => {
    console.log(`[mediasoup-server] Listening on port ${config.http.port}`);
    console.log(`[mediasoup-server] Workers: ${workerPool.count}`);
    console.log(`[mediasoup-server] RTC port range: ${config.worker.rtcMinPort}–${config.worker.rtcMaxPort}`);
    console.log(`[mediasoup-server] Announced IP: ${config.webRtcTransport.listenInfos[0].announcedAddress}`);
  });
}

main().catch((err) => {
  console.error('[mediasoup-server] Fatal startup error:', err);
  process.exit(1);
});
