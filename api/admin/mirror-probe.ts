import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../lib/adminAuth.js";
import { mirrorProbe } from "../lib/clover.js";

/**
 * POST { scenario: "same-name-diff-price" | "same-name-same-price" | "distinct" | lines: [...] }
 * Runs one draft-order probe against the ecommerce mirror and returns what each read saw.
 * Diagnostic only: drafts cannot fire or print, are invisible to the worklist, and are deleted.
 */
export const config = { maxDuration: 60 };

const SCENARIOS: Record<string, { name: string; price: number }[]> = {
  // David Evan's exact shape: one item name, two prices (9" vs 14" sub).
  "same-name-diff-price": [
    { name: "ZZ Probe Sub", price: 156 },
    { name: "ZZ Probe Sub", price: 226 },
  ],
  // Every multi-quantity cart posts this shape: N identical (name, price) rows.
  "same-name-same-price": [
    { name: "ZZ Probe Slice", price: 101 },
    { name: "ZZ Probe Slice", price: 101 },
    { name: "ZZ Probe Slice", price: 101 },
  ],
  // Control — the shape the 12 clean orders all had.
  distinct: [
    { name: "ZZ Probe A", price: 101 },
    { name: "ZZ Probe B", price: 102 },
  ],
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const body = (req.body ?? {}) as { scenario?: string; lines?: { name?: unknown; price?: unknown }[] };
  let lines = body.scenario ? SCENARIOS[body.scenario] : undefined;
  if (!lines && Array.isArray(body.lines)) {
    const parsed = body.lines
      .filter((l) => typeof l?.name === "string" && Number.isInteger(l?.price))
      .map((l) => ({ name: String(l.name).slice(0, 60), price: Math.min(Math.max(1, l.price as number), 500) }));
    if (parsed.length >= 1 && parsed.length <= 6) lines = parsed;
  }
  if (!lines) {
    res.status(400).json({ error: "bad_scenario", known: Object.keys(SCENARIOS) });
    return;
  }
  try {
    const out = await mirrorProbe(lines, [0, 1500, 4000, 9000, 20000, 40000]);
    const posted = lines.reduce((a, l) => a + l.price, 0);
    res.status(200).json({
      ok: true,
      scenario: body.scenario ?? "custom",
      postedLines: lines.length,
      postedSum: posted,
      reads: out.reads.map((r) => ({
        atMs: r.atMs,
        itemCount: r.items.length,
        sum: r.items.reduce((a, i) => a + (typeof i.amount === "number" ? i.amount : 0), 0),
        names: r.items.map((i) => `${i.name ?? "?"}:${i.amount ?? "?"}`),
      })),
    });
  } catch (err) {
    res.status(502).json({ error: "probe_failed", detail: err instanceof Error ? err.message : String(err) });
  }
}
