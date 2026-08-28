import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql, isVipBusiness } from "./lib/db.js";
import { sendEmail } from "./lib/notify.js";
import { issueWelcomePie } from "./lib/promo.js";
import { claimWindow, rateLimitAll, releaseWindow } from "./lib/rateLimit.js";
import { verifyTurnstile } from "./lib/turnstile.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Lost your code?" — email a member their own free-pie code again.
 *
 * The gap this closes: the code is shown once on the verify page and sent in the
 * welcome text/email, and after that there is NO way to get it back — re-joining
 * deliberately answers "you're already in the club" without the code, and even the
 * admin dashboard doesn't surface codes. This is the customer-grade recovery.
 *
 * TRUST MODEL — identical to the signup's: you get the code by proving you control
 * the member's inbox, because the code is only ever SENT THERE. Nothing about
 * membership is ever revealed on-screen:
 *  - The HTTP response is byte-identical for every outcome — member with a live
 *    code, member without one, no member at all — so this endpoint cannot be used
 *    to probe who is in the club.
 *  - The response NEVER carries a code.
 *  (Response TIMING can still differ member-vs-not; that channel already exists more
 *  plainly — vip-signup answers alreadyMember explicitly behind the same Turnstile +
 *  rate limits — so uniformity here is defense-in-depth, not the only wall.)
 *
 * ONE PIE, EVER, PER INBOX — the invariant every branch below serves:
 *  - All lookups aggregate across EVERY member row whose email matches
 *    case-insensitively. Hand-imported rows carry mixed-case addresses while web
 *    signups store lowercase, and the unique index is case-sensitive, so one inbox
 *    can legitimately own two rows; keying anything to a single arbitrary row is
 *    how a redeemed member "recovers" a second pie.
 *  - Minting a missing code (the stranded partial-signup case) happens only for
 *    members a WEB flow created ('website'/'checkout' source) — the only flows that
 *    ever owed a welcome pie. Hand-imported members without codes get the friendly
 *    no-active-code email instead of a pie the shop never promised them.
 *  - The mint is serialized by an atomic claim + re-check, so two concurrent
 *    recoveries cannot both mint (check-then-act across autocommitted statements).
 */

/** The one message every outcome returns — uniformity is the no-probe property. */
const UNIFORM_MESSAGE =
  "If that email belongs to a VIP member, we've just sent the code details to it — check your inbox (and spam folder).";

/** Sources whose members were created by a signup flow that promised a welcome pie —
 *  on Long Branch that is every allowlisted SIGNUP_SOURCES value (all 23 current
 *  members carry one of these). The gate exists for future hand-imported rows. */
const WEB_SOURCES = ["website", "checkout", "receipt", "menu-qr", "winback"];

const HOW_TO =
  "Pickup orders only — redeem it in the promo code box at final checkout on gigislongbranch.com, or show it at the counter.";

function clientIp(req: VercelRequest): string | undefined {
  // Vercel-set trusted IP only — no x-forwarded-for fallback (client-spoofable off-platform).
  const real = req.headers["x-real-ip"];
  return typeof real === "string" && real ? real : undefined;
}

async function emailCode(to: string, code: string, description: string): Promise<void> {
  const mail = await sendEmail(
    to,
    "Your Gigi's VIP Club code 🍕",
    "Here's your VIP welcome code, as requested on gigislongbranch.com.\n\nIf you didn't ask for this, you can safely ignore this email — nothing about your membership has changed.",
    { promoCode: code, promoDescription: description, promoHowTo: HOW_TO },
  );
  if (!mail.sent) console.error("[vip-code-recovery] code email failed:", mail.error);
}

/** One wording for BOTH "code already redeemed" and "imported member, no code owed" —
 *  the email itself shouldn't disclose which, and the customer-facing truth is the
 *  same: there is no active code, and they are still in the club. */
