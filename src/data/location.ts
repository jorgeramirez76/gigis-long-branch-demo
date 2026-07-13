/**
 * Verified facts about the Long Branch location. This is the only location
 * this site represents. Any other Gigi's locations are out of scope.
 *
 * Phone: (732) 377-2468 — the only contact number used across the site.
 * Confirmed across Yelp, Restaurantji, Restaurant Guru, Facebook video
 * captions, and Google Business Profile snippets.
 */
export const LOCATION = {
  name: "Gigi's NY Style Pizza",
  shortName: "Gigi's NY Style Pizza — Long Branch",
  street: "140 Brighton Ave",
  city: "Long Branch",
  state: "NJ",
  zip: "07740",
  phone: "732-377-2468",
  phoneTel: "+17323772468",
  // Approximate coords for 140 Brighton Ave, Long Branch NJ — kept in sync with
  // the geo in index.html. Refine both from the Google Business Profile pin.
  lat: 40.301,
  lng: -73.999,
  googleMapsQuery: "140+Brighton+Ave,+Long+Branch,+NJ+07740",
  canonicalUrl: "https://gigislongbranch.com/",
} as const;

export const ADDRESS_ONE_LINE = `${LOCATION.street}, ${LOCATION.city}, ${LOCATION.state} ${LOCATION.zip}`;

export const DIRECTIONS_URL = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
  `${LOCATION.street}, ${LOCATION.city}, ${LOCATION.state} ${LOCATION.zip}`,
)}`;

export const MAP_EMBED_URL = `https://www.google.com/maps?q=${LOCATION.googleMapsQuery}&output=embed`;

/**
 * Online ordering — this site orders STRICTLY through Clover Online Ordering
 * (published + live 2026-07-12 for merchant 2J9HNTSEXBHG1). Orders hit the POS
 * directly with no per-order marketplace fee. Slice's own marketplace listing
 * stays live independently for discovery — it's just no longer linked from here,
 * so owned traffic (site, Google, regulars) never routes through a fee channel.
 */
export const CLOVER_ORDER_URL = "https://gigislongbranch.cloveronline.com";

export const ORDER_ONLINE_URL = CLOVER_ORDER_URL;

/** Socials. Note: accounts are multi-location — posts clearly reference
 * Long Branch in captions. Link but don't claim exclusivity. */
export const SOCIALS = {
  instagram: "https://www.instagram.com/gigisnystylepizza/",
  facebook: "https://www.facebook.com/gigispizzasb/",
};
