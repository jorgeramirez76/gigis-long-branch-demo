export type ChargeBody = {
  id?: string;
  amount?: number;
  amount_captured?: number;
  captured?: boolean;
  paid?: boolean;
  status?: string;
  outcome?: { network_status?: string; type?: string };
  error?: { message?: string };
  message?: string;
};

export type ChargeOutcome = "captured" | "failed" | "uncertain";

/** Only an internally consistent, recognized response is safe to act on. */
export function classifyCharge(data: ChargeBody): ChargeOutcome {
  const st = typeof data.status === "string" ? data.status.toLowerCase() : null;
  const nw = data.outcome?.network_status?.toLowerCase();
  const ot = data.outcome?.type?.toLowerCase();
  const positiveStatuses = new Set(["succeeded", "paid"]);
  const negativeStatuses = new Set(["failed", "declined", "blocked", "canceled", "cancelled"]);
  const knownStatuses = new Set([...positiveStatuses, ...negativeStatuses]);
  const positive =
    (st != null && positiveStatuses.has(st)) ||
    data.paid === true ||
    data.captured === true ||
    (data.amount_captured ?? 0) > 0 ||
    (ot === "authorized" && (!nw || nw === "approved_by_network"));
  const negative =
    (st != null && negativeStatuses.has(st)) ||
    (nw != null && ["declined_by_network", "reversed_after_approval"].includes(nw)) ||
    ot === "blocked" ||
    data.paid === false ||
    data.captured === false;
  const unknownVocabulary =
    (st != null && !knownStatuses.has(st)) ||
    (nw != null && !["approved_by_network", "declined_by_network", "reversed_after_approval"].includes(nw)) ||
    (ot != null && !["authorized", "blocked"].includes(ot));

  if (unknownVocabulary || (positive && negative)) return "uncertain";
  if (positive) return "captured";
  if (negative) return "failed";
  return "uncertain";
}

/** Any positive signal that money moved. Used by the HTTP-status-aware decline check:
 *  a 402 response whose body shows none of these is Clover explicitly refusing payment,
 *  even when the body's vocabulary (an error object, say) is otherwise unrecognized. */
export function hasCaptureEvidence(data: ChargeBody): boolean {
  const st = typeof data.status === "string" ? data.status.toLowerCase() : null;
  const nw = data.outcome?.network_status?.toLowerCase();
  const ot = data.outcome?.type?.toLowerCase();
  return (
    (st != null && ["succeeded", "paid"].includes(st)) ||
    data.paid === true ||
    data.captured === true ||
    (data.amount_captured ?? 0) > 0 ||
    (ot === "authorized" && (!nw || nw === "approved_by_network"))
  );
}

export function chargeFailureReason(data: ChargeBody): string {
  return [
    data.status ? `status=${data.status}` : null,
    data.paid === false ? "paid=false" : null,
    data.outcome?.type ? `outcome=${data.outcome.type}` : null,
    data.outcome?.network_status ? `network=${data.outcome.network_status}` : null,
  ].filter(Boolean).join(" ") || "no capture confirmation in Clover's response";
}
