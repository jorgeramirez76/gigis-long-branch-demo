#!/usr/bin/env python3
"""Generate public/menu/index.html — the crawlable full menu with prices.

Every price is read from src/data/menuGenerated.ts (the same Clover-fed catalog the
React app and the order API price from), so this page can never disagree with the
register. Runs in prebuild AFTER prune-static-menu.mjs, so a deploy regenerates it
from the post-prune catalog; verify-prices.py then checks its tables like any other
public/*/index.html page.

Styling is lifted verbatim from a generated landing page so the cluster stays visually
in lockstep — if that extraction ever fails, the build fails loudly rather than
shipping an unstyled page.

Run: python3 scripts/build-menu-page.py   (from the repo root)
"""

import html
import json
import pathlib
import re
import sys

import seo_photos

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "data" / "menuGenerated.ts"
CSS_DONOR = ROOT / "public" / "pizza-delivery-west-end-long-branch" / "index.html"
OUT = ROOT / "public" / "menu" / "index.html"

BASE = "https://gigislongbranch.com"
TEL = "tel:+17323772468"
PHONE = "(732) 377-2468"


def E(s: str) -> str:
    return html.escape(s, quote=True)


def parse_menu():
    """Categories in menu order: (id, name, blurb, [(item, price), ...])."""
    src = SRC.read_text()
    cats = []
    # Split on category objects; each starts with `id: "..."` then `name: "..."`.
    blocks = re.split(r"\n  \{\n", src)
    for b in blocks:
        m = re.match(r'\s*id: "([a-z-]+)",\s*\n\s*name: "([^"]+)"', b)
        if not m:
            continue
        blurb = re.search(r'blurb:\s*"((?:[^"\\]|\\.)*)"', b)
        items = [
            (unq(n), p, unq(d))
            for n, p, d in re.findall(
                r'\{ name: "((?:[^"\\]|\\.)*)", price: "(\$[\d.]+)"(?:, description: "((?:[^"\\]|\\.)*)")?', b
            )
        ]
        cats.append((m.group(1), m.group(2), unq(blurb.group(1)) if blurb else "", items))
    total = sum(len(c[3]) for c in cats)
    if total < 100 or len(cats) < 10:
        sys.exit(f"build-menu-page: parsed only {total} items / {len(cats)} categories — catalog shape changed, refusing to write")
    return cats


def unq(s: str) -> str:
    return s.replace('\\"', '"')


def menu_ld(cats):
    """The full priced menu as schema.org Menu, so search engines and AI answers can quote any
    item and price. index.html's Restaurant points its hasMenu at this @id; it used to point at a
    hand-kept 19-item excerpt on the homepage that covered a fraction of the register."""
    def item(name, price, desc):
        node = {"@type": "MenuItem", "name": name}
        if desc:
            node["description"] = desc
        if re.search(r"gluten[- ]free", name, re.I):
            node["suitableForDiet"] = "https://schema.org/GlutenFreeDiet"
        elif re.search(r"\bvegan\b", name, re.I):
            node["suitableForDiet"] = "https://schema.org/VeganDiet"
        node["offers"] = {"@type": "Offer", "price": price.lstrip("$"), "priceCurrency": "USD"}
        return node

    return {
        "@type": "Menu",
        "@id": f"{BASE}/menu/#menu",
        "name": "Gigi's NY Style Pizza Menu — Long Branch",
        "url": f"{BASE}/menu/",
        "inLanguage": "en-US",
        "hasMenuSection": [
            {
                "@type": "MenuSection",
                "name": name,
                **({"description": blurb} if blurb else {}),
                "url": f"{BASE}/menu/#{cid}",
                "hasMenuItem": [item(*i) for i in items],
            }
            for cid, name, blurb, items in cats if items
        ],
    }


def css_from_donor() -> str:
    m = re.search(r"<style>(.*?)</style>", CSS_DONOR.read_text(), re.S)
    if not m:
        sys.exit("build-menu-page: no <style> block in the donor landing page — regenerate landing pages first")
    return m.group(1)


