/**
 * Paraphrased themes drawn from publicly visible reviews on Google,
 * Slice, Uber Eats, Restaurantji, and Restaurant Guru (pulled 2026-04-24).
 * Not direct quotes. Sources documented in /research/sources.md.
 *
 * Accolade "voted one of the top pizzas in New Jersey" confirmed by the
 * Long Branch owner. Kept as plain prose on the site; not combined with
 * aggregate rating numbers.
 */

export type ReviewTheme = {
  heading: string;
  body: string;
  sourceNote?: string;
};

export const REVIEW_THEMES_VERIFIED = true;

export const ACCOLADE = {
  label: "Voted one of the top pizzas in New Jersey",
  sourceNote: "Accolade confirmed by Gigi's Long Branch ownership.",
};

export const REVIEW_THEMES: ReviewTheme[] = [
  {
    heading: "Real NY-style crust",
    body: "Regulars single out the crust — balanced sauce-to-cheese ratio and a slightly sweet sauce. Both the classic round and the Grandma-style Sicilian get repeat shout-outs.",
    sourceNote: "Paraphrased from Restaurantji + Restaurant Guru reviews.",
  },
  {
    heading: "Specialty pies are a draw",
    body: "Favorites that come up again and again: General Tso's pizza, the Money Pie, Famous Pepi-Roni, and the hot-honey pepperoni.",
    sourceNote: "Recurring mentions across public review snippets.",
  },
  {
    heading: "Owner hospitality",
    body: "Multiple reviews call out Tommy and the team for going above and beyond — the kind of service that turns first-timers into regulars.",
    sourceNote: "Common theme across Google / Restaurantji reviews.",
  },
  {
    heading: "Family-friendly & welcoming",
    body: "Kid-friendly seating, a fireplace, and even make-your-own-pizza parties on offer. A neighborhood spot built for families, not just a slice stop.",
    sourceNote: "Noted across multiple public review sites.",
  },
];

export const RATING_SNAPSHOT = {
  slice: { score: 4.5, count: 286, url: "https://slicelife.com/restaurants/nj/long-branch/07740/gigi-s-ny-style-pizza-restaurant/menu" },
  uberEats: { score: 4.6, countLabel: "500+", url: "https://www.ubereats.com/store/gigis-ny-style-pizza/CWb8PzzGRGuaw9RGJc1OQQ" },
  restaurantji: { score: 4.6, count: 84, url: "https://www.restaurantji.com/nj/long-branch/gigis-ny-style-pizza-and-restaurant-lb-/" },
};
