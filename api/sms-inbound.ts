import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "./lib/db.js";

/**
 * Twilio inbound-SMS webhook for the VIP line. Handles STOP/START/HELP.
 *
 * Twilio itself enforces carrier-level STOP blocking on US long codes; this
 * webhook additionally flips our own consent flags so blast audiences shrink
 * immediately and we keep a TCPA audit trail. Authenticated via a shared
 * token in the webhook URL (?token=) since the deploy may only hold a scoped
 * API key, not the auth token Twilio signs requests with.
 */

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_WORDS = new Set(["start", "yes", "unstop"]);

export type SmsKeyword = "stop" | "start" | "help" | "other";
export function classifySmsKeyword(input: string): SmsKeyword {
  const body = input.trim().toLowerCase().replace(/[^a-z\s]/g, "").trim();
  if (STOP_WORDS.has(body)) return "stop";
  if (START_WORDS.has(body.split(/\s+/)[0])) return "start";
  if (body === "help" || body === "info") return "help";
  return "other";
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function twiml(message?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${
    message ? `<Message>${xmlEscape(message)}</Message>` : ""
  }</Response>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const expected = process.env.SMS_WEBHOOK_TOKEN;
  const got = req.query.token;
  // Compare byte lengths (not UTF-16 lengths) — a multibyte token would make
  // timingSafeEqual throw on mismatched buffer sizes instead of returning false.
  const gotBuf = typeof got === "string" ? Buffer.from(got) : null;
  const expectedBuf = expected ? Buffer.from(expected) : null;
  if (
    !expectedBuf ||
    !gotBuf ||
    gotBuf.length !== expectedBuf.length ||
    !timingSafeEqual(gotBuf, expectedBuf)
  ) {
    res.status(401).send("unauthorized");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).send("method_not_allowed");
    return;
  }
  // Second factor when the auth token is deployed: Twilio signs every webhook as
  // base64(HMAC-SHA1(authToken, url + sorted POST params)). The query-string token above
  // travels in URLs (Twilio console, request logs, any intermediary), so on its own anyone who
  // has seen it can flip a member's consent; the signature proves the POST came from Twilio.
  // Only enforced when TWILIO_AUTH_TOKEN is set — an API-key-only deployment cannot compute it.
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const sig = req.headers["x-twilio-signature"];
    const url = `https://${req.headers.host}${req.url ?? ""}`;
    const params = (req.body ?? {}) as Record<string, unknown>;
    const payload = url + Object.keys(params).sort().map((k) => k + String(params[k])).join("");
    const want = createHmac("sha1", authToken).update(payload).digest("base64");
    const gotSig = typeof sig === "string" ? Buffer.from(sig) : null;
    const wantSig = Buffer.from(want);
    if (!gotSig || gotSig.length !== wantSig.length || !timingSafeEqual(gotSig, wantSig)) {
      console.error("[sms-inbound] rejected: Twilio signature mismatch");
      res.status(403).send("forbidden");
      return;
    }
  }

  const from = typeof req.body?.From === "string" ? req.body.From : "";
  // Consent rows are keyed by phone; refuse anything that is not an E.164 number outright.
  if (!/^\+[1-9]\d{6,14}$/.test(from)) {
    res.status(400).send("bad_from");
    return;
  }
  const body = typeof req.body?.Body === "string" ? req.body.Body.trim().toLowerCase() : "";
  const keyword = classifySmsKeyword(body);
  res.setHeader("Content-Type", "text/xml");

  if (!from) {
    res.status(200).send(twiml());
    return;
  }

  try {
    if (keyword === "stop") {
      const updated = await sql`
        UPDATE vip_members SET sms_consent = FALSE
        WHERE phone = ${from} AND sms_consent
        RETURNING id
      `;
      for (const row of updated.rows) {
        await sql`
          INSERT INTO consent_events (member_id, channel, action, source)
          VALUES (${row.id}, 'sms', 'opt_out', 'sms_stop')
        `;
      }
      // Twilio suppresses our reply to STOP and sends the carrier-mandated
      // confirmation itself; returning empty TwiML is correct here.
      res.status(200).send(twiml());
      return;
    }

    if (keyword === "start") {
      // Scoped to this number's own business, unlike STOP above. The two are
      // deliberately asymmetric: opting a number out of more lists than it asked for
      // is never a compliance problem, but opting one IN is. This line is Gigi's Sea
      // Bright, and Long Branch Bagels shares the table — an unscoped START would grant
      // the bagel shop consent this customer never gave it.
      const updated = await sql`
        UPDATE vip_members SET sms_consent = TRUE
        WHERE phone = ${from} AND business = 'gigis_long_branch' AND NOT sms_consent
        RETURNING id
      `;
      for (const row of updated.rows) {
        await sql`
          INSERT INTO consent_events (member_id, channel, action, source)
          VALUES (${row.id}, 'sms', 'opt_in', 'sms_start')
        `;
      }
      res.status(200).send(
        twiml("You're back on the Gigi's VIP list. Txt STOP anytime to opt out."),
      );
      return;
    }

    if (keyword === "help") {
      res.status(200).send(
        twiml(
          "Gigi's VIP Club (Long Branch NJ): occasional deals by text. Msg&data rates may apply. Reply STOP to opt out. Questions? Call (732) 377-2468.",
        ),
      );
      return;
    }

    // Anything else: acknowledge quietly, point at the shop.
    res.status(200).send(
      twiml("Thanks for texting Gigi's! This line sends VIP deals only — to order, call (732) 377-2468."),
    );
  } catch (err) {
    console.error("[sms-inbound] error", err);
    // Never bounce Twilio — a 500 would trigger retries and error alerts.
    res.status(200).send(twiml());
  }
}
