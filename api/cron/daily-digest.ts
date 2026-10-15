import { pruneMetrics } from "../lib/metrics.js";
import { isVercelCron, menuRefreshWindow } from "../lib/menuSchedule.js";
import { cronAuthorized } from "../lib/cronAuth.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "../lib/db.js";
import { getOrderSummary, listOpenWebsiteOrders } from "../lib/clover.js";
import { getCaptureByCloverId, listWorklistCandidates } from "../lib/orderStore.js";
import { pruneExpiredAccountRows } from "../lib/accountStore.js";
import { pruneRateCounters } from "../lib/rateLimit.js";
import { sendEmail } from "../lib/notify.js";
import { CLOSED_DATES } from "../../src/lib/openStatus.js";

/**
 * Daily health digest, emailed to the owner every morning (sibling of Sea Bright's — same
 * shape, this shop's own data and credentials, per the never-share-infra rule).
 *
 * Kenny and staff are deliberately NOT on this: texts are for food-at-risk moments. The owner
 * gets one email — yesterday's orders, every open website ticket classified paid/owed/unknown,
 * anything stuck in the ledger, and whether the menu machinery is fresh. Every section fails
 * SOFT but VISIBLE, because "no news" must mean checked-and-clean, never the-checker-broke.
 */

const DIGEST_TO = process.env.DIGEST_EMAIL || "";
const SHOP = "Gigi's Long Branch";


const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Checkout opens recorded yesterday by the first-party metrics (CartDrawer's Checkout button).
 *  A lower bound — DNT/GPC visitors are never counted. Null when the table can't be read. */
async function checkoutStartsYesterday(): Promise<number | null> {
  try {
    const r = await sql`
      SELECT COALESCE(sum(n), 0)::int AS n FROM site_metric_daily
      WHERE business = 'gigis_long_branch' AND event = 'checkout_start'
        AND day = (now() AT TIME ZONE 'America/New_York')::date - 1
    `;
    return Number(r.rows[0]?.n ?? 0);
  } catch {
    return null;
  }
}

/** Customers who opened checkout yesterday with not one order getting through is how a silent
 *  outage looks from here: refused attempts are deleted from the ledger, so the order list alone
 *  just says "no web orders". Sea Bright refused every checkout Oct 6-10 and the digest said
 *  exactly that for four mornings. Skipped on a day the owner closed (CLOSED_DATES). */
const REFUSAL_SIGNAL_MIN_STARTS = 3;
export function checkoutOutageLine(starts: number | null, paidOrders: number): string | null {
  if (starts == null || paidOrders > 0 || starts < REFUSAL_SIGNAL_MIN_STARTS) return null;
  const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() - 24 * 3600e3));
  if (CLOSED_DATES[yesterday]) return null;
  return `${starts} visitors opened checkout yesterday, but no web order went through — checkout may have been refusing orders. Place a test order (or check the Vercel logs for /api/order/create).`;
}

type Section = { title: string; lines: string[]; attention: boolean };

