import { ACCOUNT_BUSINESS } from "./session.js";
import { sql } from "./db.js";
import { priceLines, type ClientLine } from "./menuCatalog.js";
import { liveItemNames } from "./menuLive.js";
export async function usualItems(accountId: number, excluded: string[]) {
  const rows = (await sql`SELECT l.item_name, l.category_id, l.modifiers, COUNT(DISTINCT l.order_id)::int AS times, MAX(l.created_at) AS last_at
    FROM order_lines l JOIN web_orders w ON w.id = l.order_id
    WHERE l.account_id = ${accountId} AND w.account_id = ${accountId} AND w.business = ${ACCOUNT_BUSINESS} AND l.created_at > now() - interval '180 days'
      AND w.status IN ('paid','paid_print_queued','paid_print_failed','refire_pending')
    GROUP BY l.item_name,l.category_id,l.modifiers HAVING COUNT(DISTINCT l.order_id) >= 2 ORDER BY times DESC,last_at DESC LIMIT 10`).rows;
  const live = await liveItemNames();
  const seen = new Set<string>();
  return rows.filter(r => !excluded.includes(String(r.item_name))).flatMap(r => {
    if (seen.has(String(r.item_name))) return [];
    const options = (typeof r.modifiers === "string" ? JSON.parse(r.modifiers) : r.modifiers) as ClientLine["options"];
    if (!Array.isArray(options)) return [];
    const priced = priceLines([{itemName:String(r.item_name),categoryId:String(r.category_id),quantity:1,options}], live);
    if (priced.ok) seen.add(String(r.item_name));
    return priced.ok ? [{...priced.lines[0], times:Number(r.times)}] : [];
  }).sort((a,b) => Number(/side|drink|dessert|fries|appetizer/.test(b.categoryId)) - Number(/side|drink|dessert|fries|appetizer/.test(a.categoryId))).slice(0,3);
}
