export type ReplayableOrder = {
  id: number;
  status: "pending" | "charged" | "placed" | "paid" | "paid_unrouted" | "paid_print_queued" | "paid_print_failed" | "capture_uncertain" | "failed";
  chargeId: string | null;
  cloverOrderId: string | null;
  ageSec: number;
};

export type ReplayDecision =
  | { kind: "completed"; paid: boolean }
  | { kind: "routing_issue"; paid: true }
  | { kind: "processing"; paid: false }
  | { kind: "uncertain"; paid: false }
  | { kind: "retry"; paid: false };

export function replayOrder(order: ReplayableOrder): ReplayDecision {
  // paid_print_queued is a finished, paid order whose ticket is still moving through Clover's
  // print queue — a retry of the same key must see the order it already placed, not a warning.
  if (order.status === "paid" || order.status === "placed" || order.status === "paid_print_queued") {
    return order.cloverOrderId
      ? { kind: "completed", paid: order.status !== "placed" }
      : { kind: "uncertain", paid: false };
  }
  if (order.status === "charged" || order.status === "paid_unrouted" || order.status === "paid_print_failed" || order.chargeId) {
    return { kind: "routing_issue", paid: true };
  }
  if (order.status === "capture_uncertain" || order.cloverOrderId) {
    return { kind: "uncertain", paid: false };
  }
  if (order.status === "pending") {
    return order.ageSec < 90 ? { kind: "processing", paid: false } : { kind: "uncertain", paid: false };
  }
  return { kind: "retry", paid: false };
}
