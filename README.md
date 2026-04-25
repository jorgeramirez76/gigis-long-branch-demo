# Gigi's NY Style Pizza — Long Branch website

Production-ready marketing site for **Gigi's NY Style Pizza, Long Branch, NJ** (140 Brighton Ave · 732-377-2468).

> This site represents **the Long Branch location only**. The Oceanport location is permanently closed and is not referenced anywhere. The Sea Bright location is not promoted here either.

## Stack

- **Vite 6** + **React 18** + **TypeScript**
- **Tailwind CSS v4** (CSS-first `@theme` config, no `tailwind.config.js` needed)
- Static output — deploy to Vercel, Netlify, GitHub Pages, Cloudflare Pages, or any static host
- Zero runtime JS dependencies beyond React

## Quick start

```bash
npm install
npm run dev       # local dev on http://localhost:5173
npm run build     # static build → dist/
npm run preview   # serve the built site locally
```

## Project layout

```
gigis-long-branch-site/
├── index.html                 # SEO meta, Open Graph, LocalBusiness + Restaurant schema
├── public/
│   ├── favicon.svg            # Pizza favicon
│   ├── robots.txt
│   └── sitemap.xml
├── src/
│   ├── App.tsx                # Page composition
│   ├── main.tsx               # React entry
│   ├── components/
│   │   ├── Nav.tsx            # Sticky header, shrinks on scroll
│   │   ├── Hero.tsx           # Full-bleed hero + CTAs
│   │   ├── Gallery.tsx        # Food gallery
│   │   ├── About.tsx          # Local story section
│   │   ├── Highlights.tsx     # Popular-item cards (auto from menu.popular)
│   │   ├── Menu.tsx           # Tabbed full menu
│   │   ├── Reviews.tsx        # Paraphrased public review themes
│   │   ├── Location.tsx       # Address, phone, hours, embedded map
│   │   ├── Footer.tsx         # Contact, jump links, legal line
│   │   ├── StickyBar.tsx      # Mobile-only bottom bar: Call / Menu / Directions
│   │   └── Icons.tsx
│   ├── data/
│   │   ├── location.ts        # Verified address, phone, map URLs
│   │   ├── hours.ts           # Weekly hours (flag: HOURS_VERIFIED)
│   │   ├── menu.ts            # Full menu by category (flag: MENU_VERIFIED)
│   │   ├── reviews.ts         # Paraphrased themes (flag: REVIEW_THEMES_VERIFIED)
│   │   └── gallery.ts         # Image list (flag: GALLERY_IS_PLACEHOLDER)
│   └── styles/
│       └── index.css          # Tailwind v4 + theme tokens
└── research/
    ├── sources.md             # Every source URL reviewed
    ├── menu-notes.md          # Per-item provenance + uncertainty log
    └── image-sources.md       # Every image source, license, category
```

## Where to plug in verified content

Each data file has a `*_VERIFIED` / `*_IS_PLACEHOLDER` flag. As soon as the owner confirms a block of content:

1. Update the data file with verified values and set the flag to `true`
2. The UI automatically removes the "call to confirm" / pricing disclaimer UI
3. Re-run `npm run build`

## Features

- **Sticky mobile bottom bar** — Call / Menu / Directions (iOS safe-area aware)
- **Sticky header** that compresses on scroll
- **Tabbed menu** with horizontal-scroll on mobile, centered pill row on desktop
- **Embedded Google Map** via iframe (`loading="lazy"`, no API key required)
- **Accessible** — skip-link, focus-visible rings, alt text everywhere, `role="tablist"` on menu tabs, reduced-motion respected
- **Mobile-first responsive** — 2-col gallery on phones, 3-col on desktop; menu reflows at `md:` breakpoint
- **Click-to-call** on every phone number, `tel:+1...` format
- **Click-to-directions** via `maps.google.com/maps/dir/` deeplink

## SEO + structured data

`index.html` ships with:

- SEO `<title>` + `<meta name="description">`
- `<link rel="canonical">`
- Open Graph (`og:type=restaurant.restaurant`, og:title, og:description, og:image, og:url)
- Twitter card (summary_large_image)
- `application/ld+json` with a Schema.org `@graph` containing:
  - `Restaurant` + `LocalBusiness` (combined via `@type` array)
  - `PostalAddress`
  - `GeoCoordinates`
  - `areaServed` (neighboring towns)
  - `servesCuisine`, `priceRange`, `telephone`, `hasMap`

### Target keywords

