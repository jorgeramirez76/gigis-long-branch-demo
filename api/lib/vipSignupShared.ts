import { createHash, randomBytes } from "node:crypto";
import { sql, type VipBusiness } from "./db.js";
import { issueWelcomePie } from "./promo.js";
import { sendWelcomeSms, sendWelcomeEmail } from "./notify.js";

/**
 * The half of a VIP signup that actually creates things — member row, free-pie
 * code, welcome sends. Split out of api/vip-signup.ts when the email-verification
 * gate was added (2026-08-06): the public endpoint now only VALIDATES and parks
 * the signup in vip_email_verifications; this runs from api/vip-verify.ts once the
 * person has proven the email is theirs. One implementation, so the verified path
 * can never drift from what the direct path used to do.
 */

// Canonical consent language — MUST stay in sync with CONSENT_TEXT in
// src/components/VipClub.tsx and the registered A2P campaign message_flow.
// Stored server-side so the audit trail can't be forged by a crafted POST.
export const CANONICAL_CONSENT_TEXT =
  "By checking \"Text me deals,\" I agree to receive recurring promotional texts (weekly specials and promo codes) from Gigi's NY Style Pizza, 140 Brighton Ave, Long Branch, NJ, sent by automated technology to the number I provided. Consent is not a condition of any purchase. Message frequency varies, typically up to 4 per month. Message & data rates may apply. Reply STOP to opt out, HELP for help. By checking \"Email me deals,\" I agree to receive promotional emails; unsubscribe anytime via the link in any email.";

/** A signup that has passed every check in api/vip-signup.ts. This exact object is
 *  stored as the pending row's JSONB payload and replayed on verify — so add a field
 *  here only if the verify path can safely see old payloads without it. */
export type ValidatedSignup = {
  name: string;
  phone: string; // E.164 (+1XXXXXXXXXX)
  email: string; // normalized lowercase
  fullAddress: string;
  apt: string | null;
  addrKey: string;
  smsConsent: boolean;
  emailConsent: boolean;
  source: string;
};

export type SignupOutcome =
  | { ok: true; code: string; description: string }
  | { ok: true; alreadyMember: true; message: string };

export const ALREADY_MEMBER_MESSAGE =
  "You're already in the VIP Club — the free welcome pie is one per new member. Watch for our deals!";

/** Cheap read-only pre-check so an existing member gets the friendly answer
 *  IMMEDIATELY at signup, before we email anyone a verification code. The INSERT's
 *  ON CONFLICT in completeSignup stays the authority (this is advisory only). */
export async function memberExists(business: VipBusiness, p: ValidatedSignup): Promise<boolean> {
  const r = await sql`
    SELECT 1 FROM vip_members
    WHERE business = ${business}
      AND (phone = ${p.phone} OR email = ${p.email} OR (addr_key = ${p.addrKey} AND addr_key <> ''))
    LIMIT 1
  `;
  return r.rowCount > 0;
}

/**
 * Recover the free-pie code already issued to a member, by the email they just proved control of.
 * Used only on the verify path when completeSignup reports alreadyMember — which, since existing
 * members are turned away BEFORE a code is ever emailed, can only mean a race or a partial-failure
 * retry, i.e. the same person finishing a signup that half-succeeded. Returning their unredeemed
 * code recovers them instead of dead-ending on "already a member" with no code. Safe: the caller
 * has just verified this exact email, so it is not a code-disclosure vector.
 */
export async function recoverMemberCode(
  business: VipBusiness,
  email: string,
): Promise<{ code: string; description: string } | null> {
  const r = await sql`
    SELECT c.code, c.description
    FROM vip_promo_codes c
    JOIN vip_members m ON m.id = c.member_id
    WHERE m.business = ${business} AND m.email = ${email} AND c.redeemed_at IS NULL
    ORDER BY c.created_at DESC
    LIMIT 1
  `;
  const row = r.rows[0] as { code: string; description: string } | undefined;
  return row ? { code: row.code, description: row.description } : null;
}

