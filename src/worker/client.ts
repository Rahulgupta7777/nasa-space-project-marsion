import type { Plan, PlanRequest } from '../core/planner';
import type { TerrainGrid } from '../core/terrain';
import type { WorkerRequest, WorkerResponse } from './protocol';

export interface PlanResult {
  plan: Plan;
  envelope: Float32Array;
  elapsedMs: number;
}

/** Promise wrapper around the planner worker. Only the newest request resolves. */
export class PlannerClient {
  private worker = new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (r: PlanResult | null) => void; reject: (e: Error) => void }
  >();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
      const message = event.data;
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.type === 'error') waiting.reject(new Error(message.message));
      else waiting.resolve(message.id === this.nextId - 1 ? message : null);
    };
  }

  setTerrain(grid: TerrainGrid): void {
    const message: WorkerRequest = {
      type: 'terrain',
      width: grid.width,
      height: grid.height,
      bounds: grid.bounds,
      elevation: grid.elevation.slice(),
      source: grid.source,
    };
    this.worker.postMessage(message, [message.elevation.buffer]);
  }

  /** Resolves with null when a newer request has superseded this one. */
  plan(request: PlanRequest): Promise<PlanResult | null> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'plan', id, request } satisfies WorkerRequest);
    });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
