import { cronAuthorized } from "../lib/cronAuth.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { remindStrandedOrders, sweepQueuedPrints } from "../lib/printSweep.js";

/**
 * Scheduled follow-up on kitchen tickets recorded as still moving through
 * Clover's print queue (see printSweep.ts).
 *
 * The sweep also runs opportunistically at the start of every order request,
 * but that made the 25-minute stuck check traffic-driven: a ticket that queued
 * on the night's LAST order wasn't re-checked until the next order or the 4 AM
 * menu cron — a page into an empty store, hours after anyone could act. This
 * cron guarantees the check during the hours somebody can: every 15 minutes,
 * UTC hours 14-23,0-4 (vercel.json). That is 10 AM to 12:45 AM Eastern in summer
 * and 9 AM to 11:45 PM in winter, so it covers 10 AM to 11 PM online ordering plus
 * the stuck-ticket window after the last order in either season. No overnight runs on purpose: the hours gate means
 * no new orders exist after close, so a night check could only ever wake Kenny
 * for something he can't do anything about until morning.
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
  const prints = await sweepQueuedPrints(); // never throws
  const strands = await remindStrandedOrders(); // never throws
  res.status(200).json({ ok: true, ...prints, strands });
}