- Gigi's NY Style Pizza Long Branch
- pizza Long Branch NJ
- NY style pizza Long Branch
- pizza near Brighton Ave Long Branch
- best pizza Long Branch NJ
- Italian food Long Branch NJ
- pizza delivery Long Branch NJ

## Deploy

The build output (`dist/`) is static files. Drop it onto any host.

**Vercel** (zero config): `vercel deploy`
**Netlify**: `netlify deploy --prod --dir=dist`
**GitHub Pages**: push `dist/` to a `gh-pages` branch, or use the Vite docs.
**cPanel / shared host**: drag `dist/*` into `public_html/`.

Before going live:

1. Update `canonicalUrl` in `src/data/location.ts` to the real production domain
2. Update `og:url` and canonical in `index.html` to match
3. Replace the placeholder `/og-image.jpg` in `public/` with a real 1200×630 hero image
4. Verify the lat/lng in `src/data/location.ts` — run Google Maps on the address and use the exact coords
5. Regenerate `sitemap.xml` if more routes are added

## Research trail

Every claim on this site traces back to a source. See:

- [`research/sources.md`](research/sources.md) — every URL consulted
- [`research/menu-notes.md`](research/menu-notes.md) — per-item verification status
- [`research/image-sources.md`](research/image-sources.md) — image provenance and licensing

Nothing was fabricated. Anything that couldn't be verified from public sources is either omitted or clearly marked "call to confirm" in the UI.

## Local SEO — playbook for ranking #1 in Long Branch + 5-mile radius

The on-page foundation is shipped. Ranking is the multiplier of (a) what's on this site and (b) what's published off-site about the business. Treat the off-site list below as the higher-leverage half.

### What's already on-page (done)
- **Title** + **meta description** front-loaded with "NY style pizza Long Branch NJ" and the address
- **Geo meta tags** (`geo.region`, `geo.position`, `ICBM`) for legacy + map services
- **Open Graph location** (street, locality, region, postal_code, country, phone, lat/lng)
- **Schema.org @graph** with combined `Restaurant` + `LocalBusiness` + `FoodEstablishment` entity, separate `Place` entity, `Menu` entity with all 16 sections, `FAQPage` with 7 Q&As, `WebSite` entity
- **`areaServed`** lists 12 cities inside the 5-mile radius (Long Branch, West Long Branch, Monmouth Beach, Oceanport, Eatontown, Tinton Falls, Deal, Allenhurst, Loch Arbour, Oakhurst, Asbury Park, Shrewsbury) — same list rendered visibly on the page so users see it AND crawlers see content + schema in agreement
- **Visible FAQ** (with FAQPage schema attached) — Google often pulls FAQ rich results for restaurant queries
- **Visible Service Area band** — pure location-keyword content in natural prose
- **`aggregateRating`** (4.6 · 286 reviews, sourced from Slice — disclosed in research docs)
- **`award`**: "Voted one of the top pizzas in New Jersey"
- **`potentialAction`**: OrderAction (Slice) + ReserveAction (tel:)
- **`sameAs`**: links to Instagram, Facebook, Slice, Uber Eats, Restaurantji
- **Sitemap.xml** + **robots.txt** in `public/`
- **Mobile-first responsive** + Lighthouse-friendly bundle (~60 KB gz JS)
- **Image alt text** on every image with location-relevant phrasing

### Off-page checklist (do these to actually rank)

#### 1. Google Business Profile (critical — biggest single ranking factor)
- [ ] Claim / verify the listing for **140 Brighton Ave, Long Branch NJ 07740**
- [ ] **NAP must match exactly**: Gigi's NY Style Pizza & Restaurant · 140 Brighton Ave, Long Branch, NJ 07740 · (732) 377-2468
- [ ] Primary category: **Pizza restaurant** · secondary: Italian restaurant, Restaurant
- [ ] Hours: 9 AM – 12 AM, all 7 days
- [ ] Upload 20+ recent photos (food, exterior, interior, team)
- [ ] Add menu via "Menu" attribute, link to `https://gigisnystylepizza-longbranch.com/#menu`
- [ ] Set service options: Dine-in ✓, Takeout ✓, Delivery ✓, No-contact delivery ✓
- [ ] Add attributes: Family-friendly, Good for groups, Wheelchair accessible (if applicable), Has Wi-Fi (if applicable)
- [ ] Enable messaging
- [ ] Post a Google Post weekly (specials, new pies, holiday hours) — these surface in the listing and get indexed

#### 2. NAP citation consistency (build authority across the web)
The exact same Name + Address + Phone string everywhere. Variations dilute ranking signal. The string to use:

