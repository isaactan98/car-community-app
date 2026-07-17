/**
 * Waze deep-link builder (R5). Pure module — unit tested.
 * Format per docs/CONTRACT.md:
 *   https://waze.com/ul?ll=<lat>,<lng>&navigate=yes
 */
export function wazeUrl(lat: number, lng: number): string {
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
}
