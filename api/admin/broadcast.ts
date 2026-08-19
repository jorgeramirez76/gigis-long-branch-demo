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

  const { business, message, subject, channels, promoCode, promoDescription, expiresAt, dryRun } =
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
    if (recent.rows[0]) {
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
      INSERT INTO broadcasts (business, subject, message, channels, promo_code_id, sms_total, email_total)
      VALUES (${business}, ${wantEmail ? subject.trim() : null}, ${message.trim()},
              ${[wantSms && "sms", wantEmail && "email"].filter(Boolean).join(",")},
              ${promoCodeId}, ${smsAudience.length}, ${emailAudience.length})
      RETURNING id
    `;
    const broadcastId = broadcast.rows[0].id as number;

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
      result.sent ? counts.smsSent++ : counts.smsFailed++;
      await record("sms", m.id, result);
    });

    // Resend does NOT queue like Twilio — its default limit is ~2 requests/sec and a
    // 429'd send is recorded as a plain failure with no retry path short of re-blasting
    // the list. One worker with spacing stays safely under the limit (maxDuration 300
    // gives this pace room for hundreds of members).
    await runPool(emailAudience, async (m) => {
      const result = await sendEmail(m.email!, subject.trim(), message.trim(), {
        promoCode: code ?? undefined,
        promoDescription: codeDesc || undefined,
      });
      result.sent ? counts.emailSent++ : counts.emailFailed++;
      await record("email", m.id, result);
      await new Promise((r) => setTimeout(r, 600));
    }, 1);

    res.status(200).json({ ok: true, broadcastId, ...counts });
  } catch (err) {
    console.error("[admin/broadcast] error", err);
    res.status(500).json({ error: "internal_error" });
  }
}
