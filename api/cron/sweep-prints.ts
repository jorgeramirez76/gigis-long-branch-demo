import { cronAuthorized } from "../lib/cronAuth.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { remindStrandedOrders, sweepQueuedPrints } from "../lib/printSweep.js";
import { cronGateApplies, sweepWindowOpen } from "../lib/cronHours.js";

/**
 * Scheduled follow-up on kitchen tickets recorded as still moving through
 * Clover's print queue (see printSweep.ts), plus the one reminder per stranded order.
 *
 * This is the ONLY regular print follow-up: the order request used to run an inline sweep
 * too, but that made the 25-minute stuck check traffic-driven (a ticket that queued on the
 * night's LAST order wasn't re-checked until the next order or the 4 AM menu cron) and
 * spent Clover calls in front of the customer's own checkout. This cron guarantees the
 * check during the hours somebody can act: every 20 minutes while online ordering is open, plus
 * a 45-minute tail after the 11 PM close so the night's last tickets are still checked while
 * staff are closing up (api/lib/cronHours.ts; the last tick that runs is 11:40 PM, the midnight
 * one never does). Changed 2026-10-15 from every 15 minutes, 10 AM to 12:45 AM. vercel.json fires
 * at :00, :20 and :40 over UTC hours 0-4,14-23, which covers those hours in summer and winter;
 * ticks outside the window return before touching the database. No run on a CLOSED_DATES day
 * (no orders can exist) and none overnight.
 *
 * Auth: fail CLOSED, same shape as refresh-menu — Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`; safe to hit manually with that header, at any hour:
 * only Vercel's scheduled hits are held to the window.
 */

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/sweep-prints] CRON_SECRET not set — refusing to run");
    res.status(503).json({ error: "cron_not_configured" });
    return;
  }
  if (!cronAuthorized(req.headers.authorization, secret)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (cronGateApplies(req.headers["user-agent"]) && !sweepWindowOpen()) {
    res.status(200).json({ ok: true, skipped: "shop_closed" });
    return;
  }
  const prints = await sweepQueuedPrints(); // never throws
  const strands = await remindStrandedOrders(); // never throws
  res.status(200).json({ ok: true, ...prints, strands });
}
