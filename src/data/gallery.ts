/**
 * Gallery images — owner-provided brand photos first, Unsplash placeholders
 * only for dish categories we don't yet have real photos for.
 */

// Owner-provided brand photos — Vite hashes + optimises at build
import sliceHeroWide from "../assets/brand/slice-hero-wide.jpg";
import sliceHeroPortrait from "../assets/brand/slice-hero-portrait.jpg";
import sliceFull from "../assets/brand/slice-full.jpg";
import sliceTile from "../assets/brand/slice-tile.jpg";
import fanzTile from "../assets/brand/fanz-tile.jpg";
import fanzFull from "../assets/brand/fanz-full.jpg";
import signTile from "../assets/brand/sign-tile.jpg";
import insideTile from "../assets/brand/inside-tile.jpg";
import insideWide from "../assets/brand/inside-wide.jpg";
// WebP candidates (900w/480w, generated 2026-09-06 from the JPEGs above, quality 80).
// The JPEGs stay as the fallback; on the home page they were 1.6 MB of the 2.7 MB total.
import sliceHeroWideW900 from "../assets/brand/slice-hero-wide-900.webp";
import sliceHeroWideW480 from "../assets/brand/slice-hero-wide-480.webp";
import sliceHeroPortraitW900 from "../assets/brand/slice-hero-portrait-900.webp";
import sliceHeroPortraitW480 from "../assets/brand/slice-hero-portrait-480.webp";
import sliceFullW900 from "../assets/brand/slice-full-900.webp";
import sliceFullW480 from "../assets/brand/slice-full-480.webp";
import sliceTileW900 from "../assets/brand/slice-tile-900.webp";
import sliceTileW480 from "../assets/brand/slice-tile-480.webp";
import fanzTileW900 from "../assets/brand/fanz-tile-900.webp";
import fanzTileW480 from "../assets/brand/fanz-tile-480.webp";
import fanzFullW900 from "../assets/brand/fanz-full-900.webp";
import fanzFullW480 from "../assets/brand/fanz-full-480.webp";
import signTileW900 from "../assets/brand/sign-tile-900.webp";
import signTileW480 from "../assets/brand/sign-tile-480.webp";
import insideTileW900 from "../assets/brand/inside-tile-900.webp";
import insideTileW480 from "../assets/brand/inside-tile-480.webp";
import insideWideW900 from "../assets/brand/inside-wide-900.webp";
import insideWideW480 from "../assets/brand/inside-wide-480.webp";

export type GalleryImage = {
  src: string;
  /** WebP srcset candidates (900w, 480w) — roughly a third of the JPEG bytes. */
  webp?: string;
  alt: string;
  caption: string;
  credit: string;
  aspect?: "portrait" | "landscape" | "square";
};

export const GALLERY_IS_PLACEHOLDER = false;

export const HERO_IMAGE = {
  srcPortrait: sliceHeroPortrait,
  srcWide: sliceHeroWide,
  webpPortrait: `${sliceHeroPortraitW900} 900w, ${sliceHeroPortraitW480} 480w`,
  webpWide: `${sliceHeroWideW900} 900w, ${sliceHeroWideW480} 480w`,
  srcFull: sliceFull,
  alt: "Hand lifting a generous New York style cheese slice from a whole pie at Gigi's Long Branch",
  credit: "Gigi's NY Style Pizza — Long Branch",
};

export const BRAND_INSIDE = {
  tile: insideTile,
  wide: insideWide,
  webpTile: `${insideTileW900} 900w, ${insideTileW480} 480w`,
  webpWide: `${insideWideW900} 900w, ${insideWideW480} 480w`,
};

// Gallery tile order — real brand photos lead, Unsplash fills category gaps
export const GALLERY: GalleryImage[] = [
  {
    src: sliceTile,
    webp: `${sliceTileW900} 900w, ${sliceTileW480} 480w`,
    alt: "Hand lifting a big New York cheese slice from a whole pie",
    caption: "Classic NY Cheese",
    credit: "Gigi's NY Style Pizza — Long Branch",
    aspect: "portrait",
  },
  {
    src: fanzTile,
    webp: `${fanzTileW900} 900w, ${fanzTileW480} 480w`,
    alt: "The Fonz specialty pizza — pepperoni, sausage and ricotta dollops on a silver pan",
    caption: "The 'Fonz' Specialty",
    credit: "Gigi's NY Style Pizza — Long Branch",
    aspect: "portrait",
  },
  {
    src: signTile,
    webp: `${signTileW900} 900w, ${signTileW480} 480w`,
    alt: "Illuminated GIGI'S marquee letters on the dining room brick wall",
    caption: "Inside the Shop",
    credit: "Gigi's NY Style Pizza — Long Branch",
    aspect: "portrait",
  },
  {
    src: insideTile,
    webp: `${insideTileW900} 900w, ${insideTileW480} 480w`,
    alt: "Gigi's dining room with string lights, tables and the red accent wall",
    caption: "Dine In",
    credit: "Gigi's NY Style Pizza — Long Branch",
    aspect: "portrait",
  },
  {
    src: "https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&q=70&auto=format&fit=crop",
    alt: "New York style pepperoni pizza on a wood board — thin crust, crispy pepperoni, bubbled cheese",
    caption: "NY Pepperoni",
    credit: "Unsplash (placeholder)",
    aspect: "portrait",
  },
  {
    src: "https://images.unsplash.com/photo-1608039755401-742074f0548d?w=800&q=70&auto=format&fit=crop",
    alt: "Bowl of classic buffalo wings tossed in hot sauce with blue cheese dip on the side",
    caption: "Buffalo Wings",
    credit: "Unsplash (placeholder)",
    aspect: "portrait",
  },
  {
    src: "https://images.unsplash.com/photo-1531749668029-2db88e4276c7?w=800&q=70&auto=format&fit=crop",
    alt: "Breaded mozzarella sticks golden-fried",
    caption: "Mozzarella Sticks",
    credit: "Unsplash (placeholder)",
    aspect: "portrait",
  },
  {
    src: "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=800&q=70&auto=format&fit=crop",
    alt: "Italian hero sandwich with fresh ingredients",
    caption: "Fresh Heroes",
    credit: "Unsplash (placeholder)",
    aspect: "portrait",
  },
  {
    src: "https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=800&q=70&auto=format&fit=crop",
    alt: "Classic Italian pasta dinner with red sauce",
    caption: "Pasta Dinners",
    credit: "Unsplash (placeholder)",
    aspect: "portrait",
  },
];

/** Signature items with REAL owner-provided photos, shown in the Fan Favorites
 * band that leads into the full menu. Only items we have a genuine Long Branch
 * photo for appear here. `menuName` is the exact Clover item name; the price is read from
 * the menu at render time (FanFavorites.tsx) so this file can never quote a stale number.
 * Add more cards as the owner supplies more real dish photography. */
export const FAVORITES = [
  {
    src: sliceFull,
    webp: `${sliceFullW900} 900w, ${sliceFullW480} 480w`,
    name: "Classic NY Cheese Pie",
    menuName: "Plain Pie",
    blurb: "Hand-stretched dough, house tomato sauce, fresh mozzarella — that perfect foldable New York slice.",
    alt: "Hand lifting a New York style cheese slice from a whole pie at Gigi's Long Branch",
  },
  {
    src: fanzFull,
    webp: `${fanzFullW900} 900w, ${fanzFullW480} 480w`,
    name: "The Fonz",
    menuName: "The Fonz",
    blurb: "The specialty square everyone on Brighton Ave asks for by name.",
    alt: "The Fonz specialty pizza from Gigi's NY Style Pizza, Long Branch",
  },
];
