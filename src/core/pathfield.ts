/**
 * Least-energy cost fields over a terrain grid (Dijkstra on an 8-connected
 * lattice). One field answers "what does it cost to walk from the source to
 * every cell" (direction `from`) or "from every cell back to the source"
 * (direction `to`). The two differ because climbing costs more than
 * descending.
 */
import type { SuitProfile } from './cost';
import { stepCost } from './cost';
import type { TerrainGrid } from './terrain';

export type FieldDirection = 'from' | 'to';

export interface CostField {
  source: number;
  direction: FieldDirection;
  /** Metabolic energy in joules; Infinity where unreachable. */
  energy: Float64Array;
  /** Walking time in seconds along the least-energy path. */
  seconds: Float64Array;
  /** Neighbouring cell on the least-energy path towards the source; -1 at the source. */
  parent: Int32Array;
}

/** Binary min-heap of (key, id) pairs backed by typed arrays. */
class MinHeap {
  private keys: Float64Array;
  private ids: Int32Array;
  size = 0;

  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.ids = new Int32Array(capacity);
  }

  push(key: number, id: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      keys.set(this.keys);
      this.keys = keys;
      const ids = new Int32Array(this.size * 2);
      ids.set(this.ids);
      this.ids = ids;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= key) break;
      this.keys[i] = this.keys[p]!;
      this.ids[i] = this.ids[p]!;
      i = p;
    }
    this.keys[i] = key;
    this.ids[i] = id;
  }

  /** Removes the smallest entry and returns its id; read `lastKey` for its key. */
  lastKey = 0;
  pop(): number {
    const topId = this.ids[0]!;
    this.lastKey = this.keys[0]!;
    const key = this.keys[--this.size]!;
    const id = this.ids[this.size]!;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.keys[child + 1]! < this.keys[child]!) child++;
      if (this.keys[child]! >= key) break;
      this.keys[i] = this.keys[child]!;
      this.ids[i] = this.ids[child]!;
      i = child;
    }
    this.keys[i] = key;
    this.ids[i] = id;
    return topId;
  }
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  /*    */ [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * @param slopeDeg per-cell steepest slope (see computeSlopeDeg); cells steeper
 *   than the suit limit are never entered, whatever the direction of travel,
 *   so the route cannot contour across a hillside that is too steep to stand on.
 */
export function computeCostField(
  grid: TerrainGrid,
  slopeDeg: Float32Array,
  profile: SuitProfile,
  source: number,
  direction: FieldDirection,
): CostField {
  const { width: w, height: h, elevation: z, cellSizeX: dx, cellSizeY: dy } = grid;
  const n = w * h;
  const energy = new Float64Array(n).fill(Infinity);
  const seconds = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const field: CostField = { source, direction, energy, seconds, parent };
  if (source < 0 || source >= n || Number.isNaN(z[source]!)) return field;

  const stepLength = NEIGHBOURS.map(([ox, oy]) => Math.hypot(ox * dx, oy * dy));
  const heap = new MinHeap(4096);
  energy[source] = 0;
  seconds[source] = 0;
  heap.push(0, source);

  while (heap.size > 0) {
    const u = heap.pop();
    if (heap.lastKey > energy[u]!) continue; // stale entry
    const ux = u % w;
    const uy = (u - ux) / w;
    const zu = z[u]!;
    for (let k = 0; k < 8; k++) {
      const [ox, oy] = NEIGHBOURS[k]!;
      const vx = ux + ox;
      const vy = uy + oy;
      if (vx < 0 || vx >= w || vy < 0 || vy >= h) continue;
      const v = vy * w + vx;
      const zv = z[v]!;
      if (Number.isNaN(zv)) continue;
      const cellSlope = slopeDeg[v]!;
      if (cellSlope > profile.maxSlopeDeg) continue; // NaN (grid edge) is allowed through
      // `from`: the walker steps u -> v. `to`: the walker steps v -> u.
      const rise = direction === 'from' ? zv - zu : zu - zv;
      const cost = stepCost(profile, stepLength[k]!, rise);
      if (!cost) continue;
      const candidate = energy[u]! + cost.joules;
      if (candidate < energy[v]!) {
        energy[v] = candidate;
        seconds[v] = seconds[u]! + cost.seconds;
        parent[v] = u;
        heap.push(candidate, v);
      }
    }
  }
  return field;
}

/**
 * Cells on the least-energy path between the field's source and `target`,
 * ordered in the direction of travel. Empty when the target is unreachable.
 */
export function tracePath(field: CostField, target: number): number[] {
  if (target < 0 || !Number.isFinite(field.energy[target] ?? Infinity)) return [];
  const cells: number[] = [];
  for (let c = target; c !== -1; c = field.parent[c]!) cells.push(c);
  return field.direction === 'from' ? cells.reverse() : cells;
}
