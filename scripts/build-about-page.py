#!/usr/bin/env python3
"""Generate public/about/index.html — who runs Gigi's Long Branch, in a crawlable page.

Until this page existed, the owners' names appeared on no indexable page and the shop's story
lived only inside the React homepage. Search engines and AI answers build a business's identity
from pages like this one, and with two Gigi's locations nearby they need a clear statement of
which shop this is and who runs it.

Every fact here is already published elsewhere on the site or in the repo's verified data:
address, hours and phone (src/data/location.ts and the landing generator), ratings
(src/data/reviews.ts), press (src/components/About.tsx), owners (owner-confirmed). Add a fact only
once it is confirmed; do not guess at founding years or history.

Styling is lifted from a generated landing page, as build-menu-page.py does, so the static pages
stay in lockstep. Runs after build-landing-pages.py in `npm run generate:seo`.

Run: python3 scripts/build-about-page.py   (from the repo root)
"""

import html
import json
import pathlib
import re
import sys

import seo_photos

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS_DONOR = ROOT / "public" / "pizza-delivery-west-end-long-branch" / "index.html"
OUT = ROOT / "public" / "about" / "index.html"

BASE = "https://gigislongbranch.com"
URL = f"{BASE}/about/"
TEL = "tel:+17323772468"
PHONE = "(732) 377-2468"
OWNERS = [("tommy-basile", "Tommy Basile"), ("kenneth-gambella", "Kenneth Gambella")]
TITLE = "About Gigi's NY Style Pizza, Long Branch NJ | Owners & Story"
DESCRIPTION = ("Gigi's NY Style Pizza is a family-run pizzeria at 140 Brighton Ave in Long Branch's "
               "West End, run by owner-operators Tommy Basile and Kenneth Gambella.")
PRESS = [
    ("NJ.com", "N.J.’s best new pizzerias: 20 delicious spots you need to try",
     "https://www.nj.com/life-and-culture/g66l-2019/10/abdd9e70a07436/njs-best-new-pizzerias-20-delicious-spots-you-need-to-try.html"),
    ("The Jersey Shore Girl", "The Best Pizza Spots at the Jersey Shore",
     "https://thelocalgirl.com/jerseyshore/pizza-restaurants-jersey-shore-nj/"),
]


def E(s: str) -> str:
    return html.escape(s, quote=True)


def css_from_donor() -> str:
    m = re.search(r"<style>(.*?)</style>", CSS_DONOR.read_text(), re.S)
    if not m:
        sys.exit("build-about-page: no <style> block in the donor landing page — regenerate landing pages first")
    return m.group(1)


def ratings():
    """Rating lines read from src/data/reviews.ts, score and count from the same source."""
    src = (ROOT / "src" / "data" / "reviews.ts").read_text()
    out = []
    for label, key in (("Google", "google"), ("Restaurantji", "restaurantji")):
        m = re.search(key + r':\s*\{\s*score:\s*([\d.]+),\s*count:\s*(\d+),\s*url:\s*"([^"]+)"', src)
        if not m:
            sys.exit(f"build-about-page: could not read {key} from src/data/reviews.ts.")
        out.append((label, m.group(1), m.group(2), m.group(3)))
    return out


def main():
    css = css_from_donor()
    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "AboutPage", "@id": URL, "url": URL, "name": TITLE, "description": DESCRIPTION,
                "isPartOf": {"@id": f"{BASE}/#website"},
                "about": {"@id": f"{BASE}/#restaurant"},
                "mentions": [{"@id": f"{URL}#{slug}"} for slug, _ in OWNERS],
            },
            *[
                {"@type": "Person", "@id": f"{URL}#{slug}", "name": name,
                 "jobTitle": "Owner-operator", "worksFor": {"@id": f"{BASE}/#restaurant"}}
                for slug, name in OWNERS
            ],
            {
                "@type": "BreadcrumbList", "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Gigi's Long Branch", "item": f"{BASE}/"},
                    {"@type": "ListItem", "position": 2, "name": "About", "item": URL},
                ],
            },
        ],
    }
    rating_items = "".join(
        f'<li><a href="{E(url)}" rel="noopener">{E(label)}</a>: {score} out of 5 from {count} reviews</li>'
        for label, score, count, url in ratings()
    )
    press_items = "".join(
        f'<li>{E(outlet)}: <a href="{E(url)}" rel="noopener">{E(title)}</a></li>' for outlet, title, url in PRESS
    )

    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{E(TITLE)}</title>
