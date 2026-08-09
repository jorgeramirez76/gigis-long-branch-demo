#!/usr/bin/env python3
"""
Force every price on public/breakfast.html to match the Clover register.

WHY: /breakfast was the only page whose prices were hand-typed from a paper menu instead of being
derived from the POS. All 34 were round dollars while the register uses cents on 34 of 36 items, and
they had drifted — The Katie advertised $10 and rang up $11.43, so the customer paid $1.43 more than
the page promised. Every other surface (landing pages, llms.txt, the React menu) already reads from
src/data/menuGenerated.ts; this brings the last one into line.

HOW: an explicit alias map from the page's display label to the exact Clover item name. Aliases are
required rather than fuzzy-matched, because "Cheese" on the page means "Cheese Omelette" in Clover
and a fuzzy match would happily bind it to "Cheese Slice".

The script REFUSES to write if a mapped Clover item has disappeared, and it never invents a price:
items with no Clover equivalent render "ask in store" rather than a number, and are reported so a
human can either add them to Clover or drop them from the page.

Run:  python3 scripts/sync-breakfast-prices.py
"""
import html as H
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "public" / "breakfast.html"

# page label -> exact Clover item name.
ALIAS = {
    "Full Stack (3)": "Full Stack Pancakes (3)",
    "Short Stack (2)": "Short Stack Pancakes (2)",
    "French Toast (2)": "French Toast (2)",
    "The #1": "The #1 Platter",
    "The #2": "The #2 Platter",
    "The #3": "The #3 Platter",
    "Egg Sandwich": "Egg Sandwich",
    "Egg & Cheese Sandwich": "Egg & Cheese Sandwich",
    "Bacon, Egg & Cheese": "Bacon Egg & Cheese",
    "Sausage, Egg & Cheese": "Sausage Egg & Cheese",
    "Pork Roll, Egg & Cheese": "Pork Roll Egg & Cheese",
    "Turkey Bacon, Egg & Cheese": "Turkey Bacon Egg & Cheese",
    "The 'Katie'": "The Katie",
    "Burrito Bomber": "Burrito Bomber",
    "Veggie Burrito": "Vegito Burrito",
    # The omelette block lists bare adjectives; Clover spells the item out.
    "Cheese": "Cheese Omelette",
    "Meat & Cheese": "Meat & Cheese Omelette",
    "Veggie": "Veggie Omelette",
    "Egg White": "Egg White Omelette",
    "B-Fit": "B-Fit Omelette",
    "Western": "Western Omelette",
    "Mediterranean": "Mediterranean Omelette",
    "Chorizo Con Huevos": "Chorizo con Huevos",
    "Home-Fries": "Side Home Fries",
    # Sides where the page and the register describe DIFFERENT portions. The register wins on both
    # count and price, so the label is rewritten too — otherwise the page would promise three
    # rashers at the two-rasher price.
    "Bacon (3)": "Bacon (2 Pieces)",
    "Turkey Bacon (3)": "Turkey Bacon (2 Pieces)",
    "Pork Roll (2)": "Pork Roll (2 Pieces)",
    "Sausage — Patty (2) or Links (3)": "Sausage (3)",
}

# Labels the register has no equivalent for. Not priced, not invented — surfaced for a decision.
NO_CLOVER_ITEM = {
    "The Nicky Brunch",
    "Chico Burrito",
    "Bagels",
    "Boar's Head Ham (3)",
    "Tater-Tots",
    "Toast — White, Wheat or Rye",
}

# The one feature block, priced separately in the markup.
FEATURE = ("The Gigi Skillet", "The Gigi Skillet")


def clover_prices():
    src = (ROOT / "src" / "data" / "menuGenerated.ts").read_text()
    out = {}
    for n, p in re.findall(r'\{ name: "([^"]+)", price: "\$([\d.]+)"', src):
        out.setdefault(n, p)
    if not out:
        raise SystemExit("sync-breakfast-prices: parsed 0 prices — refusing to touch the page.")
    return out


def money(p: str) -> str:
    """Register prices carry cents; show them exactly as charged."""
    return f"${p}"


def main():
    prices = clover_prices()

    missing = [c for c in list(ALIAS.values()) + [FEATURE[1]] if c not in prices]
    if missing:
        raise SystemExit(
            "sync-breakfast-prices: these Clover items no longer exist — update ALIAS instead of "
            "publishing a stale price:\n  " + "\n  ".join(missing)
        )

    text = PAGE.read_text()
    changed, unpriced, untouched = [], [], []

    def fix_row(m):
        label_raw, old = m.group(1), m.group(2)
        label = H.unescape(label_raw).strip()
        if label in NO_CLOVER_ITEM:
            unpriced.append((label, old))
            # No register price exists. Say so rather than show a number nobody will honour.
            return m.group(0).replace(f'<span class="p">${old}</span>',
                                      '<span class="p">ask in store</span>')
        clover = ALIAS.get(label)
        if not clover:
            untouched.append((label, old))
            return m.group(0)
        new = prices[clover]
        if f"{float(old):.2f}" != f"{float(new):.2f}":
            changed.append((label, old, new, clover))
        row = m.group(0).replace(f'<span class="p">${old}</span>', f'<span class="p">{money(new)}</span>')
        # Where the register's portion differs from the page's, adopt the register's wording too.
        if clover != label and re.search(r"\(\d|Pieces", clover):
            row = row.replace(f'<span class="n">{label_raw}</span>', f'<span class="n">{H.escape(clover)}</span>')
        return row

    text = re.sub(
        r'<span class="n">([^<]+)</span>\s*<span class="dots"></span>\s*<span class="p">\$([\d.]+)</span>',
        fix_row, text)

    # the feature (skillet) block
    fm = re.search(r'<div class="price-big">\$([\d.]+)</div>', text)
    if fm:
        old, new = fm.group(1), prices[FEATURE[1]]
        if f"{float(old):.2f}" != f"{float(new):.2f}":
            changed.append((FEATURE[0], old, new, FEATURE[1]))
        text = text.replace(f'<div class="price-big">${old}</div>', f'<div class="price-big">{money(new)}</div>', 1)

    PAGE.write_text(text)

    print(f"breakfast prices synced to Clover — {len(changed)} corrected")
    for label, old, new, clover in changed:
        print(f"   {label[:34]:36s} ${old:>6s} -> ${new:<7s} ({clover})")
    if unpriced:
        print(f"\n{len(unpriced)} item(s) have NO Clover equivalent — now show 'ask in store':")
        for label, old in unpriced:
            print(f"   {label[:34]:36s} was ${old}")
        print("   Either add them to Clover, or remove them from the page.")
    if untouched:
        print(f"\n{len(untouched)} label(s) not in ALIAS and left alone:")
        for label, old in untouched:
            print(f"   {label} (${old})")


if __name__ == "__main__":
    main()
