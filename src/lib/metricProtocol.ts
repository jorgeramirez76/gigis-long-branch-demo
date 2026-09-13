export const METRIC_EVENTS = ["menu_open", "category_select", "call_click", "checkout_start"] as const;
export const METRIC_SOURCES = ["search", "referral", "direct", "unknown"] as const;
export type MetricEvent = typeof METRIC_EVENTS[number];
export type MetricSource = typeof METRIC_SOURCES[number];
export type MetricBatch = { events: MetricEvent[]; source: MetricSource };
/** Fixed vocabulary only: never accept URLs, free text, identifiers, or counters. */
export function parseMetricBatch(value: unknown): MetricBatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(",") !== "events,source") return null;
  if (!METRIC_SOURCES.includes(v.source as MetricSource) || !Array.isArray(v.events) || v.events.length < 1 || v.events.length > 4) return null;
  if (v.events.some(event => !METRIC_EVENTS.includes(event as MetricEvent)) || new Set(v.events).size !== v.events.length) return null;
  return { events: v.events as MetricEvent[], source: v.source as MetricSource };
}
export function metricSource(referrer: string, ownOrigin: string): MetricSource {
  if (!referrer) return "direct";
  try {
    const ref = new URL(referrer);
    if (ref.origin === ownOrigin) return "unknown";
    const host = ref.hostname.toLowerCase();
    return /(^|\.)(google\.(com|co\.uk|ca)|bing\.com|duckduckgo\.com|search\.yahoo\.com)$/.test(host) ? "search" : "referral";
  } catch { return "unknown"; }
}
export function metricsOptedOut(nav: { doNotTrack?: string | null; globalPrivacyControl?: boolean }): boolean {
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}
