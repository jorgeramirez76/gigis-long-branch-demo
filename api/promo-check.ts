import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkPromoCode, normalizePromoCode, FREE_PIE_ITEM } from "./lib/promo.js";
import { priceLines } from "./lib/menuCatalog.js";
import { rateLimitAll } from "./lib/rateLimit.js";

/**
 * Read-only promo-code validity check, so the checkout can confirm a code (and show the
 * discount) BEFORE the customer submits the order. Never mutates anything — redemption
 * is reserved atomically inside order/create before payment and finalized after success.
 *
 * Response is deliberately sparse: valid/invalid + a human message. It never returns the
 * member the code belongs to, and invalid lookups are rate-limited so the 6-char code
 * space can't be enumerated ({32^6 codes, ~10 live} makes guessing pointless anyway).
 */

/** Same trusted-IP rule as order/create: x-real-ip only, never x-forwarded-for. */
function clientIp(req: VercelRequest): string | undefined {
  const real = req.headers["x-real-ip"];
  return typeof real === "string" && real ? real : undefined;
}

/** Today's catalog price of the free item — what the checkout previews as the discount. */
function freeItemPriceCents(): number | null {
  const r = priceLines([{ itemName: FREE_PIE_ITEM, quantity: 1 }]);
  return r.ok ? r.lines[0].basePrice : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const ip = clientIp(req);
  const allowed = await rateLimitAll([
    ...(ip ? [{ bucket: `promo:ip:${ip}`, max: 10, windowSec: 300 }] : []),
    { bucket: "promo:global", max: 300, windowSec: 3600 },
  ]);
  if (!allowed) {
    res.status(429).json({ valid: false, message: "Too many tries — please wait a moment." });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const code = normalizePromoCode(body.code);
  if (!code) {
    res.status(200).json({ valid: false, message: "That code doesn't look right — check it and try again." });
    return;
  }

  try {
    const check = await checkPromoCode("gigis_long_branch", code);
    if (!check.ok) {
      res.status(200).json({ valid: false, message: check.message });
      return;
    }
    res.status(200).json({
      valid: true,
      code: check.code,
      description: check.description,
      freeItem: FREE_PIE_ITEM,
      discountCents: freeItemPriceCents(),
      pickupOnly: true,
      message: `Code applied — one free ${FREE_PIE_ITEM} on this pickup order.`,
    });
  } catch (err) {
    console.error("[promo-check] error", err);
    res.status(503).json({ valid: false, message: "We couldn't check that code right now — you can still show it at the counter." });
  }
}