<meta name="description" content="{E(DESCRIPTION)}">
<link rel="canonical" href="{URL}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="icon" href="/favicon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website"><meta property="og:site_name" content="Gigi's NY Style Pizza — Long Branch">
<meta property="og:title" content="{E(TITLE)}"><meta property="og:description" content="{E(DESCRIPTION)}">
<meta property="og:url" content="{URL}"><meta property="og:image" content="{BASE}/og-image.jpg">
<script type="application/ld+json">{json.dumps(graph, ensure_ascii=False, separators=(",", ":"))}</script>
<style>{css}{seo_photos.STYLE}</style>
<script type="module" src="/metrics.js"></script>
</head>
<body>
<header class="site"><div class="row">
<img src="/logo-sm.png" alt="Gigi's NY Style Pizza logo" width="145" height="157" fetchpriority="high" decoding="async">
<div class="name">GIGI'S<small>NY STYLE PIZZA · LONG BRANCH</small></div>
<a class="btn btn-gold" href="{BASE}/#menu">Order Now</a></div></header>

<section class="hero"><div class="wrap">
<p class="eyebrow">About us · Long Branch, NJ</p>
<h1>About Gigi's NY Style Pizza in Long Branch</h1>
<p class="dek">Gigi's NY Style Pizza &amp; Restaurant is a family-run pizzeria at 140 Brighton Avenue in the West End of Long Branch, New Jersey. The shop is run day to day by its owner-operators, Tommy Basile and Kenneth Gambella.</p>
<div class="cta"><a class="btn btn-gold" href="/menu/">See the Menu</a>
<a class="btn btn-ghost" href="{TEL}">Call {PHONE}</a></div>
</div></section>

<main>
<section class="wrap" style="padding-top:0">{seo_photos.figure("dining-room", "The dining room on Brighton Ave.", eager=True)}</section>

<section class="wrap"><h2>What we make</h2>
<p>We make real New York-style pizza: hand-stretched dough, house tomato sauce and real mozzarella, sold as whole pies and by the slice. Alongside the round pies there are <a href="/square-pizza-long-branch/">Grandma and Sicilian squares</a>, stuffed and specialty pizzas like the hot-honey Bee Sting, The Fonz and the vodka-sauced Drunken Grandma, plus heroes, pasta and Italian dinners.</p>
<p>There is <a href="/gluten-free-pizza-long-branch/">gluten-free</a> and <a href="/vegan-pizza-long-branch/">vegan</a> pizza, and <a href="/breakfast">breakfast is served all day</a>. It is a full neighborhood kitchen, open year-round, not just a summer slice stop.</p>
</section>

<section class="wrap"><h2>Pickup, delivery and parties</h2>
<p>Order online at gigislongbranch.com, which goes straight to our own register and kitchen, or call {PHONE}. Gigi's runs its own drivers across Long Branch and nearby towns; see <a href="/delivery/">delivery areas and fees</a>. For groups there is <a href="/catering-long-branch/">catering</a>, and kids can make their own pies at a <a href="/pizza-party-long-branch/">pizza party</a> in the shop.</p>
</section>

<section class="wrap"><h2>Recognized for our pizza</h2>
<ul style="padding-left:1.1em">{press_items}</ul>
<h2 style="margin-top:1em">What customers say</h2>
<ul style="padding-left:1.1em">{rating_items}</ul>
</section>

<section class="wrap"><h2>Visit</h2>
<p><strong>140 Brighton Avenue, Long Branch, NJ 07740</strong>, in the West End. Open seven days: Monday to Wednesday 10 AM to 11 PM, Thursday to Sunday 10 AM to midnight. Online pickup orders close at 11 PM and online delivery orders at 10 PM. Call <a href="{TEL}">{PHONE}</a>.</p>
{seo_photos.figure("marquee", "The GIGI'S marquee in the dining room.")}
</section>
</main>

<footer class="site"><div class="wrap">
<strong>Gigi's NY Style Pizza — Long Branch</strong><br>140 Brighton Avenue, Long Branch, NJ 07740 · <a href="{TEL}">{PHONE}</a><br>
Mon–Wed 10 AM–11 PM · Thu–Sun 10 AM–midnight · Open 7 days
<div class="links"><a href="/">Home</a><a href="{BASE}/#menu">Order online</a><a href="/menu/">Full Menu &amp; Prices</a><a href="/breakfast">Breakfast</a><a href="/delivery/">Delivery</a><a href="/late-night-pizza-long-branch/">Late-Night Pizza</a></div>
</div></footer>

<nav class="stickybar" aria-label="Order actions">
<a href="{TEL}">Call</a><a href="{BASE}/#menu" class="order">Order Now</a></nav>
</body></html>
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding="utf-8")
    print(f"/about/ written → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
