import 'dotenv/config';
import express from 'express';
import { config } from './config.js';
import { workerPool } from './worker.js';
import { api } from './api.js';

const app = express();
app.use(express.json());

// ── Health check (no auth — used by Docker healthcheck + load balancers) ──────
// Returns 503 when the worker pool is empty so Docker restarts the container.
app.get('/health', (_req, res) => {
  const count = workerPool.count;
  if (count === 0) {
    return res.status(503).json({ status: 'degraded', workers: 0 });
  }
  res.json({ status: 'ok', workers: count });
});

// ── Internal auth middleware ───────────────────────────────────────────────────
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

// ── Resolve public announced IP ───────────────────────────────────────────────
// MEDIASOUP_ANNOUNCED_IP must be set to the VPS public IP so that browsers
// receive the correct ICE candidate address. If it is missing or left as the
// loopback default, media will never flow from remote clients.
async function resolveAnnouncedIP() {
  const fromEnv = process.env.MEDIASOUP_ANNOUNCED_IP;
  if (fromEnv && fromEnv !== '127.0.0.1' && fromEnv !== 'localhost') {
    return fromEnv;
  }

  console.warn('[mediasoup-server] MEDIASOUP_ANNOUNCED_IP not set or is 127.0.0.1.');
  console.warn('[mediasoup-server] Attempting to auto-detect public IP via api.ipify.org…');

  try {
    const res = await fetch('https://api.ipify.org?format=json');
    if (!res.ok) throw new Error(`ipify returned ${res.status}`);
    const { ip } = await res.json();
    console.log(`[mediasoup-server] Auto-detected public IP: ${ip}`);
    console.warn('[mediasoup-server] Set MEDIASOUP_ANNOUNCED_IP in .env to avoid this lookup at startup.');
    return ip;
  } catch (err) {
    console.error('[mediasoup-server] Could not auto-detect public IP:', err.message);
    console.error('[mediasoup-server] Set MEDIASOUP_ANNOUNCED_IP=<your-vps-public-ip> in .env and restart.');
    process.exit(1);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function main() {
  // Resolve the announced IP before spawning workers so config is fully
  // populated by the time transports are created.
  const publicIP = await resolveAnnouncedIP();
  config.webRtcTransport.listenInfos.forEach((info) => {
    info.announcedAddress = publicIP;
  });

  console.log('[mediasoup-server] Initialising workers…');
  await workerPool.init();

  const server = app.listen(config.http.port, '0.0.0.0', () => {
    console.log(`[mediasoup-server] Listening on 0.0.0.0:${config.http.port}`);
    console.log(`[mediasoup-server] Workers: ${workerPool.count}`);
    console.log(`[mediasoup-server] RTC port range: ${config.worker.rtcMinPort}–${config.worker.rtcMaxPort}`);
    console.log(`[mediasoup-server] Announced IP: ${publicIP}`);
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  // Docker (and any supervisor) sends SIGTERM before SIGKILL.
  // Close workers cleanly to release file descriptors and UDP sockets.
  function shutdown(signal) {
    console.log(`[mediasoup-server] ${signal} received — shutting down gracefully`);
    server.close(() => {
      console.log('[mediasoup-server] HTTP server closed');
    });
    for (const worker of workerPool.workers) {
      worker.close();
    }
    // Give in-flight requests up to 5 s then exit
    setTimeout(() => {
      console.log('[mediasoup-server] Forcing exit after timeout');
      process.exit(0);
    }, 5_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[mediasoup-server] Fatal startup error:', err);
  process.exit(1);
});
