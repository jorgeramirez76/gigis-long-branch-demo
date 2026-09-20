import { createHash } from "node:crypto";
import { sql, type VipBusiness } from "./db.js";
import { sendSms, sendEmail, withStopNotice, smsConfigured, emailConfigured } from "./notify.js";

/**
 * The broadcast send core, lifted verbatim out of api/admin/broadcast.ts (2026-09-19) so a
 * SCHEDULED blast (api/cron/send-scheduled.ts) runs the identical path the admin button does:
 * same consent-filtered audiences, same request-id / content-key dedupe, same durable
 * delivery_started_at transition before any provider call, same vip_sends audit rows.
 *
 * Returns an HTTP-shaped {status, body} rather than writing to a response, so the admin
 * handler and the cron can each report it their own way. The SQL text and parameter order
 * are unchanged on purpose: tests/broadcast-reservation.test.ts matches on both.
 */

type Member = { id: number; name: string; phone: string | null; email: string | null };

export type BroadcastInput = {
  business: VipBusiness;
  message: string;
  subject: string | undefined;
  wantSms: boolean;
  wantEmail: boolean;
  /** Already normalised by normalizeBroadcastPromoCode, or null for no register code. */
  code: string | null;
  codeDesc: string;
  expiry: Date | null;
  dryRun: boolean;
  requestId: string | undefined;
};

export type BroadcastOutcome = { status: number; body: Record<string, unknown> };

export async function runBroadcast(input: BroadcastInput): Promise<BroadcastOutcome> {
  const { business, message, subject, wantSms, wantEmail, code, codeDesc, expiry, dryRun, requestId } = input;
const smsBody = withStopNotice(code ? `${message.trim()} Code: ${code}` : message.trim());

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
    return { status: 200, body: {
      dryRun: true,
      smsCount: smsAudience.length,
      emailCount: emailAudience.length,
      smsPreview: wantSms ? smsBody : null,
      channelsReady: { sms: smsConfigured(), email: emailConfigured() },
    } };
  }

  if (wantSms && !smsConfigured())
    return { status: 409, body: { error: "sms_not_configured" } };
  if (wantEmail && !emailConfigured())
    return { status: 409, body: { error: "email_not_configured" } };

  await sql`ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS request_id UUID`;
  await sql`ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS content_key TEXT`;
  await sql`ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ`;
  await sql`ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS broadcasts_request_id_uidx ON broadcasts(request_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS broadcasts_active_content_uidx ON broadcasts(content_key) WHERE completed_at IS NULL`;
  const contentKey = createHash("sha256").update(JSON.stringify([
    business, message.trim(), wantEmail ? subject!.trim() : null, wantSms, wantEmail,
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
    return { status: 409, body: {error:"request_id_conflict"} };
  if (prior?.delivery_started_at)
    return { status: 200, body: replay(prior) };

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
    return { status: 409, body: { error: "duplicate_broadcast", broadcastId: recent.rows[0].id } };
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
    if (!promo.rows[0]) return { status: 409, body: { error: "promo_code_conflict" } };
    promoCodeId = promo.rows[0].id as number;
  }

  const broadcast = await sql`
    INSERT INTO broadcasts (business, subject, message, channels, promo_code_id, sms_total, email_total, request_id, content_key)
    VALUES (${business}, ${wantEmail ? subject!.trim() : null}, ${message.trim()},
            ${[wantSms && "sms", wantEmail && "email"].filter(Boolean).join(",")},
            ${promoCodeId}, ${smsAudience.length}, ${emailAudience.length}, ${requestId}, ${contentKey})
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  const reserved = prior ?? broadcast.rows[0] ?? await priorRunSummary();
  if (!reserved) return { status: 409, body: {error:"broadcast_in_progress"} };
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
    return { status: 200, body: running ? replay(running) : {ok:true,duplicate:true,inProgress:true} };
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
    const result = await sendEmail(m.email!, subject!.trim(), message.trim(), {
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
  return { status: 200, body: { ok: true, broadcastId, inProgress: needsReview, ...counts } };
}
