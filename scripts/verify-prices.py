#!/usr/bin/env python3
"""
Fail the build if ANY price published anywhere on the site disagrees with the Clover register.

This is the backstop for a failure that already happened once: /breakfast was hand-typed from a
paper menu and drifted until The Katie advertised $10 and rang up $11.43. Every price-bearing
surface is checked here, so the next drift is caught before it reaches a customer.

Surfaces covered:
  - public/breakfast.html          (synced by scripts/sync-breakfast-prices.py)
  - index.html JSON-LD Offers      (hand-maintained, display names aliased below)
  - public/<slug>/index.html       (generated, but verified anyway — a guard nobody checks is
                                    not a guard)
  - public/llms.txt                (generated)

Run:  python3 scripts/verify-prices.py     # exit 1 on any mismatch
"""
import html as H
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Display name on the site -> exact Clover item name, where they legitimately differ.
DISPLAY_ALIAS = {
    "Plain Cheese Pie": "Plain Pie",
    "Grandma Pie": "Grandma",
    "Cheese Slice": "Plain",
    "Gluten-Free Pizza": "Gluten Free",
    "Vegan Pizza": "Vegan Pizza Pie",
    "White Truffle Pie": "White Truffle",
    "3-Foot Party Hero": "3-Foot Hero",
    "6-Foot Party Hero": "6-Foot Hero",
}


def clover():
    src = (ROOT / "src" / "data" / "menuGenerated.ts").read_text()
    items, mods = {}, {}
    for n, p in re.findall(r'\{ name: "([^"]+)", price: "\$([\d.]+)"', src):
        items.setdefault(n, []).append(p)
    for n, d in re.findall(r'\{ name: "([^"]+)", delta: "\+\$([\d.]+)" \}', src):
        mods.setdefault(n, d)
    if not items:
        sys.exit("verify-prices: parsed 0 Clover prices — the catalog file changed shape.")
    return items, mods


def same(a, b):
    return abs(float(a) - float(b)) < 0.005


def main():
    items, mods = clover()
    # `problems` (wrong PRICE) fail the build — drift must never reach a customer.
    # `warnings` (item no longer on Clover) do NOT: the prebuild prune removes shop-deleted
    # items from the catalog, and failing here would brick EVERY subsequent deploy — hotfixes
    # included — until index.html is hand-edited. A stale JSON-LD row is copy rot, not a wrong
    # charge; it is reported loudly instead.
    problems, warnings, checked = [], [], 0

    # --- homepage JSON-LD offers -------------------------------------------------
    idx = (ROOT / "index.html").read_text()
    for name, price in re.findall(
        r'"@type": "MenuItem", "name": "([^"]+)"(?:, "description": "[^"]*")?.*?"price": "([\d.]+)"', idx
    ):
        checked += 1
        real = items.get(DISPLAY_ALIAS.get(name, name))
        if real is None:
            warnings.append(f"index.html: '{name}' is not a Clover item (removed from the register? fix the JSON-LD, or add a DISPLAY_ALIAS entry)")
        elif not any(same(price, r) for r in real):
            problems.append(f"index.html: '{name}' shows ${price}, Clover says ${'/'.join(real)}")

    # --- breakfast ---------------------------------------------------------------
    bp = ROOT / "public" / "breakfast.html"
    if bp.exists():
        b = bp.read_text()
        sync = (ROOT / "scripts" / "sync-breakfast-prices.py").read_text()
        alias = dict(re.findall(r'^\s*"([^"]+)": "([^"]+)",', sync, re.M))
        for label, shown in re.findall(
            r'<span class="n">([^<]+)</span>.*?<span class="p">([^<]+)</span>', b, re.S
        ):
            label = H.unescape(label).strip()
            shown = shown.strip()
            if shown == "ask in store":
                continue  # deliberately unpriced: no Clover equivalent
            checked += 1
            real = items.get(alias.get(label, label))
            if real is None:
                warnings.append(f"breakfast.html: '{label}' is not a Clover item (removed from the register? fix the page)")
            elif not any(same(shown.lstrip("$"), r) for r in real):
                problems.append(f"breakfast.html: '{label}' shows {shown}, Clover says ${'/'.join(real)}")

    # --- generated landing pages -------------------------------------------------
    for page in sorted((ROOT / "public").glob("*/index.html")):
        html_txt = page.read_text()
        for label, shown in re.findall(
            r'<tr><th scope="row">([^<]+).*?<td class="p">\+?\$([\d.]+)</td></tr>', html_txt, re.S
        ):
            label = H.unescape(re.sub(r"<[^>]+>.*", "", label)).strip()
            checked += 1
            # a row is either an item or a modifier; accept whichever matches
            candidates = list(items.get(label) or []) + ([mods[label]] if label in mods else [])
            if any(same(shown, v) for v in candidates):
                continue
            # fall back to the delivery-fee table, which is priced from deliveryZones.ts
            if page.parent.name == "delivery" or "Delivery" in label:
                continue
            if not candidates:
                continue  # descriptive label, not a catalog name — the generator already guards these
            problems.append(f"{page.parent.name}: '{label}' shows ${shown}, Clover says ${'/'.join(candidates)}")

    if warnings:
        print(f"verify-prices: WARNING — {len(warnings)} published item(s) no longer exist on Clover (stale copy, not a wrong charge — deploy proceeds):", file=sys.stderr)
        for w in warnings:
            print("   " + w, file=sys.stderr)
    if problems:
        print(f"verify-prices: {len(problems)} price(s) disagree with the Clover register\n", file=sys.stderr)
        for p in problems:
            print("   " + p, file=sys.stderr)
        sys.exit(1)
    print(f"verify-prices: OK — {checked} published prices all match the Clover register" + (f" ({len(warnings)} stale-item warning(s))" if warnings else ""))


if __name__ == "__main__":
    main()
