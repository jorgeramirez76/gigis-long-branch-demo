import { randomBytes } from "node:crypto";
import { sql } from "./db.js";
import { completeSignup, ensureMemberHasCode, type ValidatedSignup } from "./vipSignupShared.js";
import { ACCOUNT_BUSINESS, hashToken } from "./session.js";
export async function claimGuestOrders(accountId: number, email: string) {
  // Only invoked for the account's verified email. Business prevents cross-store claims.
  await sql`UPDATE web_orders SET account_id = ${accountId}, customer_email_lower = LOWER(customer_email)
    WHERE business = ${ACCOUNT_BUSINESS} AND LOWER(customer_email) = ${email} AND account_id IS NULL`;
  await sql`UPDATE order_lines l SET account_id = ${accountId} FROM web_orders w
    WHERE l.order_id = w.id AND w.account_id = ${accountId} AND l.account_id IS NULL`;
}
export async function accountOrders(id: number, offset = 0) {
  return (await sql`SELECT id, created_at, fulfillment, items, subtotal, tax, tip, total, fee_cents, discount_cents, status
    FROM web_orders WHERE account_id = ${id} AND business = ${ACCOUNT_BUSINESS}
      AND status IN ('paid','paid_print_queued','paid_print_failed','refire_pending','paid_unrouted','charged')
    ORDER BY created_at DESC LIMIT 10 OFFSET ${offset}`).rows;
}

/**
 * Mint a one-time rewards-account link token WITHOUT emailing it.
 *
 * Used by the unified signup: the person has just proved control of this inbox by tapping the VIP
 * verification link, so the password step is handed to them on that same page instead of costing
 * a second email. Same table, purpose and 30-minute life as an emailed link — only the delivery
 * differs, and the authority required to obtain it (the emailed verification token) is identical.
 *
 * Returns the raw token; the caller builds the same-origin /account/#token=… address.
 */
export async function mintAccountSignupToken(email: string, payload: unknown): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await sql`INSERT INTO account_tokens (token_hash,business,email,purpose,payload,expires_at)
    VALUES (${hashToken(token)},${ACCOUNT_BUSINESS},${email},'signup',${JSON.stringify(payload)}::jsonb,now()+interval '30 minutes')`;
  return token;
}

/** Durable enrollment survives a function stopping after the password is saved. */
export async function finishEnrollment(accountId: number) {
  const row = (await sql`SELECT email,enrollment_payload FROM accounts WHERE id=${accountId} AND business=${ACCOUNT_BUSINESS} AND deleted_at IS NULL`).rows[0];
  if (!row) return;
  if (row.enrollment_payload) {
    const p = row.enrollment_payload as ValidatedSignup & {street:string;city:string;state:string;zip:string};
    // A member who already confirmed this email through the VIP link owns the membership, the
    // household slot and the welcome pie. Re-running completeSignup would only hit its
    // NOT EXISTS guard and report alreadyMember, so skip it: this account is here to ATTACH to
    // that member and set a password, not to enroll anyone a second time. (The guard remains the
    // authority — this read is the cheap, legible short-circuit in front of it.)
    const enrolled = await sql`SELECT 1 FROM vip_members WHERE business=${ACCOUNT_BUSINESS} AND LOWER(email)=LOWER(${String(row.email)}) LIMIT 1`;
    if (enrolled.rowCount === 0) await completeSignup(ACCOUNT_BUSINESS,p);
    await sql`INSERT INTO saved_addresses(account_id,street,apt,city,state,zip)
      VALUES(${accountId},${p.street},${p.apt},${p.city},${p.state},${p.zip}) ON CONFLICT DO NOTHING`;
  }
  await ensureMemberHasCode(ACCOUNT_BUSINESS,String(row.email));
  await sql`UPDATE accounts a SET member_id=m.id FROM vip_members m
    WHERE a.id=${accountId} AND a.deleted_at IS NULL AND a.business=${ACCOUNT_BUSINESS} AND m.business=a.business AND LOWER(m.email)=a.email`;
  await claimGuestOrders(accountId,String(row.email));
  await sql`UPDATE accounts SET enrollment_payload=NULL WHERE id=${accountId} AND business=${ACCOUNT_BUSINESS}`;
}
