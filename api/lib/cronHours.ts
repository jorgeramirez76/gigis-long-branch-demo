import { isCounterOpenNow, isOrderingOpen } from "../../src/lib/openStatus.js";
import { isVercelCron } from "./menuSchedule.js";

/**
 * The two frequent crons, sweep-prints and send-scheduled, fire every 20 minutes (vercel.json
 * "*\/20 0-4,14-23 * * *", UTC, which covers the shop's hours in summer and winter) and do their
 * work only while the shop is open (decided 2026-10-15). Vercel Cron is UTC and knows nothing
 * about daylight saving, so the real Eastern gate lives here and every tick outside it returns
 * before any database query: a closed-hours tick never wakes Neon.
 *
 * Two windows, because the two jobs answer to different clocks:
 *  - sweep-prints follows ONLINE ORDERING (10 AM to 11 PM, src/lib/openStatus.ts) plus a short
 *    tail, so the last orders of the night still get their stuck-ticket check while staff are
 *    closing up. The tail covers the 5-minute post-close grace the order API allows, the
 *    25-minute stuck threshold (api/lib/printSweep.ts) and the wait for the next tick, so the
 *    11:40 PM tick is the last one that runs and the midnight tick never does. Without it a
 *    ticket queued at 10:50 PM would first be looked at by the 4 AM menu cron's backstop sweep,
 *    which pages staff at 4 AM. A CLOSED_DATES day takes no orders, so no sweep runs on it.
 *  - send-scheduled follows the COUNTER's weekday hours (Mon-Wed 10 AM-11 PM, Thu-Sun to
 *    midnight) and ignores CLOSED_DATES on purpose: the one blast anyone queues for a closed day
 *    is the "we're closed today" notice, and it must go out that morning, not the next open day.
 *
 * Only Vercel's own scheduled hits are gated (isVercelCron, as refresh-menu and daily-digest do):
 * a person running either job by hand with CRON_SECRET, at any hour, still gets the work done.
 */

/** Minutes after the 11 PM ordering close during which the sweep still runs (5 grace + 25 stuck
 *  + one 20-minute tick, rounded so the midnight tick stays off). */
export const SWEEP_TAIL_MINUTES = 45;

export function sweepWindowOpen(): boolean {
  return isOrderingOpen(SWEEP_TAIL_MINUTES);
}

export function blastWindowOpen(): boolean {
  return isCounterOpenNow();
}

/** True for the hits Vercel Cron sends on the schedule; a hand-run hit with the secret is never gated. */
export function cronGateApplies(userAgent: string | string[] | undefined): boolean {
  return isVercelCron(userAgent);
}
