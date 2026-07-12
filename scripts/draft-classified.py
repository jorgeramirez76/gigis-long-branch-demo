#!/usr/bin/env python3
"""Mechanical first pass: data/clover/raw-categories/*.json -> data/clover/classified/*.json

Fills every deterministic field (prices, option groups, choose-rules) and
defaults include=true so the editorial/agent pass only has to flip flags,
fix display names, and record the category verdict.

Run: python3 scripts/draft-classified.py [--force]
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "clover" / "raw-categories"
OUT = ROOT / "data" / "clover" / "classified"

SMALL_WORDS = {"a", "an", "and", "at", "de", "in", "of", "on", "or", "the", "to", "w", "w/", "with"}


def title_name(name):
    words = name.strip().split()
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        if 0 < i and lw in SMALL_WORDS:
            out.append(lw)
        elif w.isupper() and len(w) <= 4 and not w.isalpha() is False:
            out.append(w)  # keep short all-caps tokens (BLT, NY)
        else:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


def rule_for(min_req, max_allowed):
    mn = min_req or 0
    mx = max_allowed
    if mn >= 1 and mx == 1:
        return "Choose 1"
    if mn >= 1 and mx and mx > 1:
        return f"Choose {mn}–{mx}" if mn != mx else f"Choose {mn}"
    if (not mn) and mx and mx > 0:
        return f"Choose up to {mx}" if mx > 1 else "Optional"
    return "Optional"


def main():
    force = "--force" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    for p in sorted(RAW.glob("*.json")):
        dst = OUT / p.name
        if dst.exists() and not force:
            print(f"skip {p.stem} (already classified)")
            continue
        raw = json.loads(p.read_text())
        items = []
        for it in raw["items"]:
            price = it.get("price") or 0
            variable = it.get("priceType") != "FIXED"
            entry = {
                "name": it["name"],
                "displayName": title_name(it["name"]),
                "include": not it.get("hidden", False) and it.get("available", True),
                "priceCents": None if variable else price,
                "priceDisplay": None if variable or not price else f"${price / 100:.2f}",
            }
            options = []
            for g in it.get("modifierGroups", []):
                choices = [
                    {"name": title_name(m["name"]), "priceDelta": m.get("price") or 0}
                    for m in g.get("modifiers", [])
                    if m.get("available", True)
                ]
                if choices:
                    options.append(
                        {
                            "groupName": title_name(g.get("name") or "Options"),
                            "rule": rule_for(g.get("minRequired"), g.get("maxAllowed")),
                            "choices": choices,
                        }
                    )
            if options:
                entry["options"] = options
            items.append(entry)
        out = {
            "category": raw["category"],
            "displayName": title_name(raw["category"]),
            "verdict": "REVIEW",
            "reason": "draft — awaiting editorial pass",
            "items": items,
        }
        dst.write_text(json.dumps(out, indent=1, ensure_ascii=False))
        print(f"drafted {p.stem}: {len(items)} items")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
