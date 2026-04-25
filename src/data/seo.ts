/**
 * SEO + local-search content. Editing this file should be the only place
 * required to update what appears in the page copy AND the Schema.org
 * structured data, so they never drift apart.
 */

/** Towns inside ~5 miles of 140 Brighton Ave, Long Branch NJ.
 *  Used in: visible service-area band + Schema.org `areaServed`. */
export const SERVICE_AREAS = [
  "Long Branch",
  "West Long Branch",
  "Monmouth Beach",
  "Oceanport",
  "Eatontown",
  "Tinton Falls",
  "Deal",
  "Allenhurst",
  "Loch Arbour",
  "Oakhurst",
  "Asbury Park",
  "Shrewsbury",
] as const;

/** Cuisine + topical keywords used in copy AND `knowsAbout` schema. */
export const KEYWORDS = [
  "New York style pizza",
  "NY pizza Long Branch NJ",
  "pizza delivery Long Branch",
  "pizza near Brighton Ave",
  "Italian food Long Branch",
  "specialty pizza",
  "Sicilian pizza",
  "Grandma pizza",
  "heroes and subs",
  "pasta dinners",
  "buffalo wings",
  "mozzarella sticks",
  "family-friendly Italian restaurant",
] as const;

/** FAQs surfaced visibly + injected as FAQPage schema. */
export const FAQS = [
  {
    q: "Where is Gigi's NY Style Pizza in Long Branch?",
    a: "We're at 140 Brighton Ave, Long Branch, NJ 07740 — right on Brighton Ave with easy parking and quick pickup. Call (732) 377-2468 with any questions.",
  },
  {
    q: "What are Gigi's Long Branch hours?",
    a: "We're open daily, 9 AM to midnight (12 AM). Breakfast, lunch, dinner, and late-night slices — every day of the week.",
  },
  {
    q: "Do you deliver in Long Branch and the surrounding area?",
    a: "Yes — order online through Slice, Uber Eats, DoorDash, or Grubhub for delivery to Long Branch, West Long Branch, Monmouth Beach, Oceanport, Eatontown, Deal, Allenhurst, and the surrounding 5-mile radius. Call (732) 377-2468 for pickup.",
  },
  {
    q: "Is Gigi's pizza authentic New York style?",
    a: "Yes. We hand-stretch our dough fresh each day, build our pies on house tomato sauce with real fresh mozzarella, and bake them up in NY-style fashion — thin crust with that classic foldable slice.",
  },
  {
    q: "What's on the menu besides pizza?",
    a: "We're a full neighborhood Italian kitchen. Specialty pies, hot and cold heroes, pasta dinners, chicken parm, seafood, paninis, wraps, salads, soups, and Italian classics — plus a full breakfast menu with benedicts, omelets, and acai bowls.",
  },
  {
    q: "Do you take reservations or host parties?",
    a: "Yes — we accept reservations and we host make-your-own-pizza parties for kids and groups. Call (732) 377-2468 to arrange.",
  },
  {
    q: "Are you family-friendly?",
    a: "Absolutely. Kid-friendly seating, a fireplace, a kids' menu, and the kind of warm neighborhood feel families come back to.",
  },
] as const;

/** Display-friendly comma-separated string of service areas. */
export const SERVICE_AREAS_LINE = SERVICE_AREAS.join(" · ");
