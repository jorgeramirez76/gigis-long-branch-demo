/**
 * Menu item photos — owner-provided Long Branch food photos (sent by Tommy Basile,
 * 2026-09-21). Kept apart from menuGenerated.ts so a Clover regenerate never drops them.
 *
 * Keyed by category id + exact menu item name. Each photo has a 320w thumbnail
 * (menu row) and a 960w version (item modal) in src/assets/menu/.
 * An item with several photos (the slice tiers) shows the first in its row and
 * all of them, captioned, in its modal.
 */

const files = import.meta.glob<string>("../assets/menu/*.webp", { eager: true, import: "default" });

export type MenuPhoto = { thumb: string; full: string; caption: string };

function photo(slug: string, caption: string): MenuPhoto {
  const thumb = files[`../assets/menu/${slug}-320.webp`];
  const full = files[`../assets/menu/${slug}-960.webp`];
  if (!thumb || !full) throw new Error(`Missing menu photo: ${slug}`);
  return { thumb, full, caption };
}

const PHOTOS: Record<string, Record<string, MenuPhoto[]>> = {
  pizza: {
    "Plain Pie": [photo("plain-pie", "Plain pie")],
    "White Pie": [photo("white-pie", "White pie")],
    "Meat Lover's Pie": [photo("meat-lovers-pie", "Meat lover's pie")],
    Margherita: [photo("margherita", "Margherita")],
    "Vodka Pie": [photo("vodka-pie", "Vodka pie")],
    "White Clam Pie": [photo("white-clam-pie", "White clam pie")],
    "Veggie Pie": [photo("veggie-pie", "Veggie pie")],
    "Philly Cheesesteak Pie": [photo("philly-cheesesteak-pie", "Philly cheesesteak pie")],
    Grandma: [photo("grandma", "Grandma pie")],
    "Spinach & Artichoke Pie": [photo("spinach-artichoke-pie", "Spinach & artichoke pie")],
    "Chicken Francese Pie": [photo("chicken-francese-pie", "Chicken francese pie")],
    Sicilian: [photo("sicilian", "Sicilian")],
    "Buffalo Chicken Pie": [photo("buffalo-chicken-pie", "Buffalo chicken pie")],
    "General Tso's": [photo("general-tsos", "General Tso's pie")],
    "Staten Island": [photo("staten-island", "Staten Island pie")],
    "Drunken Grandma": [photo("drunken-grandma", "Drunken grandma")],
    "The Quad": [photo("the-quad", "The Quad")],
    "El Prez": [photo("el-prez", "El Prez")],
    "Tomato Pie": [photo("tomato-pie", "Tomato pie")],
    "Action Pie": [photo("action-pie", "Action pie")],
    "Money Pie": [photo("money-pie", "Money pie")],
    "Best Pizza Ever": [photo("best-pizza-ever", "Best Pizza Ever")],
    "Famous Pepi": [photo("famous-pepi", "Famous Pepi")],
    "Gigi's Upside Down Pie": [photo("upside-down-pie", "Gigi's upside down pie")],
    "Kelly Salad Pie": [photo("kelly-salad-pie", "Kelly salad pie")],
    "Nicky's Sausage Cup Vodka Pie": [photo("nickys-sausage-cup-vodka-pie", "Nicky's sausage cup vodka pie")],
    "Chicken Rancheros Pie": [photo("chicken-rancheros-pie", "Chicken rancheros pie")],
    "Bee Sting": [photo("bee-sting", "Bee sting")],
  },
  slices: {
    Plain: [photo("plain-slice", "Plain slice")],
    Specialty: [
      photo("pepperoni-slice", "Pepperoni slice"),
      photo("sausage-slice", "Sausage slice"),
      photo("slices", "Slices"),
    ],
    Gourmet: [
      photo("grandma-slice", "Grandma slice"),
      photo("drunken-grandpa-slice", "Drunken grandpa slice"),
      photo("buffalo-chicken-slice", "Buffalo chicken slice"),
      photo("general-tso-slice", "General Tso slice"),
    ],
  },
  appetizers: {
    "Large Family Calzone": [photo("large-family-calzone", "Large family calzone")],
    "Small Calzone": [photo("small-calzone", "Small calzone")],
  },
  desserts: {
    "Dessert Pizza": [photo("dessert-pizza", "Dessert pizza")],
  },
};

export function menuPhotos(categoryId: string, itemName: string): MenuPhoto[] {
  return PHOTOS[categoryId]?.[itemName] ?? [];
}
