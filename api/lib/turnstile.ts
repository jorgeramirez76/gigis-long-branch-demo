/**
 * Server-side Cloudflare Turnstile verification. Env-gated on TURNSTILE_SECRET_KEY:
 * with no secret, verification is skipped (returns true) so the site works before
 * the keys are set. Bot protection that doesn't depend on the rate-limiter DB and
 * defeats IP/phone rotation.
 */
export function turnstileConfigured(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

/**
 * @returns true if the request should be ALLOWED. When configured: verifies the
 * token with Cloudflare (fail-CLOSED on an explicit bot verdict, fail-OPEN on a
 * network error so a Cloudflare outage can't take down ordering — the rate
 * limiter remains the backstop).
 */
export async function verifyTurnstile(token: string | undefined, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured → skip
  if (!token || typeof token !== "string") return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean };
    return data.success === true;
  } catch (e) {
    console.error("[turnstile] verify error — failing open to the rate limiter", e);
    return true;
  }
}
