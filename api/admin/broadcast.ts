import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql, isVipBusiness, type VipBusiness } from "../lib/db.js";
import { requireAdmin } from "../lib/adminAuth.js";
import { sendSms, sendEmail, withStopNotice, smsConfigured, emailConfigured } from "../lib/notify.js";

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
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const { business, message, subject, channels, promoCode, promoDescription, expiresAt, dryRun } =
    req.body ?? {};

  if (!isVipBusiness(business)) return void res.status(400).json({ error: "invalid_business" });
  if (typeof message !== "string" || message.trim().length < 1)
    return void res.status(400).json({ error: "message_required" });
  const wantSms = !!channels?.sms;
  const wantEmail = !!channels?.email;
  if (!wantSms && !wantEmail) return void res.status(400).json({ error: "channel_required" });
  if (wantEmail && (typeof subject !== "string" || subject.trim().length < 1))
    return void res.status(400).json({ error: "subject_required_for_email" });
  if (wantSms && message.length > 1200)
    return void res.status(400).json({ error: "sms_too_long" });

  const code = typeof promoCode === "string" && promoCode.trim() ? promoCode.trim().toUpperCase() : null;
  const codeDesc = typeof promoDescription === "string" ? promoDescription.trim() : "";
  const smsBody = withStopNotice(code ? `${message.trim()} Code: ${code}` : message.trim());

  try {
    const smsAudience = wantSms
      ? ((await sql`
          SELECT id, name, phone, email FROM vip_members
          WHERE business = ${business} AND sms_consent AND phone IS NOT NULL
        `).rows as Member[])
      : [];
    const emailAudience = wantEmail
      ? ((await sql`
          SELECT id, name, phone, email FROM vip_members
          WHERE business = ${business} AND email_consent AND email IS NOT NULL
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

    let promoCodeId: number | null = null;
    if (code) {
      const promo = await sql`
        INSERT INTO vip_promo_codes (business, code, description, expires_at)
        VALUES (${business}, ${code}, ${codeDesc || "VIP promo"}, ${expiresAt ?? null})
        ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
        RETURNING id
      `;
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
      await sql`
        INSERT INTO vip_sends (business, channel, member_id, promo_code_id, broadcast_id, status, provider_id, error)
        VALUES (${business as VipBusiness}, ${channel}, ${memberId}, ${promoCodeId}, ${broadcastId},
                ${result.sent ? "sent" : "failed"}, ${result.providerId ?? null}, ${result.error ?? null})
      `;
    }

    // Concurrency-capped fan-out. Twilio queues outbound SMS server-side
    // (~1 msg/sec long-code throughput), so submitting fast is fine.
    const CONCURRENCY = 8;
    async function runPool<T>(items: T[], worker: (item: T) => Promise<void>) {
      let i = 0;
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
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

    await runPool(emailAudience, async (m) => {
      const result = await sendEmail(m.email!, subject.trim(), message.trim(), {
        promoCode: code ?? undefined,
        promoDescription: codeDesc || undefined,
      });
      result.sent ? counts.emailSent++ : counts.emailFailed++;
      await record("email", m.id, result);
    });

    res.status(200).json({ ok: true, broadcastId, ...counts });
  } catch (err) {
    console.error("[admin/broadcast] error", err);
    res.status(500).json({ error: "internal_error" });
  }
}
