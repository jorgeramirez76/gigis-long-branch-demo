import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  buildOrderNote,
  cloverConfigured,
  computeTotals,
  createCharge,
  createPosOrder,
  CloverError,
  type CartLineInput,
  type Fulfillment,
} from "../lib/clover.js";

const US_PHONE_RE = /^\+?1?[\s.-]?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})$/;

function validLines(input: unknown): input is CartLineInput[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 60) return false;
  return input.every(
    (l) =>
      l &&
      typeof l.itemName === "string" &&
      l.itemName.trim().length > 0 &&
      Number.isFinite(l.basePrice) &&
      l.basePrice >= 0 &&
      Number.isInteger(l.quantity) &&
      l.quantity >= 1 &&
      l.quantity <= 50 &&
      Array.isArray(l.options) &&
      l.options.every((o: unknown) => {
        const opt = o as { name?: unknown; delta?: unknown };
        return opt && typeof opt.name === "string" && Number.isFinite(opt.delta);
      }),
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const fulfillment = body.fulfillment as Fulfillment;
  const customer = (body.customer ?? {}) as {
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
  };
  const paymentMethod = body.paymentMethod === "card" ? "card" : "pickup";
  const cardToken = typeof body.cardToken === "string" ? body.cardToken : undefined;
  const tipCents = Number.isFinite(body.tipCents) ? Number(body.tipCents) : 0;
  const orderNote = typeof body.orderNote === "string" ? body.orderNote.slice(0, 280) : undefined;

  // ---- validate ----
  if (fulfillment !== "pickup" && fulfillment !== "delivery") {
    res.status(400).json({ error: "invalid_fulfillment" });
    return;
  }
  if (typeof customer.name !== "string" || customer.name.trim().length < 1) {
    res.status(400).json({ error: "name_required" });
    return;
  }
  if (typeof customer.phone !== "string" || !US_PHONE_RE.test(customer.phone)) {
    res.status(400).json({ error: "valid_phone_required" });
    return;
  }
  if (fulfillment === "delivery" && (typeof customer.address !== "string" || customer.address.trim().length < 5)) {
    res.status(400).json({ error: "delivery_address_required" });
    return;
  }
  if (!validLines(body.lines)) {
    res.status(400).json({ error: "invalid_lines" });
    return;
  }
  const lines = body.lines as CartLineInput[];

  if (!cloverConfigured()) {
    res.status(503).json({
      error: "ordering_not_configured",
      message: "Online ordering isn't switched on yet. Please call the store to order.",
    });
    return;
  }

  // ---- authoritative totals (never trust client) ----
  const totals = computeTotals(lines, tipCents);
  if (totals.total <= 0) {
    res.status(400).json({ error: "empty_order" });
    return;
  }

  // ---- charge card first (if paying online) ----
  let chargeId: string | undefined;
  if (paymentMethod === "card") {
    if (!cardToken || !cardToken.startsWith("clv_")) {
      res.status(400).json({ error: "card_token_required" });
      return;
    }
    try {
      const clientIp = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || undefined;
      const charge = await createCharge({
        amount: totals.total,
        source: cardToken,
        taxAmount: totals.tax,
        clientIp,
        email: customer.email,
        description: `Gigi's Long Branch web order — ${customer.name.trim()}`,
      });
      chargeId = charge.id;
    } catch (err) {
      const status = err instanceof CloverError ? err.status : 500;
      const message =
        err instanceof CloverError ? err.message : "We couldn't process that card. Please try again.";
      console.error("[order/create] charge failed", status, message);
      // 402-style: payment problem, surface the decline reason to the customer.
      res.status(status === 503 ? 503 : 402).json({ error: "payment_failed", message });
      return;
    }
  }

  // ---- drop the order into the POS / kitchen ----
  const note = buildOrderNote({
    fulfillment,
    customer: {
      name: customer.name.trim(),
      phone: customer.phone.trim(),
      email: customer.email?.trim(),
      address: customer.address?.trim(),
    },
    lines,
    totals,
    payment: paymentMethod,
    chargeId,
    orderNote,
  });

  try {
    const order = await createPosOrder({
      lines,
      fulfillment,
      note,
      paid: paymentMethod === "card",
    });
    res.status(200).json({
      ok: true,
      orderId: order.id,
      paid: paymentMethod === "card",
      chargeId,
      totals,
    });
  } catch (err) {
    console.error("[order/create] POS order failed", err);
    if (chargeId) {
      // Card was charged but the kitchen ticket didn't post. Don't tell the
      // customer it failed — their money moved. Flag for staff follow-up.
      res.status(200).json({
        ok: true,
        paid: true,
        chargeId,
        routingIssue: true,
        message:
          "Your payment went through, but please call the store to confirm your order was received.",
      });
      return;
    }
    res.status(502).json({
      error: "order_routing_failed",
      message: "We couldn't send your order to the kitchen. Please call the store to order.",
    });
  }
}