def main():
    cats = parse_menu()
    total = sum(len(c[3]) for c in cats)
    css = css_from_donor()

    sections = []
    toc = "".join(
        f'<a class="btn btn-ghost" href="#{cid}" style="margin:.2rem .25rem .2rem 0">{E(name)}</a>'
        for cid, name, _, items in cats if items
    )
    for cid, name, blurb, items in cats:
        if not items:
            continue
        rows = "".join(
            f'<tr><th scope="row">{E(n)}</th><td class="p">{E(p)}</td></tr>' for n, p, _ in items
        )
        blurb_html = f"<p>{E(blurb)}</p>" if blurb else ""
        sections.append(
            f'<section class="wrap" id="{cid}"><h2>{E(name)}</h2>{blurb_html}'
            f'<p><a href="{BASE}/?category={cid}#menu">Order from {E(name)}</a></p>'
            f'<table class="ptable"><caption>{E(name)} — prices</caption>'
            '<thead><tr><th scope="col">Item</th><th scope="col" style="text-align:right">Price</th></tr></thead>'
            f"<tbody>{rows}</tbody></table></section>"
        )

    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebPage", "@id": f"{BASE}/menu/", "url": f"{BASE}/menu/",
                "name": "Gigi's Long Branch Menu & Prices",
                "about": {"@id": f"{BASE}/#restaurant"},
                "mainEntity": {"@id": f"{BASE}/menu/#menu"},
                "description": "The full Gigi's NY Style Pizza menu with prices, fed from the register.",
            },
            menu_ld(cats),
            {
                "@type": "BreadcrumbList", "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Gigi's Long Branch", "item": f"{BASE}/"},
                    {"@type": "ListItem", "position": 2, "name": "Menu & Prices", "item": f"{BASE}/menu/"},
                ],
            },
        ],
    }
    # "</" cannot appear inside the script element; item text is register data, so guard it.
    ld = ('<script type="application/ld+json">'
          + json.dumps(graph, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
          + "</script>")

    photos = "".join(
        seo_photos.figure(name, caption)
        for name, caption in (("bee-sting", "Bee Sting"), ("drunken-grandma", "Drunken Grandma"),
                              ("grandma", "Grandma pie"), ("plain-pie", "Plain pie"))
    )

    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pizza Menu &amp; Prices in Long Branch | Gigi's</title>
<meta name="description" content="Gigi's Long Branch menu with prices: NY pies, Grandma squares, the Bee Sting, The Fonz and Drunken Grandma, heroes, pasta and all-day breakfast.">
<link rel="canonical" href="{BASE}/menu/">
<meta name="robots" content="index, follow, max-snippet:-1">
<link rel="icon" href="/favicon.ico">
{ld}
<style>{css}{seo_photos.STYLE}</style>
<script type="module" src="/metrics.js"></script>
</head>
<body>
<header class="site"><div class="row">
<img src="/logo-sm.png" alt="Gigi's NY Style Pizza logo" width="145" height="157" fetchpriority="high" decoding="async">
<div class="name">GIGI'S<small>NY STYLE PIZZA · LONG BRANCH</small></div>
<a class="btn btn-gold" href="{BASE}/#menu">Order Now</a></div></header>

<section class="hero"><div class="wrap">
<p class="eyebrow">Full menu &amp; prices · Long Branch, NJ</p>
<h1>Gigi's Long Branch Menu with Prices</h1>
<p class="dek">Every item and every price below comes straight from the register — {total} items across {len([c for c in cats if c[3]])} categories: hand-stretched NY pies, Grandma and Sicilian squares, heroes, pasta, all-day breakfast, and more. Order pickup or delivery online, or call {PHONE}.</p>
<p>Looking for breakfast? Explore the <a href="/breakfast">breakfast menu</a>, then choose your items from the current menu below.</p>
<p class="pnote">Cash menu prices shown. Card orders add 4% card pricing, plus tax and any delivery fee. Your total is shown before you pay.</p>
<div class="cta"><a class="btn btn-gold" href="{BASE}/#menu">Order Online</a>
<a class="btn btn-ghost" href="{TEL}">Call {PHONE}</a></div>
</div></section>

<main>
<section class="wrap"><div class="photo-row">{photos}</div></section>
<section class="wrap"><h2>Jump to a section</h2><p>{toc}</p></section>
{"".join(sections)}
<section class="wrap"><h2>Ready to order?</h2>
<p>Order pickup or delivery at <a href="{BASE}/#menu">gigislongbranch.com</a> — the online menu prices every topping and option as you build your order — or call <a href="{TEL}">{PHONE}</a>. Online delivery orders close at 10 PM; online pickup orders close at 11 PM daily. The counter stays open until 11 PM Mon–Wed and midnight Thu–Sun. After online ordering closes, call or order at the counter.</p>
<p>More: <a href="/square-pizza-long-branch/">square pizza</a> · <a href="/gluten-free-pizza-long-branch/">gluten-free</a> · <a href="/vegan-pizza-long-branch/">vegan</a> · <a href="/catering-long-branch/">catering</a> · <a href="/delivery/">delivery areas &amp; fees</a> · <a href="/account/?join=1&amp;source=menu-page">VIP club (free pie)</a></p>
</section>
</main>

<footer class="site"><div class="wrap">
<strong>Gigi's NY Style Pizza — Long Branch</strong><br>140 Brighton Avenue, Long Branch, NJ 07740 · <a href="{TEL}">{PHONE}</a><br>
Mon–Wed 10 AM–11 PM · Thu–Sun 10 AM–midnight · Open 7 days<br>
<a href="/">Home</a> · <a href="{BASE}/#menu">Order online</a> · <a href="/breakfast">Breakfast</a> · <a href="/pizza-party-long-branch/">Kids' pizza parties</a> · <a href="/about/">About Gigi's</a>
</div></footer>

<nav class="stickybar" aria-label="Order actions">
<a href="{TEL}">Call</a><a href="{BASE}/#menu" class="order">Order Now</a></nav>
</body></html>"""

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page)
    print(f"/menu/: {total} items in {len([c for c in cats if c[3]])} categories → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