async function section(title: string, fn: () => Promise<{ lines: string[]; attention: boolean }>): Promise<Section> {
  try {
    const r = await fn();
    return { title, ...r };
  } catch (e) {
    console.error(`[daily-digest] section "${title}" failed`, e);
    return { title, lines: [`Could not check — ${e instanceof Error ? e.message : "error"}. Treat as unknown, not clean.`], attention: true };
  }
}

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ error: "cron_not_configured" });
    return;
  }
  if (!cronAuthorized(req.headers.authorization, secret)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  if (isVercelCron(req.headers["user-agent"]) && !menuRefreshWindow(new Date(),7).shouldRun) {
    return void res.status(200).json({ok:true,skipped:"outside_7am_eastern"});
  }
  await pruneMetrics("gigis_long_branch").catch(() => console.warn("[metrics] retention cleanup unavailable"));
  await pruneExpiredAccountRows().catch(() => console.warn("[accounts] expired link/session cleanup unavailable"));
  await pruneRateCounters().catch(() => console.warn("[rateLimit] finished-window cleanup unavailable"));
  if (!DIGEST_TO || !(process.env.DIGEST_FROM || process.env.EMAIL_FROM)) return void res.status(503).json({ error: "digest_not_configured" });

  const sections: Section[] = [];

  sections.push(
    await section("Yesterday's orders", async () => {
      const r = await sql`
        SELECT status, count(*)::int AS n, COALESCE(sum(total), 0)::int AS cents
        FROM web_orders
        WHERE (created_at AT TIME ZONE 'America/New_York')::date = (now() AT TIME ZONE 'America/New_York')::date - 1
        GROUP BY status ORDER BY n DESC
      `;
      const paidish = new Set(["paid", "paid_print_queued", "paid_print_failed", "charged", "paid_unrouted"]);
      const paidOrders = r.rows.filter((row) => paidish.has(String(row.status))).reduce((a, row) => a + Number(row.n), 0);
      const outage = checkoutOutageLine(await checkoutStartsYesterday(), paidOrders);
      if (r.rows.length === 0) return { lines: ["No web orders yesterday.", ...(outage ? [outage] : [])], attention: !!outage };
      let count = 0;
      let cents = 0;
      const lines = r.rows.map((row) => {
        const n = Number(row.n);
        const c = Number(row.cents);
        count += n;
        if (paidish.has(String(row.status))) cents += c;
        return `${n}x ${row.status} (${money(c)})`;
      });
      lines.unshift(`${count} order(s), ${money(cents)} paid volume.`);
      if (outage) lines.push(outage);
      return { lines, attention: !!outage };
    }),
  );

  sections.push(
    await section("Open tickets in Clover", async () => {
      const { orders } = await listOpenWebsiteOrders();
      const seen = new Set(orders.map((o) => o.id));
      const candidates = (await listWorklistCandidates()).filter((c) => !seen.has(c.cloverOrderId)).slice(0, 30);
      for (const c of candidates) {
        try {
          const sum = await getOrderSummary(c.cloverOrderId);
          if (String(sum.state ?? "").toLowerCase() === "open" && typeof sum.title === "string" && /^WEBSITE(\s+ORDER)?\s+[•·]/i.test(sum.title)) {
            orders.push({ id: sum.id, title: sum.title, state: sum.state, total: sum.total, note: sum.note, paymentCount: sum.paymentCount, lineItemCount: sum.lineItemCount, paymentState: sum.paymentState, createdTime: sum.createdTime });
          }
        } catch {
          /* deleted ticket — not open */
        }
      }
      const paid: string[] = [];
      const owed: string[] = [];
      const unknown: string[] = [];
      for (const o of orders) {
        const label = `${o.id} ${money(o.total ?? 0)}${o.createdTime ? ` (${new Date(o.createdTime).toISOString().slice(0, 10)})` : ""}`;
        try {
          const cap = await getCaptureByCloverId(o.id);
          if (o.paymentCount === 0 && cap?.chargeId) paid.push(`${label} — ${cap.customerName}`);
          else if (!cap?.chargeId) owed.push(`${label}${cap ? ` — ${cap.customerName}` : ""}`);
        } catch {
          unknown.push(label);
        }
      }
      const lines: string[] = [];
      if (paid.length) lines.push(`PAID ONLINE, do NOT ring up — void when settled: ${paid.join("; ")}`);
      if (owed.length) lines.push(`UNVERIFIED draft — check payment records; do NOT collect again: ${owed.join("; ")}`);
      if (unknown.length) lines.push(`Ledger unreachable for: ${unknown.join("; ")} — treat as unknown.`);
      if (!lines.length) lines.push("None — the open list is clean.");
      return { lines, attention: paid.length + owed.length + unknown.length > 0 };
    }),
  );

  sections.push(
    await section("Orders needing eyes", async () => {
      const r = await sql`
        SELECT id, status, total, customer_name, created_at
        FROM web_orders
        WHERE status IN ('pending', 'charged', 'paid_unrouted', 'capture_uncertain', 'paid_print_queued', 'routing_uncertain')
          AND created_at < now() - interval '1 hour'
        ORDER BY created_at DESC LIMIT 10
      `;
      if (!r.rows.length) return { lines: ["None — every recent order reached a settled state."], attention: false };
      return {
        lines: r.rows.map((row) => `#${row.id} ${row.status} ${money(Number(row.total ?? 0))} ${row.customer_name ?? ""} (${String(row.created_at).slice(0, 10)})`),
        attention: true,
      };
    }),
  );

  sections.push(
    await section("Scheduled blasts", async () => {
      // A queued blast's outcome is written to its row and nowhere else, so a failed or hung one
      // was invisible. Created lazily by send-scheduled; a fresh database simply has none.
      const exists = await sql`SELECT to_regclass('public.scheduled_broadcasts') IS NOT NULL AS ok`;
      if (!exists.rows[0]?.ok) return { lines: ["None scheduled."], attention: false };
      const r = await sql`
        SELECT id, send_at, started_at, finished_at, result->>'status' AS status,
               result->>'error' AS error, result->>'inProgress' AS in_progress
        FROM scheduled_broadcasts
        WHERE (finished_at > now() - interval '26 hours'
               AND (COALESCE(result->>'status', '') <> '200' OR result->>'inProgress' = 'true'))
           OR (started_at IS NOT NULL AND finished_at IS NULL AND started_at < now() - interval '15 minutes')
        ORDER BY id DESC LIMIT 10
      `;
      if (!r.rows.length) return { lines: ["No failed or stuck scheduled blasts."], attention: false };
      return {
        lines: r.rows.map((row) =>
          row.finished_at == null
            ? `#${row.id} started ${String(row.started_at).slice(0, 16)} and never finished — check History before re-sending.`
            : String(row.in_progress) === "true"
              ? `#${row.id} sent with some failures — check History and provider records before re-sending.`
              : `#${row.id} failed (${row.status ?? "?"}${row.error ? ` ${row.error}` : ""}) — nothing may have gone out.`,
        ),
        attention: true,
      };
    }),
  );

  sections.push(
    await section("Menu machinery", async () => {
      const snap = await sql`SELECT updated_at, item_count FROM menu_snapshot WHERE business = 'gigis_long_branch'`;
      const s = snap.rows[0];
      if (!s) return { lines: ["No live menu snapshot exists."], attention: true };
      const ageH = Math.round((Date.now() - new Date(String(s.updated_at)).getTime()) / 3600e3);
      // Nightly cron: much older than a day means the shop is serving stale prices.
      return { lines: [`Live menu snapshot: ${s.item_count} items, refreshed ${ageH}h ago.`], attention: ageH > 30 };
    }),
  );

  const attention = sections.filter((s) => s.attention);
  const subject = attention.length
    ? `⚠ ${SHOP} — ${attention.length} item(s) need attention`
    : `${SHOP} — all clear`;
  const body = sections
    .map((s) => `${s.attention ? "!! " : "ok "}${s.title}\n${s.lines.map((l) => `   ${l}`).join("\n")}`)
    .join("\n\n");

  const sent = await sendEmail(DIGEST_TO, subject, body);
  res.status(sent.sent ? 200 : 502).json({ ok: sent.sent, subject, attention: attention.map((s) => s.title) });
}
