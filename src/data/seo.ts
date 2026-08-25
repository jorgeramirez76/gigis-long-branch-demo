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
export const FAQS: ReadonlyArray<{ q: string; a: string; link?: { href: string; label: string } }> = [
  {
    q: "What is the best NY-style pizza in Long Branch?",
    a: "Gigi's NY Style Pizza on Brighton Avenue is a longtime local favorite for New York pizza in Long Branch. Regulars come back for the thin, hand-stretched crust, the balanced sauce-to-cheese ratio, and specialty pies like the Bee Sting and The Fonz. Order a whole pie or grab it by the slice.",
  },
  {
    q: "What is New York–style pizza?",
    a: "New York–style pizza is a large, thin, hand-tossed round with a crust crisp enough to hold its shape but flexible enough to fold. It's topped with tomato sauce and whole-milk mozzarella and sold as whole pies and by the slice. Gigi's makes its NY-style pies with hand-stretched dough baked to order.",
  },
  {
    q: "What should I order at Gigi's? What's most popular?",
    a: "First-timers can't go wrong with a classic cheese slice or a plain NY pie. Among specialty pizzas, the hot-honey Bee Sting, The Fonz, and the vodka Drunken Grandma get the most repeat orders. Still hungry? The chicken parm hero and baked pasta are local go-tos. Order a whole pie, or mix a few slices to sample.",
  },
  {
    q: "Does Gigi's have gluten-free pizza?",
    a: "Yes. Gigi's makes a gluten-free NY-style pizza on a gluten-free crust. Toppings are charged separately and are not selectable online yet, so call and we'll build it. Please note our pizzas are prepared and baked in a shared kitchen, so we can't guarantee a fully allergen-free pie. If you have celiac disease, tell our staff and we'll take extra care.",
    link: { href: "/gluten-free-pizza-long-branch/", label: "Gluten-free options & prices" },
  },
  {
    q: "Is there vegan pizza in Long Branch, NJ?",
    a: "Yes. Gigi's makes a vegan pizza on our NY-style crust with dairy-free cheese and your choice of vegetable toppings. It is on the menu as its own item rather than a regular pie with the cheese left off.",
    link: { href: "/vegan-pizza-long-branch/", label: "The vegan pizza page" },
  },
  {
    q: "What are Gigi's signature specialty pizzas?",
    a: "Gigi's is known for creative pies you won't find everywhere. Favorites include the Bee Sting with hot honey, the vodka-sauced Drunken Grandma on a square crust, The Fonz, the upside-down Bobby Boombotz Vodka Pepi, and the premium White Truffle. Ask about the day's specials when you call.",
  },
  {
    q: "Does Gigi's cater events in Long Branch?",
    a: "Yes. Gigi's caters pizza parties, office lunches, graduations, and beach-house gatherings across Long Branch and Monmouth County. We offer half and full trays of pizza, pasta, and salads, plus 3-foot and 6-foot hero platters. Call (732) 377-2468 to plan your order — a day or two of notice helps for larger parties.",
    link: { href: "/catering-long-branch/", label: "Catering details & prices" },
  },
  {
    q: "Is Gigi's more than a pizzeria?",
    a: "Yes. Beyond pizza, Gigi's is a full Italian-American restaurant. The menu includes heroes and subs, pasta dinners, chicken and seafood entrées, wraps, burgers, wings, salads, and a kids' menu. One order can feed a whole family or a mixed-craving group — a solid choice for beach-house rentals and group dinners.",
  },
  {
    q: "Does Gigi's serve breakfast in Long Branch?",
    a: "Yes. Gigi's serves all-day breakfast at 140 Brighton Avenue in Long Branch — breakfast sandwiches like bacon, egg & cheese and pork roll, egg & cheese; omelettes; pancakes and French toast; breakfast platters; the Gigi Skillet; breakfast pizza; and breakfast burritos. Dine in or order for pickup and delivery. Call (732) 377-2468.",
  },
  {
    q: "Does Gigi's deliver, and where?",
    a: "Yes. Gigi's delivers across Long Branch and nearby towns, including the West End, Pier Village, Elberon, West Long Branch, Monmouth Beach, Deal, Eatontown, Allenhurst, and Oceanport. You can order pizza, heroes, pasta, salads, and full dinners for delivery, or call (732) 377-2468 to place an order for pickup.",
    link: { href: "/delivery/", label: "All delivery areas & fees" },
  },
  {
    q: "Can I order Gigi's pizza online?",
    a: "Yes. You can order Gigi's for pickup or delivery right on gigislongbranch.com — browse the full menu, customize toppings, and pay securely by card or Apple Pay. Online orders are prepaid, and go straight to the kitchen once your card is charged. Prefer to pay in person? Call us at (732) 377-2468. Online ordering is open seven days a week during regular hours.",
    link: { href: "/menu/", label: "See the full menu with prices" },
  },
  {
    q: "Where is Gigi's and what are the hours?",
    a: "Gigi's is at 140 Brighton Avenue in the West End of Long Branch, NJ 07740, with easy parking and quick pickup. We're open seven days a week: 10 AM to 11 PM Monday through Wednesday, and 10 AM to midnight Thursday through Sunday. Call (732) 377-2468 to confirm holiday hours.",
  },
  {
    q: "Is there late-night pizza in Long Branch?",
    a: "Yes. Gigi's serves hot slices and the full menu late — until midnight Thursday through Sunday, and 11 PM Monday through Wednesday — at 140 Brighton Avenue in Long Branch. Delivery runs until 10 PM; after that it's pickup at the counter. It's a go-to for a late slice after the beach, a night out, or the game.",
    link: { href: "/late-night-pizza-long-branch/", label: "Late-night hours & details" },
  },
  {
    q: "How do I redeem my VIP Club free-pie code?",
    a: "Start a pickup order at gigislongbranch.com, add a Plain Pie to your cart, and enter your PIE code in the VIP code box at final checkout — the pie comes off the total. Ordering nothing but the free pie? Just show your code at the counter instead, since a $0 order can't be placed online. Codes are one per household, pickup only, and good for 90 days.",
    link: { href: "/vip-club/", label: "VIP Club details" },
  },
  {
    q: "Does Gigi's make square pizza — Grandma or Sicilian?",
    a: "Both. Gigi's bakes the thin, crisp Grandma pie and the thicker Sicilian square, plus the vodka-sauce Drunken Grandma and the Sicilian Pan Pie — all available for pickup or delivery. Toppings go on the whole pie or either half, priced per topping.",
    link: { href: "/square-pizza-long-branch/", label: "Square pizza prices & details" },
  },
];

/** Display-friendly comma-separated string of service areas. */
export const SERVICE_AREAS_LINE = SERVICE_AREAS.join(" · ");
