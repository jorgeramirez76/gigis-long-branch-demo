import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "../lib/db.js";
import { fetchLiveInventory, pruneMenu, REMOVAL_GUARD_SHARE } from "../lib/menuSync.js";

/**
 * Nightly menu refresh (Vercel Cron — see vercel.json).
 *
 * Pulls the live Clover inventory and takes off the website anything the shop
 * has taken off the POS (deleted, hidden, marked unavailable, or 86'd). The
 * pruned menu is written to Neon and served by /api/menu, so removals reach the
 * site the same night with no redeploy.
 *
 * One-way by design: this reads Clover and never writes to it. An item pulled
 * from the POS is never re-added there, and items that exist only on the website
 * are never pushed up.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. On any Clover
 * error, or if the pull looks broken (a mass removal), nothing is written and
 * the last good snapshot stays in place.
 */
export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const inv = await fetchLiveInventory();
    const { categories, total, removed, priceDrift } = pruneMenu(inv);

    if (total > 0 && removed.length > total * REMOVAL_GUARD_SHARE) {
      // A real menu never loses a quarter of itself overnight — treat this as a
      // bad pull and keep the previous snapshot.
      res.status(422).json({ error: "too_many_removals", removed: removed.length, total });
      return;
    }

    const kept = categories.reduce((a, c) => a + c.items.length, 0);
    await sql`
      CREATE TABLE IF NOT EXISTS menu_snapshot (
        business    TEXT PRIMARY KEY,
        data        JSONB NOT NULL,
        item_count  INT NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      INSERT INTO menu_snapshot (business, data, item_count, updated_at)
      VALUES ('gigis_long_branch', ${JSON.stringify({ categories })}::jsonb, ${kept}, now())
      ON CONFLICT (business) DO UPDATE
        SET data = EXCLUDED.data, item_count = EXCLUDED.item_count, updated_at = now()
    `;
    if (removed.length) console.log("[cron/refresh-menu] removed", removed.join(" | "));
    if (priceDrift.length) console.log("[cron/refresh-menu] price drift", JSON.stringify(priceDrift));
    res.status(200).json({
      ok: true,
      items: kept,
      removed,
      priceDrift,
      stockIgnored: inv.stockIgnored,
    });
  } catch (err) {
    console.error("[cron/refresh-menu] error", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "sync_failed" });
  }
}
