# Gigi's Long Branch — Build Handoff

Brought the Long Branch site up to the **Gigi's Sea Bright** standard: the full
Clover-driven menu, VIP Club CRM + admin dashboard, cross-category menu search,
and a real-photo "Fan Favorites" band. Built 2026-07-12.

- **Local:** `~/Desktop/gigis-long-branch-site/`
- **Stack:** React 18 + Vite 6 + TS + Tailwind v4 + Vercel serverless `/api` (same as Sea Bright)
- **Repo:** `jorgeramirez76/gigis-long-branch-demo` (local changes NOT committed/pushed — awaiting your review)
- **Canonical domain (not yet registered):** `gigisnystylepizza-longbranch.com`

## The menu (the main ask) — DONE

Pulled the **complete live Clover inventory** for merchant *GIGIS PIZZA LONG
BRANCH* (`2J9HNTSEXBHG1`) and wired every customer-facing item + add-on + option
onto the site.

- **582 items across 27 categories, 4,103 option choices** (toppings, half-pie
  charges, add-protein, bread/sauce/temp choices — each with exact price deltas).
- Every price and modifier mirrors the Clover POS exactly.
- Menu renders with expandable per-item options and a cross-category search box.

**Excluded on purpose** (not customer menu items):
- **MrBeast Burger** — licensed ghost-kitchen brand run out of the kitchen; trademark risk, not Gigi's own menu.
- **Uncategorized** — POS-internal bucket: hospital/office catering tickets ("Bilky/Billy"), staff items ("Hats and Apron"), "Pizza Free", gift cards, dated one-off party lines, and cross-listed duplicates.
- **Open Food / Custom Item / Delivery** — POS create-your-own placeholders and delivery-fee lines.
- A handful of misfiled cross-category duplicates (e.g. "Saturday Night Special" kept under Pizza only).

### Regenerating the menu after any Clover change
```
cd ~/Desktop/gigis-long-branch-site
python3 scripts/pull-clover.py       # re-pull inventory (token in .env)
python3 scripts/draft-classified.py  # mechanical draft for any NEW categories
python3 scripts/build-menu.py        # -> src/data/menuGenerated.ts
npm run build
```
`data/clover/classified/*.json` is the editable source of truth (include flags,
display names, option rules). `menuGenerated.ts` is generated — don't hand-edit.
`scripts/finish-classified.py` + `patch-classified.py` + `clean-choices.py`
document the one-time editorial cleanup that was applied.

## What else was built (parity with Sea Bright)

- **VIP Club** signup section (name/phone/email, TCPA/CAN-SPAM consent, business scope `gigis_long_branch`).
- **CRM backend** `api/` — vip-signup, sms-inbound (STOP/START/HELP), unsubscribe (HMAC one-click), admin endpoints (members/stats/broadcast/sends).
- **Admin dashboard** at `/admin.html` (token login, member table + CSV, broadcast composer).
- **DB schema** `db/schema.sql` (Neon/Postgres) scoped to `gigis_long_branch`.
- **Fan Favorites** band with the two REAL Long Branch food photos (the cheese-pull pie + "The Fonz" specialty). All Sea Bright/Sonny's references rebranded to Long Branch throughout.

## Photos — needs owner assets

Only **two real Long Branch food photos** exist (`slice-*` cheese pull, `fanz-*`
The Fonz). Gallery still uses Unsplash placeholders for pepperoni/wings/sticks/
heroes/pasta (clearly credited). Get real dish photos from the owner to replace
them; add more Fan Favorites cards as photos come in.

## Go-live checklist (all need you / external — none are code)

1. **Confirm the Clover Online Ordering URL** for Long Branch, then flip site
   buttons Slice→Clover: set `VITE_ORDER_PROVIDER=clover` at build/deploy.
   Placeholder in `src/data/location.ts` (`CLOVER_ORDER_URL`) is a guess — verify
   it in the Clover dashboard first. Default today = Slice (works now).
2. **Deploy to Vercel** (currently only GitHub Pages static preview; the VIP
   backend needs Vercel serverless). Set env: `ADMIN_TOKEN`, `SMS_WEBHOOK_TOKEN`,
   `UNSUB_SECRET`, `PUBLIC_BASE_URL`, `DATABASE_URL`.
3. **Provision Neon Postgres** + run `db/schema.sql`.
4. **Twilio A2P 10DLC** + a Long Branch SMS number for VIP texts.
5. **Resend** API key + verified sending domain for VIP emails.
6. **Register + point the domain** `gigisnystylepizza-longbranch.com`.
7. Replace Unsplash placeholder photos with owner dish photos.

## Verified working (local, 2026-07-12)
`npm run build` clean; dev server QA passed — 27 menu tabs render, Pizza panel
shows all 75 items with options + price deltas, search returns cross-category
matches, Fan Favorites photos load, VIP form + admin login render, phone
732-377-2468 throughout, zero console errors, no Sea Bright leakage.

**Note:** the Clover merchant API token lives in the gitignored `.env`
(`CLOVER_API_TOKEN` / `CLOVER_MERCHANT_ID`). Keep it out of git.
