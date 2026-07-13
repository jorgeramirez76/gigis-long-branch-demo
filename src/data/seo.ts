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

/**
 * FAQs surfaced visibly (FAQ.tsx) AND mirrored in the FAQPage JSON-LD in
 * index.html. Each answer is written to stand alone (40–60 words) so it can be
 * extracted and cited by AI answer engines. IMPORTANT: keep this array and the
 * FAQPage @graph in index.html in sync — edit both together.
 */
export const FAQS = [
  {
    q: "What is the best NY-style pizza in Long Branch?",
    a: "Gigi's NY Style Pizza on Brighton Avenue is a longtime local favorite for New York pizza in Long Branch. Regulars come back for the thin, hand-stretched crust, the balanced sauce-to-cheese ratio, and specialty pies like the Bee Sting and The Fonz. Order a whole pie or grab it by the slice.",
  },
  {
    q: "What is New York–style pizza?",
    a: "New York–style pizza is a large, thin, hand-tossed round with a crust crisp enough to hold its shape but flexible enough to fold. It's topped with tomato sauce and whole-milk mozzarella and sold as whole pies and by the slice. Gigi's makes its NY-style pies with hand-stretched dough baked to order.",
  },
  {
    q: "Does Gigi's have gluten-free pizza?",
    a: "Yes. Gigi's makes a gluten-free NY-style pizza on a gluten-free crust, and you can add any toppings you like. Please note our pizzas are prepared and baked in a shared kitchen, so we can't guarantee a fully allergen-free pie. If you have celiac disease, tell our staff and we'll take extra care.",
  },
  {
    q: "Is there vegan pizza in Long Branch, NJ?",
    a: "Yes. Gigi's makes a vegan pizza on our NY-style crust with dairy-free cheese and your choice of vegetable toppings. It's one of the few vegan pizza options right in town, so you don't have to drive out of Long Branch to find one. Vegan-friendly salads and marinara pies are also available.",
  },
  {
    q: "What are Gigi's signature specialty pizzas?",
    a: "Gigi's is known for creative pies you won't find everywhere. Favorites include the Bee Sting with hot honey, the vodka-sauced Drunken Grandma on a square crust, The Fonz, the upside-down Bobby Boombotz Vodka Pepi, and premium pies like White Truffle and Lobster. There's also a full lineup of stuffed pizzas.",
  },
  {
    q: "Does Gigi's cater events in Long Branch?",
    a: "Yes. Gigi's caters pizza parties, office lunches, graduations, and beach-house gatherings across Long Branch and Monmouth County. We offer half and full trays of pizza, pasta, and salads, plus 3-foot and 6-foot hero platters. Call (732) 377-2468 to plan your order — a day or two of notice helps for larger parties.",
  },
  {
    q: "Does Gigi's serve breakfast and açaí bowls?",
    a: "Yes. Gigi's serves breakfast every morning — omelettes, Benedicts, pancakes, French toast, and breakfast pizza. We also make açaí bowls with granola, fresh fruit, and honey. It's a rare all-day pizzeria where you can get morning eats and a fresh slice from the same kitchen on Brighton Avenue.",
  },
  {
    q: "Is Gigi's more than a pizzeria?",
    a: "Yes. Beyond pizza, Gigi's is a full Italian-American restaurant. The menu includes heroes and subs, pasta dinners, chicken and seafood entrées, wraps, burgers, wings, salads, and a kids' menu. One order can feed a whole family or a mixed-craving group — a solid choice for beach-house rentals and group dinners.",
  },
  {
    q: "Does Gigi's deliver, and where?",
    a: "Yes. Gigi's delivers across Long Branch and nearby towns, including the West End, Pier Village, Elberon, West Long Branch, Monmouth Beach, Deal, Eatontown, Allenhurst, and Oceanport. You can order pizza, heroes, pasta, salads, and full dinners for delivery, or call (732) 377-2468 to place an order for pickup.",
  },
  {
    q: "Where is Gigi's and what are the hours?",
    a: "Gigi's is at 140 Brighton Avenue in the West End of Long Branch, NJ 07740, with easy parking and quick pickup. We're open daily from 9 AM and the kitchen runs late every night. Holiday and seasonal hours can change, so call (732) 377-2468 to confirm before a late-night or early-morning visit.",
  },
] as const;

/** Display-friendly comma-separated string of service areas. */
export const SERVICE_AREAS_LINE = SERVICE_AREAS.join(" · ");
