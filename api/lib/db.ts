import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Uses Neon's native Vercel integration (the current recommended path —
 * @vercel/postgres is deprecated as of 2026). Lazily initialized so a missing
 * DATABASE_URL fails the individual request with a loggable error instead of
 * crashing the function on cold start.
 */
let _sql: NeonQueryFunction<false, true> | null = null;

export const sql: NeonQueryFunction<false, true> = ((
  strings: TemplateStringsArray,
  ...values: unknown[]
) => {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set — database not provisioned yet");
    _sql = neon(process.env.DATABASE_URL, { fullResults: true });
  }
  return _sql(strings, ...values);
}) as NeonQueryFunction<false, true>;

/** Business slugs used across vip_members / vip_promo_codes / vip_sends. */
export type VipBusiness = "gigis_long_branch";

export function isVipBusiness(value: unknown): value is VipBusiness {
  return value === "gigis_long_branch";
}