/**
 * The code a verified member should be holding — returning the one on file, or MINTING one if they
 * somehow have none.
 *
 * The gap this closes: completeSignup is not transactional (the Neon HTTP driver autocommits each
 * statement), so a throw between the member INSERT and issueWelcomePie leaves a real member with no
 * promo code. Every later attempt then hit ON CONFLICT DO NOTHING, reported "you're already in the
 * VIP Club", and handed over nothing — permanently, for a person who had earned a pie.
 */
export async function ensureMemberHasCode(
  business: VipBusiness,
  email: string,
): Promise<{ code: string; description: string; minted: boolean } | null> {
  const existing = await recoverMemberCode(business, email);
  if (existing) return { ...existing, minted: false };

  const m = await sql`SELECT id FROM vip_members WHERE business = ${business} AND email = ${email} LIMIT 1`;
  const memberId = m.rows[0]?.id as number | undefined;
  if (memberId == null) return null; // matched on phone/address, not this email — nothing to mint against

  // Only mint when the member genuinely holds NO code at all (redeemed ones count, so a member who
  // already used their pie is not handed a second one).
  const any = await sql`SELECT 1 FROM vip_promo_codes WHERE business = ${business} AND member_id = ${memberId} LIMIT 1`;
  if (any.rowCount > 0) return null;

  const issued = await issueWelcomePie(business, memberId);
  console.log(`[vip] minted a missing welcome code for member ${memberId} (${email})`);
  return { code: issued.code, description: issued.description, minted: true };
}

/** Create the member, issue the pie, send the welcome messages. Verbatim the logic
 *  the public endpoint ran before the verification gate existed. */
export async function completeSignup(business: VipBusiness, p: ValidatedSignup): Promise<SignupOutcome> {
  // ON CONFLICT DO NOTHING covers ALL three unique indexes (phone, email,
  // address+apt): a match on ANY one means this person/household already
  // claimed the welcome pie, so no row is inserted and no new pie is issued.
  const inserted = await sql`
    INSERT INTO vip_members (business, name, phone, email, address, apt, addr_key, sms_consent, email_consent, consent_text, source)
    VALUES (${business}, ${p.name}, ${p.phone}, ${p.email}, ${p.fullAddress}, ${p.apt}, ${p.addrKey}, ${p.smsConsent}, ${p.emailConsent}, ${CANONICAL_CONSENT_TEXT}, ${p.source})
    ON CONFLICT DO NOTHING
    RETURNING id
  `;

  if (inserted.rowCount === 0) {
    // Generic message (no field echoed) to avoid leaking which detail is on file.
    return { ok: true, alreadyMember: true, message: ALREADY_MEMBER_MESSAGE };
  }

  const memberId = inserted.rows[0].id as number;
  const { id: promoCodeId, code, description } = await issueWelcomePie(business, memberId);
  // Registered as the campaign's OptInMessage — keep the shape in sync with
  // the A2P filing if this wording changes.
  const welcomeMessage = `Gigi's NY Style Pizza VIP Club: you're in! Code ${code} gets you ${description}. Up to 4 msgs/mo. Msg&data rates may apply. Reply HELP for help, STOP to opt out.`;

  // Send ONLY to the channels the member consented to (both fields are stored
  // for dedup regardless). On-screen code is the fallback if a channel isn't armed.
  if (p.smsConsent) {
    const sms = await sendWelcomeSms(p.phone, welcomeMessage);
    await sql`
      INSERT INTO vip_sends (business, channel, member_id, promo_code_id, status, provider_id, error)
      VALUES (${business}, 'sms', ${memberId}, ${promoCodeId}, ${sms.sent ? "sent" : "failed"}, ${sms.providerId ?? null}, ${sms.error ?? null})
    `;
  }
  if (p.emailConsent) {
    const mail = await sendWelcomeEmail(p.email, "Welcome to the Gigi's VIP Club 🍕", welcomeMessage, {
      promoCode: code,
      promoDescription: description,
      promoHowTo: "Pickup orders only — redeem it in the promo code box at final checkout on gigislongbranch.com, or show it at the counter.",
    });
    await sql`
      INSERT INTO vip_sends (business, channel, member_id, promo_code_id, status, provider_id, error)
      VALUES (${business}, 'email', ${memberId}, ${promoCodeId}, ${mail.sent ? "sent" : "failed"}, ${mail.providerId ?? null}, ${mail.error ?? null})
    `;
  }

  return { ok: true, code, description };
}

