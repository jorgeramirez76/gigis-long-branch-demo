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
}: {
  onToken: (token: string | null) => void;
  /** Increment to force a fresh challenge/token (Turnstile tokens are single-use,
   *  so the parent bumps this after a failed submit consumed the token). */
  resetSignal?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  // Reset the widget when the parent bumps resetSignal → issues a new token.
  useEffect(() => {
    if (resetSignal === 0) return;
    const ts = (window as { turnstile?: { reset: (id: string) => void } }).turnstile;
    if (ts && widgetId.current) {
      try {
        cb.current(null);
        ts.reset(widgetId.current);
      } catch {
        /* ignore */
      }
    }
  }, [resetSignal]);

  useEffect(() => {
    if (!turnstileEnabled() || !ref.current) return;
    // Guard on widgetId (not a "removed" flag) so React 18 StrictMode's
    // mount→cleanup→mount in dev can't race the async ready() callback into
    // skipping the render. Render at most once into the live container.
    const doRender = (ts: { render: (el: HTMLElement, opts: unknown) => string }) => {
      if (!ref.current || widgetId.current !== null) return;
      try {
        widgetId.current = ts.render(ref.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token: string) => cb.current(token),
          "error-callback": () => cb.current(null),
          "expired-callback": () => cb.current(null),
          "timeout-callback": () => cb.current(null),
          theme: "auto",
        });
      } catch {
        cb.current(null);
      }
    };
    // Our loader resolves on the script's onload, so turnstile is already
    // initialized — render directly. (turnstile.ready() must NOT be used here:
    // it throws for an async/defer-loaded api.js.)
    loadTurnstile()
      .then((ts) => doRender(ts))
      .catch(() => cb.current(null));
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

  if (!turnstileEnabled()) return null;
  return <div ref={ref} className="my-2 flex min-h-[65px] justify-center" />;
}
