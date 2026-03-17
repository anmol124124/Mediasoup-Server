import mediasoup from 'mediasoup';
import { config } from './config.js';

/**
 * Manages a pool of mediasoup Worker processes.
 *
 * Each Worker is a separate OS process running the mediasoup C++ engine.
 * Workers are assigned to rooms in round-robin to distribute CPU load.
 *
 * Scaling note:
 *   For production use os.cpus().length workers.
 *   Workers that die are logged — add auto-respawn logic here for prod.
 */
class WorkerPool {
  /** @type {import('mediasoup').types.Worker[]} */
  _workers = [];
  _nextIdx = 0;

  async init() {
    const count = config.worker.count;

    for (let i = 0; i < count; i++) {
      const worker = await mediasoup.createWorker({
        logLevel:   config.worker.logLevel,
        logTags:    config.worker.logTags,
        rtcMinPort: config.worker.rtcMinPort,
        rtcMaxPort: config.worker.rtcMaxPort,
      });

      worker.on('died', (error) => {
        console.error(`[WorkerPool] Worker PID ${worker.pid} died — ${error.message}`);
        this._workers = this._workers.filter((w) => w !== worker);
        // TODO: respawn + redistribute rooms in production
      });

      this._workers.push(worker);
      console.log(`[WorkerPool] Worker ${i + 1}/${count} started  pid=${worker.pid}`);
    }
  }

  /** Round-robin worker selection. */
  next() {
    if (this._workers.length === 0) throw new Error('No workers available');
    const worker = this._workers[this._nextIdx % this._workers.length];
    this._nextIdx = (this._nextIdx + 1) % this._workers.length;
    return worker;
  }

  get count() {
    return this._workers.length;
  }
}

export const workerPool = new WorkerPool();
