/**
 * Pool of terrain generation workers. Falls back to synchronous generation on
 * the main thread when workers are unavailable (tests, old browsers).
 */

import type { DimId } from './constants';
import type { DimensionGenerator, GeneratedChunk } from './generator';

type Callback = (chunk: GeneratedChunk, ms: number) => void;

interface Pending { dim: DimId; cb: Callback }

export class GenerationPool {
  private workers: Worker[] = [];
  private next = 0;
  private reqId = 0;
  private pending = new Map<number, Pending>();
  private inFlight: number[] = [];
  readonly maxInFlightPerWorker = 3;
  totalMs = 0;
  totalChunks = 0;

  constructor(private readonly seed: number, private readonly fallback: (dim: DimId) => DimensionGenerator) {
    if (typeof Worker === 'undefined') return;
    const count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < count; i++) {
      try {
        const w = new Worker(new URL('../worldgen/worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this.onMessage(i, e.data);
        w.onerror = (err) => console.error('generation worker error', err);
        this.workers.push(w);
        this.inFlight.push(0);
      } catch (err) {
        console.warn('Workers unavailable, generating on main thread', err);
        break;
      }
    }
  }

  get workerCount(): number {
    return this.workers.length;
  }

  /** Whether more requests can be queued right now. */
  canAccept(): boolean {
    if (this.workers.length === 0) return true;
    return this.inFlight.some((n) => n < this.maxInFlightPerWorker);
  }

  request(dim: DimId, cx: number, cz: number, cb: Callback): void {
    if (this.workers.length === 0) {
      const t0 = performance.now();
      const chunk = this.fallback(dim).generateTerrain(cx, cz);
      const ms = performance.now() - t0;
      this.totalMs += ms;
      this.totalChunks++;
      cb(chunk, ms);
      return;
    }
    // Pick the least loaded worker.
    let best = 0;
    for (let i = 1; i < this.workers.length; i++) if (this.inFlight[i] < this.inFlight[best]) best = i;
    const id = ++this.reqId;
    this.pending.set(id, { dim, cb });
    this.inFlight[best]++;
    this.workers[best].postMessage({ id, seed: this.seed, dim, cx, cz });
    this.next = (best + 1) % this.workers.length;
  }

  private onMessage(worker: number, data: GeneratedChunk & { id: number; ms: number }): void {
    this.inFlight[worker] = Math.max(0, this.inFlight[worker] - 1);
    const p = this.pending.get(data.id);
    if (!p) return;
    this.pending.delete(data.id);
    this.totalMs += data.ms;
    this.totalChunks++;
    p.cb(data, data.ms);
  }

  /** Drop callbacks for outstanding requests (dimension change / world exit). */
  cancelAll(): void {
    this.pending.clear();
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.pending.clear();
  }
}
