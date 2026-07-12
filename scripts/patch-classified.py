#!/usr/bin/env python3
"""Targeted post-cleanup fixes: misfiled cross-category duplicates + a few
display-name polish items the token pass couldn't infer. Idempotent —
matches on the raw Clover item name. Run once after finish-classified.py.
"""
import json
import pathlib

CLS = pathlib.Path(__file__).resolve().parent.parent / "data" / "clover" / "classified"

# (slug, raw_name) -> exclude from menu (misfiled duplicate of another section)
EXCLUDE = [
    ("chicken-dishes", "Saturday Night Special"),   # lives in pizza
    ("seafood", "Parmigiana Combo Dinner"),          # lives in chicken-dishes
    ("soups", "Chicken Murphy Special"),             # not a soup
    ("soups", "Minestrone"),                         # dup of "Minestrone Soup"
    ("salads", "Chicken Murphy Special"),            # not a salad
]

# (slug, raw_name) -> displayName override
RENAME = {
    ("seafood", "GiGi’s Capellini"): "Gigi's Capellini",
    ("seafood", "Fried shrimp (3)Scallop (3)"): "Fried Shrimp (3) & Scallop (3)",
    ("seafood", "The Big O Seafood Platterd  Comes With Soup Or Salad"): "The Big O Seafood Platter",
    ("seafood", "Flounde alla Funghi Tartufo"): "Flounder alla Funghi Tartufo",
    ("salads", "Caesar"): "Caesar Salad",
    ("kids-menu", "Kid's Burger"): "Kids Burger",
    ("kids-menu", "Kid Pasta Butter"): "Kids Pasta with Butter",
    ("wraps", "Buff Chic\\Mac Chz Wrap"): "Buffalo Chicken Mac & Cheese Wrap",
}

by_slug = {}
for slug, raw in EXCLUDE:
    by_slug.setdefault(slug, {"exclude": set(), "rename": {}})["exclude"].add(raw)
for (slug, raw), disp in RENAME.items():
    by_slug.setdefault(slug, {"exclude": set(), "rename": {}})["rename"][raw] = disp

for slug, ops in by_slug.items():
    p = CLS / f"{slug}.json"
    j = json.loads(p.read_text())
    ex = rn = 0
    for it in j["items"]:
        if it["name"] in ops["exclude"]:
            it["include"] = False
            ex += 1
        if it["name"] in ops["rename"]:
            it["displayName"] = ops["rename"][it["name"]]
            rn += 1
    p.write_text(json.dumps(j, indent=1, ensure_ascii=False))
    print(f"{slug}: {ex} excluded, {rn} renamed")

# Blt -> BLT everywhere (whole word)
import re
for p in CLS.glob("*.json"):
    j = json.loads(p.read_text())
    changed = False
    for it in j["items"]:
        new = re.sub(r"\bBlt\b", "BLT", it["displayName"])
        if new != it["displayName"]:
            it["displayName"] = new
            changed = True
    if changed:
        p.write_text(json.dumps(j, indent=1, ensure_ascii=False))
        print(f"{p.stem}: BLT casing fixed")
