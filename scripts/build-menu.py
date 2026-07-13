#!/usr/bin/env python3
"""Generate src/data/menuGenerated.ts from Clover-classified category JSON.

Source of truth: data/clover/classified/*.json — produced by the agent
classification pass over the raw Clover inventory dump
(data/clover/clover-menu-dump.json), then adversarially verified.

Run: python3 scripts/build-menu.py   (from the repo root)
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "clover" / "classified"
OUT = ROOT / "src" / "data" / "menuGenerated.ts"

# Dining-order for included categories; slugs not listed here are excluded.
# Built from Gigi's Long Branch Clover categories (pulled 2026-07-12).
# Removed per owner (2026-07-13): breakfast, wine, jar-sauce (Take-Home Sauce),
# acai (Açaí Bowls), brazilian, mexican, chubbzie-wubbzies. Their classified/*.json
# still exist but are intentionally excluded here so a future re-pull won't re-add them.
CATEGORY_ORDER = [
    "pizza",
    "slices",
    "appetizers",
    "french-fries",
    "salads",
    "soups",
    "heroes",
    "wraps",
    "paninis",
    "burgers",
    "hot-dogs",
    "chicken-dishes",
    "seafood",
    "pasta",
    "special",
    "kids-menu",
    "catering",
    "desserts",
    "snacks",
    "drinks",
]

# Category display-name overrides (post-agent editorial fixes).
RENAME = {
    "heroes": "Heroes & Subs",
    "chubbzie-wubbzies": "Chubbzie Wubbzies",
    "chicken-dishes": "Chicken Dinners",
    "special": "House Specials",
    "hot-dogs": "Hot Dogs",
    "french-fries": "Loaded Fries",
    "jar-sauce": "Take-Home Sauce",
    "acai": "Açaí Bowls",
}

# Blurbs for the big sections (shown under the category heading).
BLURBS = {
    "pizza": "Hand-stretched NY rounds, Grandma and Sicilian squares, stuffed pies, and the specialty creations. Toppings and half-pie options under each pie.",
    "slices": "By the slice, all day.",
    "heroes": "Hot and cold heroes, clubs, and the numbered specialty subs.",
    "breakfast": "Breakfast served daily — sandwiches, platters, omelettes, pancakes, and French toast.",
    "catering": "Half trays and full trays for parties and offices — call ahead: (732) 377-2468.",
    "special": "The rotating house specials board — daily favorites and Gigi's originals.",
}

# `popular` flags — house signatures called out on the site.
POPULAR = {
    "grandma",
    "margherita",
    "the fonz",
    "vodka pie",
    "gigi's salad",
}


def cents_display(delta: int) -> str:
    return f"+${delta / 100:.2f}"


def ts_str(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def main() -> int:
    if not SRC.is_dir():
        print(f"missing {SRC} — copy the classified outputs first", file=sys.stderr)
        return 1

    files = {p.stem: json.loads(p.read_text()) for p in SRC.glob("*.json")}
    missing = [s for s in CATEGORY_ORDER if s not in files]
    if missing:
        print(f"WARNING: ordered slugs missing classified files: {missing}", file=sys.stderr)

    lines = [
        "// GENERATED FILE — do not hand-edit.",
        "// Source: data/clover/classified/*.json (Clover POS inventory, classified + verified).",
        "// Regenerate: python3 scripts/build-menu.py",
        'import type { MenuCategory } from "./menuTypes";',
        "",
        "export const MENU_GENERATED: MenuCategory[] = [",
    ]

    total_items = 0
    total_choices = 0
    for slug in CATEGORY_ORDER:
        if slug not in files:
            continue
        cat = files[slug]
        display = RENAME.get(slug, cat.get("displayName") or cat["category"])
        included = [i for i in cat.get("items", []) if i.get("include")]
        if not included:
            print(f"  skip {slug}: no included items", file=sys.stderr)
            continue

        # Dedupe exact name+price repeats (POS double-entry)
        seen = set()
        items = []
        for i in included:
            key = (i["displayName"].strip().lower(), i.get("priceCents"))
            if key in seen:
                continue
            seen.add(key)
            items.append(i)

        lines.append("  {")
        lines.append(f"    id: {ts_str(slug)},")
        lines.append(f"    name: {ts_str(display)},")
        if slug in BLURBS:
            lines.append(f"    blurb: {ts_str(BLURBS[slug])},")
        lines.append("    items: [")
        for i in items:
            total_items += 1
            parts = [f"name: {ts_str(i['displayName'])}"]
            if i.get("priceDisplay"):
                parts.append(f"price: {ts_str(i['priceDisplay'])}")
            if i["displayName"].strip().lower() in POPULAR:
                parts.append("popular: true")
            opts = i.get("options") or []
            if opts:
                og = []
                for g in opts:
                    choices = []
                    for ch in g.get("choices", []):
                        total_choices += 1
                        delta = ch.get("priceDelta") or 0
                        if delta:
                            choices.append(
                                f"{{ name: {ts_str(ch['name'])}, delta: {ts_str(cents_display(delta))} }}"
                            )
                        else:
                            choices.append(f"{{ name: {ts_str(ch['name'])} }}")
                    rule = f", rule: {ts_str(g['rule'])}" if g.get("rule") else ""
                    og.append(
                        f"{{ group: {ts_str(g['groupName'])}{rule}, choices: [{', '.join(choices)}] }}"
                    )
                parts.append(f"options: [{', '.join(og)}]")
            lines.append(f"      {{ {', '.join(parts)} }},")
        lines.append("    ],")
        lines.append("  },")

    lines.append("];")
    lines.append("")
    OUT.write_text("\n".join(lines))
    print(f"wrote {OUT.relative_to(ROOT)} — {total_items} items, {total_choices} option choices")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
