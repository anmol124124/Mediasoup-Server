/**
 * Represents one participant's media state inside a Room.
 *
 * Each Peer owns:
 *   - transports  (WebRTC ICE/DTLS connections — typically one send + one recv)
 *   - producers   (outgoing media tracks this peer is sending)
 *   - consumers   (incoming media tracks this peer is receiving)
 */
export class Peer {
  /**
   * @param {string} peerId   UUID of the user (matches users.id in Postgres)
   */
  constructor(peerId) {
    this.id = peerId;

    /** @type {Map<string, import('mediasoup').types.WebRtcTransport>} */
    this.transports = new Map();

    /** @type {Map<string, import('mediasoup').types.Producer>} */
    this.producers = new Map();

    /** @type {Map<string, import('mediasoup').types.Consumer>} */
    this.consumers = new Map();
  }

  // ── Transports ─────────────────────────────────────────────────────────────

  addTransport(transport) {
    this.transports.set(transport.id, transport);
  }

  getTransport(transportId) {
    return this.transports.get(transportId);
  }

  // ── Producers ──────────────────────────────────────────────────────────────

  addProducer(producer) {
    this.producers.set(producer.id, producer);
  }

  getProducer(producerId) {
    return this.producers.get(producerId);
  }

  // ── Consumers ──────────────────────────────────────────────────────────────

  addConsumer(consumer) {
    this.consumers.set(consumer.id, consumer);
  }

  getConsumer(consumerId) {
    return this.consumers.get(consumerId);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Close all transports (cascades to producers + consumers automatically). */
  close() {
    for (const transport of this.transports.values()) {
      transport.close();
    }
  }
}
