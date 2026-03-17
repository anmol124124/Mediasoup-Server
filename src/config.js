/**
 * Central configuration for the mediasoup SFU server.
 *
 * All values can be overridden via environment variables.
 * See .env.example for the full list.
 */

export const config = {
  // ── HTTP server ────────────────────────────────────────────────────────────
  http: {
    port: parseInt(process.env.PORT ?? '3000', 10),
    // Shared secret so only FastAPI can call this service
    internalSecret: process.env.INTERNAL_SECRET ?? 'change-this-secret-in-production',
  },

  // ── mediasoup worker ───────────────────────────────────────────────────────
  worker: {
    // Number of workers to spawn (defaults to 1 for dev; use os.cpus().length in prod)
    count: parseInt(process.env.WORKER_COUNT ?? '1', 10),
    logLevel: process.env.WORKER_LOG_LEVEL ?? 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    // UDP port range allocated to mediasoup for RTP/RTCP
    rtcMinPort: parseInt(process.env.RTC_MIN_PORT ?? '40000', 10),
    rtcMaxPort: parseInt(process.env.RTC_MAX_PORT ?? '40100', 10),
  },

  // ── mediasoup router (codec capabilities) ──────────────────────────────────
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: { 'x-google-start-bitrate': 1000 },
      },
      {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'profile-id': 2,
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '4d0032',
          'level-asymmetry-allowed': 1,
          'x-google-start-bitrate': 1000,
        },
      },
    ],
  },

  // ── WebRTC transport ───────────────────────────────────────────────────────
  webRtcTransport: {
    listenInfos: [
      {
        protocol: 'udp',
        ip: process.env.MEDIASOUP_LISTEN_IP ?? '0.0.0.0',
        // announcedAddress: the IP browsers will use to reach us.
        // Set MEDIASOUP_ANNOUNCED_IP to your machine's LAN/public IP for
        // cross-device testing. 127.0.0.1 works for browser on same host.
        announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP ?? '127.0.0.1',
      },
      {
        protocol: 'tcp',
        ip: process.env.MEDIASOUP_LISTEN_IP ?? '0.0.0.0',
        announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP ?? '127.0.0.1',
      },
    ],
    initialAvailableOutgoingBitrate: 800_000,
    minimumAvailableOutgoingBitrate: 200_000,
    maxSctpMessageSize: 262_144,
    maxIncomingBitrate: 1_500_000,
  },
};
