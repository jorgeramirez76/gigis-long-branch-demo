/**
 * Open/closed status computed in the restaurant's timezone (America/New_York),
 * independent of the visitor's device clock.
 *
 * TWO different clocks live here, and conflating them is the bug this file exists to avoid:
 *   COUNTER hours (hours.ts, owner-confirmed 2026-07-12) — Mon/Tue/Wed 10:00 AM–11:00 PM,
 *     Thu/Fri/Sat/Sun 10:00 AM–midnight. What getOpenStatus() reports, and what the site
 *     tells people about walking in.
 *   ONLINE ORDERING — closes at 11:00 PM every night (ORDER_LAST_HOUR), owner's call
 *     2026-08-27 via Jorge. On the late nights the counter keeps serving walk-ins after the
 *     website has stopped taking orders; the storefront hours are unchanged and still
 *     published, because the shop really is open.
 */

const OPEN_HOUR = 10;
// Counter close by JS day index (0=Sun..6=Sat). 23 = 11pm, 24 = midnight.
const CLOSE_HOUR: Record<number, number> = { 0: 24, 1: 23, 2: 23, 3: 23, 4: 24, 5: 24, 6: 24 };

/**
 * Online ordering stops at 11 PM, every day — even on the nights the counter runs to
 * midnight. Owner's rule, set 2026-08-27: a web order landing at 11:40 gives the kitchen
 * no time to make it before close. Same shape as DELIVERY_LAST_HOUR below.
 */
export const ORDER_LAST_HOUR = 23;

/** The hour online ordering actually stops on a given day — never later than
 *  ORDER_LAST_HOUR, and never later than the counter itself is open. */
function orderingCloseHour(day: number): number {
  return Math.min(CLOSE_HOUR[day] ?? 23, ORDER_LAST_HOUR);
}

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

/**
 * Whether online ordering should be ACCEPTED right now. Shared by the checkout
 * UI and the order API (tsconfig.api.json includes this file) so both gate from
 * the same hours. `graceMinutes` lets the server accept an in-flight checkout
 * that crosses the closing boundary rather than failing it mid-payment.
 */
export function isOrderingOpen(graceMinutes = 0): boolean {
  const { day, hour, minute } = nowInNY();
  const m = hour * 60 + minute;
  const close = orderingCloseHour(day) * 60;
  if (m >= OPEN_HOUR * 60 && m < close + graceMinutes) return true;
  // Just past a midnight close the day index has flipped — ordering was open
  // `graceMinutes` ago only if YESTERDAY's ORDERING (not counter) ran to midnight.
  // With the 11 PM cap that is never true; the branch stays so raising
  // ORDER_LAST_HOUR back to 24 restores the old grace behaviour correctly.
  if (m < graceMinutes) {
    const prevDay = (day + 6) % 7;
    if (orderingCloseHour(prevDay) === 24) return true;
  }
  return false;
}

/**
 * In-house delivery stops at 10 PM; the counter stays open for pickup until close.
 * Owner's rule, set 2026-08-04: the drivers finish at 10 even on the nights the kitchen runs to
 * midnight, so a delivery order taken at 10:30 has nobody to take it out.
 *
 * Computed in America/New_York like everything else here, so it can't be defeated by changing the
 * device clock — and the order API gates on the same function.
 */
export const DELIVERY_LAST_HOUR = 22; // 10 PM

export function isDeliveryOpen(graceMinutes = 0): boolean {
  // Delivery can never outlive ordering itself (e.g. before 10 AM).
  if (!isOrderingOpen(graceMinutes)) return false;
  const { hour, minute } = nowInNY();
  return hour * 60 + minute < DELIVERY_LAST_HOUR * 60 + graceMinutes;
}

/** Human-readable reason for the UI when delivery is unavailable but pickup is not. */
export function deliveryClosedReason(): string {
  return "Delivery stops at 10 PM — pickup is still available to order until 11 PM.";
}

/** One phrase for "when can I order online", used by every closed-state message so the
 *  checkout, the server's refusal and any future surface can never drift apart. */
export const ORDERING_HOURS_LINE = "Online ordering is open daily from 10 AM to 11 PM";

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
