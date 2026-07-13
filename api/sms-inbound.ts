import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";
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
  if (
    !expected ||
    typeof got !== "string" ||
    got.length !== expected.length ||
    !timingSafeEqual(Buffer.from(got), Buffer.from(expected))
  ) {
    res.status(401).send("unauthorized");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).send("method_not_allowed");
    return;
  }

  const from = typeof req.body?.From === "string" ? req.body.From : "";
  const body = typeof req.body?.Body === "string" ? req.body.Body.trim().toLowerCase() : "";
  res.setHeader("Content-Type", "text/xml");

  if (!from) {
    res.status(200).send(twiml());
    return;
  }

  try {
    if (STOP_WORDS.has(body)) {
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

    if (START_WORDS.has(body)) {
      const updated = await sql`
        UPDATE vip_members SET sms_consent = TRUE
        WHERE phone = ${from} AND NOT sms_consent
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

    if (body === "help" || body === "info") {
      res.status(200).send(
        twiml(
          "Gigi's VIP Club (Long Branch NJ): occasional deals by text. Msg&data rates may apply. Reply STOP to opt out. Questions? Call (732) 377-2468.",
        ),
      );
      return;
    }

    // Anything else: acknowledge quietly, point at the shop.
    res.status(200).send(
      twiml("Thanks for texting Gigi's! This line sends VIP deals only — to order, call (732) 377-2468 or visit gigislongbranch.com."),
    );
  } catch (err) {
    console.error("[sms-inbound] error", err);
    // Never bounce Twilio — a 500 would trigger retries and error alerts.
    res.status(200).send(twiml());
  }
}
