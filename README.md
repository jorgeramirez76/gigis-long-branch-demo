# Gigi's Long Branch

Restaurant website, prepaid online ordering, and customer rewards for Long Branch.
Production: https://gigislongbranch.com · Shop: 732-377-2468
Local repository: `~/Projects/gigis-long-branch-demo`.

## Development and release

React, TypeScript, Vite/SSG and Tailwind power the storefront. Vercel hosts the built
pages and the Node API routes. Clover supplies the menu and handles payment and kitchen
orders; Neon stores memberships, consent records and the order ledger. Resend handles
email and Twilio handles SMS. A static-only host cannot run checkout or rewards.

Use `npm ci`, then `vercel dev` to exercise both the storefront and `/api/*`.
`npm run dev` is a storefront-only Vite preview. Local configuration belongs in
`.env.local`; credentials must remain untracked. Build-time `VITE_*` values are public.
Production ordering uses `ORDER_PROVIDER=inhouse`, `VITE_ORDER_PROVIDER=inhouse`,
`VITE_DELIVERY_ENABLED=true` and `VITE_CLOVER_APPLE_PAY=1`. A local environment without
real provider keys cannot complete payments or send account verification links.

Before release run `npm test`, `npm run lint`, `npx tsc -p tsconfig.json --noEmit`,
`npx tsc -p tsconfig.api.json --noEmit`, and `npm run build`.
Also run `python3 scripts/verify-prices.py` for the Long Branch catalog. Pushing `main` deploys production through the existing Vercel integration.
Never place a real charge or send customer/staff messages merely to test a release.

## Source map

- `src/components/`: storefront, menu, About Us, rewards entry point and location details.
- `src/ordering/`: item options, cart, checkout, confirmation and personalized suggestions.
- `src/data/`: location, hours, SEO copy, real food photos and generated Clover menu.
- `api/order/create.ts`: server pricing, payment idempotency, routing and print verification.
- `api/account/` and `public/account/`: account API and browser UI.
- `api/admin/` and `src/admin/`: protected staff tools.
- `api/cron/`: scheduled menu refresh, digest and print checks.
- `db/schema.sql` and `db/migrations/`: database schema and additive migrations.
- `scripts/`: generated landing/menu pages, sitemaps and build checks.

Keep API relative imports suffixed `.js`. The CSP disallows executable inline scripts.
Never trust browser prices or card status; consent disclosures must retain the exact
approved wording. Keep each location's database, merchant, keys and images separate.

## September 12 implementation status

The worklist changes are being prepared locally; this document does not assert they
have been deployed. Rewards use verified email as the username, a password, and separate
accounts per location. Existing VIP codes remain attached to the member; redemption is
single-use and their 90-day expiry remains. Accounts show code status and order history,
with available usual items suggested at checkout. Activate only after migrations and
release checks, using `ACCOUNTS_ENABLED=true`.

NJ.com and The Jersey Shore Girl recognition belongs in About Us. The menu is for ordering.
Photo provenance is recorded in `research/image-sources.md`; use actual location images.

Confirmed digest recipient: `gigispizzalb@gmail.com`. Lost-order SMS contact: Tommy (configured in Vercel).
These are private operations contacts, not public shop contact information.
See `ORDERING.md`, `VIP_CLUB.md`, and `OPERATIONS-2026-09-12.md` for current guidance;
older dated incident/audit notes are historical evidence rather than deployment instructions.
