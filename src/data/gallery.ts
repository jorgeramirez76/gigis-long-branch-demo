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

export type GalleryImage = {
  src: string;
  alt: string;
  caption: string;
  credit: string;
  aspect?: "portrait" | "landscape" | "square";
};

export const GALLERY_IS_PLACEHOLDER = false;

export const HERO_IMAGE = {
  srcPortrait: sliceHeroPortrait,
  srcWide: sliceHeroWide,
  srcFull: sliceFull,
  alt: "Hand lifting a generous New York style cheese slice from a whole pie at Gigi's Long Branch",
  credit: "Gigi's NY Style Pizza — Long Branch",
};

export const BRAND_INSIDE = {
  tile: insideTile,
  wide: insideWide,
};

// Gallery tile order — real brand photos lead, Unsplash fills category gaps
export const GALLERY: GalleryImage[] = [
  {
    src: sliceTile,
    alt: "Hand lifting a big New York cheese slice from a whole pie",
    caption: "Classic NY Cheese",
    credit: "Gigi's NY Style Pizza — Long Branch",
    aspect: "portrait",
  },
  {
    src: fanzTile,
    alt: "The Fanz specialty pizza — pepperoni, sausage and ricotta dollops on a silver pan",
    caption: "The 'Fanz' Specialty",
    credit: "Gigi's NY Style Pizza — Long Branch",
    aspect: "portrait",
  },
  {
    src: signTile,
    alt: "Illuminated GIGI'S marquee letters on the dining room brick wall",
    caption: "Inside the Shop",
    credit: "Gigi's NY Style Pizza — Long Branch",
    aspect: "portrait",
  },
  {
    src: insideTile,
    alt: "Gigi's dining room with string lights, tables and the red accent wall",
    caption: "Dine In",
    credit: "Gigi's NY Style Pizza — Long Branch",
    aspect: "portrait",
  },
  {
    src: "https://images.unsplash.com/photo-1628840042765-356cda07504e?w=1600&q=80&auto=format&fit=crop",
    alt: "New York style pepperoni pizza on a wood board — thin crust, crispy pepperoni, bubbled cheese",
    caption: "NY Pepperoni",
    credit: "Unsplash (placeholder)",
    aspect: "portrait",
  },
  {
    src: "https://images.unsplash.com/photo-1608039755401-742074f0548d?w=1600&q=80&auto=format&fit=crop",
    alt: "Bowl of classic buffalo wings tossed in hot sauce with blue cheese dip on the side",
    caption: "Buffalo Wings",
    credit: "Unsplash (placeholder)",
    aspect: "portrait",
  },
  {
    src: "https://images.unsplash.com/photo-1531749668029-2db88e4276c7?w=1600&q=80&auto=format&fit=crop",
    alt: "Breaded mozzarella sticks golden-fried",
    caption: "Mozzarella Sticks",
    credit: "Unsplash (placeholder)",
    aspect: "portrait",
  },
  {
    src: "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=1600&q=80&auto=format&fit=crop",
    alt: "Italian hero sandwich with fresh ingredients",
    caption: "Fresh Heroes",
    credit: "Unsplash (placeholder)",
    aspect: "portrait",
  },
  {
    src: "https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=1600&q=80&auto=format&fit=crop",
    alt: "Classic Italian pasta dinner with red sauce",
    caption: "Pasta Dinners",
    credit: "Unsplash (placeholder)",
    aspect: "portrait",
  },
];

/** Signature items with REAL owner-provided photos, shown in the Fan Favorites
 * band that leads into the full menu. Only items we have a genuine Long Branch
 * photo for appear here — prices mirror the live Clover menu (src/data/menu.ts).
 * Add more cards as the owner supplies more real dish photography. */
export const FAVORITES = [
  {
    src: sliceFull,
    name: "Classic NY Cheese Pie",
    price: "$17.68",
    blurb: "Hand-stretched dough, house tomato sauce, fresh mozzarella — that perfect foldable New York slice.",
    alt: "Hand lifting a New York style cheese slice from a whole pie at Gigi's Long Branch",
  },
  {
    src: fanzFull,
    name: "The Fonz",
    price: "$26.00",
    blurb: "The specialty square everyone on Brighton Ave asks for by name.",
    alt: "The Fonz specialty pizza from Gigi's NY Style Pizza, Long Branch",
  },
];
