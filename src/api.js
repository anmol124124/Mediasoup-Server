/**
 * Internal HTTP API consumed exclusively by the FastAPI signaling server.
 *
 * All routes are prefixed with /api and protected by x-internal-secret header.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  POST   /api/rooms/:roomId/ensure                                       │
 * │  POST   /api/rooms/:roomId/transports                                   │
 * │  POST   /api/rooms/:roomId/transports/:transportId/connect              │
 * │  POST   /api/rooms/:roomId/transports/:transportId/produce              │
 * │  POST   /api/rooms/:roomId/consumers                                    │
 * │  POST   /api/rooms/:roomId/consumers/:consumerId/resume                 │
 * │  GET    /api/rooms/:roomId/producers                                    │
 * │  DELETE /api/rooms/:roomId/peers/:peerId                                │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { Router } from 'express';
import { roomManager } from './roomManager.js';

const api = Router();

// ── Helper ─────────────────────────────────────────────────────────────────

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error('[API Error]', err);
    res.status(500).json({ error: err.message });
  });

// ── 1. Ensure room ─────────────────────────────────────────────────────────
//
// Called when a user joins a meeting via WebSocket.
// Creates the mediasoup Router if it does not exist yet.
// Returns the Router's RTP capabilities so the client can load its Device.
//
// Request:  POST /api/rooms/:roomId/ensure
// Response: { roomId, rtpCapabilities }

api.post('/rooms/:roomId/ensure', wrap(async (req, res) => {
  const { roomId } = req.params;
  console.log(`[API] ensure_room  roomId=${roomId}`);
  const room = await roomManager.getOrCreate(roomId);
  console.log(`[API] ensure_room OK  roomId=${roomId}  peers=${room.peers.size}`);
  res.json({ roomId, rtpCapabilities: room.rtpCapabilities });
}));

// ── 2. Create WebRTC transport ─────────────────────────────────────────────
//
// Called twice per peer: once for sending (producing) and once for receiving
// (consuming).  The returned ICE/DTLS parameters are forwarded to the browser
// which creates a matching RTCPeerConnection-level transport.
//
// Request body:  { peerId, direction: 'send' | 'recv' }
// Response:      { transportId, iceParameters, iceCandidates, dtlsParameters }

api.post('/rooms/:roomId/transports', wrap(async (req, res) => {
  const { roomId } = req.params;
  const { peerId, direction } = req.body;
  console.log(`[API] create_transport  roomId=${roomId}  peerId=${peerId}  direction=${direction}`);

  if (!peerId || !['send', 'recv'].includes(direction)) {
    return res.status(400).json({ error: 'peerId and direction (send|recv) are required' });
  }

  const room = roomManager.get(roomId);
  if (!room) {
    console.warn(`[API] create_transport FAIL — room not found  roomId=${roomId}`);
    return res.status(404).json({ error: 'Room not found' });
  }

  const peer = room.getOrCreatePeer(peerId);
  const transport = await room.createWebRtcTransport({ direction });
  peer.addTransport(transport);
  console.log(`[API] create_transport OK  roomId=${roomId}  peerId=${peerId}  transportId=${transport.id}  direction=${direction}`);

  res.json({
    transportId:    transport.id,
    iceParameters:  transport.iceParameters,
    iceCandidates:  transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
    direction,
  });
}));

// ── 3. Connect transport ────────────────────────────────────────────────────
//
// After the browser creates its side of the transport it provides its DTLS
// fingerprint.  This must be called before the transport can carry media.
//
// Request body:  { peerId, dtlsParameters }
// Response:      { connected: true }

api.post('/rooms/:roomId/transports/:transportId/connect', wrap(async (req, res) => {
  const { roomId, transportId } = req.params;
  const { peerId, dtlsParameters } = req.body;
  console.log(`[API] connect_transport  roomId=${roomId}  peerId=${peerId}  transportId=${transportId}`);

  const room = roomManager.get(roomId);
  if (!room) {
    console.warn(`[API] connect_transport FAIL — room not found  roomId=${roomId}`);
    return res.status(404).json({ error: 'Room not found' });
  }

  const peer = room.getPeer(peerId);
  if (!peer) {
    console.warn(`[API] connect_transport FAIL — peer not found  roomId=${roomId}  peerId=${peerId}`);
    return res.status(404).json({ error: 'Peer not found' });
  }

  const transport = peer.getTransport(transportId);
  if (!transport) {
    console.warn(`[API] connect_transport FAIL — transport not found  roomId=${roomId}  peerId=${peerId}  transportId=${transportId}`);
    return res.status(404).json({ error: 'Transport not found' });
  }

  await transport.connect({ dtlsParameters });
  console.log(`[API] connect_transport OK  roomId=${roomId}  peerId=${peerId}  transportId=${transportId}`);
  res.json({ connected: true });
}));

// ── 4. Produce ──────────────────────────────────────────────────────────────
//
// Browser starts sending a media track.  Provide the send transport ID,
// the media kind (audio|video) and the browser's RTP send parameters.
//
// Request body:  { peerId, kind: 'audio'|'video', rtpParameters, appData? }
// Response:      { producerId }

api.post('/rooms/:roomId/transports/:transportId/produce', wrap(async (req, res) => {
  const { roomId, transportId } = req.params;
  const { peerId, kind, rtpParameters, appData = {} } = req.body;
  console.log(`[API] produce  roomId=${roomId}  peerId=${peerId}  transportId=${transportId}  kind=${kind}`);

  if (!['audio', 'video'].includes(kind)) {
    return res.status(400).json({ error: 'kind must be audio or video' });
  }

  const room = roomManager.get(roomId);
  if (!room) {
    console.warn(`[API] produce FAIL — room not found  roomId=${roomId}`);
    return res.status(404).json({ error: 'Room not found' });
  }

  const peer = room.getPeer(peerId);
  if (!peer) {
    console.warn(`[API] produce FAIL — peer not found  roomId=${roomId}  peerId=${peerId}`);
    return res.status(404).json({ error: 'Peer not found' });
  }

  const transport = peer.getTransport(transportId);
  if (!transport) {
    console.warn(`[API] produce FAIL — transport not found  roomId=${roomId}  peerId=${peerId}  transportId=${transportId}`);
    return res.status(404).json({ error: 'Transport not found' });
  }

  const producer = await transport.produce({ kind, rtpParameters, appData });
  peer.addProducer(producer);
  console.log(`[API] produce OK  roomId=${roomId}  peerId=${peerId}  kind=${kind}  producerId=${producer.id}`);

  producer.on('transportclose', () => {
    peer.producers.delete(producer.id);
    console.log(`[API] Producer closed on transport close  producerId=${producer.id}`);
  });

  producer.on('score', (score) => {
    // Useful for adaptive bitrate monitoring in production
    console.debug(`[API] Producer score  producerId=${producer.id}  score=${JSON.stringify(score)}`);
  });

  res.json({ producerId: producer.id });
}));

// ── 5. Consume ──────────────────────────────────────────────────────────────
//
// Browser wants to receive a remote producer's stream.  Supply the consumer
// peer's recv transport ID, the target producerId, and the consumer's
// rtpCapabilities (from device.rtpCapabilities).
//
// The consumer starts paused — call /resume after the browser confirms its
// recv transport is connected to begin receiving media.
//
// Request body:  { consumerPeerId, producerId, transportId, rtpCapabilities }
// Response:      { consumerId, producerId, kind, rtpParameters, producerPeerId }

api.post('/rooms/:roomId/consumers', wrap(async (req, res) => {
  const { roomId } = req.params;
  const { consumerPeerId, producerId, transportId, rtpCapabilities } = req.body;
  console.log(`[API] consume  roomId=${roomId}  consumerPeerId=${consumerPeerId}  producerId=${producerId}  transportId=${transportId}`);

  const room = roomManager.get(roomId);
  if (!room) {
    console.warn(`[API] consume FAIL — room not found  roomId=${roomId}`);
    return res.status(404).json({ error: 'Room not found' });
  }

  // Verify the router can satisfy this consumer's codec support
  if (!room.router.canConsume({ producerId, rtpCapabilities })) {
    console.warn(`[API] consume FAIL — router cannot consume  roomId=${roomId}  producerId=${producerId}`);
    return res.status(400).json({ error: 'Router cannot consume this producer with given rtpCapabilities' });
  }

  const consumerPeer = room.getPeer(consumerPeerId);
  if (!consumerPeer) {
    console.warn(`[API] consume FAIL — consumer peer not found  roomId=${roomId}  consumerPeerId=${consumerPeerId}`);
    return res.status(404).json({ error: 'Consumer peer not found' });
  }

  const transport = consumerPeer.getTransport(transportId);
  if (!transport) {
    console.warn(`[API] consume FAIL — transport not found  roomId=${roomId}  consumerPeerId=${consumerPeerId}  transportId=${transportId}`);
    return res.status(404).json({ error: 'Transport not found' });
  }

  // Find the peer that owns the producer so we can return producerPeerId
  let producerPeerId = null;
  for (const [pid, peer] of room.peers) {
    if (peer.getProducer(producerId)) { producerPeerId = pid; break; }
  }
  if (!producerPeerId) {
    console.warn(`[API] consume FAIL — producer not found  roomId=${roomId}  producerId=${producerId}`);
    return res.status(404).json({ error: 'Producer not found' });
  }

  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    paused: true,   // always start paused; client resumes after transport is ready
  });

  consumerPeer.addConsumer(consumer);

  consumer.on('transportclose', () => {
    consumerPeer.consumers.delete(consumer.id);
  });
  consumer.on('producerclose', () => {
    // Producer disappeared — consumer is now useless
    consumerPeer.consumers.delete(consumer.id);
    console.log(`[API] Consumer closed (producer left)  consumerId=${consumer.id}`);
  });
  consumer.on('score', (score) => {
    console.debug(`[API] Consumer score  consumerId=${consumer.id}  score=${JSON.stringify(score)}`);
  });

  console.log(`[API] consume OK  roomId=${roomId}  consumerPeerId=${consumerPeerId}  consumerId=${consumer.id}  kind=${consumer.kind}  producerPeerId=${producerPeerId}`);
  res.json({
    consumerId:    consumer.id,
    producerId:    consumer.producerId,
    kind:          consumer.kind,
    rtpParameters: consumer.rtpParameters,
    producerPeerId,
  });
}));

// ── 6. Resume consumer ──────────────────────────────────────────────────────
//
// Called after the browser has connected its recv transport.
// Only after resume does the SFU start forwarding RTP to the consumer.
//
// Request body:  { peerId }
// Response:      { resumed: true }

api.post('/rooms/:roomId/consumers/:consumerId/resume', wrap(async (req, res) => {
  const { roomId, consumerId } = req.params;
  const { peerId } = req.body;
  console.log(`[API] resume_consumer  roomId=${roomId}  peerId=${peerId}  consumerId=${consumerId}`);

  const room = roomManager.get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const peer = room.getPeer(peerId);
  if (!peer) {
    console.warn(`[API] resume_consumer FAIL — peer not found  roomId=${roomId}  peerId=${peerId}`);
    return res.status(404).json({ error: 'Peer not found' });
  }

  const consumer = peer.getConsumer(consumerId);
  if (!consumer) {
    console.warn(`[API] resume_consumer FAIL — consumer not found  roomId=${roomId}  peerId=${peerId}  consumerId=${consumerId}`);
    return res.status(404).json({ error: 'Consumer not found' });
  }

  await consumer.resume();
  console.log(`[API] resume_consumer OK  roomId=${roomId}  peerId=${peerId}  consumerId=${consumerId}`);
  res.json({ resumed: true });
}));

// ── 7. List producers ───────────────────────────────────────────────────────
//
// Called when a peer first joins so it can subscribe to already-active streams.
//
// Query params: excludePeerId (optional)
// Response:     { producers: [{ producerId, peerId, kind }] }

api.get('/rooms/:roomId/producers', wrap(async (req, res) => {
  const { roomId } = req.params;
  const { excludePeerId } = req.query;
  console.log(`[API] get_producers  roomId=${roomId}  excludePeerId=${excludePeerId}`);

  const room = roomManager.get(roomId);
  // Return empty list — no room means no one is streaming yet
  if (!room) {
    console.log(`[API] get_producers  roomId=${roomId}  result=[] (room not found)`);
    return res.json({ producers: [] });
  }

  const producers = room.getProducers({ excludePeerId });
  console.log(`[API] get_producers OK  roomId=${roomId}  count=${producers.length}`);
  res.json({ producers });
}));

// ── 8. Remove peer ──────────────────────────────────────────────────────────
//
// Called when a user disconnects from the FastAPI WebSocket.
// Closes all transports/producers/consumers for the peer.
// If the room becomes empty it is destroyed.
//
// Response: { removed: true }

api.delete('/rooms/:roomId/peers/:peerId', wrap(async (req, res) => {
  const { roomId, peerId } = req.params;
  console.log(`[API] remove_peer  roomId=${roomId}  peerId=${peerId}`);

  const room = roomManager.get(roomId);
  if (room) {
    room.removePeer(peerId);
    if (room.isEmpty) {
      roomManager.delete(roomId);
      console.log(`[API] Room destroyed (no peers left)  roomId=${roomId}`);
    } else {
      console.log(`[API] remove_peer OK  roomId=${roomId}  peerId=${peerId}  remaining_peers=${room.peers.size}`);
    }
  } else {
    console.warn(`[API] remove_peer — room not found (already destroyed)  roomId=${roomId}  peerId=${peerId}`);
  }

  res.json({ removed: true });
}));

export { api };
