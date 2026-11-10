import type { Plan } from '../core/planner';
import { km } from './format';

const W = 640;
const H = 150;
const PAD = { left: 46, right: 12, top: 14, bottom: 22 };

/** Elevation along the route, with a tick where each stop is reached. */
export function ProfileChart({ plan }: { plan: Plan }): JSX.Element | null {
  const points = plan.profile;
  if (points.length < 2) return null;
  const total = points.at(-1)!.distanceM;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    lo = Math.min(lo, p.elevationM);
    hi = Math.max(hi, p.elevationM);
  }
  const span = Math.max(10, hi - lo);
  const x = (d: number): number => PAD.left + (d / total) * (W - PAD.left - PAD.right);
  const y = (z: number): number => PAD.top + (1 - (z - lo) / span) * (H - PAD.top - PAD.bottom);
  const line = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.distanceM).toFixed(1)},${y(p.elevationM).toFixed(1)}`)
    .join('');
  const area = `${line}L${x(total)},${H - PAD.bottom}L${x(0)},${H - PAD.bottom}Z`;

  let walked = 0;
  const stops = plan.visits.map((visit, i) => {
    walked += plan.legs[i]!.distanceM;
    return { name: visit.stop.name, d: walked, n: i + 1 };
  });

  return (
    <svg
      className="profile"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Elevation profile: ${km(total)} loop between ${lo.toFixed(0)} and ${hi.toFixed(0)} metres`}
    >
      <path d={area} className="profile-area" />
      <path d={line} className="profile-line" />
      <line
        x1={PAD.left}
        y1={H - PAD.bottom}
        x2={W - PAD.right}
        y2={H - PAD.bottom}
        className="profile-axis"
      />
      <text x={PAD.left - 6} y={y(hi) + 4} textAnchor="end">
        {hi.toFixed(0)} m
      </text>
      <text x={PAD.left - 6} y={y(lo) + 4} textAnchor="end">
        {lo.toFixed(0)} m
      </text>
      <text x={PAD.left} y={H - 6}>
        0
      </text>
      <text x={W - PAD.right} y={H - 6} textAnchor="end">
        {km(total)}
      </text>
      {stops.map((s) => (
        <g key={s.n}>
          <line x1={x(s.d)} y1={PAD.top} x2={x(s.d)} y2={H - PAD.bottom} className="profile-stop" />
          <circle cx={x(s.d)} cy={PAD.top} r={8} className="profile-badge" />
          <text x={x(s.d)} y={PAD.top + 3.5} textAnchor="middle" className="profile-badge-text">
            {s.n}
          </text>
          <title>{s.name}</title>
        </g>
      ))}
    </svg>
  );
}
