#!/usr/bin/env python3
"""Generate src/data/menuIndex.ts — the site item ↔ Clover item-id map.

The nightly refresh (api/cron/refresh-menu.ts) uses this to answer one question
per menu row: "does this still exist and is it still sellable in Clover?" It
matches on Clover ITEM IDs, not names, so the owner renaming an item in Clover
never causes it to be dropped from the site.

Source of truth: the same data/clover/classified/*.json that build-menu.py uses
(display names) plus data/clover/clover-menu-dump.json (raw Clover names → ids).
A site row with no id here is simply never pruned — unverifiable is not "gone".

Run: python3 scripts/build-menu-index.py   (from the repo root)
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "clover" / "classified"
DUMP = ROOT / "data" / "clover" / "clover-menu-dump.json"
OUT = ROOT / "src" / "data" / "menuIndex.ts"

sys.path.insert(0, str(ROOT / "scripts"))
from importlib.machinery import SourceFileLoader

_bm = SourceFileLoader("build_menu", str(ROOT / "scripts" / "build-menu.py")).load_module()
CATEGORY_ORDER = _bm.CATEGORY_ORDER


def norm(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


def main() -> int:
    dump = json.loads(DUMP.read_text())
    ids_by_name: dict[str, list[str]] = {}
    for it in dump["items"]:
        ids_by_name.setdefault(norm(it["name"]), []).append(it["id"])

    files = {p.stem: json.loads(p.read_text()) for p in SRC.glob("*.json")}
    entries = []
    matched = unmatched = 0
    for slug in CATEGORY_ORDER:
        cat = files.get(slug)
        if not cat:
            continue
        seen = set()
        for i in cat.get("items", []):
            if not i.get("include"):
                continue
            key = (i["displayName"].strip().lower(), i.get("priceCents"))
            if key in seen:
                continue
            seen.add(key)
            ids = ids_by_name.get(norm(i["name"]), [])
            if ids:
                matched += 1
                entries.append({"cat": slug, "name": i["displayName"], "ids": ids})
            else:
                unmatched += 1

    lines = [
        "// GENERATED FILE — do not hand-edit.",
        "// Source: data/clover/classified/*.json + data/clover/clover-menu-dump.json.",
        "// Regenerate: python3 scripts/build-menu-index.py",
        "",
        "/** A site menu row and the Clover item id(s) it was built from. A row is",
        " *  dropped by the nightly refresh only when EVERY one of its ids is gone,",
        " *  hidden, or unavailable in Clover. */",
        "export type MenuIndexEntry = { cat: string; name: string; ids: string[] };",
        "",
        "export const MENU_INDEX: MenuIndexEntry[] = [",
    ]
    for e in entries:
        ids = ", ".join(json.dumps(i) for i in e["ids"])
        lines.append(
            f'  {{ cat: {json.dumps(e["cat"])}, name: {json.dumps(e["name"], ensure_ascii=False)}, ids: [{ids}] }},'
        )
    lines.append("];")
    lines.append("")
    OUT.write_text("\n".join(lines))
    print(f"wrote {OUT.relative_to(ROOT)} — {matched} rows mapped, {unmatched} unmapped (kept, never pruned)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
