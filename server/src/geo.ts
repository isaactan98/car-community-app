const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance between two points, in meters (haversine). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function isValidLat(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= -90 && n <= 90;
}

export function isValidLng(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= -180 && n <= 180;
}
