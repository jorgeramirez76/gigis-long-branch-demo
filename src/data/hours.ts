/**
 * Hours confirmed by the owner (via Jorge) 2026-07-12:
 *   Mon / Tue / Wed  10:00 AM – 11:00 PM
 *   Thu / Fri / Sat / Sun  10:00 AM – 12:00 AM (midnight)
 * Open seven days a week. (Supersedes earlier third-party/POS figures that
 * were wrong — including a stale "Tuesday closed" in the Clover config.)
 */
export type DayHours = {
  day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  label: string;
};

export const HOURS_VERIFIED = true;

const EARLY = "10:00 AM – 11:00 PM";
const LATE = "10:00 AM – 12:00 AM";

export const HOURS: DayHours[] = [
  { day: "Mon", label: EARLY },
  { day: "Tue", label: EARLY },
  { day: "Wed", label: EARLY },
  { day: "Thu", label: LATE },
  { day: "Fri", label: LATE },
  { day: "Sat", label: LATE },
  { day: "Sun", label: LATE },
];

/** Human-readable one-liner for compact UI cells. */
export const HOURS_ONE_LINE = "Open daily · 10 AM til late";
