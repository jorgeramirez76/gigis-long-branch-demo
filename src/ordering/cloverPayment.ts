/**
 * clover.js hosted card fields (PCI SAQ-A). The card number / expiry / CVV live
 * inside Clover-served iframes, so raw card data never touches our JS or server.
 * We only ever receive a `clv_…` single-use token, which the backend charges.
 *
 * Card payment stays completely inert until VITE_CLOVER_PAKMS_KEY (the merchant's
 * public Ecommerce apiAccessKey) is set — until then checkout runs as pay-at-pickup.
 */

const PUBLIC_KEY = import.meta.env.VITE_CLOVER_PAKMS_KEY as string | undefined;
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
  const Clover = await loadSdk();
  const clover = new Clover(PUBLIC_KEY);
  const elements = clover.elements();
  const number = elements.create("CARD_NUMBER", FIELD_STYLE);
  const date = elements.create("CARD_DATE", FIELD_STYLE);
  const cvv = elements.create("CARD_CVV", FIELD_STYLE);
  const postal = elements.create("CARD_POSTAL_CODE", FIELD_STYLE);

  return {
    mount: (m) => {
      number.mount(m.number);
      date.mount(m.date);
      cvv.mount(m.cvv);
      postal.mount(m.postal);
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
