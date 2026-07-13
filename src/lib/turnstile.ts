/**
 * Cloudflare Turnstile (privacy-friendly CAPTCHA) — IP-rotation-proof bot
 * protection layered on top of server rate limiting. Fully env-gated: with no
 * VITE_TURNSTILE_SITE_KEY the widget is not shown and no token is required, so
 * the site works before the keys are set. Flip it on by setting the site key
 * (client) + TURNSTILE_SECRET_KEY (server).
 */
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

export function turnstileEnabled(): boolean {
  return typeof TURNSTILE_SITE_KEY === "string" && TURNSTILE_SITE_KEY.trim().length > 0;
}

let sdkPromise: Promise<any> | null = null;

export function loadTurnstile(): Promise<any> {
  const w = window as any;
  if (w.turnstile) return Promise.resolve(w.turnstile);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error("Turnstile SDK missing")));
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("Could not load the verification widget."));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}
