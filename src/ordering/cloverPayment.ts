/**
 * clover.js hosted card fields (PCI SAQ-A) and the Clover-hosted Apple Pay button.
 * Card number / expiry / CVV live inside Clover-served iframes, and the Apple Pay
 * sheet is driven entirely by Clover's frame, so raw card data never touches our
 * JS or server. Both paths hand us the same single-use `clv_…` source token, which
 * the backend charges through the one already-proven order flow.
 *
 * Card payment stays completely inert until VITE_CLOVER_PAKMS_KEY (the merchant's
 * public Ecommerce apiAccessKey) is set — until then checkout directs customers to call.
 */

const PUBLIC_KEY = import.meta.env.VITE_CLOVER_PAKMS_KEY as string | undefined;
const MERCHANT_ID = import.meta.env.VITE_CLOVER_MERCHANT_ID as string | undefined;
// Apple Pay only works once the merchant's domain is verified with Apple through
// the Clover dashboard ("Only Clover merchants with a validated ecommerce website
// domain and subdomain can use the Apple Pay button"). Clover doesn't document how
// the button behaves before then, so it stays behind an explicit opt-in flag rather
// than risk a dead control sitting above the card fields.
const APPLE_PAY_ON = (import.meta.env.VITE_CLOVER_APPLE_PAY as string | undefined) === "1";
// Production hosted-SDK. Overridable via env for sandbox testing.
const SDK_URL =
  (import.meta.env.VITE_CLOVER_SDK_URL as string | undefined) || "https://checkout.clover.com/sdk.js";

export function cardPaymentEnabled(): boolean {
  return typeof PUBLIC_KEY === "string" && PUBLIC_KEY.trim().length > 0;
}

let sdkPromise: Promise<any> | null = null;