```
Gigi's NY Style Pizza & Restaurant
140 Brighton Ave
Long Branch, NJ 07740
(732) 377-2468
https://gigisnystylepizza-longbranch.com/
```

Submit / claim / correct on:
- [ ] Yelp (high-priority — fix any wrong info, upload photos)
- [ ] TripAdvisor
- [ ] Apple Maps (Apple Business Connect)
- [ ] Bing Places
- [ ] Foursquare / Factual
- [ ] Yellow Pages
- [ ] Better Business Bureau
- [ ] Slice (already verified)
- [ ] DoorDash, Uber Eats, Grubhub, Postmates, Seamless (verify menu + hours)
- [ ] OpenTable / Resy (if reservations strategy expands)
- [ ] **NJ-specific**: NJ.com business directory, NJMonthly, Asbury Park Press dining
- [ ] **Local Long Branch**: Long Branch Chamber of Commerce, MonmouthCounty.gov business listings, JerseyShoreScene
- [ ] **Niche pizza**: PizzaToday "Find a pizzeria", Pizzeria Magazine

A free tool like Moz Local or BrightLocal will scan citations and flag inconsistencies — worth running once.

#### 3. Reviews (a top-3 ranking factor for local pack)
- [ ] **Ask every happy customer to leave a Google review.** Print a small QR-code card on tables — link directly to the review form: `https://search.google.com/local/writereview?placeid=<PLACE_ID>` (replace `<PLACE_ID>` with your GBP place ID)
- [ ] Aim for **steady review velocity** — 3–5 new reviews per month is more useful than 50 reviews in one week
- [ ] **Reply to every review** within 48h (positive or negative) — Google rewards engagement
- [ ] Same on Yelp (don't dispute Yelp filtering — just keep building organic reviews)

#### 4. Backlinks from local sites
- [ ] Get a "Local Eats" feature on **JerseyShoreOnline**, **NJ.com**, **Asbury Park Press**, **Patch.com (Long Branch Patch)**
- [ ] Sponsor a Long Branch Little League team or local school event → backlink from `.org` domains
- [ ] Cross-link from **Monmouth University** dining-options pages (the campus is right next door — student traffic is huge)
- [ ] Apply to be on regional pizza bracket lists (NJ.com runs these annually)

#### 5. On-page expansion (if/when budget allows)
- [ ] **Per-city landing pages**: `/west-long-branch-pizza-delivery`, `/monmouth-beach-pizza-delivery`, etc. Each ~600 words with unique copy + photos. This is the cleanest way to rank for `[city] pizza delivery` queries.
- [ ] **Blog**: `/blog/best-pizza-near-monmouth-university`, `/blog/long-branch-summer-pizza-guide`. Local content gets shared by local sites.
- [ ] **Schema upgrade**: add `Review` markup with 3-5 representative customer reviews (need owner permission to quote)

#### 6. Technical SEO upkeep
- [ ] **Submit sitemap.xml** in Google Search Console + Bing Webmaster Tools after first deploy
- [ ] Check **Core Web Vitals** in Search Console monthly
- [ ] Set up **Google Analytics 4** + **GA4 Conversions** (calls, online order clicks, directions clicks)
- [ ] Verify **rich-result eligibility** with Google's [Rich Results Test](https://search.google.com/test/rich-results) for the home URL — should detect Restaurant, FAQ, and LocalBusiness rich results
- [ ] Page speed: current bundle ~60 KB gz JS. Don't bloat it.

### Pre-launch checklist (replace placeholders before pointing the domain)

1. Update `canonicalUrl` in [`src/data/location.ts`](src/data/location.ts) to the real production domain
2. Update `og:url`, canonical, and all schema URLs in `index.html` to match
3. Replace placeholder `/og-image.jpg` in `public/` with a real 1200×630 hero image
4. Refine lat/lng in `src/data/location.ts` and `index.html` from exact Google Maps coords
5. Replace remaining Unsplash gallery placeholders (`NY Pepperoni`, `Buffalo Wings`, `Mozzarella Sticks`, `Fresh Heroes`, `Pasta Dinners`) with real Gigi's photography per [`research/image-sources.md`](research/image-sources.md)
6. Resubmit sitemap to Google Search Console + Bing Webmaster Tools

## License / attribution

Code: MIT.
Placeholder photography: Unsplash (free commercial use — see `research/image-sources.md`). These are staging images only; replace with owner-approved Long Branch photography before launch.
