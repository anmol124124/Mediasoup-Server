import { config } from './config.js';
import { Peer } from './peer.js';

/**
 * A Room maps 1:1 to a meeting_id.
 *
 * It wraps a mediasoup Router (which owns codec capabilities and routes RTP
 * between producers and consumers) and manages all Peer objects for the meeting.
 */
export class Room {
  /**
   * @param {string} roomId
   * @param {import('mediasoup').types.Router} router
   */
  constructor(roomId, router) {
    this.id = roomId;
    this.router = router;

    /** @type {Map<string, Peer>} */
    this.peers = new Map();
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  /**
   * Create a Room by spawning a new Router on the given Worker.
   * @param {string} roomId
   * @param {import('mediasoup').types.Worker} worker
   */
  static async create(roomId, worker) {
    const router = await worker.createRouter({
      mediaCodecs: config.router.mediaCodecs,
    });
    console.log(`[Room] Created  roomId=${roomId}  routerId=${router.id}`);
    return new Room(roomId, router);
  }

  // ── RTP capabilities ───────────────────────────────────────────────────────

  /** The router's RTP capabilities — sent to clients for device.load(). */
  get rtpCapabilities() {
    return this.router.rtpCapabilities;
  }

  // ── Transport factory ──────────────────────────────────────────────────────

  /**
   * Create a WebRTC transport on this room's router.
   * @param {{ direction: 'send' | 'recv' }} options
   * @returns {Promise<import('mediasoup').types.WebRtcTransport>}
   */
  async createWebRtcTransport({ direction }) {
    const transport = await this.router.createWebRtcTransport({
      ...config.webRtcTransport,
      appData: { direction }, // tag so we can find recv transports when consuming
    });

    transport.on('dtlsstatechange', (state) => {
      if (state === 'failed' || state === 'closed') {
        console.warn(
          `[Room] Transport DTLS ${state}  transportId=${transport.id}  roomId=${this.id}`,
        );
        transport.close();
      }
    });

    return transport;
  }

  // ── Peer management ────────────────────────────────────────────────────────

  getOrCreatePeer(peerId) {
    if (!this.peers.has(peerId)) {
      this.peers.set(peerId, new Peer(peerId));
    }
    return this.peers.get(peerId);
  }

  getPeer(peerId) {
    return this.peers.get(peerId) ?? null;
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.close();
      this.peers.delete(peerId);
      console.log(`[Room] Peer removed  peerId=${peerId}  roomId=${this.id}`);
    }
  }

  // ── Producer discovery ─────────────────────────────────────────────────────

  /**
   * Return all active producers in the room, optionally excluding one peer.
   * Used when a new participant needs to consume existing streams.
   */
  getProducers({ excludePeerId } = {}) {
    const result = [];
    for (const [peerId, peer] of this.peers) {
      if (peerId === excludePeerId) continue;
      for (const producer of peer.producers.values()) {
        result.push({ peerId, producerId: producer.id, kind: producer.kind });
      }
    }
    return result;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  get isEmpty() {
    return this.peers.size === 0;
  }

  close() {
    for (const peer of this.peers.values()) peer.close();
    this.router.close();
    console.log(`[Room] Closed  roomId=${this.id}`);
  }
}
