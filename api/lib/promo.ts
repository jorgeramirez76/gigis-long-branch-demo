import { randomInt } from "node:crypto";
import { sql, type VipBusiness } from "./db.js";

const PIE_DESCRIPTION: Record<VipBusiness, string> = {
  gigis_long_branch: "a FREE plain cheese pie (new members only)",
};

// No ambiguous 0/O/1/I so the code is easy to read off a phone at the counter.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/**
 * Issue the welcome free-pie promo to a brand-new member. A UNIQUE per-member
 * code (not one shared code) so it can't be screenshot-shared for unlimited
 * free pies, and so redemption can be tracked per member later. Called ONLY
 * after a successful insert, so it can never be handed to an existing member.
 */
export async function issueWelcomePie(business: VipBusiness, memberId: number) {
  const description = PIE_DESCRIPTION[business];
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = `PIE-${randomCode(6)}`;
    try {
      const r = await sql`
        INSERT INTO vip_promo_codes (business, code, description, member_id, expires_at)
        VALUES (${business}, ${code}, ${description}, ${memberId}, now() + interval '90 days')
        RETURNING id
      `;
      return { id: r.rows[0].id as number, code, description };
    } catch (err) {
      // Astronomically rare code collision (UNIQUE(code)) — retry with a new one.
      if (attempt === 5) throw err;
    }
  }
  throw new Error("could not generate a unique promo code");
}
