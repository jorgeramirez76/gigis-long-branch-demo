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

  try {
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
    res.status(200).setHeader("Content-Type", "text/html").send(page("You're unsubscribed.", "No more emails from the Gigi's VIP Club. Changed your mind? Rejoin anytime at gigisnystylepizza.com."));
  } catch (err) {
    console.error("[unsubscribe] error", err);
    res.status(500).setHeader("Content-Type", "text/html").send(page("Something went wrong.", "Try the link again in a minute, or call (732) 377-2468 and we'll take you off by hand."));
  }
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
