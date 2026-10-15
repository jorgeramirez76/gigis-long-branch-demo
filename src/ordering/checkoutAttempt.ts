/**
 * The checkout's persisted form and its "this payment attempt may have gone through" flag.
 *
 * Kept apart from Checkout.tsx on purpose: the cart, the cart drawer and the item modal all ask
 * savedAttemptUncertain() on every page, and importing it from Checkout.tsx pinned the whole
 * checkout (Clover, Turnstile, the VIP join) into the homepage's main bundle. Checkout.tsx now
 * loads only when the cart opens (OrderingProvider.tsx); this small module stays in main.
 */

export type Fulfillment = "pickup" | "delivery";
/** "welcome" is the per-member free Plain Pie; "bogo_pizza" is a campaign word like GAMEDAY
 *  whose value is the cheaper pizza in the cart (src/lib/bogoPromo.ts, shared with the server). */
export type PromoKind = "welcome" | "bogo_pizza" | "pct_pizza";

/** The checkout form itself, persisted alongside the key. The key's signature includes
 *  the typed contact fields, so the key can only survive a reload if the fields do too —
 *  otherwise the first render after a reload sees empty fields, mints a fresh key and
 *  overwrites the parked one, and the retry double-charges. Cleared with the key. */
export const FORM_STORE_KEY = "gigis:checkout-form";

export function storageArea(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // blocked (private mode / embedded webview policy)
  }
}

export type SavedForm = {
  fulfillment?: Fulfillment;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  town?: string;
  tipPct?: number;
  tipTouched?: boolean;
  orderNote?: string;
  promo?: { code: string; discountCents: number; kind?: PromoKind; percentOff?: number; pickupOnly?: boolean } | null;
  /** The uncertainty freeze must survive the reload it exists for: an aborted attempt whose
   *  capture may have landed freezes the priced inputs, and reload is exactly how people
   *  retry — an unfrozen post-reload form lets them nudge the tip, mint a fresh key, and
   *  genuinely pay twice for the same food. Cleared with the rest when the order settles. */
  attemptUncertain?: boolean;
};

export function readSavedForm(): SavedForm {
  try {
    const raw = storageArea()?.getItem(FORM_STORE_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as SavedForm;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

/** Whether a persisted uncertain payment attempt is on file. The CartDrawer checks this so a
 *  post-reload cart edit can't change the idempotency signature — minting a fresh key over a
 *  capture that may have landed — while the checkout freeze locks only its own form inputs. */
export function savedAttemptUncertain(): boolean {
  return readSavedForm().attemptUncertain === true;
}
