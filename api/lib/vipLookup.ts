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
  return (await lookupVipCustomer(business, phone, email, null)).member;
}

/** What the kitchen ticket header needs to know about who is ordering. */
export type VipCustomer = {
  /** In the VIP club by phone/email, or signed in to a rewards account. */
  member: boolean;
  /** Street on file: the member's, else the account's default saved address. Null when we hold none. */
  address: { address: string | null; apt: string | null; town: string | null } | null;
};

const NO_VIP: VipCustomer = { member: false, address: null };

/**
 * One round trip that answers both questions the kitchen ticket header asks:
 * is this a VIP, and do we already hold their address (so staff stop writing it
 * on the chit by hand — Kenny, 2026-09-20)?
 *
 * Fails OPEN (not a member, no address): a DB hiccup must never break an order.
 * The member's own address wins over the account's saved one — it is the address
 * the free-pie anti-abuse check was keyed on, so it is the one we verified.
 */
export async function lookupVipCustomer(
  business: string,
  phone: string | null,
  email: string | null,
  accountId: number | null,
): Promise<VipCustomer> {
  if (!phone && !email && accountId == null) return NO_VIP;
  try {
    const r = await sql`
      WITH m AS (
        SELECT id, address, apt FROM vip_members
        WHERE business = ${business}
          AND (
            (${phone}::text IS NOT NULL AND phone = ${phone})
            OR (${email}::text IS NOT NULL AND LOWER(email) = LOWER(${email}))
          )
        LIMIT 1
      ), a AS (
        SELECT street, apt, city FROM saved_addresses
        WHERE ${accountId}::bigint IS NOT NULL AND account_id = ${accountId}::bigint
        ORDER BY is_default DESC, id
        LIMIT 1
      )
      SELECT (SELECT id FROM m)      AS member_id,
             (SELECT address FROM m) AS member_address,
             (SELECT apt FROM m)     AS member_apt,
             (SELECT street FROM a)  AS saved_street,
             (SELECT apt FROM a)     AS saved_apt,
             (SELECT city FROM a)    AS saved_city
    `;
    const row = r.rows[0] as
      | {
          member_id: number | null;
          member_address: string | null;
          member_apt: string | null;
          saved_street: string | null;
          saved_apt: string | null;
          saved_city: string | null;
        }
      | undefined;
    if (!row) return { member: accountId != null, address: null };
    const address = row.member_address
      ? { address: row.member_address, apt: row.member_apt, town: null }
      : row.saved_street
        ? { address: row.saved_street, apt: row.saved_apt, town: row.saved_city }
        : null;
    return { member: row.member_id != null || accountId != null, address };
  } catch (err) {
    console.error("[vipLookup] check failed — defaulting to 'not a member'", err);
    // A signed-in account is known without the DB read — don't lose the VIP marker to a hiccup.
    return { member: accountId != null, address: null };
  }
}
