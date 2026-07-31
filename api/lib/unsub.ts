import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed one-click unsubscribe links. Secret is UNSUB_SECRET (required —
 * no fallback; a missing secret throws and the caller skips the email send).
 */
function secret(): string {
  // Dedicated secret only — do NOT fall back to ADMIN_TOKEN (that would reuse the
  // admin credential across an unrelated trust boundary). UNSUB_SECRET is set in prod.
  const s = process.env.UNSUB_SECRET;
  if (!s) throw new Error("UNSUB_SECRET not set");
  return s;
}

export function unsubToken(email: string): string {
  return createHmac("sha256", secret()).update(email.toLowerCase()).digest("hex").slice(0, 32);
}

export function verifyUnsubToken(email: string, token: string): boolean {
  // Byte lengths, not string lengths — a multibyte token in a tampered link can
  // pass the code-unit check and then make timingSafeEqual throw, which turns an
  // invalid unsubscribe link into a 500 instead of the friendly failure page.
  const a = Buffer.from(token);
  const b = Buffer.from(unsubToken(email));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unsubscribeUrl(email: string): string {
  const base = process.env.PUBLIC_BASE_URL || "https://gigis-long-branch-site.vercel.app";
  return `${base}/api/unsubscribe?e=${encodeURIComponent(email.toLowerCase())}&t=${unsubToken(email)}`;
}