async function emailNoActiveCode(to: string): Promise<void> {
  const mail = await sendEmail(
    to,
    "About your Gigi's VIP Club code 🍕",
    "You (hopefully!) asked us to resend your VIP welcome code on gigislongbranch.com.\n\nOur records show there's no active code on your account — the free welcome pie is one per new member. You're still in the club: keep an eye out for our VIP deals.\n\nIf you didn't ask for this, you can safely ignore this email.",
  );
  if (!mail.sent) console.error("[vip-code-recovery] no-active-code email failed:", mail.error);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const { business, email, turnstileToken } = req.body ?? {};
  if (!isVipBusiness(business)) {
    res.status(400).json({ error: "invalid_business" });
    return;
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    res.status(400).json({ error: "invalid_email" });
    return;
  }
  const normalizedEmail = email.trim().toLowerCase();

  // Bot check + rate limits BEFORE any lookup or send — this endpoint's only side
  // effect is email to the address's own inbox, but unmetered it is still a way to
  // make Gigi's domain pester someone. Caps mirror the signup's shape; the email
  // buckets are the ones that bound what actually costs anything.
  const ip = clientIp(req);
  if (!(await verifyTurnstile(typeof turnstileToken === "string" ? turnstileToken : undefined, ip))) {
    res.status(403).json({ error: "verification_failed" });
    return;
  }
  const allowed = await rateLimitAll([
    ...(ip
      ? [
          { bucket: `recover:ip:${ip}:h`, max: 4, windowSec: 3600 },
          { bucket: `recover:ip:${ip}:d`, max: 12, windowSec: 86400 },
        ]
      : []),
    { bucket: `recover:email:${normalizedEmail}:h`, max: 2, windowSec: 3600 },
    { bucket: `recover:email:${normalizedEmail}:d`, max: 4, windowSec: 86400 },
  ]);
  if (!allowed) {
    res.status(429).json({ error: "rate_limited" });
    return;
  }

  try {
    // The inbox's best code across ALL case-variant member rows: an unredeemed one
    // first; among those, the newest. A single JOINed read so no arbitrary LIMIT 1
    // member pick can hide a sibling row's redeemed pie.
    // "live" = unredeemed AND unexpired: welcome codes expire 90 days after issue and
    // checkout refuses them past that — emailing an expired code as "your code" sends
    // the member to a register that will say no.
    const c = await sql`
      SELECT c.code, c.description,
             (c.redeemed_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now())) AS live
      FROM vip_promo_codes c
      JOIN vip_members m ON m.id = c.member_id AND m.business = c.business
      WHERE c.business = ${business} AND LOWER(m.email) = ${normalizedEmail}
      ORDER BY live DESC, c.created_at DESC
      LIMIT 1
    `;
    const row = c.rows[0] as { code: string; description: string; live: boolean } | undefined;

    if (row && row.live) {
      await emailCode(normalizedEmail, row.code, row.description);
    } else if (row) {
      // Redeemed or expired (on any of the inbox's rows) — never a second pie.
      await emailNoActiveCode(normalizedEmail);
    } else {
      // NO code on any row for this inbox. Mintable only if a web flow created the
      // member (stranded partial signup); prefer the exact-lowercase row, then newest.
      const m = await sql`
        SELECT id, source FROM vip_members
        WHERE business = ${business} AND LOWER(email) = ${normalizedEmail}
        ORDER BY (email = ${normalizedEmail}) DESC, created_at DESC
        LIMIT 1
      `;
      const member = m.rows[0] as { id: number; source: string | null } | undefined;
      if (member && WEB_SOURCES.includes(member.source ?? "")) {
        // Serialize concurrent minters: atomic claim, then RE-CHECK under it. The
        // loser sends nothing — the winner's email is already on its way to the
        // same inbox, and the uniform response below covers both.
        if (await claimWindow(`recover-mint:${business}:${member.id}`, 3600)) {
          // Released in the finally: a mint failure must hand the claim back so the
          // next attempt can retry, instead of a spent claim silently eating every
          // recovery for the rest of the window.
          try {
            const again = await sql`
              SELECT 1 FROM vip_promo_codes c
              JOIN vip_members m2 ON m2.id = c.member_id AND m2.business = c.business
              WHERE c.business = ${business} AND LOWER(m2.email) = ${normalizedEmail}
              LIMIT 1
            `;
            if (again.rowCount === 0) {
              const issued = await issueWelcomePie(business, member.id);
              console.log(`[vip-code-recovery] minted missing welcome code for member ${member.id}`);
              await emailCode(normalizedEmail, issued.code, issued.description);
            }
          } finally {
            await releaseWindow(`recover-mint:${business}:${member.id}`, 3600);
          }
        }
      } else if (member) {
        // Hand-imported member with no code: the shop never owed them a welcome
        // pie, so recovery must not become the flow that hands one out.
        await emailNoActiveCode(normalizedEmail);
      }
      // No member at all: fall through silently — the uniform answer is the point.
    }

    res.status(200).json({ ok: true, message: UNIFORM_MESSAGE });
  } catch (err) {
    console.error("[vip-code-recovery] error", err);
    res.status(500).json({ error: "internal_error" });
  }
}
