import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "./lib/db.js";

/**
 * Serves the latest Clover-reconciled menu (written by api/cron/refresh-menu).
 * The site fetches this and falls back to the static build-time menu if it's
 * empty or unavailable, so the page always renders. Cached at the edge — the
 * menu changes at most nightly.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  try {
    const rows = await sql`
      SELECT data, item_count, updated_at
      FROM menu_snapshot WHERE business = 'gigis_long_branch'
    `;
    if (rows.rowCount === 0) {
      res.status(204).end(); // no snapshot yet — site uses its static menu
      return;
    }
    const row = rows.rows[0];
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
    res.status(200).json({
      categories: row.data.categories,
      itemCount: row.item_count,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    console.error("[api/menu] error", err);
    res.status(502).json({ error: "menu_unavailable" });
  }
}
