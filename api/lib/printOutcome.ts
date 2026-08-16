export type PrintPollOutcome = "pending" | "printed" | "failed";

/**
 * Clover keeps a print event only while it is CREATED, PRINTING, or FAILED.
 * After the paper prints successfully Clover discards the event, so a 404 while
 * polling an event ID returned by POST /print_event is the documented success
 * signal. Merely receiving CREATED/PRINTING is never proof that paper printed.
 */
export function classifyPrintPoll(state?: string, httpStatus?: number): PrintPollOutcome {
  if (httpStatus === 404) return "printed";
  const normalized = state?.trim().toUpperCase();
  if (normalized === "FAILED") return "failed";
  return "pending";
}