// ---------------------------------------------------------------------------
// Verification-LINK plumbing (one-click "Verify" button in the email)
// ---------------------------------------------------------------------------

/** 24 hours. A link is read whenever the person next opens their email — often not
 *  immediately — so this is deliberately far longer than the 15 minutes a typed code got. */
export const VERIFY_TTL_HOURS = 24;

/** The token that rides in the emailed link. 32 random bytes, URL-safe: unguessable, so no
 *  attempt cap is needed (unlike the 6-digit code this replaced, which had 1e6 possibilities). */
export function generateVerifyToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Public, opaque id the waiting browser tab polls. Safe to expose: it reveals only whether a
 *  signup it already knows about has been verified, and carries no way to verify anything. */
export function generatePollId(): string {
  return randomBytes(16).toString("base64url");
}

/** Only the HASH of the token is stored, so a leaked DB row can't be used to verify anything. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Park (or refresh) the pending signup. Resubmitting replaces the row wholesale: new token, new
 *  poll id, clock restarted — so "resend" is just submitting the form again, and any earlier link
 *  stops working (one live link per email at a time). */
export async function storePendingSignup(
  business: VipBusiness,
  p: ValidatedSignup,
  secretHash: string,
  pollId: string,
): Promise<void> {
  // ONE live pending signup per phone. Without this, correcting a mistyped email would leave the
  // first link alive in a stranger's inbox: the replacement row is keyed on the NEW address, so the
  // wrong-address row survived with a working token, and whoever owns that mailbox could activate a
  // membership carrying the real person's phone and home address. Cleared before the upsert so a
  // resubmit genuinely retires the previous attempt.
  await sql`
    DELETE FROM vip_email_verifications
    WHERE business = ${business} AND payload->>'phone' = ${p.phone} AND email <> ${p.email}
      AND verified_at IS NULL
  `;
  await sql`
    INSERT INTO vip_email_verifications (business, email, secret_hash, payload, poll_id, expires_at)
    VALUES (${business}, ${p.email}, ${secretHash}, ${JSON.stringify(p)}::jsonb, ${pollId},
            now() + make_interval(hours => ${VERIFY_TTL_HOURS}))
    ON CONFLICT (business, email) DO UPDATE
      SET secret_hash = EXCLUDED.secret_hash,
          payload = EXCLUDED.payload,
          poll_id = EXCLUDED.poll_id,
          attempts = 0,
          verified_at = NULL,
          issued_code = NULL,
          expires_at = EXCLUDED.expires_at,
          created_at = now()
  `;
}

export type PendingRow = {
  id: number;
  business: VipBusiness;
  email: string;
  payload: ValidatedSignup;
  expires_at: string;
  verified_at: string | null;
  issued_code: string | null;
};

export type TokenLookup =
  | { ok: true; row: PendingRow }
  | { ok: false; reason: "not_found" | "expired" };

/**
 * Resolve a verification token to its pending signup. Looked up by hash across all businesses —
 * the token itself is globally unique, so the link needs no other identifier (and carries no email
 * address, which keeps the URL free of PII).
 *
 * An ALREADY-VERIFIED row is returned as ok:true so a second click on the same link is idempotent
 * and shows the same code instead of an error — people forward, re-tap, and double-click links.
 */
