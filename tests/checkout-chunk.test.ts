/**
 * The checkout is its own chunk (2026-10-14). It used to ride in the homepage's main bundle only
 * because the cart, cart drawer and item modal imported one tiny helper, savedAttemptUncertain,
 * from Checkout.tsx. These tests keep that helper honest in its new home and keep every static
 * import of Checkout.tsx out of the storefront.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { FORM_STORE_KEY, readSavedForm, savedAttemptUncertain } from "../src/ordering/checkoutAttempt.js";

const g = globalThis as { localStorage?: unknown };
const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (had) Object.defineProperty(globalThis, "localStorage", had);
  else delete g.localStorage;
});
function storage(value: string | null) {
  const store = new Map<string, string>(value == null ? [] : [[FORM_STORE_KEY, value]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
  });
}

describe("savedAttemptUncertain (shared by the cart, drawer, item modal and checkout)", () => {
  it("is true only when the parked checkout form says the last attempt may have been charged", () => {
    storage(JSON.stringify({ name: "A", attemptUncertain: true }));
    assert.equal(savedAttemptUncertain(), true);
    storage(JSON.stringify({ name: "A", attemptUncertain: false }));
    assert.equal(savedAttemptUncertain(), false);
    storage(null);
    assert.equal(savedAttemptUncertain(), false);
  });

  it("treats unreadable storage as no attempt rather than crashing the cart", () => {
    storage("{not json");
    assert.deepEqual(readSavedForm(), {});
    assert.equal(savedAttemptUncertain(), false);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    assert.equal(savedAttemptUncertain(), false);
  });

  it("reads the same key the checkout writes", () => {
    assert.equal(FORM_STORE_KEY, "gigis:checkout-form", "renaming it would drop every parked uncertain attempt");
    const checkout = readFileSync(new URL("../src/ordering/Checkout.tsx", import.meta.url), "utf8");
    assert.match(checkout, /storageArea\(\)\?\.setItem\(\s*FORM_STORE_KEY,/);
    assert.match(checkout, /from "\.\/checkoutAttempt"/);
  });
});

describe("the checkout chunk", () => {
  function sources(dir: URL): string[] {
    return readdirSync(dir).flatMap((name) => {
      const url = new URL(name, dir);
      if (statSync(url).isDirectory()) return sources(new URL(`${name}/`, dir));
      return /\.(tsx?|mts)$/.test(name) ? [url.pathname] : [];
    });
  }

  it("nothing in the storefront imports Checkout.tsx statically", () => {
    for (const file of sources(new URL("../src/", import.meta.url))) {
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(src, /^\s*import\s[^;]*from\s+["'](\.\/|\.\.\/ordering\/)Checkout["']/m, `${file} pulls Checkout into the main bundle`);
    }
  });

  it("OrderingProvider fetches it after hydration and warms Clover when the cart opens", () => {
    const provider = readFileSync(new URL("../src/ordering/OrderingProvider.tsx", import.meta.url), "utf8");
    assert.match(provider, /import\("\.\/Checkout"\)/);
    // Early, not on the tap: a chunk requested long after page load can be gone after a deploy.
    assert.match(provider, /requestIdleCallback\(load, \{ timeout: 4000 \}\)/);
    assert.match(provider, /window\.setTimeout\(load, 2000\)/);
    assert.match(provider, /if \(!cart\.isOpen\) return;\s*loadCheckout\(\)/);
    assert.match(provider, /m\.warmCheckout\(\)/);
    // A failed download must not leave a dead tap: the customer is told to reload, with the phone number.
    assert.match(provider, /Checkout didn't load/);
    assert.match(provider, /checkoutModule = null;/);
  });

  it("the checkout dialogs get a stable onClose, and the loading dialog keeps focus without stealing it", () => {
    const provider = readFileSync(new URL("../src/ordering/OrderingProvider.tsx", import.meta.url), "utf8");
    // An inline arrow is a new function on every render, which re-ran the dialogs' focus effects
    // (Shell's and CheckoutLoading's) and pulled focus back to their first control.
    assert.match(provider, /const closeCheckout = useCallback\(\(\) => setCheckoutOpen\(false\), \[\]\);/);
    assert.match(provider, /<CheckoutView onClose=\{closeCheckout\} \/>/);
    assert.match(provider, /<CheckoutLoading failed=\{checkoutLoadFailed\} onClose=\{closeCheckout\} \/>/);
    assert.doesNotMatch(provider, /onClose=\{\(\) => setCheckoutOpen\(false\)\}/);
    const loading = provider.slice(provider.indexOf("function CheckoutLoading"));
    assert.match(loading, /useEffect\(\(\) => \{ actionRef\.current\?\.focus\(\); \}, \[failed\]\);/, "focus moves only on open and on failure");
    assert.match(loading, /e\.key !== "Tab"/, "Tab is kept inside the dialog");
  });
});