function loadSdk(): Promise<any> {
  const w = window as any;
  if (w.Clover) return Promise.resolve(w.Clover);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () =>
      w.Clover ? resolve(w.Clover) : reject(new Error("Clover SDK loaded but global missing"));
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("Could not load the secure payment fields. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

/**
 * Clover's element factory is a process-wide singleton: `Element.getInstance`
 * caches the FIRST instance and silently ignores the apiKey/merchantId passed by
 * every later call. So the page must share ONE Clover instance — otherwise
 * whichever payment method mounts first decides the merchant id for the other,
 * and Apple Pay ends up without one. Each `elements()` call also appends its own
 * hidden message frame to the body, so calling it once avoids that leak too.
 */
let cloverPromise: Promise<{ clover: any; elements: any }> | null = null;

function getClover(): Promise<{ clover: any; elements: any }> {
  if (cloverPromise) return cloverPromise;
  cloverPromise = loadSdk()
    .then((Clover) => {
      // merchantId is only passed when Apple Pay is on: it changes what the
      // tokenization frame does (it fetches the merchant's ecomm_payment_configs
      // and can switch on Clover's own reCAPTCHA), and the proven card path must
      // keep behaving exactly as it does today while Apple Pay is switched off.
      const clover =
        APPLE_PAY_ON && MERCHANT_ID
          ? new Clover(PUBLIC_KEY, { merchantId: MERCHANT_ID })
          : new Clover(PUBLIC_KEY);
      return { clover, elements: clover.elements() };
    })
    .catch((e) => {
      cloverPromise = null;
      throw e;
    });
  return cloverPromise;
}

export type CardMounts = {
  number: HTMLElement;
  date: HTMLElement;
  cvv: HTMLElement;
  postal: HTMLElement;
};

export type CloverCard = {
  mount: (m: CardMounts) => void;
  /** Returns a `clv_…` token or throws with a user-facing message. */
  tokenize: () => Promise<string>;
  destroy: () => void;
};

const FIELD_STYLE = {
  body: { fontFamily: "inherit" },
  input: { fontSize: "16px", color: "#1a1210" },
  "input::placeholder": { color: "#9a8f88" },
};

export async function initCloverCard(): Promise<CloverCard> {
  if (!cardPaymentEnabled()) throw new Error("Card payment is not enabled.");
  const { clover, elements } = await getClover();
  const number = elements.create("CARD_NUMBER", FIELD_STYLE);
  const date = elements.create("CARD_DATE", FIELD_STYLE);
  const cvv = elements.create("CARD_CVV", FIELD_STYLE);
  const postal = elements.create("CARD_POSTAL_CODE", FIELD_STYLE);

  return {
    mount: (m) => {
      // Clover's SDK binds each field iframe by element id ("Please set an id on
      // the node div" + silent mount failure otherwise) — assign ids and mount
      // by selector, which is the form the SDK documents.
      const bySelector = (el: HTMLElement, id: string) => {
        if (!el.id) el.id = id;
        return `#${el.id}`;
      };
      number.mount(bySelector(m.number, "clv-card-number"));
      date.mount(bySelector(m.date, "clv-card-date"));
      cvv.mount(bySelector(m.cvv, "clv-card-cvv"));
      postal.mount(bySelector(m.postal, "clv-card-postal"));
    },
    tokenize: async () => {
      const result = await clover.createToken();
      if (result?.errors) {
        const first = Object.values(result.errors).find((v) => typeof v === "string");
        throw new Error((first as string) || "Please check your card details.");
      }
      if (!result?.token) throw new Error("Please check your card details.");
      return result.token as string;
    },
    destroy: () => {
      for (const el of [number, date, cvv, postal]) {
        try {
          el.destroy?.();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Apple Pay — same token, same server flow, one tap instead of typing a card.
// ---------------------------------------------------------------------------

/**
 * Whether to offer Apple Pay at all. Safari on an Apple-Pay-capable device is the
 * only place the button can work, so everywhere else this is false and checkout
 * renders exactly as it always has.
 */
export function applePayAvailable(): boolean {
  if (!APPLE_PAY_ON || !cardPaymentEnabled() || !MERCHANT_ID) return false;
  const session = (window as any).ApplePaySession;
  try {
    return !!session && typeof session.canMakePayments === "function" && session.canMakePayments();
  } catch {
    return false;
  }
}

export type ApplePayHandle = {
  /** Mounts the Clover-hosted Apple Pay button into `el`. */
  mount: (el: HTMLElement) => void;
  /** Re-prices the sheet after the cart or tip changes. */
  updateAmount: (amountCents: number) => void;
  /** The amount the sheet was last told to show — i.e. what the shopper approves. */
  requestedAmount: () => number;
  /** Closes out the Apple Pay sheet. Clover allows ~30s after the token. */
  finish: (ok: boolean) => void;
  destroy: () => void;
};

export type ApplePayCallbacks = {
  /** Fires with a `clv_…` source token once the shopper authorizes the sheet. */
  onToken: (token: string) => void;
  /** Fires when the sheet is dismissed without a usable token. */
  onCancel: () => void;
};

/** The SDK hands the token back as either a bare id or an object carrying one. */
function tokenId(received: unknown): string | undefined {
  if (typeof received === "string") return received;
  const id = (received as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : undefined;
}

/**
 * `liveAmount` is read, not captured: loading the SDK takes a network round trip,
 * and a shopper adjusting the tip during it must not end up approving a sheet
 * priced before their change. `requestedAmount()` then lets the caller prove the
 * approved figure still matches the cart before any money moves.
 */
export async function initApplePay(
  liveAmount: () => number,
  cb: ApplePayCallbacks,
): Promise<ApplePayHandle> {
  if (!applePayAvailable()) throw new Error("Apple Pay is not available.");
  const { clover, elements } = await getClover();

  const makeRequest = (cents: number) =>
    clover.createApplePaymentRequest({
      // Clover stringifies this as (cents / 100).toFixed(2), so it must be cents.
      amount: cents,
      countryCode: "US",
      currencyCode: "USD",
    });

  // What the sheet is actually priced at. -1 means "unknown" — only ever set to a
  // real figure once Clover has accepted it, so a failed re-price reads as unknown
  // rather than as agreement, and the caller's check fails closed.
  let requested = -1;
  const initial = liveAmount();
  const button = elements.create("PAYMENT_REQUEST_BUTTON_APPLE_PAY", {
    applePaymentRequest: makeRequest(initial),
    sessionIdentifier: MERCHANT_ID,
  });
  requested = initial;

  // Clover raises both of these on `window`, not on the element.
  const onPaymentMethod = (e: Event) => {
    const detail = (e as CustomEvent).detail ?? {};
    const token = tokenId(detail.tokenRecieved ?? detail.tokenReceived);
    if (!token) {
      cb.onCancel();
      return;
    }
    // The server only accepts `clv_…` sources. Clover documents that prefix for the
    // token its API mints, but never for the one this iframe emits — so if they ever
    // differ, say so on the first tap instead of leaving a bare 400 to diagnose.
    if (!token.startsWith("clv_")) console.error("[apple-pay] unexpected token prefix:", token.slice(0, 6));
    cb.onToken(token);
  };
  // Only a real dismissal cancels — this event also fires for other wallet
  // windows closing, and treating those as a cancel would unwind a live order.
  const onPaymentMethodEnd = (e: Event) => {
    if ((e as CustomEvent).detail?.status === "session_cancelled") cb.onCancel();
  };
  window.addEventListener("paymentMethod", onPaymentMethod);
  window.addEventListener("paymentMethodEnd", onPaymentMethodEnd);

  return {
    mount: (el) => {
      if (!el.id) el.id = "clv-apple-pay";
      button.mount(`#${el.id}`);
    },
    updateAmount: (cents) => {
      if (cents === requested) return; // already priced; -1 always retries
      try {
        clover.updateApplePaymentRequest(makeRequest(cents));
        requested = cents;
      } catch {
        // The sheet may still be showing the old total. Record that we no longer
        // know what it says, so the caller refuses to charge rather than trusting
        // a price the shopper was never shown.
        requested = -1;
      }
    },
    requestedAmount: () => requested,
    finish: (ok) => {
      try {
        clover.updateApplePaymentStatus(ok ? "success" : "failed");
      } catch {
        /* the charge already stands or already failed — the sheet state is cosmetic */
      }
    },
    destroy: () => {
      window.removeEventListener("paymentMethod", onPaymentMethod);
      window.removeEventListener("paymentMethodEnd", onPaymentMethodEnd);
      try {
        button.destroy?.();
      } catch {
        /* ignore */
      }
    },
  };
}
