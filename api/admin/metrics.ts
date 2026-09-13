import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../lib/adminAuth.js";
import { readMetrics } from "../lib/metrics.js";
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (!(await requireAdmin(req, res))) return;
  if (req.method !== "GET") return void res.status(405).end();
  try { res.status(200).json(await readMetrics("gigis_long_branch")); }
  catch { res.status(503).json({ error: "metrics_unavailable" }); }
}
