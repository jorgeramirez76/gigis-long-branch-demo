import { useEffect, useRef } from "react";
import { loadTurnstile, TURNSTILE_SITE_KEY, turnstileEnabled } from "../lib/turnstile";

/**
 * Renders a Cloudflare Turnstile widget and reports the verification token up.
 * Renders nothing (and requires no token) when Turnstile isn't configured, so
 * the form works unchanged until the site key is set.
 */
export function Turnstile({
  onToken,
  resetSignal = 0,
  onLoadFailed,
}: {
  onToken: (token: string | null) => void;
  /** Increment to force a fresh challenge/token (Turnstile tokens are single-use,
   *  so the parent bumps this after a failed submit consumed the token). Also the
   *  customer's "Retry security check" when the widget never loaded at all. */
  resetSignal?: number;
  /** The widget could not be loaded or rendered at all — an ad blocker, a corporate DNS
   *  filter, a Cloudflare edge outage. Without this the parent sees only a null token and
   *  tells the customer to complete a check that isn't on the page. */
  onLoadFailed?: (failed: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  const failed = useRef(onLoadFailed);
  failed.current = onLoadFailed;

  /** Load the script (if needed) and render the widget. Safe to call repeatedly. */
  const mount = useRef(() => {});
  mount.current = () => {
    if (!ref.current || widgetId.current !== null) return;
    loadTurnstile()
      .then((ts) => {
        // Re-check: the await gives StrictMode's mount→cleanup→mount a window to race in.
        if (!ref.current || widgetId.current !== null) return;
        try {
          widgetId.current = ts.render(ref.current, {
            sitekey: TURNSTILE_SITE_KEY,
            callback: (token: string) => {
              failed.current?.(false);
              cb.current(token);
            },
            // An errored or expired challenge is recoverable — the widget re-runs on its own —
            // so these null the token WITHOUT reporting a hard failure. Only a widget that never
            // rendered is unrecoverable, and only that should send the customer to the phone.
            "error-callback": () => cb.current(null),
            "expired-callback": () => cb.current(null),
            "timeout-callback": () => cb.current(null),
            theme: "auto",
          });
        } catch {
          cb.current(null);
          failed.current?.(true);
        }
      })
      .catch(() => {
        cb.current(null);
        failed.current?.(true);
      });
  };

  // Initial mount only — the widget is rendered once and then reset in place.
  useEffect(() => {
    if (!turnstileEnabled()) return;
    mount.current();
    return () => {
      const ts = (window as { turnstile?: { remove: (id: string) => void } }).turnstile;
      if (ts && widgetId.current) {
        try {
          ts.remove(widgetId.current);
        } catch {
          /* ignore */
        }
        widgetId.current = null;
      }
    };
  }, []);

  // Parent bumped resetSignal. With a live widget its token was spent, so reset in place.
  // With NO widget the earlier load failed and this is the customer's retry — attempt the
  // whole load again. The old code no-oped in that case, which made a blocked script terminal:
  // the Pay button stayed disabled for the rest of the session with no way to recover.
  useEffect(() => {
    if (resetSignal === 0 || !turnstileEnabled()) return;
    const ts = (window as { turnstile?: { reset: (id: string) => void } }).turnstile;
    if (ts && widgetId.current) {
      try {
        cb.current(null);
        ts.reset(widgetId.current);
      } catch {
        /* ignore */
      }
      return;
    }
    mount.current();
  }, [resetSignal]);

  if (!turnstileEnabled()) return null;
  return <div ref={ref} className="my-2 flex min-h-[65px] justify-center" />;
}
