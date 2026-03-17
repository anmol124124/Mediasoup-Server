import { Room } from './room.js';
import { workerPool } from './worker.js';

/**
 * Singleton registry: roomId (= meeting_id) → Room.
 *
 * Rooms are created on demand when the first participant joins.
 * Rooms are destroyed automatically when the last participant leaves.
 */
class RoomManager {
  /** @type {Map<string, Room>} */
  _rooms = new Map();

  /**
   * Return an existing room or create a new one on the next available worker.
   * Safe to call concurrently for the same roomId — creation is synchronous
   * once the router promise resolves (no race with Map.has + Map.set).
   */
  async getOrCreate(roomId) {
    if (this._rooms.has(roomId)) {
      return this._rooms.get(roomId);
    }
    const room = await Room.create(roomId, workerPool.next());
    this._rooms.set(roomId, room);
    return room;
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
