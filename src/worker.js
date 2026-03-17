import mediasoup from 'mediasoup';
import { config } from './config.js';

/**
 * Manages a pool of mediasoup Worker processes.
 *
 * Each Worker is a separate OS process running the mediasoup C++ engine.
 * Workers are assigned to rooms in round-robin to distribute CPU load.
 *
 * Production notes:
 *   - Set WORKER_COUNT to os.cpus().length (or cores - 1) for best throughput.
 *   - Workers that die are automatically respawned.
 *   - If all workers die and respawn fails, the process exits so Docker/systemd
 *     can restart the container from a clean state.
 */
class WorkerPool {
  /** @type {import('mediasoup').types.Worker[]} */
  _workers = [];
  _nextIdx = 0;

  async init() {
    const count = config.worker.count;
    for (let i = 0; i < count; i++) {
      await this._spawnWorker(i + 1, count);
    }
  }

  /**
   * Spawn one mediasoup Worker and attach the 'died' respawn handler.
   * @param {number} [num]   display index (1-based), for logging only
   * @param {number} [total] total workers expected, for logging only
   */
  async _spawnWorker(num, total) {
    const worker = await mediasoup.createWorker({
      logLevel:   config.worker.logLevel,
      logTags:    config.worker.logTags,
      rtcMinPort: config.worker.rtcMinPort,
      rtcMaxPort: config.worker.rtcMaxPort,
    });

    if (num && total) {
      console.log(`[WorkerPool] Worker ${num}/${total} started  pid=${worker.pid}`);
    } else {
      console.log(`[WorkerPool] Worker (re)spawned  pid=${worker.pid}`);
    }

    worker.on('died', async (error) => {
      console.error(
        `[WorkerPool] Worker pid=${worker.pid} died — ${error.message}. Respawning…`,
      );
      this._workers = this._workers.filter((w) => w !== worker);

      try {
        await this._spawnWorker();
        console.log('[WorkerPool] Respawn successful.');
      } catch (spawnErr) {
        console.error('[WorkerPool] Respawn failed:', spawnErr.message);
        if (this._workers.length === 0) {
          console.error('[WorkerPool] No workers remain. Exiting so the container can be restarted.');
          process.exit(1);
        }
      }
    });

    this._workers.push(worker);
    return worker;
  }

  /** Round-robin worker selection. */
  next() {
    if (this._workers.length === 0) throw new Error('No workers available');
    const worker = this._workers[this._nextIdx % this._workers.length];
    this._nextIdx = (this._nextIdx + 1) % this._workers.length;
    return worker;
  }

  /** Expose the array for graceful shutdown (index.js reads this). */
  get workers() {
    return this._workers;
  }

  get count() {
    return this._workers.length;
  }
}

export const workerPool = new WorkerPool();
