/** Accepts loose US 10-digit input; normalizes to E.164 (+1XXXXXXXXXX).
 *  Lifted out of api/vip-signup.ts so the checkout opt-in (api/order/create.ts)
 *  can share it without importing one endpoint module into another. */
const US_PHONE_RE = /^\+?1?[\s.-]?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})$/;

export function normalizePhone(input: string): string | null {
  const match = input.trim().match(US_PHONE_RE);
  if (!match) return null;
  return `+1${match[1]}${match[2]}${match[3]}`;
}
