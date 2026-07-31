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

## Apple Pay

Built and shipped **off**. Set `VITE_CLOVER_APPLE_PAY=1` only after steps 1–3 below
report **Verified** in Clover. The button renders inside the "Pay online" panel,
above the card fields, and is only reachable on Safari 17.5+ on an Apple-Pay-capable
device — every other browser sees the checkout exactly as it is today.

The Apple Pay sheet returns the same single-use Clover source token as a typed card,
so **the server path is completely unchanged** (`api/order/create.ts` was not touched).

| Var | Scope | Set? | Purpose |
|---|---|---|---|
| `VITE_CLOVER_MERCHANT_ID` | Production | ❌ **needed** | `2J9HNTSEXBHG1` — passed as both the Clover `merchantId` and the Apple Pay `sessionIdentifier` |
| `VITE_CLOVER_APPLE_PAY` | Production | ❌ off | `"1"` enables the button; anything else keeps it hidden |

### Owner-side steps (nobody can do these from code)

1. Clover Merchant Dashboard → **Settings → View all settings → Ecommerce →
   Ecommerce Payments → Apple Pay → iFrame integration** → *Enable Apple Pay* →
   enter `gigislongbranch.com` → **Download verification file**.
2. Commit that file to `public/.well-known/apple-developer-merchantid-domain-association`
   — **no file extension** — and deploy. It must return HTTP 200 with no redirect.
3. Back in the dashboard, click **Verify**. Clover says the process can take a few days.
4. Register the **apex domain only**. `www.gigislongbranch.com` 308-redirects to the apex
   (`vercel.json`), and Apple rejects domains behind a redirect. The button never renders
   on `www` because the redirect happens before the page loads.

### Two traps

- **Never add `payment=(self)` to the `Permissions-Policy` header.** The header currently
  omits `payment`, which lets Clover's own `allow="payment"` iframe attribute delegate
  normally. Narrowing it to `self` silently kills Apple Pay inside the Clover frame while
  the page still looks healthy — a nasty thing to debug. Leaving `payment` unnamed is
  deliberate, not an oversight.
- **Clover allows ~30 seconds** between the shopper authorizing the sheet and
  `updateApplePaymentStatus`. Our server call (draft → verify → pay → fire → print →
  receipt) normally runs in single-digit seconds, but don't add slow work to that path.

### First live test

Apple Pay can't be rehearsed in sandbox or headlessly — it needs a real device, a real
card, and a real charge. Do it off-peak, warn the kitchen, then refund. The one thing to
watch: Clover documents the `clv_` token prefix for the token its *API* mints but never
for the one this *iframe* emits, and the server rejects anything else. If the order fails,
check the browser console for `[apple-pay] unexpected token prefix`.

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

## Security hardening (done)

Audited adversarially (correctness + security) before launch and hardened:

- **Prices are server-authoritative** — the browser sends item/option IDs only;
  the server prices from the catalog (`api/lib/menuCatalog.ts`) and rejects
  unknown items/options. Client prices are never trusted. (Runtime-tested.)
- **Rate limiting** (`api/lib/rateLimit.ts`, atomic Neon counter) on
  `/api/order/create` and `/api/vip-signup`, per normalized IP + phone.
- **Charge idempotency** — `idempotency-key` on every Clover charge + atomic
  order-key reservation (`web_orders.idempotency_key`) so retries/concurrency
  can't double-charge or double-fire. Stale/uncertain attempts are flagged to
  staff, never silently re-fired.
- **Atomic orders** — draft → bulk line items → fire, with rollback.
- **Never lose a paid order** — chargeId persisted before the POS step; a
  post-charge POS failure → `paid_unrouted` + `alertStaff`.
- **Generic card errors** (no decline oracle), **CSV-injection** fix on admin
  export, **localStorage** hardening, **security headers** + CSP (`vercel.json`).

## Known follow-ups

- **Rotate secrets** that have touched plaintext `.env` on disk (Clover token,
  Neon password, ADMIN_TOKEN) — best practice, owner's call.
- **Cloudflare Turnstile** (CAPTCHA) is built into checkout + VIP signup, env-gated
  and OFF until keys are set. To turn on: create a Turnstile widget at
  dash.cloudflare.com, then set `VITE_TURNSTILE_SITE_KEY` (client) +
  `TURNSTILE_SECRET_KEY` (server) in Vercel. Defeats IP/phone rotation on top of
  the rate limiter. Until keys are set, rate limiting is the abuse control.
- **Set `STAFF_ALERT_PHONE`** (Vercel env) so paid-but-unrouted / uncertain
  orders SMS a human. Until then they're logged + saved to `web_orders`.
- **Card reconciliation** (card mode only): the PAID POS order's line items sum
  to subtotal; tax/tip live in the ecommerce charge + the order note. Confirm the
  owner's preferred reporting view before enabling online card payment.
- **Promote CSP** from the current allowlist to stricter once verified in prod.
