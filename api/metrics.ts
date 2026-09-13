import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseMetricBatch } from "../src/lib/metricProtocol.js";
import { recordMetrics } from "./lib/metrics.js";
const ORIGINS = new Set(["https://gigislongbranch.com", "https://www.gigislongbranch.com"]);
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return void res.status(405).end();
  if (process.env.METRICS_DISABLED === "true" || req.headers.dnt === "1" || req.headers["sec-gpc"] === "1") return void res.status(204).end();
  if (!ORIGINS.has(String(req.headers.origin ?? "")) || req.headers["sec-fetch-site"] === "cross-site") return void res.status(403).end();
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json") || Number(req.headers["content-length"] ?? 0) > 512) return void res.status(400).end();
  let body: unknown = req.body;
  if (typeof body === "string") { if (body.length > 512) return void res.status(400).end(); try { body = JSON.parse(body); } catch { return void res.status(400).end(); } }
  const batch = parseMetricBatch(body);
  if (!batch) return void res.status(400).end();
  try { await recordMetrics("gigis_long_branch", batch); } catch { console.warn("[metrics] aggregate unavailable"); }
  // No retries and no dependency on ordering or authentication success.
  res.status(204).end();
}
