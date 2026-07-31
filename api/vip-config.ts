/**
 * Public config for the static VIP landing page at /vip/.
 *
 * WHY THIS EXISTS: /vip/ is printed as a QR code on 20,000 paper menus, so that URL can never be
 * changed and the page behind it must keep working through future config changes. The page is
 * static HTML (no build-time env injection), but /api/vip-signup verifies a Turnstile token
 * whenever TURNSTILE_SECRET_KEY is set. If someone switches Turnstile on later, a page that did
 * not render the widget would start returning 403 verification_failed to every scan — silently
 * breaking every printed menu.
 *
 * So the page asks the server at runtime whether a token will be required, and renders the widget
 * only when it is. Nothing secret is exposed: a Turnstile *site* key is public by design and
 * normally ships inside client HTML. The secret key is never returned, only whether one is set.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  // The client bundle reads VITE_TURNSTILE_SITE_KEY; the same value is available to functions when
  // it is set as a plain Vercel env var. TURNSTILE_SITE_KEY is accepted as a server-side alias.
  const siteKey =
    process.env.VITE_TURNSTILE_SITE_KEY || process.env.TURNSTILE_SITE_KEY || null;

  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
  res.status(200).json({
    // Whether /api/vip-signup will actually enforce a token. Server-side truth.
    turnstileRequired: !!process.env.TURNSTILE_SECRET_KEY,
    turnstileSiteKey: siteKey,
  });
}
