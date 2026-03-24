import { Room } from './room.js';
import { workerPool } from './worker.js';

/**
 * Singleton registry: roomId (= meeting_id) → Room.
 *
 * Rooms are created on demand when the first participant joins.
 * Rooms are destroyed automatically when the last participant leaves.
 *
 * Concurrency note:
 *   getOrCreate() is called concurrently when two peers join the same meeting
 *   at nearly the same time. A plain has/set guard is NOT safe because
 *   `await Room.create()` yields the event loop — both callers would see
 *   has(roomId)=false and create two routers, with the second overwriting
 *   the first and orphaning it in memory.
 *
 *   We fix this with a _creating Map that stores the in-flight Promise.
 *   Subsequent callers for the same roomId await the same Promise instead of
 *   launching a second Room.create().
 */
class RoomManager {
  /** @type {Map<string, Room>} */
  _rooms = new Map();

  /** @type {Map<string, Promise<Room>>} — in-flight creation promises */
  _creating = new Map();

  /**
   * Return an existing room or create a new one on the next available worker.
   * Safe to call concurrently for the same roomId.
   */
  async getOrCreate(roomId) {
    // Fast path: room already exists
    if (this._rooms.has(roomId)) {
      console.log(`[RoomManager] getOrCreate HIT  roomId=${roomId}  total_rooms=${this._rooms.size}`);
      return this._rooms.get(roomId);
    }

    // Slow path: creation already in-flight — reuse the same Promise
    if (this._creating.has(roomId)) {
      console.log(`[RoomManager] getOrCreate IN-FLIGHT  roomId=${roomId}`);
      return this._creating.get(roomId);
    }

    // First caller: start creation and store the Promise so concurrent callers
    // can await it instead of launching a duplicate Room.create().
    console.log(`[RoomManager] getOrCreate NEW  roomId=${roomId}`);
    const creationPromise = Room.create(roomId, workerPool.next())
      .then((room) => {
        this._rooms.set(roomId, room);
        this._creating.delete(roomId);
        console.log(`[RoomManager] room created  roomId=${roomId}  total_rooms=${this._rooms.size}`);
        return room;
      })
      .catch((err) => {
        this._creating.delete(roomId);
        console.error(`[RoomManager] room creation FAILED  roomId=${roomId}  error=${err.message}`);
        throw err;
      });

    this._creating.set(roomId, creationPromise);
    return creationPromise;
  }

  get(roomId) {
    return this._rooms.get(roomId) ?? null;
  }

  /**
   * Remove and close a room.
   * Called automatically when a room becomes empty, or explicitly on meeting end.
   */
  delete(roomId) {
    const room = this._rooms.get(roomId);
    if (room) {
      room.close();
      this._rooms.delete(roomId);
    }
  }

  get count() {
    return this._rooms.size;
  }
}

export const roomManager = new RoomManager();
