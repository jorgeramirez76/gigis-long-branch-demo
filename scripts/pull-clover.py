#!/usr/bin/env python3
"""Pull the full Clover inventory for Gigi's Long Branch into data/clover/.

Auth: merchant API token in .env (CLOVER_API_TOKEN + CLOVER_MERCHANT_ID) —
passed as ?access_token= (Bearer headers 401 on this token type).

Outputs (same shapes the Sea Bright pipeline used, so build-menu.py and the
classification pass work unchanged):
  data/clover/clover-menu-dump.json   — normalized {categories, items, modifierGroups}
  data/clover/raw-categories/<slug>.json — per-category items with resolved modifier groups

Run: python3 scripts/pull-clover.py   (from the repo root)
"""

import json
import pathlib
import re
import sys
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "clover"
RAW_DIR = OUT_DIR / "raw-categories"

API = "https://api.clover.com/v3/merchants"


def load_env() -> dict:
    env = {}
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def fetch_all(base_url, token, expand=None):
    """Paginate a Clover v3 collection endpoint (limit/offset)."""
    out = []
    offset = 0
    limit = 1000
    while True:
        params = {"access_token": token, "limit": str(limit), "offset": str(offset)}
        if expand:
            params["expand"] = expand
        url = f"{base_url}?{urllib.parse.urlencode(params)}"
        with urllib.request.urlopen(url, timeout=60) as r:
            data = json.load(r)
        elements = data.get("elements", [])
        out.extend(elements)
        if len(elements) < limit:
            return out
        offset += limit


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "unnamed"


def main() -> int:
    env = load_env()
    token = env.get("CLOVER_API_TOKEN")
    mid = env.get("CLOVER_MERCHANT_ID")
    if not token or not mid:
        print("CLOVER_API_TOKEN / CLOVER_MERCHANT_ID missing from .env", file=sys.stderr)
        return 1

    base = f"{API}/{mid}"
    print(f"pulling inventory for merchant {mid} …")
    items_raw = fetch_all(f"{base}/items", token, expand="categories,modifierGroups")
    cats_raw = fetch_all(f"{base}/categories", token, expand="items")
    mgs_raw = fetch_all(f"{base}/modifier_groups", token, expand="modifiers")
    print(f"  {len(items_raw)} items, {len(cats_raw)} categories, {len(mgs_raw)} modifier groups")

    # --- normalized dump (same shape as the Sea Bright pull) ---
    mods_by_id = {}
    modifier_groups = []
    for g in sorted(mgs_raw, key=lambda g: g.get("sortOrder") or 0):
        norm = {
            "id": g["id"],
            "name": g.get("name", ""),
            "minRequired": g.get("minRequired"),
            "maxAllowed": g.get("maxAllowed"),
            "sortOrder": g.get("sortOrder"),
            "modifiers": [
                {
                    "name": m.get("name", ""),
                    "price": m.get("price", 0),
                    "available": m.get("available", True),
                }
                for m in (g.get("modifiers") or {}).get("elements", [])
            ],
        }
        mods_by_id[g["id"]] = norm
        modifier_groups.append(norm)

    items = []
    for i in items_raw:
        items.append(
            {
                "id": i["id"],
                "name": i.get("name", ""),
                "price": i.get("price", 0),
                "priceType": i.get("priceType", "FIXED"),
                "hidden": i.get("hidden", False),
                "available": i.get("available", True),
                "cats": [c["id"] for c in (i.get("categories") or {}).get("elements", [])],
                "mods": [g["id"] for g in (i.get("modifierGroups") or {}).get("elements", [])],
            }
        )

    categories = []
    for c in sorted(cats_raw, key=lambda c: c.get("sortOrder") or 0):
        categories.append(
            {
                "id": c["id"],
                "name": c.get("name", ""),
                "sortOrder": c.get("sortOrder"),
                "itemIds": [i["id"] for i in (c.get("items") or {}).get("elements", [])],
            }
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dump = {"categories": categories, "items": items, "modifierGroups": modifier_groups}
    (OUT_DIR / "clover-menu-dump.json").write_text(json.dumps(dump, indent=1, ensure_ascii=False))
    print(f"wrote data/clover/clover-menu-dump.json")

    # --- per-category raw files for the classification pass ---
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    items_by_id = {i["id"]: i for i in items}
    categorized = set()
    slug_counts = {}

    def write_cat(name, sort_order, member_items):
        slug = slugify(name)
        n = slug_counts.get(slug, 0)
        slug_counts[slug] = n + 1
        if n:
            slug = f"{slug}-{n + 1}"
        payload = {
            "category": name,
            "sortOrder": sort_order,
            "items": [
                {
                    "name": it["name"],
                    "price": it["price"],
                    "priceType": it["priceType"],
                    "hidden": it["hidden"],
                    "available": it["available"],
                    "modifierGroups": [
                        {
                            "name": mods_by_id[mid_]["name"],
                            "minRequired": mods_by_id[mid_]["minRequired"],
                            "maxAllowed": mods_by_id[mid_]["maxAllowed"],
                            "modifiers": mods_by_id[mid_]["modifiers"],
                        }
                        for mid_ in it["mods"]
                        if mid_ in mods_by_id
                    ],
                }
                for it in member_items
            ],
        }
        (RAW_DIR / f"{slug}.json").write_text(json.dumps(payload, indent=1, ensure_ascii=False))

    for c in categories:
        member_items = [items_by_id[iid] for iid in c["itemIds"] if iid in items_by_id]
        categorized.update(i["id"] for i in member_items)
        write_cat(c["name"], c["sortOrder"], member_items)

    orphans = [i for i in items if i["id"] not in categorized]
    if orphans:
        write_cat("Uncategorized", 10**9, orphans)
        print(f"  {len(orphans)} uncategorized items -> raw-categories/uncategorized.json")

    print(f"wrote {len(list(RAW_DIR.glob('*.json')))} raw category files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
