#!/usr/bin/env python3
"""Normalize option-choice display names across every classified file — the
same POS abbreviations that appear in item names also appear in modifier
choices ("Gr Chic", "Bals Vinegarette", "O\\V"). Conservative whole-word map;
does not touch price deltas. Idempotent. Run after the classify passes.
"""
import json
import pathlib
import re

CLS = pathlib.Path(__file__).resolve().parent.parent / "data" / "clover" / "classified"

# phrase fixes (applied first, case-insensitive)
PHRASES = [
    (r"\bGr\s+Chic\b", "Grilled Chicken"),
    (r"\bChic\s+Cutlet\b", "Chicken Cutlet"),
    (r"\bBals\s+Vinegarette\b", "Balsamic Vinaigrette"),
    (r"\bO\s*&\s*V\b", "Oil & Vinegar"),
    (r"\bO\\V\b", "Oil & Vinegar"),
    (r"\bAmer\s+Chz\b", "American Cheese"),
    (r"\bMed\s+Rare\b", "Medium Rare"),
    (r"\bMed\s+Well\b", "Medium Well"),
]

# whole-word single-token fixes
TOKENS = {
    "chic": "Chicken",
    "chix": "Chicken",
    "chz": "Cheese",
    "saus": "Sausage",
    "mozz": "Mozzarella",
    "prov": "Provolone",
    "provo": "Provolone",
    "amer": "American",
    "bals": "Balsamic",
    "vinegarette": "Vinaigrette",
    "roni": "Pepperoni",
    "buff": "Buffalo",
}

_tok = re.compile(r"\b(" + "|".join(sorted(TOKENS, key=len, reverse=True)) + r")\b", re.I)


def clean(name: str) -> str:
    s = name.replace("\\", " & ")
    for pat, rep in PHRASES:
        s = re.sub(pat, rep, s, flags=re.I)
    s = _tok.sub(lambda m: TOKENS[m.group(0).lower()], s)
    s = re.sub(r"\s{2,}", " ", s).strip()
    return s


changed_files = 0
for p in sorted(CLS.glob("*.json")):
    j = json.loads(p.read_text())
    hit = False
    for it in j.get("items", []):
        for g in it.get("options", []) or []:
            for ch in g.get("choices", []):
                new = clean(ch["name"])
                if new != ch["name"]:
                    ch["name"] = new
                    hit = True
    if hit:
        p.write_text(json.dumps(j, indent=1, ensure_ascii=False))
        changed_files += 1
        print(f"cleaned choices in {p.stem}")
print(f"\n{changed_files} files updated")
