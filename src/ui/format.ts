export const km = (m: number): string => `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
export const kg = (v: number): string => `${v.toFixed(2)} kg`;
export const hm = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds / 60));
  return total < 60
    ? `${total} min`
    : `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
};
export const signed = (v: number, digits = 0): string => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
export const degC = (v: number | null | undefined): string =>
  v === null || v === undefined ? 'n/a' : `${signed(v)} °C`;
export const coord = (lat: number, lon: number): string =>
  `${Math.abs(lat).toFixed(4)}°${lat < 0 ? 'S' : 'N'}, ${lon.toFixed(4)}°E`;
