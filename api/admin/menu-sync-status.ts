import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../lib/adminAuth.js";
import { fetchLiveInventory, pruneMenu } from "../lib/menuSync.js";
import { MENU_INDEX } from "../../src/data/menuIndex.js";

/**
 * GET /api/admin/menu-sync-status — read-only dry run of the nightly refresh.
 *
 * Shows what the cron WOULD take off the site and why, without writing a
 * snapshot. Use it to check a surprising removal against Clover before trusting
 * it (`?id=<cloverItemId>` also fetches that one item straight from Clover, so
 * "deleted" can be confirmed at the source).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  try {
    // Probing specific ids skips the full inventory pull — Clover rate-limits it.
    const ids = typeof req.query.id === "string" ? req.query.id.split(",").filter(Boolean) : [];
    if (ids.length) {
      const probe = [];
      for (const id of ids) {
        const r = await fetch(
          `https://api.clover.com/v3/merchants/${process.env.CLOVER_MERCHANT_ID}/items/${id}`,
          { headers: { Authorization: `Bearer ${process.env.CLOVER_API_TOKEN}` } },
        );
        const body: any = await r.json().catch(() => null);
        probe.push({ id, status: r.status, name: body?.name, deleted: body?.deleted, hidden: body?.hidden, available: body?.available });
      }
      res.status(200).json({ probe });
      return;
    }

    const inv = await fetchLiveInventory();
    const { total, removed, priceDrift } = pruneMenu(inv);

    res.status(200).json({
      liveItems: inv.known.size,
      liveSellable: inv.sellable.size,
      outOfStock: inv.outOfStock.size,
      stockIgnored: inv.stockIgnored,
      siteRows: total,
      mappedRows: MENU_INDEX.length,
      wouldRemove: removed.length,
      removed,
      priceDrift,
    });
  } catch (err) {
    console.error("[admin/menu-sync-status] error", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "failed" });
  }
}
