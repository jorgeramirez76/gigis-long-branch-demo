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
  // Approximate coords for 140 Brighton Ave, Long Branch NJ.
  // Refine from the Google Business Profile when verifying on-site.
  lat: 40.3015,
  lng: -74.0015,
  googleMapsQuery: "140+Brighton+Ave,+Long+Branch,+NJ+07740",
  canonicalUrl: "https://gigisnystylepizza-longbranch.com/",
} as const;

export const ADDRESS_ONE_LINE = `${LOCATION.street}, ${LOCATION.city}, ${LOCATION.state} ${LOCATION.zip}`;

export const DIRECTIONS_URL = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
  `${LOCATION.street}, ${LOCATION.city}, ${LOCATION.state} ${LOCATION.zip}`,
)}`;

export const MAP_EMBED_URL = `https://www.google.com/maps?q=${LOCATION.googleMapsQuery}&output=embed`;

/** Canonical online ordering URL — Slice matches in-store pricing. */
export const ORDER_ONLINE_URL =
  "https://slicelife.com/restaurants/nj/long-branch/07740/gigi-s-ny-style-pizza-restaurant/menu";

/** Socials. Note: accounts are multi-location — posts clearly reference
 * Long Branch in captions. Link but don't claim exclusivity. */
export const SOCIALS = {
  instagram: "https://www.instagram.com/gigisnystylepizza/",
  facebook: "https://www.facebook.com/gigispizzasb/",
};
