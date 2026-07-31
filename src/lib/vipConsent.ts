/**
 * Canonical VIP Club consent language — the single copy for the React app.
 *
 * MUST stay byte-identical to CANONICAL_CONSENT_TEXT in api/vip-signup.ts (the server rejects a
 * signup whose consentText doesn't match) and to the copy in public/vip-club/vip.js. This exact
 * wording is also registered as the A2P campaign's opt-in language, so changing it means updating
 * the server, the static page, and the Twilio filing together.
 *
 * Both the homepage VIP form (components/VipClub.tsx) and the post-order inline join
 * (ordering/VipJoinInline.tsx) import from here so they can never drift apart.
 */
export const CONSENT_TEXT =
  "By checking \"Text me deals,\" I agree to receive recurring promotional texts (weekly specials and promo codes) from Gigi's NY Style Pizza, 140 Brighton Ave, Long Branch, NJ, sent by automated technology to the number I provided. Consent is not a condition of any purchase. Message frequency varies, typically up to 4 per month. Message & data rates may apply. Reply STOP to opt out, HELP for help. By checking \"Email me deals,\" I agree to receive promotional emails; unsubscribe anytime via the link in any email.";
