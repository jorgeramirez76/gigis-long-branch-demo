import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

/** Every text-entry element (input that is not a checkbox/radio, or textarea) in a file. */
function textEntries(src: string): { line: number; tag: string }[] {
  const out: { line: number; tag: string }[] = [];
  const re = /<(input|textarea)\b/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const end = src.indexOf("/>", m.index);
    const tag = src.slice(m.index, end + 2);
    if (/type="(checkbox|radio|hidden)"/.test(tag)) continue;
    out.push({ line: src.slice(0, m.index).split("\n").length, tag });
  }
  return out;
}

describe("phones: no zoom-on-tap, real labels, light hero", () => {
  it("every customer-facing text field is 16px on phones (iOS Safari zooms on anything smaller)", () => {
    const files = [
      ...readdirSync(new URL("../src/ordering/", import.meta.url)).filter((f) => f.endsWith(".tsx")).map((f) => `src/ordering/${f}`),
      ...readdirSync(new URL("../src/components/", import.meta.url)).filter((f) => f.endsWith(".tsx")).map((f) => `src/components/${f}`),
    ];
    let seen = 0;
    for (const file of files) {
      for (const { line, tag } of textEntries(read(file))) {
        seen++;
        const cls = /className="([^"]*)"/.exec(tag)?.[1] ?? "";
        // text-base is 16px. "sm:text-sm" above the phone breakpoint is fine; a bare text-sm/xs is not.
        const phoneSize = cls.split(/\s+/).filter((c) => /^text-(xs|sm|base|lg|\[\d+px\])$/.test(c));
        assert.ok(phoneSize.includes("text-base") || phoneSize.includes("text-lg"), `${file}:${line} renders its text below 16px on phones (${phoneSize.join(" ") || "no size"})`);
      }
    }
    assert.ok(seen >= 15, `expected the checkout, VIP and menu fields to be scanned (saw ${seen})`);
  });

  it("the checkout's VIP address fields have accessible names, not just placeholders", () => {
    const src = read("src/ordering/Checkout.tsx");
    for (const label of ["Home street address", "Apartment or unit (optional)", "City or town", "ZIP code"]) {
      assert.ok(src.includes(`aria-label="${label}"`), `missing aria-label ${label}`);
    }
  });

  it("phones get the wide hero crop; the portrait stays for wider screens", () => {
    const hero = read("src/components/Hero.tsx");
    const wide = hero.indexOf('media="(max-width: 767px)" type="image/webp" srcSet={HERO_IMAGE.webpWide}');
    const portrait = hero.indexOf("srcSet={HERO_IMAGE.webpPortrait}");
    assert.ok(wide > 0, "the phone <source> must offer HERO_IMAGE.webpWide");
    assert.ok(portrait > wide, "the phone source must come first: a <picture> uses the first matching <source>");
    // The breakpoint must match the CSS that makes the hero a short strip.
    const css = read("src/styles/storefront.css");
    const strip = css.indexOf(".food-hero-photo { grid-row:1; height:clamp(170px, 52vw, 230px)");
    assert.ok(strip > 0 && css.lastIndexOf("@media (max-width:767px) {", strip) > css.lastIndexOf("}\n}", strip),
      "the short hero strip must still be the max-width:767px rule");
  });
});

describe("checkout layout", () => {
  it("the promo code and order note come before Apple Pay, which charges on the tap", () => {
    const src = read("src/ordering/Checkout.tsx");
    const promo = src.indexOf('<p className="mb-2 text-sm font-bold text-[var(--color-copy)]">Promo code</p>');
    const note = src.indexOf('htmlFor="order-note"');
    const applePay = src.indexOf("ref={applePayMountRef}");
    const cardFields = src.indexOf('<CardField label="Card number"');
    assert.ok(promo > 0 && note > 0 && applePay > 0 && cardFields > 0);
    assert.ok(promo < applePay && promo < cardFields, "promo box must render above the payment buttons");
    assert.ok(note < applePay && note < cardFields, "order note must render above the payment buttons");
  });
});
