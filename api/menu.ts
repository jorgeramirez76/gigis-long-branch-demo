import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "./lib/db.js";
import { MENU_PRICING_VERSION } from "./lib/cardPricing.mjs";

/**
 * Serves the latest Clover-synced menu (written by api/cron/refresh-menu).
 * The site fetches this and falls back to the static build-time menu if it's
 * empty or unavailable, so the page always renders. Cached at the edge — the
 * menu changes at most daily.
 */

/** UTC hours of the refresh-menu cron (vercel.json "0 8,9 * * *": 4 AM Eastern in either DST
 *  state; menuSchedule.ts picks the one that is really 4 AM). Between deploys that run is the
 *  only thing that changes the snapshot, and a deploy starts a fresh CDN cache. */
export const MENU_REFRESH_UTC_HOURS = [8, 9] as const;
/** Slack after each run before the cached copy expires, so a cron that starts a few minutes late
 *  is still read fresh. If it runs later than that, the next expiry (an hour on) picks it up. */
const MENU_REFRESH_SLACK_MIN = 10;

/**
 * How long the CDN may keep the menu: until shortly after the next refresh-menu run, at most a
 * day. With a fixed 10-minute lifetime every region re-read Neon about every 10 minutes of
 * traffic, waking the database between the cron ticks it is meant to sleep through (b8bcc15).
 * Checkout still re-checks every item against the live snapshot (liveItemNames), so a cached
 * menu can never sell something the POS removed.
 */
export function menuCdnMaxAgeSec(now: Date): number {
  const t = now.getTime();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const next = Math.min(
    ...[0, 1].flatMap((day) => MENU_REFRESH_UTC_HOURS.map((h) => midnight + day * 86_400_000 + (h * 60 + MENU_REFRESH_SLACK_MIN) * 60_000)).filter((at) => at > t),
  );
  return Math.max(60, Math.min(86_400, Math.ceil((next - t) / 1000)));
}

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
    if (row.data?.pricing !== MENU_PRICING_VERSION) {
      // Pre-cash-price snapshot (see api/lib/menuLive.ts) — the static menu is the right one.
      res.status(204).end();
      return;
    }
    // s-maxage is the CDN's lifetime (browsers keep 60 s). After it expires, one visitor gets the
    // cached copy while the CDN re-reads in the background (stale-while-revalidate).
    res.setHeader("Cache-Control", `public, max-age=60, s-maxage=${menuCdnMaxAgeSec(new Date())}, stale-while-revalidate=86400`);
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
