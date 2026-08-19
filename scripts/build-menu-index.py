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
import time

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
    # The price that separates two Clover items sharing a name comes FROM this dump, so a
    # stale dump silently regresses the twin disambiguation (rows fall back to carrying
    # every candidate id). Refuse to build the index from data old enough to have drifted.
    age_h = (time.time() - DUMP.stat().st_mtime) / 3600
    if age_h > 24:
        sys.exit(f"build-menu-index: {DUMP.name} is {age_h:.0f}h old — run scripts/pull-clover.py first.")
    dump = json.loads(DUMP.read_text())
    # (id, price) — the price is what separates two Clover items that share a name.
    ids_by_name: dict[str, list[tuple[str, int]]] = {}
    for it in dump["items"]:
        ids_by_name.setdefault(norm(it["name"]), []).append((it["id"], it.get("price")))

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
            # Clover has several items sharing a name at different prices (Shrimp Oreganata is
            # a $27.04 seafood dinner AND a $67.60 catering tray). Keying on the name alone gave
            # BOTH site rows BOTH ids, which made the nightly job compare the dinner's price
            # against the tray — a nightly "price drift" alert for a price that was never wrong —
            # and let a row stay orderable because its same-named twin was still sellable.
            # Prefer the id whose Clover price matches this row; fall back to all when none does,
            # since an unverifiable row must never be pruned.
            candidates = ids_by_name.get(norm(i["name"]), [])
            exact = [cid for cid, price in candidates if price is not None and price == i.get("priceCents")]
            ids = exact or [cid for cid, _ in candidates]
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
