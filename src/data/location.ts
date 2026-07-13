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
 * Online ordering URL — Slice today. The whole "kill Slice fees" play is to
 * route owned traffic (this site, Google, regulars) to Clover Online Ordering
 * once the owner turns it on, so orders hit the POS with no per-order fee.
 *
 * Switching is a deploy-time env var, no code edit:
 *   VITE_ORDER_PROVIDER=clover  → all Order Online buttons point at Clover.
 * Anything else (or unset)      → Slice.
 *
 * TODO(go-live): confirm the live Clover Online Ordering URL for the Long
 * Branch merchant (2J9HNTSEXBHG1) before flipping the env var — the value
 * below is the standard cloveronline.com pattern and must be verified.
 */
const SLICE_ORDER_URL =
  "https://slicelife.com/restaurants/nj/long-branch/07740/gigi-s-ny-style-pizza-restaurant/menu";

export const CLOVER_ORDER_URL = "https://gigis-pizza-long-branch.cloveronline.com";

export const ORDER_ONLINE_URL =
  import.meta.env.VITE_ORDER_PROVIDER === "clover" ? CLOVER_ORDER_URL : SLICE_ORDER_URL;

/** Socials. Note: accounts are multi-location — posts clearly reference
 * Long Branch in captions. Link but don't claim exclusivity. */
export const SOCIALS = {
  instagram: "https://www.instagram.com/gigisnystylepizza/",
  facebook: "https://www.facebook.com/gigispizzasb/",
};
