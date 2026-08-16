export type PrintPollOutcome = "pending" | "printed" | "failed";

/**
 * Clover keeps a print event only while it is CREATED, PRINTING, or FAILED.
 * Once the paper prints, Clover discards the event, so the event going away is
 * the documented success signal. Merely receiving CREATED/PRINTING is never
 * proof that paper printed.
 *
 * The "went away" response is NOT a 404: this merchant's API answers a consumed
 * event with `400 {"message":"The print event is missing"}` (measured live
 * 2026-08-16 against a ticket that had printed). Reading only 404 as success
 * meant a printed ticket could never be confirmed, which is what turned Robert
 * Ciardullo's 5:11 PM order into a false "DID NOT PRINT" alarm.
 */
export function classifyPrintPoll(state?: string, httpStatus?: number, body?: string): PrintPollOutcome {
  if (httpStatus === 404) return "printed";
  if (httpStatus === 400 && /print event is missing/i.test(body ?? "")) return "printed";
  const normalized = state?.trim().toUpperCase();
  if (normalized === "FAILED") return "failed";
  return "pending";
}
