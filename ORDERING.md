# In-house online ordering — Gigi's Long Branch

Fully custom ordering built into the site (no Slice, no Clover hosted page). The
customer browses the menu, builds an order with options + a 3-item upsell, and
checks out on our own UI. Orders drop straight into Gigi's Clover POS / kitchen.

## Architecture

```
Menu (menuGenerated.ts, 582 items from Clover)
  → ItemModal (options, live price)
  → CartDrawer (+ 3-item Upsell)
  → Checkout
       ├─ Pay at pickup/delivery  →  POST /api/order/create           → Clover v3 order (kitchen ticket)
       └─ Pay online (card)       →  clover.js tokenize (clv_…) ──┐
                                                                   ↓
                                       POST /api/order/create → Clover charge (/v1/charges) → then v3 order (PAID)
```

- **Card data never touches our servers.** The card number/expiry/CVV live in
  Clover-served iframes (clover.js, PCI SAQ-A). We only ever get a `clv_…` token.
- **Totals are recomputed server-side** in `api/lib/clover.ts` — the client-sent
  total is never trusted. NJ tax 6.625% (matches the merchant's Clover tax config).
- **Order types** (verified on merchant `2J9HNTSEXBHG1`): pickup `R8FK9C8AD11P4`,
  delivery `H3TYJ5NC01662`.

## Files

| File | Role |
|---|---|
| `src/ordering/CartContext.tsx` | cart state, price math, localStorage |
| `src/ordering/ItemModal.tsx` | item options + live unit price |
| `src/ordering/CartDrawer.tsx` + `Upsell.tsx` | cart + 3-item add-on nudge |
| `src/ordering/Checkout.tsx` | fulfillment, tip, payment, confirmation |
| `src/ordering/cloverPayment.ts` | clover.js loader + card tokenization |
| `api/order/create.ts` | validates, charges card (if online), creates POS order |
| `api/lib/clover.ts` | Clover Ecommerce + REST helpers, server-side totals |

## Configuration (Vercel env)

| Var | Scope | Set? | Purpose |
|---|---|---|---|
| `CLOVER_API_TOKEN` | Production | ✅ | private token — charges + POS orders |
| `CLOVER_MERCHANT_ID` | Production | ✅ | `2J9HNTSEXBHG1` |
| `VITE_CLOVER_PAKMS_KEY` | Production | ❌ **needed for card** | Clover Ecommerce **public** apiAccessKey (browser tokenization) |

**With no `VITE_CLOVER_PAKMS_KEY`, checkout runs as pay-at-pickup** (order goes to
the kitchen; customer pays at the counter/door). This is the safe default and is
live-ready today.

### To enable online card payment

1. Clover Merchant Dashboard → **Settings → View all settings → Ecommerce →
   Ecommerce API Tokens** → open the token of type **"Hosted iFrame + API/SDK"**
   → copy the **PUBLIC** key (the private key is the one already in use).
2. `vercel env add VITE_CLOVER_PAKMS_KEY production` (paste the public key), redeploy.
3. The "Pay online" option appears automatically with secure card fields.

## Go-live checklist (before pushing to the live domain)

1. ✅ Build passes (`npm run build`), checkout UI verified in preview.
2. ⏳ **One coordinated test order** — with someone watching Gigi's POS/kitchen,
   place a real pickup order and confirm it appears correctly (name, items,
   options, note). Void it after. Do this **off-peak**, not mid-service.
3. ⏳ (Card only) supervised **real-card test** on production — small order, then
   refund in the Clover dashboard. Confirm the charge + the PAID POS order and
   how paid online orders show in the owner's reports (ecommerce charges settle
   separately from register sales — confirm reconciliation with the owner).
4. Push → Vercel auto-deploys → the live site switches order buttons to the
   in-house flow. Until then the current Clover hosted page stays live.

## Known follow-ups

- Optional hardening: re-price each line against `menuGenerated.ts` server-side
  (today the server recomputes the arithmetic from posted base prices/deltas).
- Charge↔order reconciliation: online-paid orders are marked PAID on the v3 order
  with the charge id in the note; verify the owner's preferred reporting view.
