/// <reference lib="webworker" />
/**
 * Runs the planner off the main thread so the map stays responsive while
 * cost fields are computed over a quarter of a million terrain cells.
 */
import type { FieldCache } from '../core/planner';
import { planSortie, returnEnvelope } from '../core/planner';
import type { TerrainGrid } from '../core/terrain';
import { computeSlopeDeg, makeGrid } from '../core/terrain';
import type { WorkerRequest, WorkerResponse } from './protocol';

let grid: TerrainGrid | null = null;
let slope: Float32Array | null = null;
let cache: FieldCache = new Map();
let cacheKey = '';

const post = (message: WorkerResponse, transfer: Transferable[] = []): void => {
  (self as DedicatedWorkerGlobalScope).postMessage(message, transfer);
};

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const message = event.data;
  if (message.type === 'terrain') {
    grid = makeGrid(
      message.width,
      message.height,
      message.bounds,
      message.elevation,
      message.source,
    );
    slope = computeSlopeDeg(grid);
    cache = new Map();
    return;
  }
  try {
    if (!grid || !slope) throw new Error('Terrain has not been loaded yet.');
    const started = performance.now();
    // Cost fields depend only on terrain and suit; reuse them until the suit changes.
    const key = JSON.stringify(message.request.profile);
    if (key !== cacheKey) {
      cache = new Map();
      cacheKey = key;
    }
    const plan = planSortie(grid, slope, message.request, cache);
    const envelope = returnEnvelope(
      grid,
      slope,
      message.request.habitat,
      message.request.profile,
      cache,
    );
    // Keep the habitat and current stops only; a moved habitat would otherwise leak fields.
    if (cache.size > 40) cache = new Map();
    post({ type: 'plan', id: message.id, plan, envelope, elapsedMs: performance.now() - started }, [
      envelope.buffer,
    ]);
  } catch (error) {
    post({
      type: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
