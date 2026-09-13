import { sql } from "./db.js";
import type { MetricBatch } from "../../src/lib/metricProtocol.js";

export async function recordMetrics(business: string, batch: MetricBatch): Promise<void> {
  // One statement per batch. Fixed vocabulary bounds rows; counters saturate daily.
  await sql`
    INSERT INTO site_metric_daily (business, day, event, source, n)
    SELECT ${business}, (now() AT TIME ZONE 'America/New_York')::date, value, ${batch.source}, 1
    FROM jsonb_array_elements_text(${JSON.stringify(batch.events)}::jsonb)
    ON CONFLICT (business, day, event, source)
    DO UPDATE SET n = LEAST(site_metric_daily.n + 1, 10000)
  `;
}

export async function pruneMetrics(business: string) {
  await sql`DELETE FROM site_metric_daily WHERE business=${business} AND day < (now() AT TIME ZONE 'America/New_York')::date - 180`;
}

export async function readMetrics(business: string) {
  await pruneMetrics(business);
  const events = await sql`SELECT day::text, event, source, n FROM site_metric_daily
    WHERE business=${business} AND day >= (now() AT TIME ZONE 'America/New_York')::date - 28 ORDER BY day, event, source`;
  const orders = await sql`SELECT (created_at AT TIME ZONE 'America/New_York')::date::text AS day,
    COUNT(*) FILTER (WHERE status IN ('placed','paid','paid_print_queued','paid_print_failed'))::int AS accepted_orders,
    COUNT(*) FILTER (WHERE charge_id IS NOT NULL)::int AS recorded_captures,
    COUNT(*) FILTER (WHERE status IN ('capture_uncertain','routing_uncertain','charged','paid_unrouted','refire_pending'))::int AS unresolved_orders
    FROM web_orders WHERE business=${business} AND created_at >= ((now() AT TIME ZONE 'America/New_York')::date - 28) AT TIME ZONE 'America/New_York'
    GROUP BY 1 ORDER BY 1`;
  return { events: events.rows, orders: orders.rows,
    definitions: { events: "At most one action of each type per document; best effort, not people or sessions.",
      source: "Referrer-derived document source; internal navigation is unknown. No order attribution.",
      orders: "Existing ledger rows by creation date and current status; accepted includes cash placed, captures are not net revenue or proof of fulfillment." } };
}
