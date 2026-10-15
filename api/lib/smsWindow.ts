/**
 * When a marketing text blast may START, in the shop's own time zone.
 *
 * The federal rule for telephone solicitations is 8 AM to 9 PM at the recipient's location
 * (47 CFR 64.1200(c)(1)); whether it reaches double-opted-in VIP members is debated, but
 * texting the whole list at 11 PM is how a mistake turns into complaints either way. Nothing
 * checked the clock before: a hand-fired blast went out at any hour, and the scheduled queue
 * ran until 12:45 AM (its cron hours are UTC, so the window also moved with daylight saving).
 *
 * The window here is deliberately inside the legal one: no blast starts before 9:00 AM or at/after
 * 8:30 PM Eastern, because a blast takes minutes to fan out (up to the 300 s function cap) and
 * must be finished well before 9 PM. Email is not limited. Computed with Intl in
 * America/New_York, so it is correct across DST — never from the UTC cron hours.
 */
export const SMS_WINDOW_OPENS_MIN = 9 * 60; // 9:00 AM Eastern
export const SMS_WINDOW_LAST_START_MIN = 20 * 60 + 30; // 8:30 PM Eastern
export const SMS_WINDOW_LABEL = "9 AM to 8:30 PM Eastern";

function minutesInNewYork(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return (get("hour") % 24) * 60 + get("minute");
}

/** Whether an SMS blast may start at `now` (pass the clock in; tests and the cron do). */
export function smsSendWindowOpen(now: Date = new Date()): boolean {
  const m = minutesInNewYork(now);
  return m >= SMS_WINDOW_OPENS_MIN && m < SMS_WINDOW_LAST_START_MIN;
}
