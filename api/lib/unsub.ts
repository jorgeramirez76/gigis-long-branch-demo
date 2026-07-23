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
  const expected = unsubToken(email);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export function unsubscribeUrl(email: string): string {
  const base = process.env.PUBLIC_BASE_URL || "https://gigis-long-branch-site.vercel.app";
  return `${base}/api/unsubscribe?e=${encodeURIComponent(email.toLowerCase())}&t=${unsubToken(email)}`;
}
