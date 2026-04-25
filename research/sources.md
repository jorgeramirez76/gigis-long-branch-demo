# Sources — Gigi's NY Style Pizza (Long Branch)

All research pulled **2026-04-24**. This document lists every URL consulted and its role in the build. Sites that returned errors are noted so future passes know to retry.

## Confirmed primary sources

### Official / restaurant-controlled
- https://www.gigisnystylepizza.com/ — home (multi-location marketing site)
- https://www.gigisnystylepizza.com/menu — menu page (does not print items + prices)
- https://www.gigisnystylepizzarestaurant.com/ — Long-Branch-specific subdomain referenced in search; did not resolve at fetch time (`ECONNREFUSED`). Worth retrying.
- https://www.instagram.com/gigisnystylepizza/ — public IG (covers multiple locations)
  - Long-Branch-specific posts observed:
    - https://www.instagram.com/gigisnystylepizza/reel/CfaPjk1PHBv/ ("Gigi's Long Branch now open! 140 …")
    - https://www.instagram.com/gigisnystylepizza/reel/Cv0ijJkAwEy/ ("Come on down to Gigi's in Long…")
    - https://www.instagram.com/gigisnystylepizza/p/Ce1haVmJfLL/ ("GiGi's Long Branch…")
- https://www.facebook.com/gigispizzasb/ — public FB page (handle reads "sb" but contains Long-Branch-specific videos)
  - https://www.facebook.com/gigispizzasb/videos/1268823650876947/ — "This is at 140 Brighton avenue, Long Branch right now"
  - https://www.facebook.com/gigispizzasb/videos/912305320970707/ — "Gigis long branch 140 Brighton ave 732/377/2468"

### Menu + pricing
- **Primary menu source:** https://slicelife.com/restaurants/nj/long-branch/07740/gigi-s-ny-style-pizza-restaurant/menu — full item list with prices, successfully fetched
- Cross-check source: https://www.ubereats.com/store/gigis-ny-style-pizza/CWb8PzzGRGuaw9RGJc1OQQ — item list + prices, with markup vs Slice

### Hours, address, ratings
- https://www.restaurantji.com/nj/long-branch/gigis-ny-style-pizza-and-restaurant-lb-/ — hours, address, rating 4.6 (84 reviews), 28 photos
- https://restaurantguru.com/Gigis-NY-Style-Pizza-and-Restaurant-Long-Branch — hours, address, rating 4.3 (125 votes), ranking #17 of 221
- https://maps.roadtrippers.com/us/long-branch-nj/food-drink/gigi-s-ny-style-pizza-restaurant — address confirmation

### Reviews + sentiment
- https://www.findmeglutenfree.com/biz/gigis/4913017843744768 — gluten-free cross-contact feedback

## Sources consulted but blocked / incomplete

These returned a redirect, 403, 429, 402, or placeholder content. Worth retrying from a different network or with different headers on a future pass.

- https://www.yelp.com/biz/gigi-s-ny-style-pizza-and-restaurant-long-branch — 403 on direct fetch. Metadata (photo count = 155, review count = 14) captured from search snippets.
- https://www.doordash.com/store/gigi%E2%80%99s-pizza-long-branch-long-branch-23600776/ — 403
- https://postmates.com/store/gigis-ny-style-pizza/CWb8PzzGRGuaw9RGJc1OQQ — 403
- https://www.seamless.com/menu/gigis-pizza-long-branch-140-brighton-ave-long-branch/3358496 — placeholder content
- https://eatstreet.com/new-brunswick-nj/restaurants/gigis-ny-style-pizza-and-restaurant-brighton-ave — placeholder content
- https://www.toogoodtogo.com/en-us/find/longbranch/gigisnystylepizzaandrestaurant/meal/surprisebag-907067 — 429 rate limit. Confirms "surprise bag" program exists.
- https://www.menupix.com/newjersey/restaurants/32520106/GiGis-NY-Style-Pizza-and-Restaurant-Long-Branch-NJ — 402
- https://www.gigisnystylepizza.com/contact — 404

## Sources intentionally EXCLUDED from this site

These reference other Gigi's locations and are excluded per project scope (Long Branch only).

- Sea Bright — Dave Portnoy 7.4 review (excluded):
  - https://wrat.com/2024/07/28/dave-portnoy-visits-jersey-shore-pizza-joints/
  - https://nj1015.com/dave-portnoy-visits-jersey-shore-pizzeria-in-great-small-town/
  - https://www.aol.com/dave-portnoy-rates-gigis-york-010845313.html
- Oceanport — permanently closed, no references included.

## Owner-confirmed claims used on the site

- **"Voted one of the top pizzas in New Jersey"** — confirmed by Gigi's Long Branch ownership on 2026-04-24 during the site build. The originating publication / year was not isolated during the research pass but the claim is authorized by the restaurant for publication. Appears in the Hero badge, About-section recognition callout, meta description, and Schema.org `award` field. Owner should supply the originating publication + date when convenient so it can be cited precisely.

## Pending owner-confirm items

Before launch, the Long Branch owner should confirm:

1. **Canonical phone number** — (732) 377-2468 used site-wide. Slice lists 732-702-5821 as an alternate (likely Slice-routed); not published on site.
2. **Email address** — `gigispizzalb@gmail.com` surfaced in one snippet. Not published until confirmed.
3. **Hero copy / brand story / taglines** — no verified "about us" copy was found on the official site. Current About copy on the new site uses only the plain-fact description from the project brief. Tommy should supply a real brand story when ready.
4. **Real photography** — all imagery currently used is licensed Unsplash placeholder (see `image-sources.md`). Replace with owner-approved Long Branch photos before launch.
5. **Social handles** — consider a Long-Branch-specific IG handle. Current IG and FB cover multiple locations.
6. **Accolade verification** — "voted top 20 pizza in NJ" is only listed here for future research, not on the site.

## Research pass metadata

- **Date pulled:** 2026-04-24
- **Tools used:** WebFetch + WebSearch (no browser automation)
- **Duration:** ~5 minutes
- **Blocked sources:** see list above — retry on a future pass
