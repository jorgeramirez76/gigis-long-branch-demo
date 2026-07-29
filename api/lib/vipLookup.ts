import { sql } from "./db.js";

/**
 * Is this customer already in the VIP club? Used to decide whether an order
 * confirmation (popup + receipt) should pitch the free-pie signup — existing
 * members shouldn't be invited to something they already joined.
 *
 * Fails OPEN (returns false = "pitch them"): a DB hiccup must never break an
 * order, and the worst case is an existing member seeing one extra invite,
 * whereas a false "already a member" would silently cost a signup.
 */
export async function isVipMember(
  business: string,
  phone: string | null,
  email: string | null,
): Promise<boolean> {
  if (!phone && !email) return false;
  try {
    const r = await sql`
      SELECT 1 FROM vip_members
      WHERE business = ${business}
        AND (
          (${phone}::text IS NOT NULL AND phone = ${phone})
          OR (${email}::text IS NOT NULL AND email = ${email})
        )
      LIMIT 1
    `;
    return r.rowCount > 0;
  } catch (err) {
    console.error("[vipLookup] check failed — defaulting to 'not a member'", err);
    return false;
  }
}