export async function lookupVerifyToken(token: string): Promise<TokenLookup> {
  const r = await sql`
    SELECT id, business, email, payload, expires_at, verified_at, issued_code
    FROM vip_email_verifications WHERE secret_hash = ${hashSecret(token)}
  `;
  const row = r.rows[0] as PendingRow | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  // An already-verified row stays usable past expiry so a re-click still shows the code.
  if (!row.verified_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, row };
}

/**
 * Claim the row for activation. Conditional on it not already being verified, so two clicks landing
 * at the same moment (email scanner + human, or a double-tap) can't both run completeSignup and
 * issue two codes. The loser gets false and reads the winner's code instead.
 */
export async function claimForVerification(id: number): Promise<boolean> {
  const r = await sql`
    UPDATE vip_email_verifications SET verified_at = now()
    WHERE id = ${id} AND verified_at IS NULL
    RETURNING id
  `;
  return r.rowCount === 1;
}

/** Record the code that was issued, so re-clicks and the waiting tab can be shown the same one. */
export async function recordIssuedCode(id: number, code: string): Promise<void> {
  await sql`UPDATE vip_email_verifications SET issued_code = ${code} WHERE id = ${id}`;
}

/** Release a failed claim so the person's link still works on a retry. */
export async function releaseClaim(id: number): Promise<void> {
  await sql`UPDATE vip_email_verifications SET verified_at = NULL WHERE id = ${id} AND issued_code IS NULL`;
}

/** Written to issued_code when a verification legitimately produces no new code (an existing
 *  membership absorbed the signup). Lets the waiting tab tell "finished, no code" apart from
 *  "still working" — without it, that tab would poll until it timed out. */
export const NO_CODE_SENTINEL = "__NO_CODE__";

/**
 * Status for the tab still sitting on "check your email" — including on another device.
 *
 * `verified` is deliberately gated on issued_code, NOT on verified_at: verified_at is stamped when
 * the link is claimed, seconds BEFORE completeSignup finishes issuing the code and sending the
 * welcomes. Reporting on verified_at alone meant a poll landing inside that window told the tab
 * "you're in!" while the code was still null — and because the tab stops polling on success, it
 * showed a headline promising a code above an empty space, permanently.
 */
export async function pollVerifyStatus(
  pollId: string,
): Promise<{ found: boolean; verified: boolean; code: string | null }> {
  const r = await sql`
    SELECT verified_at, issued_code FROM vip_email_verifications WHERE poll_id = ${pollId}
  `;
  const row = r.rows[0] as { verified_at: string | null; issued_code: string | null } | undefined;
  if (!row) return { found: false, verified: false, code: null };
  const settled = !!row.verified_at && !!row.issued_code;
  return {
    found: true,
    verified: settled,
    code: settled && row.issued_code !== NO_CODE_SENTINEL ? row.issued_code : null,
  };
}

/**
 * Opportunistic sweep of finished/expired rows. Called best-effort on each signup so this table —
 * which holds signup PII in its payload — never accumulates. Verified rows go an hour after
 * verification (the waiting tab only needs minutes); unverified ones an hour past expiry.
 */
export async function sweepExpiredPending(business: VipBusiness): Promise<void> {
  try {
    await sql`
      DELETE FROM vip_email_verifications
      WHERE business = ${business}
        AND (
          (verified_at IS NOT NULL AND verified_at < now() - interval '1 hour')
          OR (verified_at IS NULL AND expires_at < now() - interval '1 hour')
        )
    `;
  } catch (err) {
    console.error("[vip] pending-row sweep failed (non-fatal)", err);
  }
}

/** Burn a pending row outright (used when a signup can't proceed). */
export async function deletePendingSignup(business: VipBusiness, email: string): Promise<void> {
  await sql`DELETE FROM vip_email_verifications WHERE business = ${business} AND email = ${email}`;
}
