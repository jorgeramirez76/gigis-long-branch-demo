import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "./lib/db.js";
import { verifyUnsubToken } from "./lib/unsub.js";

/**
 * One-click email unsubscribe: GET (link in every email footer) and POST
 * (RFC 8058 List-Unsubscribe-Post, used by Gmail/Yahoo's native button).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const email = typeof req.query.e === "string" ? req.query.e.toLowerCase() : "";
  const token = typeof req.query.t === "string" ? req.query.t : "";

  if (!email || !token || !verifyUnsubToken(email, token)) {
    res.status(400).setHeader("Content-Type", "text/html").send(page("That unsubscribe link isn't valid.", "If you keep getting emails you don't want, call us at (732) 377-2468 and we'll take you off by hand."));
    return;
  }

  // A plain GET must not change anything. Corporate mail gateways, link scanners and image
  // proxies fetch every URL in a delivered email before the recipient ever opens it — so a GET
  // that opts out silently unsubscribed members from the welcome email itself, and they never
  // learned why the deals stopped. RFC 8058's one-click button uses POST, which still works
  // untouched below; the emailed link now renders a confirm button that POSTs.
  if (req.method === "GET") {
    res.status(200).setHeader("Content-Type", "text/html").send(
      confirmPage(email, token),
    );
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).setHeader("Content-Type", "text/html").send(page("Method not allowed.", "Open the unsubscribe link from your email and use its confirmation button."));
    return;
  }

  try {
    // Suppression first, and keyed by ADDRESS not member id: a one-time campaign to
    // past customers reaches people who were never members, and for them flipping
    // email_consent below matches zero rows — their opt-out would be forgotten.
    await sql`
      CREATE TABLE IF NOT EXISTS email_suppressions (
        email      TEXT PRIMARY KEY,
        source     TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      INSERT INTO email_suppressions (email, source) VALUES (${email}, 'unsubscribe_link')
      ON CONFLICT (email) DO NOTHING
    `;
    const updated = await sql`
      UPDATE vip_members SET email_consent = FALSE
      WHERE email = ${email} AND email_consent
      RETURNING id
    `;
    for (const row of updated.rows) {
      await sql`
        INSERT INTO consent_events (member_id, channel, action, source)
        VALUES (${row.id}, 'email', 'opt_out', 'email_unsubscribe')
      `;
    }
    res.status(200).setHeader("Content-Type", "text/html").send(page("You're unsubscribed.", "No more emails from the Gigi's VIP Club. Changed your mind? Rejoin anytime at gigislongbranch.com."));
  } catch (err) {
    console.error("[unsubscribe] error", err);
    res.status(500).setHeader("Content-Type", "text/html").send(page("Something went wrong.", "Try the link again in a minute, or call (732) 377-2468 and we'll take you off by hand."));
  }
}

/** GET view: a one-tap confirm that POSTs. Nothing is changed until the human presses it. */
function confirmPage(email: string, token: string): string {
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe — Gigi's VIP Club</title></head>
<body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#faf2e1;display:flex;min-height:100vh;align-items:center;justify-content:center;">
  <div style="max-width:420px;margin:24px;padding:36px 28px;background:#fff;border-radius:16px;box-shadow:0 14px 40px rgba(26,18,16,.12);text-align:center;">
    <h1 style="margin:0 0 10px;font-size:22px;color:#1a1210;">Unsubscribe from Gigi's emails?</h1>
    <p style="margin:0 0 22px;color:#6a5a52;line-height:1.6;">This will stop promotional emails to <strong>${esc(email)}</strong>. Your orders and receipts are not affected.</p>
    <form method="POST" action="/api/unsubscribe?e=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}">
      <button type="submit" style="width:100%;padding:14px 18px;border:0;border-radius:999px;background:#9b121a;color:#fff;font-size:15px;font-weight:700;cursor:pointer;">Yes, unsubscribe me</button>
    </form>
    <p style="margin:18px 0 0;font-size:13px;color:#6a5a52;">Changed your mind? Just close this page — nothing has changed yet.</p>
  </div>
</body></html>`;
}

function page(title: string, detail: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Gigi's VIP Club</title></head>
<body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#faf2e1;display:flex;min-height:100vh;align-items:center;justify-content:center;">
  <div style="max-width:420px;margin:24px;padding:36px 28px;background:#fff;border-radius:16px;box-shadow:0 14px 40px rgba(26,18,16,.12);text-align:center;">
    <div style="font-size:22px;font-weight:800;color:#9b121a;">${title}</div>
    <p style="color:#3c2f2a;line-height:1.6;margin:14px 0 0;">${detail}</p>
  </div>
</body></html>`;
}
