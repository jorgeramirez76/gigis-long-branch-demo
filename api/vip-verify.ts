import type { VercelRequest, VercelResponse } from "@vercel/node";
import { rateLimitAll } from "./lib/rateLimit.js";
import { hashSecret } from "./lib/vipSignupShared.js";
import { notifyStaffNewMember } from "./lib/vipStaffNotify.js";
import {
  claimForVerification,
  completeSignup,
  ensureMemberHasCode,
  lookupVerifyToken,
  NO_CODE_SENTINEL,
  recordIssuedCode,
  recoverMemberCode,
  releaseClaim,
  sweepExpiredPending,
} from "./lib/vipSignupShared.js";

/**
 * Step 2 of the VIP signup: the person tapped "Verify my email" in the email we sent.
 *
 * The emailed button points at the static /vip-verify/ page, which POSTs the token here. That
 * indirection is deliberate: mail providers and corporate security appliances pre-fetch links in
 * email, and a GET that created members would let a SCANNER activate accounts (and burn the
 * one-per-household pie) instead of the actual person. A static page + a scripted POST means only a
 * real browser completes the signup.
 *
 * A valid token replays the parked signup through the SAME member-creation path the one-step
 * endpoint used (completeSignup) — member row, free-pie code, welcome SMS/email — then notifies the
 * owner. Re-tapping the link is idempotent: it returns the same code rather than erroring, because
 * people double-tap, forward, and revisit emails.
 *
 * No Turnstile: the signup step already passed it, and a 32-byte token is not guessable.
 */

function clientIp(req: VercelRequest): string | undefined {
  const real = req.headers["x-real-ip"];
  return typeof real === "string" && real ? real : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token.trim() : "";
  // Tokens are 32 bytes base64url (43 chars). Bounded so a junk payload can't reach the DB.
  if (!token || token.length < 20 || token.length > 200) {
    res.status(400).json({
      error: "invalid_link",
      message: "That verification link doesn't look complete — please open it straight from the email.",
    });
    return;
  }

  const ip = clientIp(req);
  // Deliberately NO shared/global bucket here. A global cap on this endpoint is a denial-of-service
  // handed to anybody with a few hundred junk POSTs: it would exhaust on garbage tokens and then
  // every real customer tapping their emailed button gets throttled. Limits are per-IP and
  // per-token, so abuse can only ever throttle the abuser or the one link being hammered.
  const allowed = await rateLimitAll([
    ...(ip ? [{ bucket: `verify:ip:${ip}`, max: 30, windowSec: 300 }] : []),
    { bucket: `verify:tok:${hashSecret(token)}`, max: 12, windowSec: 600 },
  ]);
  if (!allowed) {
    // 429 is TRANSIENT — the landing page must offer a retry, not declare the link dead.
    res.status(429).json({ error: "rate_limited", retryable: true, message: "Too many tries just now — give it a few seconds and try again." });
    return;
  }

  try {
    const found = await lookupVerifyToken(token);
    if (!found.ok) {
      const r =
        found.reason === "expired"
          ? {
              error: "verify_expired",
              message:
                "That link has expired. Head back to the VIP Club signup and submit again — we'll email you a fresh one.",
            }
          : {
              error: "verify_not_found",
              message:
                "That link is no longer valid — it may have been replaced by a newer one. Submit the VIP Club form again for a fresh link.",
            };
      res.status(400).json(r);
      return;
    }

    const row = found.row;

    // Already verified (a re-tap, or the scanner-then-human case): hand back the same code.
    if (row.verified_at) {
      // verified_at is set by the CLAIM, before the code is issued. A re-tap landing in that
      // window has verified_at but no issued_code yet — same situation as losing the claim
      // race below, and it needs the same answer: "still finishing", not a codeless success.
      if (!row.issued_code) {
        const recoveredEarly = await recoverMemberCode(row.business, row.email);
        if (!recoveredEarly) {
          res.status(409).json({ error: "verification_processing", retryable: true, message: "Your membership is still being finished — wait a moment and try again." });
          return;
        }
        res.status(200).json({ ok: true, alreadyVerified: true, code: recoveredEarly.code });
        return;
      }
      const stored = row.issued_code === NO_CODE_SENTINEL ? null : row.issued_code;
      const code = stored ?? (await recoverMemberCode(row.business, row.email))?.code ?? null;
      res.status(200).json({ ok: true, alreadyVerified: true, code });
      return;
    }

    // Claim it, so two simultaneous taps can't both create a member / issue two pies.
    if (!(await claimForVerification(row.id))) {
      const again = await lookupVerifyToken(token);
      const stored = again.ok && again.row.issued_code !== NO_CODE_SENTINEL ? again.row.issued_code : null;
      const code = stored || (await recoverMemberCode(row.business, row.email))?.code || null;
      if (!code && again.ok && !again.row.issued_code) {
        // Another request owns the claim but has not finished issuing the code. Calling this
        // "already verified" strands the faster response on a success screen with no code.
        res.status(409).json({ error: "verification_processing", retryable: true, message: "Your membership is still being finished — wait a moment and try again." });
        return;
      }
      res.status(200).json({ ok: true, alreadyVerified: true, code });
      return;
    }

    let outcome;
    try {
      outcome = await completeSignup(row.business, row.payload);
    } catch (err) {
      // Creation failed after we claimed the row — release it so their link still works.
      await releaseClaim(row.id);
      throw err;
    }

    // alreadyMember here means a race or a dedup collision that appeared since signup (existing
    // members never get a link). Hand back the code already on file rather than a codeless answer.
    if ("alreadyMember" in outcome) {
      // Either a genuine existing membership, or the aftermath of a half-completed earlier attempt
      // (member row committed, then the code issue or a send threw). ensureMemberHasCode covers
      // both: it returns the code on file, and MINTS one if the member somehow has none — otherwise
      // that person was told "you're already in the club" forever and never got the pie they earned.
      const recovered = await ensureMemberHasCode(row.business, row.email);
      if (recovered) {
        await recordIssuedCode(row.id, recovered.code);
        // Notify on this path too: a member who arrives via recovery is just as real, and staff
        // never hearing about them is how one goes unnoticed.
        if (recovered.minted) await notifyStaffNewMember(row.business, row.payload, recovered.code);
        res.status(200).json({ ok: true, code: recovered.code, description: recovered.description });
        return;
      }
      // Verified, but genuinely no code to hand out. Mark it settled so the waiting tab stops
      // instead of polling for a code that will never arrive.
      await recordIssuedCode(row.id, NO_CODE_SENTINEL);
      res.status(200).json(outcome);
      return;
    }

    await recordIssuedCode(row.id, outcome.code);
    // Tell the owner a real, email-confirmed member just joined. Never blocks or fails the signup.
    await notifyStaffNewMember(row.business, row.payload, outcome.code);
    // Keep the PII table tidy from this side too — verification traffic happens even when signups
    // pause, so the sweep can't live only in the signup handler.
    await sweepExpiredPending(row.business);
    res.status(200).json(outcome);
  } catch (err) {
    console.error("[vip-verify] error", err);
    res.status(500).json({ error: "internal_error", message: "Something went wrong on our end — please try that link again." });
  }
}
