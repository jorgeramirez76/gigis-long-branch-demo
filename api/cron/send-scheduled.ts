import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cronAuthorized } from "../lib/cronAuth.js";
import { sql, isVipBusiness } from "../lib/db.js";
import { runBroadcast } from "../lib/broadcastRun.js";

/**
 * GET /api/cron/send-scheduled — every 5 minutes (vercel.json).
 *
 * Drains scheduled_broadcasts: blasts queued for a future moment ("tomorrow at 11am"), sent
 * through the SAME core the admin dashboard uses (api/lib/broadcastRun.ts), so a scheduled
 * blast honours every guard a hand-fired one does — consent filtering, request-id dedupe,
 * the durable started-before-any-provider-call transition, and the vip_sends audit rows.
 *
 * One row is claimed at a time with a conditional UPDATE, so two overlapping cron ticks can
 * never both send the same row. A row that is claimed and then crashes stays claimed (started_at
 * set, finished_at null) rather than being retried blind: the send core's own request_id replay
 * makes a manual re-run safe, but the decision to re-run is a human's.
 */

export const config = { maxDuration: 300 };

let ensured = false;
export async function ensureScheduledTable() {
  if (ensured) return;
  await sql`CREATE TABLE IF NOT EXISTS scheduled_broadcasts (
    id          BIGSERIAL PRIMARY KEY,
    business    TEXT NOT NULL,
    subject     TEXT,
    message     TEXT NOT NULL,
    want_sms    BOOLEAN NOT NULL DEFAULT FALSE,
    want_email  BOOLEAN NOT NULL DEFAULT FALSE,
    send_at     TIMESTAMPTZ NOT NULL,
    request_id  UUID NOT NULL UNIQUE,
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    result      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  ensured = true;
}

/** Neon returns real BOOLEANs, but a driver or fixture that hands back text must not silently
 *  turn a channel off — "false"/"f"/"0" are off, anything else truthy is on. */
function flag(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return !["", "false", "f", "0", "no"].includes(v.trim().toLowerCase());
  return Boolean(v);
}

type Row = {
  id: number; business: string; subject: string | null; message: string;
  want_sms: boolean; want_email: boolean; send_at: string; request_id: string;
};

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

  const done: Array<{ id: number; status: number; body: Record<string, unknown> }> = [];
  try {
    await ensureScheduledTable();
    // At most a few per tick; each blast can take minutes and the function has a ceiling.
    for (let n = 0; n < 3; n++) {
      const claimed = await sql`
        UPDATE scheduled_broadcasts SET started_at = now()
        WHERE id = (
          SELECT id FROM scheduled_broadcasts
          WHERE send_at <= now() AND started_at IS NULL
          ORDER BY send_at, id LIMIT 1
        ) AND started_at IS NULL
        RETURNING id, business, subject, message, want_sms, want_email, send_at, request_id
      `;
      const row = claimed.rows[0] as Row | undefined;
      if (!row) break;

      let outcome: { status: number; body: Record<string, unknown> };
      if (!isVipBusiness(row.business)) {
        outcome = { status: 400, body: { error: "invalid_business" } };
      } else {
        try {
          outcome = await runBroadcast({
            business: row.business,
            message: row.message,
            subject: row.subject ?? undefined,
            wantSms: flag(row.want_sms),
            wantEmail: flag(row.want_email),
            code: null,
            codeDesc: "",
            expiry: null,
            dryRun: false,
            requestId: row.request_id,
          });
        } catch (err) {
          console.error(`[cron/send-scheduled] row ${row.id} threw`, err);
          outcome = { status: 500, body: { error: "internal_error", detail: err instanceof Error ? err.message : String(err) } };
        }
      }
      await sql`
        UPDATE scheduled_broadcasts SET finished_at = now(), result = ${JSON.stringify({ status: outcome.status, ...outcome.body })}::jsonb
        WHERE id = ${row.id}
      `;
      console.log(`[cron/send-scheduled] row ${row.id} -> ${outcome.status}`, JSON.stringify(outcome.body));
      done.push({ id: Number(row.id), ...outcome });
    }
    res.status(200).json({ ok: true, sent: done });
  } catch (err) {
    console.error("[cron/send-scheduled] error", err);
    res.status(500).json({ error: "internal_error", sent: done });
  }
}
