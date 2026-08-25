/**
 * Paraphrased themes drawn from publicly visible reviews on Google,
 * Restaurantji, and Restaurant Guru (re-verified 2026-07-12). Not direct quotes.
 *
 * Accuracy notes:
 *  - The "voted top pizza in NJ" line that used to live here was a menu
 *    marketing claim that couldn't be traced to any publication, so it's been
 *    removed from schema, titles, and prominent copy (no fabricated accolades).
 *  - Ratings below are real, per-platform, single-source numbers — NOT summed
 *    into one aggregate (Google's structured-data policy forbids that, and it
 *    reads as fake). Re-confirm the live Google count before any AggregateRating.
 */

export type ReviewTheme = {
  heading: string;
  body: string;
  sourceNote?: string;
};

export const REVIEW_THEMES_VERIFIED = true;

/** Honest headline signal — a real, defensible descriptor, not an award claim. */
export const ACCOLADE = {
  label: "A West End neighborhood favorite for real New York–style pizza",
  sourceNote: "",
};

export const REVIEW_THEMES: ReviewTheme[] = [
  {
    heading: "Real NY-style crust",
    body: "Regulars single out the crust — a balanced sauce-to-cheese ratio and a slightly sweet sauce. Both the classic round and the Grandma-style square get repeat shout-outs.",
    sourceNote: "Paraphrased from Restaurantji + Restaurant Guru reviews.",
  },
  {
    heading: "Specialty pies are a draw",
    body: "Favorites that come up again and again: the hot-honey Bee Sting, General Tso's pizza, the Money Pie, and the Famous Pepi.",
    sourceNote: "Recurring mentions across public review snippets.",
  },
  {
    heading: "Owner hospitality",
    body: "Multiple reviews call out Tommy and the team for going above and beyond — the kind of service that turns first-timers into regulars.",
    sourceNote: "Common theme across Google / Restaurantji reviews.",
  },
  {
    heading: "Something for everyone",
    body: "A huge menu — NY pies, Grandma squares, heroes, pasta, seafood, plus gluten-free and vegan pizza — means the whole table finds something. A neighborhood spot built for families.",
    sourceNote: "Noted across multiple public review sites.",
  },
];

/** Real, single-source ratings (re-verified 2026-08-24 by direct page fetch — Restaurantji's
 * own JSON-LD returned ratingValue 4.4, ratingCount 90; was 4.6/86 when verified 7/12).
 * Displayed as attributed tiles with links — never summed into one AggregateRating. */
export const RATING_SNAPSHOT = {
  restaurantji: { score: 4.4, count: 90, url: "https://www.restaurantji.com/nj/long-branch/gigis-ny-style-pizza-and-restaurant-lb-/" },
  /* Restaurant Guru tile REMOVED 2026-07-29. It displayed "4.3 · 130 reviews · on Restaurant Guru",
   * but 4.3 is GOOGLE's rating that Restaurant Guru republishes — its own aggregateRating JSON-LD
   * declares 2.9/5 with those 130 reviews, and its visible page reads "Google (4.3/5)" with
   * "120 Visitors' reviews". So the tile paired Google's score with Restaurant Guru's count and
   * credited both to Restaurant Guru. Re-verified against the live page on 2026-07-29.
   *
   * Restaurantji still checks out exactly (ratingValue 4.6, ratingCount 86, verified same day).
   *
   * To show Google's rating instead, read BOTH the score and the review count off the Google
   * Business Profile dashboard and add them here as `google: { score, count, url }` — do not reuse
   * Restaurant Guru's count with Google's score. Google's rating is 4.3 as of 2026-07-29 (read
   * first-hand from the Maps listing); the count was not exposed there. */
};
