export type ReplayableOrder = {
  id: number;
  status: "refire_pending" | "pending" | "charged" | "placed" | "paid" | "paid_unrouted" | "paid_print_queued" | "paid_print_failed" | "capture_uncertain" | "routing_uncertain" | "failed";
  chargeId: string | null;
  cloverOrderId: string | null;
  ageSec: number;
};

export type ReplayDecision =
  | { kind: "completed"; paid: boolean }
  | { kind: "routing_issue"; paid: true }
  | { kind: "processing"; paid: false }
  /** `noCharge`: a $0.00 free-pie order whose fire was never confirmed (`routing_uncertain`).
   *  Nothing was ever charged, so the answer must not talk about being charged twice. */
  | { kind: "uncertain"; paid: false; noCharge?: true }
  | { kind: "retry"; paid: false };

export function replayOrder(order: ReplayableOrder): ReplayDecision {
  // paid_print_queued is a finished, paid order whose ticket is still moving through Clover's
  // print queue — a retry of the same key must see the order it already placed, not a warning.
  if (order.status === "paid" || order.status === "placed" || order.status === "paid_print_queued") {
    return order.cloverOrderId
      ? { kind: "completed", paid: order.status !== "placed" }
      : { kind: "uncertain", paid: false };
  }
  if (order.status === "refire_pending" || order.status === "charged" || order.status === "paid_unrouted" || order.status === "paid_print_failed" || order.chargeId) {
    return { kind: "routing_issue", paid: true };
  }
  // Written by the $0.00 free-pie path the moment its Clover draft exists (ported from Sea
  // Bright): without it a free order's retry read as an uncertain CARD capture.
  if (order.status === "routing_uncertain") return { kind: "uncertain", paid: false, noCharge: true };
  if (order.status === "capture_uncertain" || order.cloverOrderId) {
    return { kind: "uncertain", paid: false };
  }
  if (order.status === "pending") {
    return order.ageSec < 90 ? { kind: "processing", paid: false } : { kind: "uncertain", paid: false };
  }
  return { kind: "retry", paid: false };
}
