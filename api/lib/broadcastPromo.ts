/**
 * Broadcast offers are staff-defined campaign codes, not the one-time
 * PIE-XXXXXX welcome benefit. Keeping their namespaces separate prevents a
 * blast from overwriting or being redeemed as somebody's free-pie code.
 */
export function normalizeBroadcastPromoCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{3,19}$/.test(code)) return null;
  if (code.startsWith("PIE")) return null;
  return code;
}
