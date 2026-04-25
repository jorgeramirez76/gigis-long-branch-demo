/**
 * Hours verified 2026-04-24 from Restaurantji and Restaurant Guru (both
 * surfacing Google Business Profile data). Mon–Sun 9:00 AM – 12:00 AM.
 * Uber Eats reports a narrower delivery-cutoff window; those are delivery
 * times, not store hours.
 *
 * Sources:
 *  - https://www.restaurantji.com/nj/long-branch/gigis-ny-style-pizza-and-restaurant-lb-/
 *  - https://restaurantguru.com/Gigis-NY-Style-Pizza-and-Restaurant-Long-Branch
 */
export type DayHours = {
  day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  label: string;
};

export const HOURS_VERIFIED = true;

const STANDARD = "9:00 AM – 12:00 AM";

export const HOURS: DayHours[] = [
  { day: "Mon", label: STANDARD },
  { day: "Tue", label: STANDARD },
  { day: "Wed", label: STANDARD },
  { day: "Thu", label: STANDARD },
  { day: "Fri", label: STANDARD },
  { day: "Sat", label: STANDARD },
  { day: "Sun", label: STANDARD },
];

/** Human-readable one-liner for compact UI cells. */
export const HOURS_ONE_LINE = "Open daily · 9 AM – 12 AM";
