/**
 * Hours confirmed 2026-07-12 from the merchant's own Clover POS (the
 * authoritative source — it drives their online-ordering availability):
 *   Mon 10 AM–10 PM · Tue CLOSED · Wed 10 AM–10 PM · Thu 10 AM–10 PM ·
 *   Fri 10 AM–11 PM · Sat 10 AM–11 PM · Sun 10 AM–10 PM.
 * (Supersedes the earlier "9 AM–midnight daily" figure, which came from
 * third-party listings and was wrong — notably it missed the Tuesday closure.)
 */
export type DayHours = {
  day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  label: string;
};

export const HOURS_VERIFIED = true;

const REG = "10:00 AM – 10:00 PM";
const LATE = "10:00 AM – 11:00 PM";
const CLOSED = "Closed";

export const HOURS: DayHours[] = [
  { day: "Mon", label: REG },
  { day: "Tue", label: CLOSED },
  { day: "Wed", label: REG },
  { day: "Thu", label: REG },
  { day: "Fri", label: LATE },
  { day: "Sat", label: LATE },
  { day: "Sun", label: REG },
];

/** Human-readable one-liner for compact UI cells. */
export const HOURS_ONE_LINE = "Open 10 AM–10 PM · Closed Tuesdays";
