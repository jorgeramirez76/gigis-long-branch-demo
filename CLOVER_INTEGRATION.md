# Clover ordering integration — execution playbook

Internal notes for wiring Gigi's Long Branch site to Clover so orders bypass Slice.
Reusable for the partner's location too.

## The one-line switch (Tier 1 — link-out, ship first)

Every "Order Online" button on the site reads from a single constant:

- File: `src/data/location.ts`
- Constant: `ORDER_ONLINE_URL`
- Currently: `https://slicelife.com/restaurants/nj/long-branch/07740/gigi-s-ny-style-pizza-restaurant/menu`

**To go live on Clover:** replace that value with the owner's Clover Online Ordering
URL, then `npm run build` and redeploy. That's it — Nav, Hero, Location, Footer, and
ServiceArea all update automatically.

### How the owner gets the Clover URL
1. Clover Dashboard → **Online Ordering** app (free; no setup fee, no monthly fee,
   no per-order commission per Clover's published terms).
2. Enable it, confirm the menu/hours synced from the POS.
3. Copy the public ordering link (looks like `https://order.clover.com/...` or a
   custom Clover ordering subdomain).
4. Paste into `ORDER_ONLINE_URL`. Done — orders now print straight to his kitchen/KDS.

> Honest framing for the client: Clover converts traffic he *already owns* (site,
> Google, repeat customers). It does NOT replace Slice's *marketplace discovery*.
> Keep Slice for new-customer discovery if desired; route owned traffic to Clover to
> stop paying $3/order on customers he didn't need Slice to find.

## Tier 2 — embedded checkout (premium upsell, +$1,500–2,500)

Fully branded ordering ON the site, no redirect. Requires a Clover developer account
+ the owner authorizing an app (OAuth). Building blocks (per Clover dev docs):

- **Menu:** `GET /v3/merchants/{mId}/items` (Inventory API) → render menu from POS data.
- **Payment:** Clover **Hosted Checkout** or **iFrame** payment form (PCI-safe, brandable).
- **Order to POS:** Orders API "create custom orders" so tickets hit the KDS/printer.

Docs: https://docs.clover.com/dev/docs/ecommerce-integration-types

## What's needed from the owner to execute
- [ ] Confirms go + plan tier
- [ ] Clover Online Ordering enabled → ordering URL (Tier 1) OR dev/API access (Tier 2)
- [ ] Register/connect domain `gigisnystylepizza-longbranch.com` (already the canonical)
- [ ] Verify hours, menu, prices; supply real food photos (replace Unsplash placeholders)
- [ ] Add Jorge as manager on the Google Business Profile

## Cost comparison (for the pitch)
- Slice: $39/mo + $3.00 per credit-card order.
- Clover Online Ordering: $0 setup / $0 monthly / $0 commission — only normal card processing.
