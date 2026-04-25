# Image Sources — Gigi's NY Style Pizza (Long Branch)

**Status: ALL IMAGERY IS PLACEHOLDER.** The site ships today with licensed Unsplash food photography. These are staging images only. **Replace with owner-approved Long Branch photography before launch.**

## Why placeholders instead of real photos

On 2026-04-24 research, three real-photo sources were identified:

1. **Yelp** — the Long Branch listing has **155 photos** (mix of customer + business uploads). Yelp returned HTTP 403 on direct fetch, so image URLs weren't extractable in this pass.
2. **Restaurantji** — the Long Branch listing has **28 photos**. Customer uploads, mixed quality.
3. **Instagram @gigisnystylepizza** and **Facebook @gigispizzasb** — both contain verified Long-Branch-specific content (videos + posts with "140 Brighton" captions). Instagram does not permit hotlinking images without an API token and Meta's terms restrict scraping.

**None of these sources can be legally scraped and directly embedded** on a third-party site without either (a) owner permission for business-uploaded assets, or (b) explicit uploader permission for customer-generated content. The clean path is to get originals from the owner.

## Placeholder images currently live on the site

All sourced from [Unsplash](https://unsplash.com), which provides a license for free commercial and non-commercial use without attribution (attribution kept below as best practice).

### Hero image (owner-provided, graded)
- **Source:** `~/Desktop/new-york-pizza-slice-pull.jpeg` — provided by owner 2026-04-24
- **Depicts:** Hand lifting a generous NY cheese slice from a whole pie with cheese pull
- **Graded variants in `src/assets/brand/`:**
  - `slice-hero-wide.jpg` (1920×1080) — desktop hero
  - `slice-hero-portrait.jpg` (1080×1620) — mobile hero
  - `slice-full.jpg` (3809×2000) — largest variant
  - `slice-tile.jpg` (800×1000) — gallery tile
- **Grade applied:** bilateral denoise + CLAHE + warm curves + saturation +20% + contrast +10% + clarity stack + unsharp + subtle vignette
- **Status:** LIVE. Source resolution was 1200×630 so the upscaled variants may look slightly soft on 4K displays — owner can supply a higher-res original to replace.

### Gallery images (`src/data/gallery.ts` — GALLERY)

| # | Caption | Source | Notes |
|---|---|---|---|
| 1 | **Classic NY Cheese** | `slice-tile.jpg` (owner-provided) | Owner-provided, graded |
| 2 | **The 'Fanz' Specialty** | `fanz-tile.jpg` (owner-provided) | Owner-provided, graded |
| 3 | **Inside the Shop** | `sign-tile.jpg` (owner-provided) | Owner-provided GIGI'S marquee |
| 4 | **Dine In** | `inside-tile.jpg` (owner-provided) | Owner-provided dining room |
| 5 | **NY Pepperoni** | Unsplash `photo-1628840042765-356cda07504e` | Placeholder — classic NY pepperoni whole pie |
| 6 | **Buffalo Wings** | Unsplash `photo-1608039755401-742074f0548d` | Placeholder — saucy wings + blue cheese |
| 7 | **Mozzarella Sticks** | Unsplash `photo-1531749668029-2db88e4276c7` | Placeholder — fried breaded sticks (slightly unusual composition, recommend owner replace) |
| 8 | Fresh Heroes | Unsplash `photo-1528735602780-2552fd46c7af` | Placeholder |
| 9 | Pasta Dinners | Unsplash `photo-1621996346565-e3dbc646d9a9` | Placeholder |

**NY-style pizza rule (owner directive 2026-04-24):** any tile that represents pizza MUST be NY style. Tile #5 was swapped from Italian-style specialty pie (`photo-1574071318508`) to NY pepperoni whole pie (`photo-1628840042765`) to honor this.

Full URL pattern for placeholders: `https://images.unsplash.com/<photo-id>?w=1600&q=80&auto=format&fit=crop`

### Favicon (`public/favicon.svg`)
- Custom SVG (hand-drawn pizza mark in brand colors) — not a photo, owner-safe.

## Non-placeholder visual assets (owner-provided required)

The following image slots are defined in the codebase but should be filled with **real Gigi's photography** before launch:

1. **`public/og-image.jpg`** — Open Graph + Twitter card share image (1200×630). Referenced in `index.html`. File does not yet exist — must be created/supplied. Recommendation: a hero shot of the signature pie, text-overlay-free, centered subject.
2. **All gallery tiles** — replace all 6 Unsplash images with real Long Branch food shots.
3. **Hero background** — replace with a tall vertical oven-shot or storefront shot.

## Recommended image shoot list (for owner photo session)

A photo shoot or curated IG pull should produce, at minimum:

- 1× hero shot (whole pie, top-down or 3/4 angle, natural light, high resolution)
- 1× Grandma pie (top-down)
- 1× specialty pie — The Money Pizza or Famous Pepi-Roni
- 1× cheese slice (the classic sell)
- 1× Italian hero (Chicken or Meatball Parm)
- 1× pasta dinner (Penne Alla Vodka is a good single-plate hero)
- 1× appetizer (garlic knots or mozzarella sticks)
- 1× salad
- 1× storefront / Brighton Ave exterior
- 1× interior / counter / oven detail

Resolution target: **2400px** on the long edge minimum. File format: JPG at 80-85% quality, or WebP.

## Observed-but-not-embedded image sources

For reference only. Do not hotlink; use only with explicit permission:

- **Instagram @gigisnystylepizza** — Long-Branch-specific reels observed:
  - https://www.instagram.com/gigisnystylepizza/reel/CfaPjk1PHBv/
  - https://www.instagram.com/gigisnystylepizza/reel/Cv0ijJkAwEy/
  - https://www.instagram.com/gigisnystylepizza/p/Ce1haVmJfLL/
- **Facebook @gigispizzasb** — Long-Branch-specific videos:
  - https://www.facebook.com/gigispizzasb/videos/1268823650876947/
  - https://www.facebook.com/gigispizzasb/videos/912305320970707/
- **Yelp listing** (155 photos): https://www.yelp.com/biz/gigi-s-ny-style-pizza-and-restaurant-long-branch
- **Restaurantji listing** (28 photos): https://www.restaurantji.com/nj/long-branch/gigis-ny-style-pizza-and-restaurant-lb-/

## Attribution / licensing

- **Unsplash images:** licensed under the [Unsplash License](https://unsplash.com/license). Attribution is appreciated, not legally required, but Unsplash photographer names are available at each photo URL if the restaurant wants to credit them.
- **Restaurant-owned images:** all rights reserved to Gigi's NY Style Pizza.
- **Customer-generated images** (Yelp, IG tags): rights remain with the uploader; do not embed without their permission.

## Replacement workflow

When real photos arrive:

1. Save files into `src/assets/food/` (create the folder).
2. Import them at the top of `src/data/gallery.ts` (e.g., `import heroPhoto from "../assets/food/hero.jpg"`).
3. Replace Unsplash URLs with imports. Vite will handle optimization + hashing at build time.
4. Delete the `credit: "Unsplash (placeholder)"` strings.
5. Flip `GALLERY_IS_PLACEHOLDER` in `gallery.ts` to `false`.
6. Rebuild: `npm run build`.
