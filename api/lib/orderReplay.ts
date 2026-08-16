export type ReplayableOrder = {
  id: number;
  status: "pending" | "charged" | "placed" | "paid" | "paid_unrouted" | "capture_uncertain" | "failed";
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
  if (order.status === "paid" || order.status === "placed") {
    return order.cloverOrderId
      ? { kind: "completed", paid: order.status === "paid" }
      : { kind: "uncertain", paid: false };
  }
  if (order.status === "charged" || order.status === "paid_unrouted" || order.chargeId) {
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
