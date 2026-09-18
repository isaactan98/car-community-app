/**
 * Human-facing labels for runs and attendees. Pure module — unit tested.
 */

export type DayLabel = "Today" | "Tomorrow" | "Yesterday";

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today" / "Tomorrow" / "Yesterday" relative to `now`, otherwise null. */
export function relativeDay(date: Date, now: Date): DayLabel | null {
  // Round, not floor: DST days are 23 or 25 hours long.
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return null;
}

/** "Today, 6:30 AM" or "Wed, 30 Sep, 5:00 AM". Unparseable input is echoed. */
export function formatWhen(iso: string, now: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day =
    relativeDay(d, new Date(now)) ??
    d.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day}, ${time}`;
}

/** Board order for people on the way: soonest ETA first, unknown ETAs last. */
export function compareEta(
  a: { etaSeconds: number | null; displayName: string },
  b: { etaSeconds: number | null; displayName: string },
): number {
  if (a.etaSeconds !== b.etaSeconds) {
    if (a.etaSeconds === null) return 1;
    if (b.etaSeconds === null) return -1;
    return a.etaSeconds - b.etaSeconds;
  }
  return a.displayName.localeCompare(b.displayName);
}

/** Up to two initials for an avatar: "Wei Jie" → "WJ", "isaac" → "I". */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}
