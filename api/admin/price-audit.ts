import type { VercelRequest, VercelResponse } from "@vercel/node";
import { secretMatches } from "../lib/adminAuthToken.js";
import { fetchLiveInventory, pruneMenu } from "../lib/menuSync.js";

/**
 * TEMPORARY ops route — reports every price on the site that disagrees with the live Clover
 * register, so a drift can be corrected at the source instead of from a stale local pull.
 * Remove once the current reconciliation is done.
 *
 * It is the same read-only dry run /api/admin/menu-sync-status already performs; it exists only
 * because ADMIN_TOKEN is marked Sensitive in Vercel and cannot be read from a laptop, so the
 * existing route cannot be called from outside the deployment. Guarded by its own throwaway
 * secret (MENU_AUDIT_SECRET), read-only, and it never writes to Clover or the database.
 *
 * GET with header `x-audit-token`. Optional ?q=<substring> filters the drift list by item name.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  const expected = process.env.MENU_AUDIT_SECRET;
  if (!expected) return void res.status(503).json({ error: "audit_not_configured" });
  if (!secretMatches(req.headers["x-audit-token"], expected)) return void res.status(401).json({ error: "unauthorized" });
  if (req.method !== "GET") return void res.status(405).json({ error: "method_not_allowed" });

  try {
    const inv = await fetchLiveInventory();
    const { total, removed, priceDrift } = pruneMenu(inv);
    const q = typeof req.query.q === "string" ? req.query.q.toLowerCase() : "";
    const drift = q ? priceDrift.filter((d) => d.item.toLowerCase().includes(q)) : priceDrift;
    res.status(200).json({
      itemsOnSite: total,
      removedByClover: removed.length,
      driftCount: priceDrift.length,
      drift,
      toppingChargeCents: inv.toppingChargeCents,
      halfToppingChargeCents: inv.halfToppingChargeCents,
    });
  } catch (err) {
    console.error("[admin/price-audit] error", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "clover_failed" });
  }
}
