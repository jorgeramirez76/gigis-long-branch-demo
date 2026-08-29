import { timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "../lib/db.js";
import { getOrderSummary, listOpenWebsiteOrders } from "../lib/clover.js";
import { getCaptureByCloverId, listWorklistCandidates } from "../lib/orderStore.js";
import { sendEmail } from "../lib/notify.js";

/**
 * Daily health digest, emailed to the owner every morning (sibling of Sea Bright's — same
 * shape, this shop's own data and credentials, per the never-share-infra rule).
 *
 * Kenny and staff are deliberately NOT on this: texts are for food-at-risk moments. The owner
 * gets one email — yesterday's orders, every open website ticket classified paid/owed/unknown,
 * anything stuck in the ledger, and whether the menu machinery is fresh. Every section fails
 * SOFT but VISIBLE, because "no news" must mean checked-and-clean, never the-checker-broke.
 */

const DIGEST_TO = process.env.DIGEST_EMAIL || "jorgeramirez76@gmail.com";
const SHOP = "Gigi's Long Branch";

function cronAuthorized(header: unknown, secret: string): boolean {
  const got = typeof header === "string" ? Buffer.from(header) : null;
  const want = Buffer.from(`Bearer ${secret}`);
  return !!got && got.length === want.length && timingSafeEqual(got, want);
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

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

  const sections: Section[] = [];

  sections.push(
    await section("Yesterday's orders", async () => {
      const r = await sql`
        SELECT status, count(*)::int AS n, COALESCE(sum(total), 0)::int AS cents
        FROM web_orders
        WHERE (created_at AT TIME ZONE 'America/New_York')::date = (now() AT TIME ZONE 'America/New_York')::date - 1
        GROUP BY status ORDER BY n DESC
      `;
      if (r.rows.length === 0) return { lines: ["No web orders yesterday."], attention: false };
      const paidish = new Set(["paid", "paid_print_queued", "paid_print_failed", "charged", "paid_unrouted"]);
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
      return { lines, attention: false };
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
            orders.push({ id: sum.id, title: sum.title, state: sum.state, total: sum.total, note: sum.note, paymentCount: sum.paymentCount, createdTime: sum.createdTime });
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
      if (owed.length) lines.push(`OWED money — collect normally: ${owed.join("; ")}`);
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
        WHERE status IN ('pending', 'charged', 'paid_unrouted', 'capture_uncertain', 'paid_print_queued')
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
