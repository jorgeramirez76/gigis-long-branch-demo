#!/usr/bin/env python3
"""Finish the draft classified files the credit-interrupted agents didn't reach.

Deterministic editorial pass over the still-REVIEW food categories:
  - expand Clover POS abbreviations in displayName (whole-word, safe)
  - normalize backslash separators and stray double spaces
  - drop the POS 'Custom Item' create-your-own placeholder
  - set the category verdict to include

Specific misfiled-duplicate exclusions are applied separately (targeted edits),
and 'uncategorized' is left excluded (POS-internal junk). Idempotent.

Run: python3 scripts/finish-classified.py
"""

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
CLS = ROOT / "data" / "clover" / "classified"

FOOD_DRAFTS = [
    "chicken-dishes",
    "french-fries",
    "kids-menu",
    "paninis",
    "salads",
    "seafood",
    "soups",
    "wraps",
]

# whole-word POS abbreviation expansions (case-insensitive match, fixed replacement)
TOKENS = {
    "chix": "Chicken",
    "chic": "Chicken",
    "chz": "Cheese",
    "chzburger": "Cheeseburger",
    "chzstk": "Cheesesteak",
    "saus": "Sausage",
    "mozz": "Mozzarella",
    "stix": "Sticks",
    "fing": "Fingers",
    "buff": "Buffalo",
    "czr": "Caesar",
    "ff": "Fries",
    "grill": "Grilled",
    "marniara": "Marinara",
    "gigis": "Gigi's",
    "grammys": "Grammy's",
    "nickys": "Nicky's",
    "janyes": "Janye's",
    "flounde": "Flounder",
    "platterd": "Platter",
    "hotdog": "Hot Dog",
    "eggplant": "Eggplant",
}

DROP_RAW = {"Custom Item"}  # POS create-your-own placeholder


def expand(name: str) -> str:
    # backslash = separator in the POS ("Mac\chz", "Buff Chic\Mac Chz")
    name = name.replace("\\", " & ")

    def repl(m):
        w = m.group(0)
        rep = TOKENS[w.lower()]
        return rep

    pattern = re.compile(r"\b(" + "|".join(sorted(TOKENS, key=len, reverse=True)) + r")\b", re.I)
    name = pattern.sub(repl, name)
    # "Kid " / "Kid's" handling: Kid -> Kids (but not "Kid's")
    name = re.sub(r"\bKid\b(?!['s])", "Kids", name)
    name = re.sub(r"\s{2,}", " ", name).strip()
    name = name.replace(" & & ", " & ")
    return name


def main():
    for slug in FOOD_DRAFTS:
        p = CLS / f"{slug}.json"
        j = json.loads(p.read_text())
        kept = []
        for it in j["items"]:
            if it["name"] in DROP_RAW:
                it["include"] = False
            it["displayName"] = expand(it["displayName"])
            kept.append(it)
        j["items"] = kept
        j["verdict"] = "include"
        if j.get("reason", "").startswith("draft"):
            j["reason"] = f"Real customer-facing {j['displayName'].lower()} category."
        j["displayName"] = expand(j.get("displayName") or j["category"])
        p.write_text(json.dumps(j, indent=1, ensure_ascii=False))
        print(f"finished {slug}: {sum(1 for i in kept if i['include'])}/{len(kept)} included")

    # uncategorized stays out of the menu
    up = CLS / "uncategorized.json"
    uj = json.loads(up.read_text())
    uj["verdict"] = "exclude"
    uj["reason"] = "POS-internal bucket — hospital/catering order tickets, staff items, gift cards, dated party lines, and cross-listed duplicates. Not a customer menu section."
    up.write_text(json.dumps(uj, indent=1, ensure_ascii=False))
    print("marked uncategorized: exclude")


if __name__ == "__main__":
    main()
