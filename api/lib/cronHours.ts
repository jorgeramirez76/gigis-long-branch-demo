import { getOpenStatus } from "../../src/lib/openStatus.js";

/**
 * The two frequent crons, sweep-prints and send-scheduled, run every 20 minutes and do their
 * work ONLY while the shop is open (decided 2026-10-15): counter hours from
 * src/lib/openStatus.ts, Mon-Wed 10 AM-11 PM and Thu-Sun 10 AM-midnight Eastern, never on a
 * CLOSED_DATES day.
 *
 * Vercel Cron schedules are UTC and ignore daylight saving, so vercel.json covers the open hours
 * in both summer and winter ("*\/20 0-4,14-23 * * *") and this check turns every tick outside the
 * real Eastern hours into a no-op. It runs before any database query, so a closed-hours tick
 * never wakes Neon.
 */
export function shopOpenForCron(): boolean {
  return getOpenStatus().open;
}
