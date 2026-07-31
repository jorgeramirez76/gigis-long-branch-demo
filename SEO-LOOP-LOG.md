# Gigi's Long Branch — SEO Loop Log

A running record of the search-ranking work: what changed, what was actually verified
(not assumed), and what is waiting on Jorge or Tommy. Newest cycle at the top.

Autonomy rule in force for this loop: **ship** schema, metadata, internal links, new/expanded
landing pages, speed, alt text and llms.txt without asking. **Queue for Jorge** anything touching
homepage design, prices, or factual claims — the homepage design is final, additive work only.
Never invent a fact: no fake reviews, awards, party durations or guest minimums.

---

## Baseline, measured 2026-07-29 (Google Search Console API, window 2026-06-15 → 2026-07-28)

This is the honest starting line. The site is roughly six weeks old.

| Metric | Value |
|---|---|
| Total impressions | 293 |
| Total clicks | **8** |
| Distinct queries | 47 |
| Brand queries ("gigis long branch", "gigi's pizza", …) | 28 queries · 262 impressions · 8 clicks |
| Non-brand queries | 19 queries · 31 impressions · **0 clicks** |
| Homepage | 408 impressions · 14 clicks · avg position 6.9 |
| `gigis long branch` (best brand query) | 56 impressions · 2 clicks · pos 3.86 · **CTR 3.6%** |
| `pizza long branch nj` | 2 impressions · pos 5 |
| `pizza long branch` | 1 impression · pos 54 |

Two findings matter more than the totals:

1. **Non-brand search sends this site zero traffic.** 31 impressions and no clicks in six weeks.
2. **Brand-query CTR is 3.6% at position 3.86.** When someone searches Gigi's by name, the
   site is the fourth thing they see and almost nobody clicks it. For a business's own name that
   number should be many times higher. Whatever sits above it — the map pack, Slice, DoorDash,
   Yelp — is taking those clicks. This is the single most valuable open question.

### GSC URL Inspection, all 10 URLs (2026-07-29)

| URL | State |
|---|---|
| `/` | Submitted and indexed |
| `/breakfast` | Submitted and indexed |
| `/vegan-pizza-long-branch/` | Submitted and indexed |
| `/late-night-pizza-long-branch/` | Submitted and indexed |
| `/catering-long-branch/` | Submitted and indexed |
| `/pizza-delivery-west-end-long-branch/` | Submitted and indexed |
| `/gluten-free-pizza-long-branch/` | **Discovered — currently not indexed** (never crawled) |
| `/pizza-delivery-elberon/` | **Discovered — currently not indexed** (never crawled, no referring URLs) |
| `/pizza-delivery-pier-village/` | **Discovered — currently not indexed** (never crawled, no referring URLs) |
| `/pizza-party-long-branch/` | **URL is unknown to Google** (brand new, published 2026-07-28) |

Rich results detected on the indexed pages: **Breadcrumbs only**, even though Restaurant,
LocalBusiness and FAQPage schema were already present and valid.

Google's sitemap record: `lastSubmitted 2026-07-15`, `lastDownloaded 2026-07-22`. Google had not
re-read the sitemap in a week, which is why the party page was still unknown to it.

---

## Cycle 1 — 2026-07-29 — Depth and crawl paths on the seven landing pages

### Diagnosis

The three unindexed pages were the lead. Checked and ruled out the plumbing first: robots.txt
allows everything except `/admin.html` and `/api/` (and explicitly welcomes GPTBot,
PerplexityBot, ClaudeBot, OAI-SearchBot); the sitemap listed all 12 URLs; and the footer links to
every landing page were present in the live prerendered HTML. So Google had found these URLs and
*chose* not to spend a crawl on them.

Measured the pages instead: **524–636 visible words each, of which about 30% is shared nav and
footer boilerplate** — so roughly 350–450 words of unique body copy per page. Pairwise 6-word
shingle overlap between pages ran 27–31%, which is boilerplate rather than doorway-page
duplication. The pages weren't spammy; they were thin, on a domain with no authority yet.

### What shipped

All seven landing pages regenerated from `scripts/build-landing-pages.py` + `data/landing-pages.json`:

