import { METRIC_EVENTS, metricSource, metricsOptedOut, type MetricEvent } from "./lib/metricProtocol";

/** Best-effort action counts, once per type/document. No IDs, storage, URLs or pageviews. */
export function installMetrics() {
  if (typeof window === "undefined" || import.meta.env.VITE_METRICS_OFF === "true" || metricsOptedOut(navigator)) return;
  if (/^\/(account|admin|vip)(\/|\.|$)/.test(location.pathname)) return;
  if (document.documentElement.hasAttribute("data-metrics-installed")) return;
  document.documentElement.setAttribute("data-metrics-installed", "");
  const seen = new Set<MetricEvent>();
  let queued: MetricEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const source = metricSource(document.referrer, location.origin);
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    const events = queued; queued = [];
    if (!events.length || metricsOptedOut(navigator)) return;
    void fetch("/api/metrics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events, source }), credentials: "omit", referrerPolicy: "no-referrer", keepalive: true }).catch(() => {});
  };
  document.addEventListener("click", event => {
    if (!event.isTrusted || metricsOptedOut(navigator)) return;
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>("a,button") : null;
    if (!element || element.matches(":disabled,[aria-disabled=true]")) return;
    let name = element.dataset.metric as MetricEvent | undefined;
    if (element instanceof HTMLAnchorElement) {
      if (element.protocol === "tel:") name = "call_click";
      else if (element.origin === location.origin) {
        const url = new URL(element.href);
        if (url.searchParams.has("category")) name = "category_select";
        else if (url.hash === "#menu" || /^\/menu\/?$/.test(url.pathname)) name = "menu_open";
      }
    }
    if (!name || !METRIC_EVENTS.includes(name) || seen.has(name)) return;
    seen.add(name); queued.push(name);
    if (!timer) timer = setTimeout(flush, 1500);
  }, { capture: true });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
}
installMetrics();
