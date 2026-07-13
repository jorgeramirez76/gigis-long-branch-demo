/**
 * Open/closed status computed in the restaurant's timezone (America/New_York),
 * independent of the visitor's device clock. Hours (from hours.ts):
 *   Mon/Tue/Wed  10:00 AM – 11:00 PM
 *   Thu/Fri/Sat/Sun  10:00 AM – 12:00 AM (midnight)
 */

const OPEN_HOUR = 10;
// Close hour by JS day index (0=Sun..6=Sat). 23 = 11pm, 24 = midnight.
const CLOSE_HOUR: Record<number, number> = { 0: 24, 1: 23, 2: 23, 3: 23, 4: 24, 5: 24, 6: 24 };

export type OpenStatus = {
  open: boolean;
  /** Short label, e.g. "Open now", "Closed · opens 10 AM", "Open till midnight". */
  label: string;
  /** True only in the last hour before close. */
  closingSoon: boolean;
};

/** Current {day 0-6, hour 0-23, minute} in America/New_York. */
function nowInNY(): { day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // some environments render midnight as 24
  return { day: dayMap[get("weekday")] ?? 0, hour, minute: parseInt(get("minute"), 10) || 0 };
}

export function getOpenStatus(): OpenStatus {
  const { day, hour } = nowInNY();
  const close = CLOSE_HOUR[day] ?? 23;
  const open = hour >= OPEN_HOUR && hour < close;
  if (!open) {
    return { open: false, label: "Closed · opens 10 AM", closingSoon: false };
  }
  const closingSoon = hour >= close - 1;
  const label = close === 24 ? "Open till midnight" : "Open now";
  return { open: true, label, closingSoon };
}
