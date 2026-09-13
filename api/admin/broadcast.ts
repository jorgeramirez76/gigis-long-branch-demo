import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql, isVipBusiness, type VipBusiness } from "../lib/db.js";
import { requireAdmin } from "../lib/adminAuth.js";
import { sendSms, sendEmail, withStopNotice, smsConfigured, emailConfigured } from "../lib/notify.js";
import { normalizeBroadcastPromoCode } from "../lib/broadcastPromo.js";

export const config = { maxDuration: 300 };

type Member = { id: number; name: string; phone: string | null; email: string | null };

/**
 * POST /api/admin/broadcast
 * body: { business, message, subject?, channels: { sms, email },
 *         promoCode?, promoDescription?, expiresAt?, dryRun? }
 *
 * dryRun returns audience counts + rendered SMS without sending anything.
 * A real run creates the broadcasts row (+ optional promo code), sends to every
 * consenting member on the selected channels, and logs each send in vip_sends.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const { business, message, subject, channels, promoCode, promoDescription, expiresAt, dryRun, requestId } =
    req.body ?? {};

  if (!isVipBusiness(business)) return void res.status(400).json({ error: "invalid_business" });
  if (typeof message !== "string" || message.trim().length < 1)
    return void res.status(400).json({ error: "message_required" });
  const wantSms = channels?.sms === true;
  const wantEmail = channels?.email === true;
  if (!wantSms && !wantEmail) return void res.status(400).json({ error: "channel_required" });
  if (wantEmail && (typeof subject !== "string" || subject.trim().length < 1))
    return void res.status(400).json({ error: "subject_required_for_email" });
  if (wantSms && message.length > 1200)
    return void res.status(400).json({ error: "sms_too_long" });

  if (!dryRun && (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)))
    return void res.status(400).json({ error: "request_id_required" });

  const codeRequested = typeof promoCode === "string" && promoCode.trim().length > 0;
  const code = codeRequested ? normalizeBroadcastPromoCode(promoCode) : null;
  if (codeRequested && !code) {
    return void res.status(400).json({
      error: "invalid_promo_code",
      message: "Use 4–20 letters, numbers, or hyphens. PIE codes are reserved for welcome offers.",
    });
  }
  const codeDesc = typeof promoDescription === "string" ? promoDescription.trim() : "";
  if (code && !codeDesc) return void res.status(400).json({ error: "promo_description_required" });
  const expiry = expiresAt == null || expiresAt === "" ? null : typeof expiresAt === "string" ? new Date(expiresAt) : null;
  if (expiresAt != null && expiresAt !== "" && (!expiry || !Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now())) {
    return void res.status(400).json({ error: "invalid_expiration" });
  }
  const smsBody = withStopNotice(code ? `${message.trim()} Code: ${code}` : message.trim());

  try {
    const smsAudience = wantSms
      ? ((await sql`
          SELECT id, name, phone, email FROM vip_members
          WHERE business = ${business} AND sms_consent AND phone IS NOT NULL
        `).rows as Member[])
      : [];
    // email_suppressions covers opt-outs whose member row the consent flip may have missed
    // (e.g. a hand-imported mixed-case email). Created lazily like api/unsubscribe.ts does —
    // on a fresh database the audience query must not 500 for want of an empty table. Both
    // sides lowercased: schema documents source='admin' rows, which nothing case-normalizes.
    if (wantEmail) {
      await sql`
        CREATE TABLE IF NOT EXISTS email_suppressions (
          email      TEXT PRIMARY KEY,
          source     TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
    }
    const emailAudience = wantEmail
      ? ((await sql`
          SELECT id, name, phone, email FROM vip_members
          WHERE business = ${business} AND email_consent AND email IS NOT NULL
            AND LOWER(email) NOT IN (SELECT LOWER(email) FROM email_suppressions)
        `).rows as Member[])
      : [];

    if (dryRun) {
      res.status(200).json({
        dryRun: true,
        smsCount: smsAudience.length,
        emailCount: emailAudience.length,
        smsPreview: wantSms ? smsBody : null,
        channelsReady: { sms: smsConfigured(), email: emailConfigured() },
      });
      return;
    }

    if (wantSms && !smsConfigured())
      return void res.status(409).json({ error: "sms_not_configured" });
    if (wantEmail && !emailConfigured())
      return void res.status(409).json({ error: "email_not_configured" });

    await sql`ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS request_id UUID`;
    await sql`ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS content_key TEXT`;
    await sql`ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ`;
    await sql`ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS broadcasts_request_id_uidx ON broadcasts(request_id)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS broadcasts_active_content_uidx ON broadcasts(content_key) WHERE completed_at IS NULL`;
    const contentKey = createHash("sha256").update(JSON.stringify([
      business, message.trim(), wantEmail ? subject.trim() : null, wantSms, wantEmail,
      code, codeDesc, expiry?.toISOString() ?? null,
    ])).digest("hex");

    async function priorRunSummary() {
      const prior = await sql`
        SELECT b.id, b.content_key, b.delivery_started_at, b.completed_at,
          COUNT(*) FILTER (WHERE s.channel='sms' AND s.status='sent')::int AS sms_sent,
          COUNT(*) FILTER (WHERE s.channel='sms' AND s.status='failed')::int AS sms_failed,
          COUNT(*) FILTER (WHERE s.channel='email' AND s.status='sent')::int AS email_sent,
          COUNT(*) FILTER (WHERE s.channel='email' AND s.status='failed')::int AS email_failed
        FROM broadcasts b LEFT JOIN vip_sends s ON s.broadcast_id=b.id
        WHERE b.request_id=${requestId} GROUP BY b.id
      `;
      return prior.rows[0];
    }
    function replay(row: Record<string, unknown>) {
      return { ok:true, duplicate:true, broadcastId:row.id,
        inProgress:!row.completed_at, smsSent:row.sms_sent, smsFailed:row.sms_failed,
        emailSent:row.email_sent, emailFailed:row.email_failed };
    }
    const prior = await priorRunSummary();
    if (prior && prior.content_key !== contentKey)
      return void res.status(409).json({error:"request_id_conflict"});
    if (prior?.delivery_started_at)
      return void res.status(200).json(replay(prior));

    // A retry after an ambiguous failure (client timeout, tab reload mid-send) must not
    // text the whole list twice — an identical message that already DELIVERED something in
    // the last 15 minutes is refused. The EXISTS matters: the broadcasts row is inserted
    // before any send, so a blast that died with zero messages out leaves a row but no
    // vip_sends — that retry is legitimate and must go through.
    const recent = await sql`
      SELECT b.id FROM broadcasts b
      WHERE b.business = ${business} AND b.message = ${message.trim()}
        AND b.created_at > now() - interval '15 minutes'
        AND EXISTS (SELECT 1 FROM vip_sends s WHERE s.broadcast_id = b.id AND s.status = 'sent')
      LIMIT 1
    `;
    if (!prior && recent.rows[0]) {
      return void res.status(409).json({ error: "duplicate_broadcast", broadcastId: recent.rows[0].id });
    }

    let promoCodeId: number | null = null;
    if (code) {
      const promo = await sql`
        INSERT INTO vip_promo_codes (business, code, description, expires_at)
        VALUES (${business}, ${code}, ${codeDesc}, ${expiry?.toISOString() ?? null})
        ON CONFLICT (code) DO UPDATE
          SET description = EXCLUDED.description, expires_at = EXCLUDED.expires_at
          WHERE vip_promo_codes.business = EXCLUDED.business
            AND vip_promo_codes.member_id IS NULL
        RETURNING id
      `;
      if (!promo.rows[0]) return void res.status(409).json({ error: "promo_code_conflict" });
      promoCodeId = promo.rows[0].id as number;
    }

    const broadcast = await sql`
      INSERT INTO broadcasts (business, subject, message, channels, promo_code_id, sms_total, email_total, request_id, content_key)
      VALUES (${business}, ${wantEmail ? subject.trim() : null}, ${message.trim()},
              ${[wantSms && "sms", wantEmail && "email"].filter(Boolean).join(",")},
              ${promoCodeId}, ${smsAudience.length}, ${emailAudience.length}, ${requestId}, ${contentKey})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    const reserved = prior ?? broadcast.rows[0] ?? await priorRunSummary();
    if (!reserved) return void res.status(409).json({error:"broadcast_in_progress"});
    const broadcastId = reserved.id as number;
    // The durable transition happens BEFORE any provider call. A timeout, lost audit
    // write, or crashed worker can never license a second send under this action.
    const started = await sql`
      UPDATE broadcasts SET delivery_started_at=now()
      WHERE id=${broadcastId} AND request_id=${requestId} AND delivery_started_at IS NULL
      RETURNING id
    `;
    if (!started.rows[0]) {
      const running = await priorRunSummary();
      return void res.status(200).json(running ? replay(running) : {ok:true,duplicate:true,inProgress:true});
    }

    let auditLost = false;
    const counts = { smsSent: 0, smsFailed: 0, emailSent: 0, emailFailed: 0 };

    async function record(
      channel: "sms" | "email",
      memberId: number,
      result: { sent: boolean; providerId?: string; error?: string },
    ) {
      // A transient DB failure after a successful provider send must not throw through
      // the pool — the message already went out; a lost audit row is the lesser harm.
      try {
        await sql`
          INSERT INTO vip_sends (business, channel, member_id, promo_code_id, broadcast_id, status, provider_id, error)
          VALUES (${business as VipBusiness}, ${channel}, ${memberId}, ${promoCodeId}, ${broadcastId},
                  ${result.sent ? "sent" : "failed"}, ${result.providerId ?? null}, ${result.error ?? null})
        `;
      } catch (e) {
        auditLost = true;
        console.error(`[admin/broadcast] vip_sends row lost (${channel}, member ${memberId}, broadcast ${broadcastId})`, e);
      }
    }

    // Concurrency-capped fan-out. Twilio queues outbound SMS server-side
    // (~1 msg/sec long-code throughput), so submitting fast is fine.
    async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, concurrency = 8) {
      let i = 0;
      await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, async () => {
          while (i < items.length) {
            const item = items[i++];
            await worker(item);
          }
        }),
      );
    }

    await runPool(smsAudience, async (m) => {
      const result = await sendSms(m.phone!, smsBody);
      if (result.sent) counts.smsSent++;
      else counts.smsFailed++;
      await record("sms", m.id, result);
    });

    // Resend does NOT queue like Twilio — its default limit is ~2 requests/sec and a
    // 429'd send is recorded as a plain failure with no retry path short of re-blasting
    // the list. One worker with spacing stays safely under the limit (maxDuration 300
    // gives this pace room for hundreds of members).
    await runPool(emailAudience, async (m) => {
      const result = await sendEmail(m.email!, subject.trim(), message.trim(), {
        promoCode: code ?? undefined,
        promoDescription: codeDesc ? `${codeDesc} — redeem at the register only; not valid in online checkout.` : undefined,
      });
      if (result.sent) counts.emailSent++;
      else counts.emailFailed++;
      await record("email", m.id, result);
      await new Promise((r) => setTimeout(r, 600));
    }, 1);

    // Failed/unknown provider outcomes or missing audit rows remain reserved for
    // staff reconciliation. A different request ID cannot bypass that reservation.
    const needsReview = auditLost || counts.smsFailed > 0 || counts.emailFailed > 0;
    if (!needsReview) await sql`UPDATE broadcasts SET completed_at=now() WHERE id=${broadcastId}`;
    res.status(200).json({ ok: true, broadcastId, inProgress: needsReview, ...counts });
  } catch (err) {
    console.error("[admin/broadcast] error", err);
    res.status(500).json({ error: "internal_error" });
  }
}