- **Real price tables, read programmatically from the POS.** A new `load_prices()` parses
  `src/data/menuGenerated.ts` (generated from Gigi's live Clover inventory) and `price_of()`
  **hard-fails the build** if a row names an item that doesn't exist, so a price can never be
  hand-typed or invented, and a Clover menu change flows through on the next build instead of
  going stale. Each page shows the prices relevant to its own intent — the gluten-free page shows
  the $17.68 GF pie plus the +$2.60 GF pasta and +$2.08 GF bread substitutions; the late-night
  page shows real slice prices ($2.92 plain, $3.38 specialty, $3.90 gourmet, $5.20 Hangover);
  catering shows real tray prices ($57.20 chicken, $67.60 seafood).
- **A visible hours table**, plus `openingHoursSpecification`, `geo` and `paymentAccepted` on the
  Restaurant node.
- **An "Order Direct, Not Through a Middleman" block** — the genuine differentiator against
  Slice and DoorDash, and the only content on these pages that no competitor can copy: the ticket
  prints in Gigi's own kitchen on payment, 3.99% off for cash, no app service fee, emailed
  receipt with a ready time, free plain cheese pie for new VIP members.
- **Two to three more FAQ entries per page** (3–4 → 6), each answering a question the price data
  now supports, e.g. "How much is a gluten-free pizza at Gigi's?"
- **`Menu` / `MenuItem` / `Offer` JSON-LD** matching the visible tables.
- **Internal linking widened from the first 5 siblings to every sibling**, plus a descriptive
  "More from Gigi's" related-links list. This directly targets the two pages Google reported with
  no referring URLs.
- **Sitemap** `lastmod` bumped to 2026-07-29 and `changefreq` set to `weekly` on the seven
  changed pages (honest now that prices track Clover).

Net effect: **~550 → ~1,000 visible words per page**, with the added content being specific
prices and hours rather than padding.

### Verified, not assumed

- `npm run build` (tsc + vite-react-ssg) clean; `dist/` contains all seven pages.
- Deployed with `vercel --prod --yes` twice (git auto-deploy is still broken on this project).
- Live-checked over HTTPS on the production domain: `/gluten-free-pizza-long-branch/` returns 200
  with 4 price rows and Menu schema; `/pizza-delivery-elberon/` returns 200 with 7 price rows and
  8 MenuItem nodes; both render the related-links block.
- Price rendering spot-checked against Clover data, including the **name-collision bug I caught
  before it shipped**: `"Gluten Free"` exists as both a $17.68 pie and a +$2.60 pasta
  substitution, so both rows would have rendered $17.68. `price_of()` now takes an explicit
  `kind` and the GF rows are tagged `item` / `mod`. Verified output: $17.68 pie, +$2.60 pasta,
  +$2.08 bread.
- Live sitemap serves the new `lastmod` values (8 of 10 URLs dated 2026-07-29).

### Blocked / could not do

- **Cannot resubmit the sitemap or request indexing via API.** The stored credential at
  `~/.gsc_token.json` holds only `webmasters.readonly`. Reads work; every write returns
  `403 insufficientPermissions`. Google's sitemap ping endpoint was retired in 2023, so there is
  no unauthenticated fallback. Accelerating the crawl of the three unindexed pages therefore
  needs either a re-auth with the `webmasters` write scope, or a few clicks in the Search Console
  UI. Next cycle will do it through Jorge's logged-in Chrome, which he approved.
- Google's sitemap report field says `indexed: 0` of 9 submitted. Not treating that as truth —
  URL Inspection is authoritative and shows six URLs indexed. That field is long known to be
  unreliable.

### Queued for Jorge — not shipped

- Nothing from this cycle required his approval; it was all additive and no prices or claims were
  authored by hand. Items surfaced for him live in the section below as the loop finds them.

### Honest caveat on this cycle

Deepening thin pages is a real fix for "Discovered — currently not indexed", but it is not
guaranteed to be *the* fix on a six-week-old domain with essentially no backlinks — crawl
budget on a new low-authority site is small, and Google may still decline these pages. The
measurable test is whether those three URLs move out of "Discovered" over the coming days; that
gets re-checked with the same URL Inspection call each cycle rather than assumed.

---

### Also shipped this cycle — AI-answer-engine prices

`public/llms.txt` had no prices at all, and "how much is a gluten-free pizza in Long Branch" is
exactly the shape of question an AI answer engine gets asked. Added a generated price block plus
three directly-answered priced questions, via a new `scripts/build-llms-prices.py` that reads the
same Clover data and **fails rather than publishing a stale price** if an item disappears from the
POS. Verified: 16 real prices live at `https://gigislongbranch.com/llms.txt`, and the script is
idempotent (runs twice, one marker block).

### The brand-CTR answer — found it

Searched the brand terms and read the result set. For Gigi's own name, **Gigi's own site is third**,
behind:

1. **Slice** (`slicelife.com/restaurants/nj/long-branch/07740/gigi-s-ny-style-pizza-restaurant/menu`)
2. **Yelp**
3. gigislongbranch.com

Behind those sit Restaurantji, `menu-world.com`, **Grubhub**, **Seamless**, and **EatStreet** — and
the EatStreet listing files Gigi's under *New Brunswick*, not Long Branch. There is also a
`gigisnystylepizza.com` and a Facebook page at `@gigispizzasb` (the "sb" suggests it is the Sea
Bright page, not Long Branch).

That is the 3.6% brand CTR explained: when a customer searches Gigi's by name, Slice gets the
click and Slice takes a cut of the order. This is a direct revenue leak, not an abstract ranking
problem, and no amount of on-site work fixes it — it is won by making the owned listing the
obvious first result.

**Third-party listings are also publishing wrong hours.** At least one aggregator states
"Monday through Sunday, 9:00 AM – 12:00 AM". The owner-confirmed hours are Mon–Wed 10 AM–11 PM and
Thu–Sun 10 AM–midnight. So customers are being told Gigi's opens an hour earlier than it does, and
the inconsistent hours also weaken the local-search signal.

Checked our own site against the loose claims floating around those listings, and it is clean:
"voted top 20 pizza in NJ" appears **nowhere** in our source, and "Bee Sting" and "The Fonz" are
genuine Clover items, correctly listed. The bad data is theirs, not ours.

---

## Cycle 2 — 2026-07-29 — Undoing the damage cycle 1 did

Two adversarial agents audited cycle 1. Both found real problems, and I verified every claim myself
before acting on any of it. The short version: **the prices were flawless and almost everything I
hand-wrote around them was not.**

### What the audit got right

**The price numbers were perfect — 43 of 43 rows, and every dollar figure in every FAQ answer.** The
build-time guard worked exactly as intended, including the `"Gluten Free"` name collision.

**And then I hand-wrote about twenty ingredient descriptions right next to them.** `menuGenerated.ts`
contains **zero** description fields, so every one of "Pepperoni, sausage, meatball, bacon and ham",
"Thin square, sauce on top", "Ricotta and mozzarella, no red sauce", "18-inch hand-stretched NY
round" and the rest was invented by me — and each one was also being injected into the JSON-LD as a
`MenuItem.description`. I built a guard against invented prices and then wrote invented prose beside
it. That is the lesson from this cycle.

**The worst single item:** the vegan page listed a **Veggie Omelette** in a price table headed
"Vegan and Plant-Based Prices", and an FAQ answer named it among plant-based options. An omelette is
eggs, and that page exists precisely for people who care about that. It also called the Veggie Pie
plant-based while the table on the same page said it used regular mozzarella.

**A 1.26-mile location error, in structured data, on all seven pages.** `src/data/location.ts` gives
the verified rooftop coordinates as `40.284619, -73.988707` — checked against the US Census geocoder
and OpenStreetMap. The generator hardcoded `40.3010, -73.9990`. The wrong `<meta name="geo.position">`
was pre-existing, but I promoted it into a `GeoCoordinates` JSON-LD node, which made it far more
authoritative. Verified distance between the two points: **2.02 km**.

**I made the pages more templated, not less.** Measured with the same 6-word-shingle metric both
times: mean cross-page similarity went **28.5% → 43.3%**, and elberon ↔ pier-village went
**28.7% → 47.5%** — the two most-duplicative URLs being two of the three Google refused to crawl.
`render_hours()` and `render_direct()` were appended unconditionally, so five pages ended up with
"Hours &amp; How to Order" immediately followed by "Hours &amp; Where to Find Us".

**Same `@id`, contradictory entity.** The landing pages re-declared
`https://gigislongbranch.com/#restaurant` — the homepage's canonical business node — with a
different `name`, a narrower `@type`, and the wrong coordinates. Identical `@id` means identical
entity in JSON-LD, so seven pages were publishing a competing definition of the business at exactly
the moment the goal was to strengthen it.

**My rich-result rationale was wrong.** There is no Google rich result for `Menu`/`MenuItem`
markup and never has been, and FAQ rich results were deprecated. So "Breadcrumbs only" was never a
bug to fix — it was the correct and complete answer for this page type. The `Menu` node was also
dangling: it carried an `@id` that nothing referenced.

**And the core logical gap:** `Discovered — currently not indexed` with `lastCrawlTime: null` means
Google *never fetched the page*. Content it has not read cannot change its decision to read it. My
cycle-1 diagnosis had the causal arrow backwards. The direct fix is Request Indexing in Search
Console — which is exactly the thing the read-only token blocks.

### What the audit got wrong, or overstated

- **The "orphan pages" premise.** The footer has linked all seven slugs since the commit that created
  them, server-rendered. GSC's "Referring page" field shows one *sampled* referrer and routinely
  reports none for genuinely-linked pages. I over-read it as evidence of zero inbound links.
- **"Zero upside" on the Menu schema** is too strong. There is no Google rich result, correct — but
  entity clarity and AI-answer-engine citability were explicitly in scope for this work, and
  `Offer` prices matching visible content serve both. Kept, wired correctly, rationale corrected.
- `"More from Gigi's"` is internal navigation, not a link scheme. The real cost is a flattened
  priority signal, which is a different and much smaller problem.

### What shipped in response

| Fix | Result, measured |
|---|---|
| Coordinates read from `location.ts`, never hardcoded; build fails if unreadable | Live pages now serve `40.284619;-73.988707` in both the meta tag and JSON-LD |
| Restaurant node mirrors the homepage entity exactly (`@type` array, name, geo) | Verified field-by-field against the live homepage node |
| `Menu` node wired via `hasMenu` | No longer dangling |
| Stripped every unverifiable ingredient/size/preparation description | **37 descriptions removed**; only the ones that trace to Clover option groups kept |
| Removed the Veggie Omelette row; reframed the table as "Vegan and Vegetarian", stating explicitly that only the Vegan Pizza Pie is vegan and the rest use dairy cheese | Live: zero occurrences of "omelette" on the vegan page |
| Removed/reworded: "18-inch", "dedicated GF crust", "shortest delivery run", "11:45 PM", "half and full trays", "most offices order first", "few real vegan pizzas in town", "straight shot down from Brighton Avenue", "cut to order all night" | Live scan: all clear |
| Gluten-free page no longer promises "any toppings" (the Clover GF pie has no Toppings option group at all) | Now says toppings are charged separately, call to build it |
| Gated the hours and order-direct blocks against each page's own sections; cut the order-direct block from 5 bullets to 3 | Mean similarity **43.3% → 31.5%**, worst pair **47.5% → 37.9%**, identical-on-all-seven sentences **13 (226 words) → 3 (37 words)** — while pages stayed at 778–932 words, well above the 550 baseline |
| Ticket wording corrected to "the moment you place it" | Cash orders are not paid at order time; the ticket prints on placement reading NOT PAID |
| Hero rating tiles now read from `src/data/reviews.ts` | Was inlined and had already drifted once (84/125 → 86/130) |
| Header uses a new `logo-sm.png` at 145×120 with intrinsic `width`/`height` | **156 KB → 18 KB**, and `logo.png` left untouched because it is also the favicon, apple-touch-icon and JSON-LD logo |

Built, deployed with `vercel --prod --yes`, and verified live on all three spot-checked pages:
HTTP 200, correct coordinates, zero residual flagged strings, price tables intact.

### Still queued for Jorge — I did not touch these

- **The Sea Bright Facebook page is declared as Long Branch's own.** `src/data/location.ts:39` sets
  `facebook: "https://www.facebook.com/gigispizzasb/"`, and it is emitted in the homepage's `sameAs`
  — an assertion that this *is* the same entity. The Sea Bright repo claims the identical URL at
  `gigis-sea-bright-site/src/data/location.ts:70`. Both sites therefore tell Google their
  differently-addressed businesses are the same Facebook page. That conflates the two entities and
  cuts against the standing rule that Long Branch and Sea Bright never share infrastructure.
  **Needs Jorge to say whether Long Branch has its own page or none** before I remove it.
- **`sameAs` also asserts identity with Restaurantji and Restaurant Guru** — aggregator pages that
  compete for brand-name SERP slots. Demoting them to plain citations is a judgment call on his side.
- **Homepage title is category-first:** "NY Pizza &amp; All-Day Breakfast in Long Branch, NJ | Gigi's".
  Brand-first would read better for the brand queries that are 89% of current impressions. This
  touches the homepage, so it stays queued under the design-is-final rule.
- **No Google review count exists anywhere in the repo.** `src/data/reviews.ts` documents Restaurantji
  and Restaurant Guru but has an explicit code comment to re-confirm the live Google count before
  using an `AggregateRating` — and nobody ever captured it. For a pizzeria the Google rating is the
  number that matters most, and it is the one number not on record.
- **Merging `/pizza-delivery-elberon/` into `/pizza-delivery-pier-village/`** (or into one delivery
  page) would cut the remaining duplication further, but deleting a live URL is his call.

---

## Cycle 3 — 2026-07-29 — 17 confirmed findings, including one where my own fix was wrong

Ran a 5-dimension verification workflow (facts, schema, duplication, frontend, crawl), each finding
then attacked by two independent skeptics told to default to "refuted" when unsure. 65 agents.
**30 findings raised, 17 survived, 13 refuted.** I verified every critical claim myself before acting.

### The finding that mattered most: my cycle-2 entity "fix" was wrong

I claimed to "mirror the homepage's `/#restaurant` entity instead of redefining it." I did not — I
re-declared it inline with a full property set under the same `@id`. The homepage's own WebPage node
does it correctly, with a **bare reference and nothing else**: `"about": {"@id": ".../#restaurant"}`.

The consequence I missed: `address`, `geo` and `openingHoursSpecification` are *anonymous blank
nodes*. A consumer merging the site does not deduplicate them, it **unions** them. So the single
canonical business was accumulating, across seven pages, two telephone literals
(`(732) 377-2468` here vs `+1-732-377-2468` on the homepage), two street spellings
(`140 Brighton Avenue` vs `140 Brighton Ave` — and `address` is the one *required* property for
Google's local business feature), eight `GeoCoordinates`, sixteen `OpeningHoursSpecification` nodes
carrying `"Mo"`/`"Tu"` day codes that are **not** schema.org `DayOfWeek` members and a `closes`
value of `"24:00"` that is out of range and contradicted the homepage's `23:59`, and eight competing
`hasMenu` values that overwrote the real 5-section site menu with a 2–7 row marketing list.

Switching to the bare `@id` reference resolved **six** confirmed findings at once. Verified live: the
landing-page graph is now exactly `[WebPage, FAQPage, BreadcrumbList]`, `WebPage.about` is a bare
reference, and no node re-declares a Restaurant property.

I also **dropped the `Menu`/`MenuItem`/`Offer` JSON-LD entirely.** It has never been eligible for a
Google rich result, and attaching it to the shared `@id` was the hijack above. The visible price
tables — the part that actually serves readers — stay, and `llms.txt` already carries structured
prices for AI answer engines.

### The second critical: the same defect class I "fixed" was still on the same page

Cycle 2 pulled the "veggie omelette is plant-based" line. It missed that the **same page** offered
**"vegan-friendly salads and marinara pies"** — in the meta description, the dek, an H2 ("More than
pizza: vegan salads and marinara pies"), a body paragraph, and an FAQ answer that was also emitted
into the FAQPage JSON-LD. Checked it myself:

- Not one salad in the POS has any ingredient data, and the only option groups on any salad are
  "Dressing" and "Add Meat Salad" — **no** "No Cheese" or "Vegan Cheese" choice exists on a single
  one. The category includes Caesar, Cobb, Wedge, Antipasto and Chicken Milanese.
- **There is no "Marinara Pie" item at all.** The closest is "Tomato Pie" at $16.64. And no pizza
  item offers a "no cheese" choice, so "crust and sauce, no cheese" was not an orderable build.
- The page contradicted itself: its own price-table intro already said "Only the Vegan Pizza Pie is
  on the menu as a vegan item."

### Everything else fixed this cycle

| Confirmed finding | Fix, verified live |
|---|---|
| "vegan-friendly salads and marinara pies" in 5 places incl. JSON-LD | Removed; dairy-free requests now route to a phone call |
| The competitor claim survived cycle 2 in **3 more wordings** ("one of the few vegan pizza options right in Long Branch") | All three removed. My cycle-2 fix only caught one phrasing |
| "dairy-free cheese and vegetable toppings" as the vegan pie's build | Removed — no pizza item in the POS carries a Vegan Cheese choice |
| Beyond burger + grilled veggie wrap presented as plant-based (the wrap's own POS group offers Mayo) | Reworded: only the Vegan Pizza Pie is named vegan; the others say to specify when ordering |
| "GF pasta swap in **any** pasta dish" — 10 of 24 pasta items have no Pasta Mod group at all (Baked Ziti, Lasagna, Ravioli, Stuffed Shells…) | Changed to "most pasta dishes" everywhere |
| **WCAG 1.4.10 reflow failure on 5 of 7 pages** — `scrollWidth` 333px at a 320px viewport, caused by `white-space:nowrap` on the hours-table time column | Removed nowrap, trimmed cell padding. Measured in a real browser at 320px: **scrollWidth 320, zero overflowing elements** |
| Hero eyebrow failed WCAG AA contrast (3.81–4.30:1 across the gradient) | Now #f0c274: measured **5.08–7.37:1** at every point on the gradient. The price note (5.90) and trust line (6.20) already passed |
| Every landing page still used the 152 KB non-square `logo.png` as its apple-touch-icon | New square 180×180 `apple-touch-icon.png`, 21 KB |

### Refuted — I did not act on these

Worth recording because two of them contradict things I said earlier and one contradicts the first
audit:

- **"No on-page change can affect Google's decision to crawl a URL it never fetched."** Refuted. The
  first audit stated this absolutely and I repeated it. The skeptics pushed back: host-level quality
  signals do feed crawl scheduling, so the absolutist version overstates it. My cycle-1 thesis was
  weaker than I claimed but not baseless.
- **"Consolidate Elberon and Pier Village as doorway pages."** Refuted.
- **Three separate challenges to my duplication measurements** — including "the 31.5% figure is not
  reproducible." All refuted; the number stands. Finding 16 *was* confirmed though: at 31–37% the
  pages are still above the 27–31% pre-cycle-1 baseline, so varying the related-links block per page
  is queued rather than done.
- "The dedup gate deleted the one genuine differentiator" — refuted; the order-direct block is still
  present on the pages that don't already cover ordering.
- "Each page is reachable at three 200-status URLs" — refuted.

### Known-remaining, not yet fixed

- **LCP is blocked by the Google Fonts stylesheet.** Measured: it is the only render-blocking
  resource (145–241 ms) and the LCP element is a text node in Inter at 532 ms. The fix is to
  self-host three woff2 files and inline the `@font-face` rules. Real, worth doing, and bigger than
  the rest of this cycle — next cycle.
- **Font-swap CLS shifts content below the hero by ~32px.** Fix is metric-override fallback
  `@font-face` rules; pairs naturally with the self-hosting work above.
- Cross-page duplication at 31–37% vs a 27–31% baseline (vary the related-links block per page).

---

## Cycle 4 — 2026-07-29 — Fonts self-hosted, duplication now below baseline, and a ratings problem

### First, the honest null result

Re-ran GSC URL Inspection on all four problem URLs. **Nothing moved.** All three are still
"Discovered — currently not indexed" with `lastCrawl: None`, and `/pizza-party-long-branch/` is
still "URL is unknown to Google" with `sitemap: None` — meaning Google has *still* not re-read the
sitemap. That is Google's own crawl scheduling, on its own clock, and it is far too early to draw a
conclusion in either direction. It gets re-checked every cycle rather than assumed.

### Self-hosted fonts — the render-blocking resource is gone

The only render-blocking resource on these pages was the `fonts.googleapis.com` stylesheet, and the
LCP element is a text node, so nothing painted until a cross-origin round trip finished.

Checked what is actually used before downloading anything: **only weights 400 and 700, and no
italic** — while the old link pulled nine weights plus an italic. Fetched the latin subsets and
found Inter ships as a **variable font**, so one file covers 100–900 and the "400" and "700" files
were byte-identical (same SHA-256). Deleted the duplicate. Final payload: **3 files, 80.3 KB**
(Inter 48.4 KB, Playfair 23.3 KB, Bebas 8.6 KB), all verified as genuine woff2 by magic bytes.
`font-src 'self'` was already permitted by the CSP, so no header change was needed.

**Metric-override fallbacks, measured rather than guessed.** To stop the font swap reflowing the
page I needed real numbers, so I extracted them from the font binaries with fontTools. My first
attempt used `xAvgCharWidth` and produced `size-adjust: 138.3%` for Inter — obviously wrong, since
that would render fallback text 38% oversized and make the shift *worse*. `xAvgCharWidth` is not
computed consistently across fonts. Measuring the real advance width of a representative sentence
instead gave **Inter 107.8%, Playfair 104.7%, Bebas 84.6%**, and the derived Inter overrides
(89.9% ascent / 22.4% descent) independently reproduce the widely-published Inter fallback metrics —
which is good corroboration that the method is right.

Measured live in a real browser after deploying:

| | Before | After |
|---|---|---|
| Render-blocking resources | 1 (145–241 ms) | **0** |
| Third-party origins | fonts.googleapis.com, fonts.gstatic.com | **none** |
| CLS | ~32 px shift on font swap | **0** |
| Font files | 9 weights + italic, cross-origin | 3 files, 80.3 KB, self-hosted |

Also added `preload` for the two fonts above the fold. **I could not capture a comparable LCP
figure** — the browser did not expose paint entries on the measurement pass — so I am not claiming
an LCP number. The structural facts above are what was verified.

### Duplication is now below where it started

Rotated the "More from Gigi's" block so each page describes **4 siblings instead of all 6**, chosen
by a fixed rotation so the graph stays provably balanced — every page links out to exactly four and
receives exactly four descriptive inbound links, so nothing can get orphaned the way
`/pizza-delivery-elberon/` was. The footer still links to every sibling, so crawl reachability is
unchanged.

**Mean cross-page similarity: 28.5% baseline → 43.3% after cycle 1 → 31.5% after cycle 3 → 27.2%
now.** Below the original baseline, while pages carry ~850 words against the original ~550. That is
the outcome I wanted from cycle 1 and did not get: more useful content, less repeated boilerplate.

### The ratings badge is mislabeled, and this one is important

Cycle 3 flagged that the hero trust tiles were hardcoded and might be stale, so I verified both
against the live sources.

**Restaurantji is exactly right:** `ratingValue 4.6`, `ratingCount 86` — matches the repo.

**Restaurant Guru is not.** We display **"★ 4.3 Restaurant Guru (130)"**. What that page actually
publishes:

- Its **own** `AggregateRating` in JSON-LD is **2.9 / 5 with 130 reviews**.
- The **4.3 is Google's rating**, which Restaurant Guru is merely republishing — its visible text
  reads "Google (4.3/5)" alongside "120 Visitors' reviews", and elsewhere "This bar scored 4.3 in
  the Google rating system."

So the badge on eight live pages pairs **Google's score** with **Restaurant Guru's review count**
and attributes the whole thing to Restaurant Guru. Restaurant Guru's own score is 2.9. That is a
materially misleading composite on a real business's website, and I am not going to quietly decide
how Jorge's ratings get presented — see the queue below.

**The upside:** this incidentally surfaces the number cycle 3 said existed nowhere in the repo —
**Google 4.3/5, with roughly 120 Google reviews** as reported second-hand by Restaurant Guru. It
should be treated as second-hand until read off the Google Business Profile directly, not recorded
as verified.

---

## Cycle 5 — 2026-07-29 — Found the revenue leak, precisely

### 🔴 Google's "Order online" button sends every customer to a middleman, and Gigi's own ordering system is not even listed

Read Gigi's Google Business Profile and Maps listing (read-only, no account changes). When a
customer finds Gigi's on Google and taps **Order online**, Google opens a provider picker offering
**nine** options, in this order:

| # | Provider | What Google shows |
|---|---|---|
| 1 | **Slice** | **"Preferred by business"** |
| 2 | EatStreet | "Service fee 18%" |
| 3 | DoorDash | No fee |
| 4 | RestaurantDirect | No fee |
| 5 | Online Ordering by DoorDash (order.online) | No fee |
| 6 | Seamless | No fee |
| 7 | Grubhub | No fee |
| 8 | Uber Eats | No fee |
| 9 | Postmates | No fee |

**gigislongbranch.com is not on that list at all.** Verified programmatically — I enumerated every
outbound link on the picker and zero point at the owned domain.

So the commission-free ordering stack we built — the one wired to Gigi's own Clover, that prints
straight to the kitchen and puts the whole ticket in Gigi's account — is invisible at the exact
moment a customer decides to order. And **Slice is explicitly flagged "Preferred by business,"**
which is a setting, not an accident.

This explains the numbers that have been puzzling all day: the 3.6% brand-query CTR, the 8 organic
clicks in six weeks, and Slice outranking the owned site for Gigi's own name. It was never mainly a
ranking problem. Google is actively routing the highest-intent traffic to a middleman.

**This is a Google Business Profile change, it is outward-facing, and it is Tommy's and Jorge's
call — so I have not touched it.** What it needs: in the GBP dashboard, add gigislongbranch.com as a
food-ordering link and set it as the preferred provider. That is the highest-value action available
anywhere in this project right now, and it costs nothing.

### GBP facts verified while I was in there

Good news first: **the website field is correct** — it points at `gigislongbranch.com`, not Slice.
That was cycle 4's open worry, now resolved. (It uses the `www.` variant while our canonical is
bare; that redirects, so it is cosmetic.)

| Field | Google Business Profile | Our source of truth | Match |
|---|---|---|---|
| Rating | **4.3** | — | Confirms cycle 4: the 4.3 on our badge is **Google's**, not Restaurant Guru's |
| Name | **"Gigi's Pizza Long Branch"** | "Gigi's NY Style Pizza & Restaurant" | ✗ inconsistent |
| Address | 140 Brighton Ave, Long Branch, NJ 07740 | same | ✓ |
| Phone | (732) 377-2468 | same | ✓ |
| Hours | closes 11 PM, opens 10 AM Thu | Mon–Wed 10–11, Thu–Sun 10–12 | ✓ |
| Category | Pizza restaurant | — | reasonable |
| Website | www.gigislongbranch.com | canonical is bare domain | ✓ (redirects) |

The review count is not exposed in that view, so **the Google review count is still not captured** —
it needs the GBP dashboard. The rating (4.3) is now first-hand from Google rather than second-hand
through Restaurant Guru, which independently confirms the cycle-4 badge finding.

The **name mismatch** is a genuine entity-consolidation problem: Google knows this business as
"Gigi's Pizza Long Branch" while the site, its schema and its `sameAs` all say "Gigi's NY Style
Pizza & Restaurant." That splits the brand signal. Renaming a GBP requires the owner and a Google
review, so it is queued rather than done.

### The ★ glyph — checked, and it is not a regression

I subset the self-hosted fonts to latin only, so I checked every non-ASCII character the pages
actually render against each font's cmap: `·` `–` `—` `©` are all present in all three subsets.
**`★` (U+2605) is in none of them** — but it never was, because U+2605 is not in any standard Google
Fonts subset either, so it always fell back. I then checked whether my new metric-override fallback
could distort it: Arial, Helvetica, Georgia and Impact contain no U+2605 either, so the browser walks
straight past the `size-adjust: 107.8%` face to a system symbol font. **The star is unaffected by my
change.** Confirmed with a mobile screenshot — the hero, both rating tiles, all three typefaces and
the sticky bar all render correctly.

---

## Cycle 6 — 2026-07-29 — My blind spot: I was only ever fixing one of four files

17 more confirmed findings (12 refuted). Two of them correct claims **I made in this log**, so those
come first.

### Corrections to my own earlier reporting

**"Duplication is now below where it started" was wrong.** The 27.2% figure is reproducible, but the
conclusion I drew from it is not. Full-page similarity held roughly flat only because the
denominator grew — the pages got 52% longer, so the shared boilerplate was **diluted, not removed**.
Honest restatement: cross-page similarity is **essentially unchanged from baseline**, not below it.
And the worst pair (pier-village ↔ west-end) is ~35.8%, about two points better than cycle 3 —
improved, **not resolved**.

**"Zero third-party origins" was a scope overclaim.** True for the seven landing pages only. The
**homepage**, `/breakfast` and `/pizza-party-long-branch/` still load Google Fonts — and the homepage
is the most important URL on the site and the one every landing-page CTA points at. So a visitor who
lands on a landing page and clicks through pays for the self-hosted fonts *and* the full gstatic set.
Corrected below and queued.

### The blind spot itself

Cycles 2–5 removed a series of unsupported claims from `data/landing-pages.json`. The same claims
were sitting the whole time in **`src/data/seo.ts`**, **`index.html`** and **`public/llms.txt`** —
and `llms.txt` is the file that exists specifically to be quoted verbatim by AI answer engines, so
wrong claims there travel further than page copy. A repo-wide sweep found them in all four places.
Fixed everywhere this cycle, then verified live on all eleven public surfaces.

The specific claims, and why each is wrong:

- **"any toppings" / "full range of toppings" / "specialty combos" on the gluten-free pie.** The
  Clover `Gluten Free` item has **no Toppings option group at all** — only a "Topping Charges"
  price-delta group with no way to say *which* topping. Plain Pie, Margherita, Veggie Pie and the
  vegan pie all carry the 26-choice Toppings list; the GF pie does not. A customer following that
  copy literally cannot pick pepperoni online. Worse, the GF page's own price table already said
  "Toppings are charged separately — call and we'll build it," so **the page contradicted itself**.
- **"one of the few vegan pizza options right in town" / "you don't have to drive out of Long Branch"
  / "vegan-friendly salads and marinara pies."** A fifth surviving wording was still on the Elberon
  page, and the whole set was still in the homepage's FAQPage and Menu JSON-LD — the canonical
  entity all seven landing pages now point at, so it was the schema Google attributes the claims to.
- **"GF pasta in any pasta dish."** Measured: the +$2.60 swap exists on **13 of 24** pasta items
  (54%) and on **zero** of the 64 catering trays. So "any" was false — and my own cycle-5 fix to
  "most" was also a stretch at 54%. Now reads "many pasta dishes."
- **"Weekend slots go quickly"** on the pizza-party page. PRODUCT.md's "never state as fact" list
  names weekend availability explicitly.

### A genuine regression my font migration caused

Live fonts were served **`cache-control: public, max-age=0, must-revalidate`**. `/fonts/` matched no
rule in `vercel.json` except the catch-all, which sets security headers but no caching. gstatic had
served these exact typefaces `immutable` for a year, so **repeat visitors were paying three
conditional round trips for 80 KB that never changes** — and because that RTT sits in front of first
paint, the swap flash the metric-override faces exist to mask was happening on *every* visit.
Fixed: `/fonts/(.*)` → `public, max-age=31536000, immutable`. Verified live.

### Also fixed

- **The `Inter Fallback` face had no bold weight**, so 23 of 67 Inter elements were getting
  synthetic-bolded Arial Regular and still reflowing on swap — the exact thing the override exists to
  prevent. Added a bold companion face. I first typed the metrics from intuition (104.4% / 92.8% /
  23.1%), caught myself, and measured them instead by instancing the variable font at weight 700 and
  comparing against Arial Bold: **101.9% / 95.1% / 23.7%**. Shipped the measured values.
- **`isPartOf` was still an anonymous `WebSite` blank node** whose name disagreed with the
  homepage's — the identical failure mode the entity fix was meant to eliminate, left in place one
  property over. Now `{"@id": ".../#website"}`, verified to resolve against the node the homepage
  actually defines.
- **Added `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">`.**
  `max-image-preview:large` is opt-in; without it Google restricts these pages to a small preview.

### Two process lessons worth keeping

1. **Fix the generator, not the output.** I patched the text in `public/llms.txt`, then re-ran
   `build-llms-prices.py`, which regenerated the block and silently reintroduced "in any pasta dish."
   The fix belongs in `scripts/build-llms-prices.py`.
2. **My own residual scan had a false-positive bug.** Grepping for `any pasta dish` matched inside
   "m*any pasta dish*es", so the gluten-free page looked dirty when it was clean. Re-ran with word
   boundaries. A verification script that cries wolf is worse than none.

Final live check, word-boundary aware, across all 11 public surfaces (homepage, llms.txt, breakfast,
party page, and all 7 landing pages): **every one clean.**

---

## Cycle 7 — 2026-07-29 — Jorge said "fix the issues you think I should fix"

Everything below is shipped and live-verified. I did not touch the Google Business Profile — that is
a live edit to Tommy's listing under his Google account, so it needs him or Jorge clicking it. Exact
steps are in the queue section.

### A submission channel that does not wait on Google

Google's crawl queue cannot be forced, and the stored GSC credential is read-only, so both sitemap
resubmission and Request Indexing return 403. **IndexNow is a push protocol that bypasses that
entirely** — one call reaches Bing (and therefore Copilot and DuckDuckGo), Yandex, Seznam and Naver.
Bing knew only a fraction of the site, so there was real headroom.

Generated a 32-char key, hosted it at `/a55f036be37024cafee7d006ca74b454.txt`, and wrote
`scripts/indexnow-submit.py` (reads the sitemap, has a `--dry-run`, explains the 403/202 cases).
First submission returned **202** (key pending validation); after confirming the key file served
`200` with `content-type: text/plain`, the resubmission returned **200 for all 12 URLs**.

To re-notify after any content change: `python3 scripts/indexnow-submit.py`.
**Google does not participate in IndexNow** — this does nothing for Google, and I am not going to
imply otherwise. Google still needs Request Indexing in the Search Console UI.

### The sitemap is now generated, not hand-maintained

`scripts/build-sitemap.py` discovers routes by walking `public/` and `index.html`. A hand-maintained
sitemap is exactly how `/pizza-party-long-branch/` shipped without an entry and stayed unknown to
Google, and that class of mistake is now impossible. `lastmod` comes from each file's own mtime, so
it reflects real change rather than the last time the script ran. It also **refuses to write** if any
URL's canonical disagrees with its sitemap entry.

The script caught something on its first run: it had picked up
`public/googlececb096098599354.html`, the **Search Console ownership-verification stub**. That file
must stay on disk — deleting it un-verifies Search Console — but it must never appear in the sitemap.
Added exclusion patterns for Google/Bing verification stubs and the IndexNow key. Now 12 URLs,
verification file still served (`200`), zero verification stubs in the sitemap.

### The mislabeled ratings badge — fixed by removal, not invention

Cycle 4 found the badge crediting Google's 4.3 to Restaurant Guru, whose own aggregate is 2.9/5.
Cycle 5 confirmed the 4.3 first-hand from Google. The clean fix would show Google's rating **with
Google's own review count** — but that count is only available from the GBP dashboard, and pairing
Google's score with Restaurant Guru's 130 would repeat the exact error. So I removed the tile rather
than invent a replacement.

- Homepage now shows **one** verified tile: Restaurantji 4.6/5, 86 reviews (re-verified live against
  their JSON-LD the same day). Checked in a browser: centered, clean, reads better than two.
- The seven landing-page hero trust lines now render only that tile.
- `llms.txt` now says **"Google: 4.3 / 5"** with an explicit note that the review count is withheld
  because it was not verified at the same source.
- `src/data/reviews.ts` carries a comment explaining precisely what was wrong and what to add once
  the real Google count is in hand — **never a score from one source with a count from another.**

The remaining "Restaurant Guru" mention on the homepage is attribution for where the review *themes*
were paraphrased from. That is accurate and stays.

### Homepage JSON-LD: 12 of 20 invented MenuItem descriptions removed

The homepage still carried 20 `MenuItem` descriptions while `menuGenerated.ts` has **zero**
description fields — the same invented-ingredient class stripped from the landing pages in cycle 2.
Rather than blanket-delete, I checked each against the item's real Clover option groups and
PRODUCT.md and kept the 8 that trace: Drunken Grandma, Bobby Boombotz, Grandma Pie, Vodka Pie, Vegan
Pizza, Bacon Egg & Cheese (its "Served On" group really does list Kaiser/bagel/wrap), The Gigi
Skillet (described in PRODUCT.md), and Full Stack Pancakes (its flavour group matches).

Removed the 12 with no source, including "Bee Sting — pepperoni pie finished with hot honey",
"Lobster Pie — premium seafood specialty pie", the full Western Omelette and Breakfast Burrito
ingredient lists, and two that said nothing at all ("Party hero that feeds a group").

Verified: JSON-LD parses, all 20 `MenuItem` nodes and all 20 `Offer` nodes intact, and the **price
set is byte-identical to before the edit** — I diffed it explicitly, because touching prices was the
one thing this edit must not do.

### Party page headings

It had **two `<h1>` elements**, each with its subtitle nested inside the heading text, and neither
contained "pizza party" or "Long Branch" — on the one URL Google has never crawled, where on-page
signals are all it has. Now a single `<h1>Kids' Pizza Parties in Long Branch</h1>`, subtitles moved
to sibling paragraphs with equivalent styling, and the second heading demoted to an `<h2>` that
looks identical.

---

## 2026-07-30 — VIP Club QR code for 20,000 printed menus

Tommy is printing 20,000 menus with a QR for VIP Club signup. A printed QR cannot be corrected, so
the bar here was "provably works", not "looks right".

**Encoded URL: `https://gigislongbranch.com/vip`** — short (fits in a version-4 code, so the modules
stay large and forgiving), on Gigi's own domain, no third-party shortener that could expire.

### The key design decision

`/vip` is a **permanent address that redirects**, not a page. So the destination can be repointed in
about a minute and all 20,000 menus keep working. That mattered immediately, because the first thing
I built did not survive testing.

I wrote a dedicated static landing page at `/vip/` with the full form. It could not be verified:
`window.turnstile` came back as an empty object there, so the bot-protection widget never rendered
and every submission would have failed `verification_failed`. The identical script works on the
homepage in the same browser, and I could not find the cause. **I was not willing to print 20,000
menus pointing at a signup path I could not prove works**, so `/vip` now redirects to the homepage
VIP form — the path that is already proven in production (it produced a real member on 2026-07-25).
The dedicated page is kept at `/vip-club/` for later; promoting it is a one-line redirect change,
with no reprint.

### A real bug this uncovered: the site ignored URL anchors

Arriving at `/#vip-club` left the visitor at the **top of a 15,924px homepage with the form 13,406px
below the fold**. Three separate causes, each hiding the next:

1. `scrollIntoView` + `scrollBy` did nothing, because the site CSS sets `scroll-behavior: smooth` —
   `scrollIntoView` starts an *animated* scroll and the immediate `scrollBy` cancels it and applies
   its delta from the top. Fixed with a single `scrollTo({behavior:"instant"})`.
2. `history.scrollRestoration` was `"auto"`, so the browser reset to the top after hydration. Now
   set to `"manual"` while the anchor scroll settles, then restored.
3. The correction was gated on `requestAnimationFrame`, which is throttled to zero in a
   non-foreground tab — so the very first attempt never ran. Proven by instrumentation: the effect
   ran (it had set `scrollRestoration`) but the scroll marker was never set. Now fires immediately
   and re-corrects on a timer for 2.5s as fonts and images settle.

This fixes every external anchor link into the site, not just the QR — `#menu`, `#breakfast`,
`#reviews` and the rest all landed at the top before.

Verified after the fix, on both desktop and a 375px mobile viewport: a scan lands with the VIP form
72px from the top of the screen.

### Verified before release

| Check | Result |
|---|---|
| SVG and PNG decode | both exactly `https://gigislongbranch.com/vip` |
| Damage tolerance | still decodes with **10% and 20%** of the code obscured (ECC level H) |
| URL chain | `307` → `/#vip-club`, final `200` |
| Landing position | form 72px from top of viewport, desktop **and** mobile |
| Signup form | present, all fields, Turnstile widget active with a live token |
| Signup API | live and validating — rejects bad phone, email, business; `405` on GET |
| Consent text | SHA-256 **identical** across `api/vip-signup.ts`, `VipClub.tsx` and the new page — a byte of drift would fail every signup with `consent_text_required` |

Files: `~/Desktop/gigis-vip-qr/` — SVG (vector master, give this to the printer), PDF, PNG, and a
`READ-ME-FIRST.txt` with the print rules (minimum 0.8in, keep the quiet zone, black on white, matte,
never on a fold).

**Not done: a full live signup.** Completing one would consume a household's one-per-household free
pie and fire a real text/email. Everything up to the final insert is verified, and this exact form
created a real member on 2026-07-25. If Tommy wants absolute certainty, he should scan the code and
sign himself up before the print run — that is the last untested inch.

---

## Standing items for Jorge / Tommy

## Cycle 8 — 2026-07-30 — Verification pass: one real bug found and fixed

Jorge asked for a verification run rather than new work. Ran the whole surface end to end.

### The bug the verification caught

**The sitemap was not idempotent, and it was lying to Google.** `lastmod` was derived from each
file's mtime, so simply re-running the page generator — which rewrites every file with identical
content — moved the dates. The clock had passed midnight since cycle 7, which made it obvious:
regenerating byte-identical pages advanced **all seven landing pages to 2026-07-30**, announcing
changes that never happened. Google explicitly discounts `lastmod` on sites where it proves
unreliable, so this was actively corroding the one crawl signal we can send.

Fixed: `lastmod` now tracks **content**, not file writes. Each page's meaningful markup is hashed
into `sitemap-manifest.json` and the date only advances when that hash actually changes. Proven:
regenerating all seven landing pages now leaves the sitemap **byte-identical** and the script
reports "no content changed — every lastmod left exactly as it was."

### The guards were tested, not assumed

Deliberately injected a fake menu item ("Unicorn Pie") into `data/landing-pages.json` and re-ran the
build. It **refused to build**: *"'Unicorn Pie' is not a real item or modifier in the Clover menu.
Fix data/landing-pages.json — do not invent prices."* The price guard genuinely guards. Restored.

### Everything else verified green

| Check | Result |
|---|---|
| All 12 sitemap URLs | 200, each with a matching self-canonical |
| robots.txt + sitemap reference | reachable, correct |
| IndexNow key file | 200, and resubmission returned **200 for 12 URLs** |
| GSC verification stub | still served 200, and correctly **absent** from the sitemap |
| IndexNow key | correctly **absent** from the sitemap |
| Font cache headers | all three `public, max-age=31536000, immutable` |
| Third-party font requests on landing pages | **0** |
| JSON-LD on every page | parses; no page re-declares a Restaurant property |
| `<h1>` count | exactly 1 on every page checked, including the party page |
| Unsupported claims across all 13 surfaces | **0**, word-boundary aware |
| **Live price rows re-checked against Clover** | **45 of 45 exact**, plus 4/4 in llms.txt |
| Homepage MenuItem descriptions | 8 (the traceable ones), Offer nodes still 20 — prices intact |
| Rating tiles | Restaurantji only, on homepage and all landing heroes |
| WCAG reflow (`nowrap` on hours cells) | gone from every page |

### An honest observation, not a win

`/pizza-delivery-elberon/` moved from "Discovered — currently not indexed" to **"URL is unknown to
Google"** — it went *backwards*. I checked whether we broke something: it is in the sitemap, returns
200, is linked from the homepage footer **and from 10 places across its six sibling pages**, has a
correct self-canonical, is `index, follow`, and is not disallowed in robots.txt. Nothing on our side
is wrong. This is Google's own record of the URL regressing, which reinforces the conclusion this log
keeps arriving at: **the bottleneck is Google's crawl scheduling, not the pages.** Two URLs are now
"unknown", two remain "discovered but not crawled", and the sitemap has still not been re-read.

That is precisely why cycle 7 added IndexNow — Bing and the others accept a push. Google does not
participate, and only Request Indexing in the Search Console UI will move it.

---

### The two things only Tommy or Jorge can do — exact steps

**1. Reclaim the "Order online" button (highest-value action in this entire project).**

1. Sign in at <https://business.google.com> as a manager of **"Gigi's Pizza Long Branch"**
   (note: that is the profile's name — not "Gigi's NY Style Pizza & Restaurant").
2. Open the profile → **Edit profile** → **Ordering** (may appear as "Food ordering links" or under
   *Info → Order ahead*).
3. Google will list the nine third-party providers it currently offers. Add
   **`https://gigislongbranch.com/#menu`** as an ordering link.
4. Find the toggle that lets the business prefer its own link — Google surfaces this as
   *"Preferred by business"*, which is the label **Slice currently carries**. Move it to Gigi's link.
5. If the option is missing, it is usually because the third-party links come from Gigi's POS/Slice
   integration. In that case the same screen has a **"Remove"** or **"Manage links"** control, and the
   Slice listing itself has to stop syndicating the ordering link.
6. Verify from a phone, signed out: search "Gigi's Pizza Long Branch", tap **Order online**, and
   confirm gigislongbranch.com appears first.

**2. While you are in there, capture the Google review count.** The rating is 4.3 (I read it
first-hand from Maps) but the count is only in the dashboard. Send it to me and I will put a properly
attributed "★ 4.3 Google (N)" tile back on the site — the tile is removed right now precisely because
I would not guess at N.

Optional in the same session: consider whether the profile name should be
"Gigi's NY Style Pizza & Restaurant" to match the site, the schema and every other listing.

---

- 🔴🔴 **DO THIS FIRST — add gigislongbranch.com to the Google Business Profile's food-ordering
  links and make it the preferred provider.** Google's "Order online" button currently offers nine
  middlemen (Slice marked "Preferred by business", EatStreet at an 18% service fee, DoorDash,
  Grubhub, Seamless, Uber Eats, Postmates, RestaurantDirect, order.online) and does **not** list
  Gigi's own site. Every order placed through that button pays a commission that Gigi's own system
  would not charge, and the tickets already print in Gigi's kitchen. Nothing in this repo can fix
  it; it is a few minutes in the GBP dashboard. This is worth more than every on-page change in
  this log combined.
- 🔴 **The Google Business Profile name is "Gigi's Pizza Long Branch"** while the site, its schema
  and its `sameAs` all say "Gigi's NY Style Pizza & Restaurant." Google is the authority customers
  see, so either the GBP gets renamed or the site aligns to it — but they should not disagree.
  Owner action + Google review required.
- 🔴 **HIGHEST PRIORITY — the Restaurant Guru trust badge is mislabeled on 8 live pages.** It shows
  "★ 4.3 Restaurant Guru (130)", but 4.3 is *Google's* rating that Restaurant Guru republishes,
  while Restaurant Guru's own aggregate is **2.9/5**. The 130 is their review count. Three ways to
  make it honest, and it is Jorge's call which: (a) relabel it "★ 4.3 Google" and drop Restaurant
  Guru — cleanest, and Google is the rating customers care about, but the count should then be
  Google's ~120, not 130; (b) show Restaurant Guru accurately at 2.9, which nobody will want;
  (c) drop the Restaurant Guru tile entirely and keep only Restaurantji 4.6/86, which is verified
  correct. My recommendation is (a), sourced from the GBP directly so the count is right too. Until
  he decides I have left it exactly as-is rather than silently changing how his ratings read.
- **Google Business Profile** is almost certainly the bigger lever than anything in this repo for
  a local pizzeria, and it is in scope via Chrome. Cycle 2 target. Specifically: confirm the
  profile's website field points at gigislongbranch.com (not Slice), that hours match the
  owner-confirmed set, and that the "Order online" action links to the owned site.
- **Reclaim the brand search result from Slice.** Needs the owner's decisions, so queuing rather
  than acting: whether to keep the Slice listing at all now that Gigi's has its own ordering
  stack, and whether to correct or remove the Grubhub / Seamless / EatStreet listings (the
  EatStreet one has Gigi's filed under New Brunswick). Wrong hours on those listings are actively
  costing walk-ins.
- **Search Console needs one manual action.** Re-submit the sitemap and use "Request Indexing" on
  `/gluten-free-pizza-long-branch/`, `/pizza-delivery-elberon/`, `/pizza-delivery-pier-village/`
  and `/pizza-party-long-branch/`. Cannot be scripted — the stored token is read-only. Either
  re-auth with the `webmasters` write scope, or do it in the UI.
- Pre-existing on the landing-page heroes: trust badges reading "4.6 Restaurantji (86)" and
  "4.3 Restaurant Guru (130)". These predate this loop. Worth confirming they're still accurate,
  since stale third-party rating counts are a real liability on a live business site.
- Five Unsplash placeholder images remain instead of real dish photos.
