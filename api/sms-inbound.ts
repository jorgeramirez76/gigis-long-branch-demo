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

/** The six classic carrier opt-out keywords. Twilio blocks the number and sends its own
 *  confirmation when one of these is the whole message, so our reply to them stays empty. */
const CARRIER_STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
/** Every single word that means "stop" here, the FCC's revocation words included. */
const STOP_WORDS = new Set([...CARRIER_STOP_WORDS, "revoke", "optout"]);
const START_WORDS = new Set(["start", "yes", "unstop"]);
/** Stop words with no everyday second meaning: anywhere in the reply, they mean stop. ("stop"
 *  itself is handled on its own below; "cancel", "end" and "quit" count only at either end of the
 *  reply, since "cancel my order" or "end of the day" are not revocations.) */
const UNAMBIGUOUS_STOP_WORDS = new Set(["stopall", "unsubscribe", "unsub", "revoke", "optout"]);
/** Plain-English revocations anywhere in the reply ("take me off your list", "no more please"). */
const STOP_PHRASE = /\b(opt ?out|remove (me|my number|this number)|take (me|my number|this number) off|off (your|the|this|ur) (list|texts?)|(dont|do not) (text|txt|message|contact|send)|no more|leave me alone|wrong number)\b/;

/** Lowercase letters and single spaces only — "STOP!!", "Stop." and "stop  texting" all normalize. */
function normalizeSmsBody(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

export type SmsKeyword = "stop" | "start" | "help" | "other";
/**
 * STOP is checked FIRST, and matched well beyond the exact keyword, because over-opting-out is
 * harmless and texting someone who revoked consent is the TCPA exposure. A reply is STOP when:
 *  - the word "stop" appears anywhere, unless the very next word is "by" ("please stop by" is an
 *    invitation, the one documented false positive): "please stop these texts", "I want to stop
 *    receiving these", "YES STOP";
 *  - stopall, unsubscribe, unsub, revoke or optout appears anywhere;
 *  - its first or last word is cancel, end or quit ("cancel", "quit please", "ok end");
 *  - or it says so in plain English: "opt out", "take me off your list", "remove me",
 *    "don't text me", "no more please", "leave me alone", "wrong number".
 * It used to take the whole message being one of six words, so "please stop" and "opt out" kept
 * the person on the list, and "yes stop texting me" matched the YES opt-in first and re-subscribed
 * them. START keeps its deliberate first-word match (WORKLIST LB-2: "YES!" and "yes please"
 * confirm the double opt-in), but only once no stop intent was found.
 */
export function classifySmsKeyword(input: string): SmsKeyword {
  const body = normalizeSmsBody(input);
  const words = body ? body.split(" ") : [];
  const last = words.length - 1;
  const stopIntent =
    words.some((w, i) => (w === "stop" && words[i + 1] !== "by") || UNAMBIGUOUS_STOP_WORDS.has(w)) ||
    (words.length > 0 && (STOP_WORDS.has(words[0]) || STOP_WORDS.has(words[last]))) ||
    STOP_PHRASE.test(body);
  if (stopIntent) return "stop";
  if (words.length && START_WORDS.has(words[0])) return "start";
  if (body === "help" || body === "info") return "help";
  return "other";
}

/** Whether Twilio itself recognized this as an opt-out (and so blocks and confirms on its own). */
function carrierHandledStop(rawBody: string, optOutType: string): boolean {
  return optOutType === "STOP" || CARRIER_STOP_WORDS.has(normalizeSmsBody(rawBody));
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
  // TWILIO_SIGNATURE_LOG_ONLY=1 is the safe way to switch it on: mismatches are logged, not
  // refused, so you can confirm for a day that the Twilio console's webhook URL matches this
  // host/path/query exactly (any difference fails every signature — including every STOP)
  // before removing the flag to enforce.
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signatureLogOnly = process.env.TWILIO_SIGNATURE_LOG_ONLY === "1";
  if (authToken) {
    const sig = req.headers["x-twilio-signature"];
    const url = `https://${req.headers.host}${req.url ?? ""}`;
    const params = (req.body ?? {}) as Record<string, unknown>;
    const payload = url + Object.keys(params).sort().map((k) => k + String(params[k])).join("");
    const want = createHmac("sha1", authToken).update(payload).digest("base64");
    const gotSig = typeof sig === "string" ? Buffer.from(sig) : null;
    const wantSig = Buffer.from(want);
    if (!gotSig || gotSig.length !== wantSig.length || !timingSafeEqual(gotSig, wantSig)) {
      if (signatureLogOnly) {
        console.error("[sms-inbound] Twilio signature mismatch (TWILIO_SIGNATURE_LOG_ONLY — not refused)");
      } else {
        console.error("[sms-inbound] rejected: Twilio signature mismatch");
        res.status(403).send("forbidden");
        return;
      }
    }
  }

  const from = typeof req.body?.From === "string" ? req.body.From : "";
  // Consent rows are keyed by phone; refuse anything that is not an E.164 number outright.
  if (!/^\+[1-9]\d{6,14}$/.test(from)) {
    res.status(400).send("bad_from");
    return;
  }
  const body = typeof req.body?.Body === "string" ? req.body.Body.trim().toLowerCase() : "";
  // With Twilio Advanced Opt-Out, Twilio tells us which keyword class it matched (including any
  // custom keywords set in the console); honor it so our consent flags match what Twilio blocks.
  const optOutType = typeof req.body?.OptOutType === "string" ? req.body.OptOutType.trim().toUpperCase() : "";
  const keyword: SmsKeyword =
    optOutType === "STOP" ? "stop" : optOutType === "START" ? "start" : optOutType === "HELP" ? "help" : classifySmsKeyword(body);
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
      // An exact carrier keyword: Twilio suppresses our reply and sends the carrier-mandated
      // confirmation itself, so empty TwiML is correct. A plain-English revocation ("please
      // stop") is not one Twilio recognized, so nothing else confirms it — send the one
      // permitted confirmation the SMS terms promise.
      if (carrierHandledStop(body, optOutType)) {
        res.status(200).send(twiml());
        return;
      }
      res.status(200).send(
        twiml("Gigi's VIP Club: you're unsubscribed and won't get more texts from us. Reply START to rejoin. Questions? Call (732) 377-2468."),
      );
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
