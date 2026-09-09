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
       └─ Prepaid card / Apple Pay → clover.js tokenize (clv_…) ──┐
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
| `api/order/create.ts` | validates, creates one itemized Clover order, pays it, fires it, confirms printing |
| `api/lib/clover.ts` | Clover Ecommerce + REST helpers, server-side totals |

## Configuration (Vercel env)

| Var | Scope | Set? | Purpose |
|---|---|---|---|
| `CLOVER_API_TOKEN` | Production | ✅ | private token — charges + POS orders |
| `CLOVER_MERCHANT_ID` | Production | ✅ | `2J9HNTSEXBHG1` |
| `VITE_CLOVER_PAKMS_KEY` | Production | ✅ | Clover Ecommerce **public** apiAccessKey (browser tokenization) |

**With no `VITE_CLOVER_PAKMS_KEY`, website checkout stops and directs the customer
to call.** Website orders are prepaid; there is no pay-at-pickup fallback.

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
| `VITE_CLOVER_MERCHANT_ID` | Production | ✅ | `2J9HNTSEXBHG1` — passed as both the Clover `merchantId` and the Apple Pay `sessionIdentifier` |
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

### Turning the flag on also changes the typed-card path

Apple Pay needs the Clover instance built with `{ merchantId }`, and that makes Clover's
widget fetch the merchant's `ecomm_payment_configs` and inject **its own reCAPTCHA** into
card tokenization. Verified locally by A/B — same page, same cart, only the flag differs:

| `VITE_CLOVER_APPLE_PAY` | card field iframes | reCAPTCHA iframe |
|---|---|---|
| `0` | 4 | no |
| `1` | 4 | **yes** |

So `merchantId` is passed **only when Apple Pay is on** (`cloverPayment.ts` `getClover`),
which keeps today's proven card path byte-identical. When the flag flips, expect a reCAPTCHA
in the card flow on top of our Turnstile — check the Clover dashboard's Ecommerce reCAPTCHA
setting and re-test a typed-card order, not just Apple Pay.

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
- **Exactly one Clover order** — itemized draft → verify Clover amount → pay that draft → fire it. Any pre-charge setup failure stops without charging; there is no standalone-charge/two-order fallback.
- **Confirmed kitchen print** — a queued print event is polled until Clover discards it (Clover's documented successful-print signal). `CREATED`/`PRINTING` is not treated as success; failures become `paid_print_failed` and alert staff without submitting an ambiguous duplicate print job.
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

## Cash prices on the menu, 4% card pricing at checkout (2026-09-06)

The register runs a cash-discount program: every Clover item price carries 4% ($17.00 is stored
as $17.68) and cash customers get it back at the counter. Until 2026-09-06 the site mirrored the
register verbatim, so the menu read $17.68 — except toppings, which since 2026-08-19 showed $3.00
with a 12¢ "Card pricing (toppings)" line. Per Jorge, the whole menu now shows the clean cash
price and ONE "Card pricing (4%)" line is added at checkout on the food actually paid for. The
toppings-only split is gone; it is the same idea applied to everything.

- **Where the 4% lives:** `api/lib/cardPricing.mjs` (order API, browser) and its Python twin
  `scripts/card_pricing.py` (the generators). `tests/card-pricing.test.ts` runs both over the
  same inputs and fails if they disagree. Nothing else knows the number.
- **Where register prices become cash prices:** `scripts/build-menu.py` (`price_display` /
  `cents_display`), once, from `data/clover/classified/*.json` → `menuGenerated.ts`. Every
  other surface (landing pages, llms.txt, /menu/, breakfast.html, the React menu) reads that
  file, and `verify-prices.py` still fails the build if any of them disagree with it. The
  nightly cron strips the register's 4% the same way before it compares topping rates.
  `menuPriceCents()` is NOT idempotent — never apply it at read time.
- **Which prices were stripped:** the register was inflated item by item, so the rule decides
  from the number (header comment on `menuPriceCents`). Prices it kept flat — $1.00 side
  sauces, $22.00 pies, $13.99 — now cost 4% MORE online than they did; prices it stripped
  charge exactly what they did before, tax included. `TOPPING_CHARGE_CENTS` is 300 (was 312)
  and `HALF_TOPPING_CHARGE_CENTS` 200 (was 208) — cash rates.
- **Totals:** `computeTotals()` (server) and `CartContext` / `Checkout` (browser) agree:
  `cardPricing = round((subtotal − discount) × 4%)`, taxed with the food; not on the delivery
  fee, not on the tip. `expectedTotal` still matches to the cent.
- **Kitchen ticket:** `createDraftOrder` pushes "Card pricing (4%)" as a taxed line after the
  delivery fee, so Clover's order total equals the card charge. Receipt email, cart drawer and
  checkout summary each gain one row; `web_orders` gains a `card_pricing` column.
- **Disclosure:** NJ law requires a card-price adjustment to be disclosed before checkout. It is
  under the menu heading, in the item sheet, on the toppings selector, and itemized in the cart
  and at checkout. Note for Jorge: card-network rules (Visa in particular) cap a stated
  surcharge at 3%; the register's cash-discount framing sidestepped that, an itemized 4% line
  does not. Worth a word with the processor before this goes live.

## Extra toppings: $3 each, capped at $6 a pie (2026-09-08)

Per Jorge: one extra topping is $3, two are $6, and anything past two stays at $6 — the third,
fourth, seventh topping are free. The register does NOT do this; staff ringing a walk-in pie still
charge per topping, so a phoned-in "same as my online order" can come out higher at the counter.

- **One rule:** `TOPPING_CHARGE_CAP_CENTS` + `capToppingCharges()` in `src/data/menuToppings.ts`;
  `capLineOptions()` in `src/lib/menuPricing.ts` binds it to the catalog's own charge-priced test
  (`placementEligible`). Applied on every hop — the item sheet's button and `add()`
  (`ItemModal.tsx`), the cart's restore re-price (`CartContext.repriceStoredLine`) and the order
  API (`menuCatalog.priceLines`) — and idempotent, so the same line re-caps to itself.
- **What counts:** the folded charge rate only — $3 whole / $2 half. Half toppings share the same
  $6 (three halves = $6, a fourth is free; $3 + $2 + $2 bills $3 + $2 + $1). A topping with its
  own Clover price (Penne Pasta $1) is a modifier, not an extra-topping charge, and is outside the
  cap; so is everything that isn't in a Toppings group.
- **How it shows:** the cap comes off the LATER toppings' deltas (first two full price, then
  whatever room is left, then $0), never as a separate discount line — so the itemized cart,
  receipt, kitchen ticket and refire all still sum to the unit price charged, and `expectedTotal`
  matches to the cent. The item sheet says so next to the toppings ("cap at $6.00 — after two,
  the rest are free") and the pizza blurb carries it too.
- **Removed toppings (same day):** Brazil Ricotta, Corn and Hard Egg are off the online menu —
  `EXCLUDED_TOPPINGS` in `scripts/build-menu.py` drops them at generation so a Clover re-pull can't
  put them back. They are still in Clover; only the website stops offering them. The nightly
  snapshot copies the menu as of its last write, so `Menu.tsx` now takes each item's options from
  the build rather than the snapshot — otherwise a pulled topping would stay tickable until the
  next 4 AM refresh and then be refused at checkout as unknown.
- **Tests:** `tests/topping-cap.test.ts`.
