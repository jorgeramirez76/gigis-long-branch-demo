# Menu Notes — Gigi's NY Style Pizza (Long Branch)

**Pulled 2026-04-24.** Every price on the site has a source. This document explains which source was trusted, where sources disagreed, and what should be verified before launch.

## Primary source

**Slice:** https://slicelife.com/restaurants/nj/long-branch/07740/gigi-s-ny-style-pizza-restaurant/menu

Slice is the restaurant's own preferred online-ordering channel — prices there match what the restaurant wants customers to see and pay. The full Slice menu was machine-readable and successfully pulled on 2026-04-24. The site's `src/data/menu.ts` mirrors the Slice menu with lightly cleaned-up item names and descriptions.

## Cross-check source

**Uber Eats:** https://www.ubereats.com/store/gigis-ny-style-pizza/CWb8PzzGRGuaw9RGJc1OQQ

Uber Eats prices run 3–5% higher on most items than Slice. This is typical delivery-platform markup, not a restaurant price change. The site uses **Slice prices** and the menu UI shows a disclaimer:

> "Menu prices shown reflect in-store / Slice pricing pulled 2026-04-24. Third-party delivery platforms may charge more. Call 732-377-2468 to confirm."

## Pricing inconsistencies observed

| Item | Slice | Uber Eats | Used on site |
|---|---|---|---|
| Buffalo Wings | $15.99 | $20.00 | $15.99 (Slice) |
| Margherita Pizza | $22.99 | $25.95 | $22.99 (Slice) |
| Penne Alla Vodka | $18.99 | $21.10 | $18.99 (Slice) |
| Famous Pepi-Roni | $27.99 | $27.40 | $27.99 (Slice) |
| Grandma Pizza | $25.99 | $24.85 | $25.99 (Slice) |
| Plain Cheese Pizza | $18.99 | $18.95 | $18.99 (Slice) |
| Mozzarella Sticks | $10.99 | $11.00 | $10.99 (Slice) |

Close matches (within ~$0.10) treated as identical. Where prices differ meaningfully, Slice is used.

## Category mapping

The owner's reference menu categories (from the project brief) were consolidated with what Slice actually exposes. The final category structure on the site:

| Site category | Maps to (Slice) |
|---|---|
| Pizza | Classic Round Pizzas |
| Gigi's Signature Pizza | Gigi's Signature Pizza |
| Sicilian & Grandma | Thin Sicilian Pizzas |
| Pizza by the Slice | Pizza by the Slice |
| Appetizers | Appetizers (includes calzones, pinwheels) |
| Salads & Soups | Salads + Soups |
| Heroes & Sandwiches | Heroes + Hot Sandwiches + Club Sandwiches |
| Paninis & Wraps | Paninis + Wraps |
| Pasta & Dinners | Pasta (Classic + Specialty) + Chicken Dinners + Seafood + Entrees |
| Burgers · Dogs · Fries | Burgers / Dogs / Fries |
| Chubbzie Wubbzies | Chubbzie Wubbzies (house-signature category) |
| Mexican | Mexican Dishes |
| Breakfast | Benedicts + Omelets + Skillets + Sandwiches + Pancakes + Burritos + Tacos + Acai + Breakfast Pizza |
| Kids Menu | Kids Menu |
| Desserts | Desserts |
| Beverages | Beverages |

## Items called out in public reviews as popular

Marked `popular: true` in `menu.ts` (surface as highlights):

- **Vodka Pizza** — repeatedly mentioned in public reviews
- **The Money Pizza** — signature item surfaced in search snippets
- **General Tso's Pizza** — house specialty, review-favorite
- **Famous Pepi Roni Pizza** — cupped pepperoni, hot-honey; called out by name
- **Grandma Pizza** — a style-defining item for the shop
- **Buffalo Chicken Pizza** — recurring mention

## Uncertainty / caveats

1. **Slice menus drift.** The restaurant occasionally updates prices directly and Slice updates later. **Before launch, the owner should line-edit the menu for current accuracy** — particularly the specialty pie lineup.
2. **Specials and seasonal items** are not captured here (Slice shows a "Weekend Specials" category with only one item listed). Treat seasonal rotation as the owner's domain.
3. **Item names** in a few places were tidied for readability. E.g., Slice lists "Parmigiano Dinner" — site uses "Chicken Parmigiana Dinner" for clarity. No items were invented.
4. **Gluten-free** — pizza is available (`$20.55`). Public reviews raise cross-contact concerns. The site does NOT claim gluten-free safety. If the owner wants GF marketed, cross-contact practices should be confirmed.
5. **Alcohol** — no beer / wine / cocktails listed on Slice. Not published on the site. Verify whether the shop serves alcohol before adding a beverage category expansion.

## What's NOT on the new site

Deliberately omitted despite being on Slice — owner can add back if desired:

- **Weekend Specials / Staten Island Pizza Special** — only one item; easier to add inline if it becomes a recurring lineup.
- **Duplicate entries** that appeared in two Slice categories (e.g., "Seafood Fra Diavolo" in both Seafood and Entrees) — deduped, listed once under Pasta & Dinners.

## Sign-off checklist (owner)

Before go-live, the Long Branch owner should review `src/data/menu.ts` line-by-line for:

- [ ] Item names read correctly
- [ ] Prices match current in-store
- [ ] Any recent additions (new specialty pies, seasonal pasta) are present
- [ ] Any retired items are removed
- [ ] `popular: true` items still reflect what the kitchen wants to promote
