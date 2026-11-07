import type { Bounds } from '../core/geo';
import type { Plan, PlanRequest } from '../core/planner';

export type WorkerRequest =
  | {
      type: 'terrain';
      width: number;
      height: number;
      bounds: Bounds;
      elevation: Float32Array;
      source: string;
    }
  | { type: 'plan'; id: number; request: PlanRequest };

export type WorkerResponse =
  | { type: 'plan'; id: number; plan: Plan; envelope: Float32Array; elapsedMs: number }
  | { type: 'error'; id: number; message: string };
