import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../lib/adminAuth.js";
import { cloverConfigured, fulfillmentConfigured } from "../lib/clover.js";

/**
 * GET /api/admin/clover-status — is the site actually wired to the Clover merchant?
 *
 * Exists because the credentials live only in the Vercel environment (`vercel env pull`
 * masks every value as empty for this project), so the order-type IDs needed to switch
 * ordering on cannot be looked up from a laptop. This runs where the token already is.
 *
 * Read-only and admin-guarded. Reports which settings are present as booleans and never
 * echoes a secret. The order types it returns are what `CLOVER_ORDER_TYPE_PICKUP` and
 * `CLOVER_ORDER_TYPE_DELIVERY` expect.
 */
const REST_BASE = "https://api.clover.com";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireAdmin(req, res))) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const token = process.env.CLOVER_API_TOKEN;
  // The menu sync resolves the merchant from sync-config.json while the order path reads
  // an env var; fall back to the same source so this reports on the merchant either uses.
  const merchantId = process.env.CLOVER_MERCHANT_ID || null;

  const config = {
    apiToken: !!token,
    merchantIdEnv: !!process.env.CLOVER_MERCHANT_ID,
    merchantIdResolved: merchantId,
    orderTypePickup: !!process.env.CLOVER_ORDER_TYPE_PICKUP,
    orderTypeDelivery: !!process.env.CLOVER_ORDER_TYPE_DELIVERY,
    cardPaymentKey: !!process.env.VITE_CLOVER_PAKMS_KEY,
    ecommPrivateToken: !!process.env.CLOVER_ECOMM_PRIVATE_TOKEN,
    // Turnstile fails OPEN by design when its secret is absent — every abuse control on
    // ordering then rests on Clover's own velocity checks. Make that state observable.
    turnstileSecret: !!process.env.TURNSTILE_SECRET_KEY,
    orderingLive: cloverConfigured(),
    pickupRoutable: fulfillmentConfigured("pickup"),
    deliveryRoutable: fulfillmentConfigured("delivery"),
  };

  if (!token || !merchantId) {
    res.status(200).json({ config, merchant: null, orderTypes: [], note: "No token or merchant id — cannot query Clover." });
    return;
  }

  try {
    const auth = { Authorization: `Bearer ${token}` };
    const [mRes, oRes, hRes, pRes, dRes, tRes, kRes] = await Promise.all([
      fetch(`${REST_BASE}/v3/merchants/${merchantId}`, { headers: auth }),
      fetch(`${REST_BASE}/v3/merchants/${merchantId}/order_types`, { headers: auth }),
      // The merchant's own opening hours — the authoritative answer to "when is the store
      // open", which the site's ordering gate has to match.
      fetch(`${REST_BASE}/v3/merchants/${merchantId}/opening_hours?expand=elements`, { headers: auth }),
      // Whether a fired web order actually produces a paper ticket depends on the
      // merchant's own print setup, not on our code — so surface it here.
      fetch(`${REST_BASE}/v3/merchants/${merchantId}/printers`, { headers: auth }),
      fetch(`${REST_BASE}/v3/merchants/${merchantId}/devices`, { headers: auth }),
      // The merchant's own tax rates. Website line items must carry THIS merchant's
      // rate id, or Clover values the order pre-tax ("Taxes (included)") and the
      // shop under-reports sales tax on web orders.
      fetch(`${REST_BASE}/v3/merchants/${merchantId}/tax_rates`, { headers: auth }),
      // The PAKMS key is the PUBLISHABLE card-tokenization key the checkout iframe
      // needs (it ships in the client bundle by design — not a secret). Clover only
      // shows it in the dashboard, but this endpoint returns it for the token's own
      // merchant, which saves a trip to the owner's login to copy it out.
      fetch(`https://scl.clover.com/pakms/apikey`, { headers: auth }),
    ]);
    if (!mRes.ok || !oRes.ok) {
      res.status(502).json({ config, error: "clover_request_failed", merchantStatus: mRes.status, orderTypesStatus: oRes.status });
      return;
    }
    const merchant = (await mRes.json()) as { id?: string; name?: string };
    const orderTypes = (await oRes.json()) as { elements?: Array<{ id: string; label?: string; labelKey?: string; taxable?: boolean; isHidden?: boolean }> };
    // Hours fetch is best-effort: some merchants have none configured.
    const openingHours = hRes.ok ? await hRes.json() : { error: `opening_hours HTTP ${hRes.status}` };
    const printersRaw = pRes.ok ? ((await pRes.json()) as { elements?: Array<Record<string, unknown>> }) : null;
    const devicesRaw = dRes.ok ? ((await dRes.json()) as { elements?: Array<Record<string, unknown>> }) : null;
    const taxRatesRaw = tRes.ok ? ((await tRes.json()) as { elements?: Array<Record<string, unknown>> }) : null;
    const pakms = kRes.ok ? ((await kRes.json()) as { active?: boolean; apiAccessKey?: string }) : null;

    res.status(200).json({
      config,
      merchant: { id: merchant.id, name: merchant.name },
      orderTypes: (orderTypes.elements || []).map((o) => ({
        id: o.id,
        label: o.label,
        labelKey: o.labelKey,
        taxable: o.taxable,
        hidden: o.isHidden,
      })),
      openingHours,
      pakms: pakms ? { active: pakms.active, apiAccessKey: pakms.apiAccessKey } : { error: `pakms HTTP ${kRes.status}` },
      // "type" distinguishes a receipt printer from an order/kitchen printer; a fired web
      // order only produces a paper chit if an ORDER printer exists and is reachable.
      printers: printersRaw
        ? (printersRaw.elements || []).map((p) => ({
            id: p.id, name: p.name, type: p.type, ip: p.ip ? "set" : null, model: p.model,
          }))
        : { error: `printers HTTP ${pRes.status}` },
      devices: devicesRaw
        ? (devicesRaw.elements || []).map((d) => ({
            id: d.id, serial: d.serial, model: d.model, name: d.name,
          }))
        : { error: `devices HTTP ${dRes.status}` },
      taxRates: taxRatesRaw
        ? (taxRatesRaw.elements || []).map((t) => ({
            id: t.id, name: t.name, rate: t.rate, isDefault: t.isDefault,
          }))
        : { error: `tax_rates HTTP ${tRes.status}` },
    });
  } catch (err) {
    console.error("[admin/clover-status] error", err);
    res.status(502).json({ config, error: err instanceof Error ? err.message : "clover_query_failed" });
  }
}
