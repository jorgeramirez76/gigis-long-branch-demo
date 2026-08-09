/**
 * The single rule for whether "Pay & place order" is clickable, and — just as important —
 * what the customer is told when it isn't.
 *
 * This lives apart from Checkout.tsx so it can be exhaustively checked. A disabled button
 * that explains nothing reads as a broken site: the customer taps it, nothing happens, and
 * the order is lost. That is exactly what happened at the Sea Bright store on 2026-08-08 —
 * a failed attempt reset the bot-check token, the button went dead, and nothing on screen
 * said why. The same shape existed here.
 *
 * The invariant, proven over the whole state space by scripts/verify-checkout-gate.mjs:
 *
 *     payDisabled(s) && !s.storeClosed && !s.submitting  ⇒  blockReason(s) !== null
 *
 * i.e. the button is never silently dead. The two exemptions are states the button's own
 * label already explains ("Closed — ordering opens 10 AM" / "Placing order…").
 *
 * Keep the two functions in step: every disjunct of payDisabled needs a blockReason branch.
 */

export type GateState = {
  storeClosed: boolean;
  submitting: boolean;
  cartEmpty: boolean;
  contactOk: boolean;
  deliveryOk: boolean;
  payment: "pickup" | "card" | "cash";
  cardReady: boolean;
  cardInitFailed: boolean;
  /** the cash-at-pickup acknowledgement checkbox */
  cashAgreed: boolean;
  turnstileOn: boolean;
  /** whether a live Turnstile token is currently held */
  turnstileToken: boolean;
  /** the widget could not load at all — so telling them to complete it would be a lie */
  turnstileFailed: boolean;
  /** store phone, for the one message whose only way forward is a call */
  phone: string;
};

export function payDisabled(s: GateState): boolean {
  return (
    s.storeClosed ||
    !s.contactOk ||
    !s.deliveryOk ||
    s.submitting ||
    s.cartEmpty ||
    (s.payment === "card" && !s.cardReady) ||
    (s.payment === "cash" && !s.cashAgreed) ||
    (s.turnstileOn && !s.turnstileToken)
  );
}

/** Why the button is greyed out, in the customer's words — or null when it is clickable
 *  (or when the button's own label already says why). */
export function blockReason(s: GateState): string | null {
  // Derived from payDisabled rather than re-deriving the conditions, so the two can never
  // disagree: a clickable button cannot nag, and a blocked one cannot go unexplained.
  if (!payDisabled(s)) return null;
  if (s.storeClosed || s.submitting) return null; // the button label covers these
  if (s.cartEmpty) return "Your cart is empty.";
  if (!s.contactOk) return "Add your name, phone and email above to continue.";
  if (!s.deliveryOk) return "Add your delivery address and town above to continue.";
  if (s.payment === "card" && s.cardInitFailed) {
    return "Card payment isn't available right now — choose Pay at pickup just above.";
  }
  if (s.payment === "card" && !s.cardReady) return "Card fields are still loading — one moment.";
  if (s.payment === "cash" && !s.cashAgreed) return "Tick the box above to confirm you'll bring cash.";
  if (s.turnstileOn && s.turnstileFailed) {
    // Must come first among the Turnstile branches: with the widget absent there is nothing
    // "just above" to finish, and the server rejects a tokenless order, so a call is the
    // only real way forward.
    return `The security check couldn't load — please reload the page, or call ${s.phone} to order.`;
  }
  if (s.turnstileOn && !s.turnstileToken) {
    return "Finish the quick “I'm human” check just above to continue.";
  }
  return null;
}
