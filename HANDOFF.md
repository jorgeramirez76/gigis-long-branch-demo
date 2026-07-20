# Gigi's Long Branch — Handoff (updated 2026-07-20; supersedes 2026-07-12)

Full-stack site for Gigi's NY Style Pizza, 140 Brighton Ave, Long Branch NJ.
**Live at https://gigislongbranch.com** (Vercel, git-integrated) and **taking
real customer orders** — 3 genuine orders 7/17–7/18 ($21.50, $48.52, $40.81
delivery), all routed to the Clover POS automatically.

- **Local:** `~/Desktop/gigis-long-branch-site/` · **Repo:** `jorgeramirez76/gigis-long-branch-demo`
- **Stack:** React 18 + Vite 6 + TS + Tailwind v4, vite-react-ssg prerender, Vercel serverless `/api`
- **DB:** isolated Neon `neon-crimson-queen` (7 tables — never shared with Sea Bright)
- **Secrets:** `.env` (Clover), `.env.crm.local` (admin/webhook/unsub), Vercel prod env
- **⚠ Never delete** `public/googlececb096098599354.html` — Google Search Console verification.

## What's DONE and verified live (2026-07-20 audit)

- **Menu** — 429 items / 21 categories / 3,666 option choices, mirroring the live
  Clover POS exactly (verified: every base price + every price-affecting delta).
  Includes the new **Breakfast** category (36 items, owner launched 7/15).
  Excluded on purpose: MrBeast (licensed ghost brand), Uncategorized/Open
  Food/Custom/Delivery (POS-internal), plus owner-removed categories (wine,
  jar sauce, açaí, brazilian, mexican, chubbzie-wubbzies).
- **In-house online ordering** (replaced the old Slice/Clover-hosted-page plan;
  Clover hosted page disabled): cart → checkout → Turnstile → server-side
  pricing from the Clover catalog (client prices never trusted) → atomic POS
  order via v3 API (draft → bulk line items → fire, rollback on failure) →
  idempotent `web_orders` record. Orders print as "WEBSITE • PICKUP/DELIVERY"
  with WEB-prefixed kitchen chits. Pay at pickup/delivery today (card path
  built + live-tested, awaiting public key — see below). DoorDash removed;
  delivery uses the in-house driver.
- **Security hardening** (4 audit rounds): price-tampering closed, rate
  limiting (atomic fixed-window), charge idempotency, lost-order recovery +
  staff-alert hook, strict CSP/HSTS headers, generic decline messages, PII
  masking, admin token timing-safe, Turnstile on signup + checkout.
- **VIP CRM** — signup (TCPA/CAN-SPAM consent capture) → Neon → welcome promo
  `GIGIVIP10` (10% off) → env-gated welcome SMS/email with full send audit in
  `vip_sends`. STOP/START/HELP webhook, HMAC one-click unsubscribe (+ RFC 8058),
  admin dashboard at `/admin.html` (stats, members + CSV, broadcast composer
  with dry-run). **Verified end-to-end on prod 7/20** via real browser signup
  (Turnstile passed, row persisted, send correctly logged `*_not_configured`;
  test data cleaned). `/api/admin/stats` now also reports env sanity (`config`).
- **SEO/AI-SEO** — prerendered static HTML, Restaurant/Menu/FAQ/Breadcrumb
  JSON-LD (incl. Breakfast section + FAQ), llms.txt, sitemap, robots with AI
  crawlers welcomed, 7 landing pages, **GSC verified + sitemap submitted 7/15**
  (9 URLs; homepage indexed, /breakfast indexing requested).
- **Breakfast** — orderable menu tab #2 (Clover-synced), dine-in poster page at
  `/breakfast` (own prices per owner: poster = dine-in portions), table-tent QR
  assets (`~/Downloads/gigis-breakfast-menu-QR.png`).

## What remains — the arming checklist (none are code)

### 1) Card payments — ✅ ARMED 2026-07-20 (one $1 test left)
No ecommerce token existed at all (why the public key was never found).
Created the merchant's first pair in the dashboard: **"Clover eComm Iframe"**
(Hosted iFrame + API/SDK). Public key → `VITE_CLOVER_PAKMS_KEY`; private
(UUID) → `CLOVER_ECOMM_PRIVATE_TOKEN` (charges prefer it; v3 orders keep the
merchant token). Private token verified via `/pakms/apikey` (200, active).
Also fixed a mount bug (SDK requires ids on the field divs). Verified live:
all 4 hosted card-field iframes render at checkout, no error state.
Token page: Account & Setup → "Ecommerce API tokens"
(`/setupapp/m/2J9HNTSEXBHG1/ecomm-api-tokens`). reCAPTCHA toggle left OFF
(we use Turnstile).
**Remaining: supervised $1 live card test** — Jorge places a real card
pickup order, confirms the charge + POS ticket says PAID, then refunds it
from the Clover dashboard. Do this before announcing card payment.

### 2) Auto-SMS — JORGE (Twilio)
HARD rule: LB gets its **own** number + A2P — never Sea Bright's.
Buy a 732 number → A2P brand/campaign for the LB business → point the number's
inbound-SMS webhook at
`https://gigislongbranch.com/api/sms-inbound?token=<SMS_WEBHOOK_TOKEN>`
(value in `.env.crm.local`) → add `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN` (or API key pair), `TWILIO_FROM_NUMBER` to Vercel prod →
redeploy. `/api/admin/stats` `channels.sms` flips true. Until then, skipped
sends are logged in `vip_sends` — nothing silently lost.

### 3) Auto-email — JORGE (Resend, ~20 min + DNS)
Resend → add domain `gigislongbranch.com` → SPF/DKIM at GoDaddy → verified →
add `RESEND_API_KEY` + `EMAIL_FROM` (`Gigi's VIP Club <vip@gigislongbranch.com>`)
to Vercel prod → redeploy. Unsub links verified pointing at gigislongbranch.com.

### 4) Staff lost-order alerts — 1 min once SMS is armed
`printf '+1<store manager cell>' | npx vercel env add STAFF_ALERT_PHONE production`
(use Tommy/Ken's line, not a customer-facing number).

### 5) Real dish photos — OWNER
Gallery still has 5 Unsplash placeholders; breakfast photos are the poster's
stock shots. Swap as real photos arrive.

## Ops quick-reference

- **Menu sync after any Clover change:**
  `python3 scripts/pull-clover.py && python3 scripts/build-menu.py` → review
  diff → `npm run build` → commit/push. `data/clover/classified/*.json` is the
  editable source of truth; `menuGenerated.ts` is generated — never hand-edit.
- **Admin:** `https://gigislongbranch.com/admin.html`, token = `ADMIN_TOKEN` in
  `.env.crm.local`. Broadcast composer: always dry-run first.
- **Env gotcha:** `vercel env pull` masks ALL values as `""` — check real
  runtime config via `/api/admin/stats` → `config`.
- Welcome promo `GIGIVIP10` — register staff must know it.
