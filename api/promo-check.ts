import { clientIp } from "./lib/requestIp.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FREE_PIE_ITEM } from "./lib/promo.js";
import { resolvePromo } from "./lib/campaignPromo.js";
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
  // The per-IP bucket is the real brute-force guard; the global one is only a backstop
  // against distributed probing. At 300/h one hostile IP-rotator could exhaust it and
  // block every legitimate customer's code at checkout for the rest of the hour — a
  // cheap denial of the free-pie promo — so it is sized well above organic traffic.
  const allowed = await rateLimitAll([
    ...(ip ? [{ bucket: `promo:ip:${ip}`, max: 10, windowSec: 300 }] : []),
    { bucket: "promo:global", max: 2000, windowSec: 3600 },
  ]);
  if (!allowed) {
    res.status(429).json({ valid: false, message: "Too many tries — please wait a moment." });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  try {
    const check = await resolvePromo("gigis_long_branch", body.code);
    if (!check.ok) {
      res.status(200).json({ valid: false, message: check.message });
      return;
    }
    if (check.kind === "bogo_pizza") {
      // No discountCents here: a buy-one-get-one is worth whatever the cheaper pizza in the
      // cart costs, so the amount is computed from the cart on both sides (src/lib/bogoPromo.ts)
      // rather than pinned to a catalog item the way the welcome pie is.
      res.status(200).json({
        valid: true,
        code: check.code,
        kind: check.kind,
        description: check.description,
        pickupOnly: check.pickupOnly,
        message: "Code applied — buy one pizza, get one free on this pickup order.",
      });
      return;
    }
    res.status(200).json({
      valid: true,
      code: check.code,
      kind: "welcome",
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
