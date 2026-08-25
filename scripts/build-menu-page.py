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
import pathlib
import re
import sys

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
        items = re.findall(r'\{ name: "((?:[^"\\]|\\.)*)", price: "(\$[\d.]+)"', b)
        cats.append((m.group(1), m.group(2), blurb.group(1).replace('\\"', '"') if blurb else "", items))
    total = sum(len(c[3]) for c in cats)
    if total < 100 or len(cats) < 10:
        sys.exit(f"build-menu-page: parsed only {total} items / {len(cats)} categories — catalog shape changed, refusing to write")
    return cats


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
            f'<tr><th scope="row">{E(n)}</th><td class="p">{E(p)}</td></tr>' for n, p in items
        )
        blurb_html = f"<p>{E(blurb)}</p>" if blurb else ""
        sections.append(
            f'<section class="wrap" id="{cid}"><h2>{E(name)}</h2>{blurb_html}'
            f'<table class="ptable"><caption>{E(name)} — prices</caption>'
            '<thead><tr><th scope="col">Item</th><th scope="col" style="text-align:right">Price</th></tr></thead>'
            f"<tbody>{rows}</tbody></table></section>"
        )

    ld = (
        '<script type="application/ld+json">{"@context":"https://schema.org","@graph":['
        f'{{"@type":"WebPage","@id":"{BASE}/menu/","url":"{BASE}/menu/",'
        '"name":"Gigi\'s Long Branch Menu & Prices",'
        f'"about":{{"@id":"{BASE}/#restaurant"}},'
        '"description":"The full Gigi\'s NY Style Pizza menu with prices, fed from the register."},'
        '{"@type":"BreadcrumbList","itemListElement":['
        f'{{"@type":"ListItem","position":1,"name":"Gigi\'s Long Branch","item":"{BASE}/"}},'
        f'{{"@type":"ListItem","position":2,"name":"Menu & Prices","item":"{BASE}/menu/"}}]}}'
        "]}</script>"
    )

    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gigi's Long Branch Menu &amp; Prices — Pizza, Heroes, Pasta &amp; Breakfast</title>
<meta name="description" content="The full Gigi's menu with prices — {total} items straight from the register: NY pies, Grandma &amp; Sicilian squares, heroes, pasta, all-day breakfast &amp; more. 140 Brighton Ave, Long Branch.">
<link rel="canonical" href="{BASE}/menu/">
<meta name="robots" content="index, follow, max-snippet:-1">
<link rel="icon" href="/favicon.ico">
{ld}
<style>{css}</style>
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
<div class="cta"><a class="btn btn-gold" href="{BASE}/#menu">Order Online</a>
<a class="btn btn-ghost" href="{TEL}">Call {PHONE}</a></div>
</div></section>

<main>
<section class="wrap"><h2>Jump to a section</h2><p>{toc}</p></section>
{"".join(sections)}
<section class="wrap"><h2>Ready to order?</h2>
<p>Order pickup or delivery at <a href="{BASE}/#menu">gigislongbranch.com</a> — the online menu prices every topping and option as you build your order — or call <a href="{TEL}">{PHONE}</a>. Delivery runs until 10 PM; pickup until close (midnight Thu–Sun, 11 PM Mon–Wed).</p>
<p>More: <a href="/square-pizza-long-branch/">square pizza</a> · <a href="/gluten-free-pizza-long-branch/">gluten-free</a> · <a href="/vegan-pizza-long-branch/">vegan</a> · <a href="/catering-long-branch/">catering</a> · <a href="/delivery/">delivery areas &amp; fees</a> · <a href="/vip-club/">VIP club (free pie)</a></p>
</section>
</main>

<footer class="site"><div class="wrap">
<strong>Gigi's NY Style Pizza — Long Branch</strong><br>140 Brighton Avenue, Long Branch, NJ 07740 · <a href="{TEL}">{PHONE}</a><br>
Mon–Wed 10 AM–11 PM · Thu–Sun 10 AM–midnight · Open 7 days<br>
<a href="/">Home</a> · <a href="{BASE}/#menu">Order online</a>
</div></footer>

<nav class="stickybar" aria-label="Order actions">
<a href="{TEL}">Call</a><a href="{BASE}/#menu" class="order">Order Now</a></nav>
</body></html>"""

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page)
    print(f"/menu/: {total} items in {len([c for c in cats if c[3]])} categories → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
