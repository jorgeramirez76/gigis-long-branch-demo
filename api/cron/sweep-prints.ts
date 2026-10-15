import { cronAuthorized } from "../lib/cronAuth.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { remindStrandedOrders, sweepQueuedPrints } from "../lib/printSweep.js";
import { shopOpenForCron } from "../lib/cronHours.js";

/**
 * Scheduled follow-up on kitchen tickets recorded as still moving through
 * Clover's print queue (see printSweep.ts), plus the one reminder per stranded order.
 *
 * This is the ONLY regular print follow-up: the order request used to run an inline sweep
 * too, but that made the 25-minute stuck check traffic-driven (a ticket that queued on the
 * night's LAST order wasn't re-checked until the next order or the 4 AM menu cron) and
 * spent Clover calls in front of the customer's own checkout. This cron guarantees the
 * check during the hours somebody can act: every 20 minutes, and only while the shop is open
 * (api/lib/cronHours.ts: counter hours, Mon-Wed 10 AM-11 PM and Thu-Sun 10 AM-midnight Eastern,
 * never on a CLOSED_DATES day). Changed 2026-10-15 from every 15 minutes, 10 AM to 12:45 AM.
 * vercel.json fires at :00, :20 and :40 over UTC hours 0-4,14-23, which covers the open hours in
 * summer and winter; ticks outside them return before touching the database. A ticket queued in
 * the last minutes before close is therefore next checked at the first tick after opening.
 *
 * Auth: fail CLOSED, same shape as refresh-menu — Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`; safe to hit manually with that header.
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
  if (!shopOpenForCron()) {
    res.status(200).json({ ok: true, skipped: "shop_closed" });
    return;
  }
  const prints = await sweepQueuedPrints(); // never throws
  const strands = await remindStrandedOrders(); // never throws
  res.status(200).json({ ok: true, ...prints, strands });
}
