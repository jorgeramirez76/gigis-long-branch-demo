#!/usr/bin/env python3
"""
Build static, mobile-first local SEO landing pages for Gigi's Long Branch.

WHY STATIC (and separate from the React app): the main site is a live ordering/payment app.
These landing pages are pure static HTML + inline CSS (no JS) so they:
  - rank for local searches (each is its own crawlable URL with its own title/meta/schema),
  - load instantly on a phone (the highest-intent traffic for "pizza near me / late night"),
  - and CANNOT affect the React ordering/checkout code in any way.
They are CSP-compliant (inline <style> only; no inline <script>) and match the brand tokens.
Every "Order" path funnels to the real menu on the main site (https://gigislongbranch.com/#menu)
or the phone, so checkout stays entirely in the audited React flow.

Data source: data/landing-pages.json (list of page packages). Output: public/<slug>/index.html.
Regenerate: python3 scripts/build-landing-pages.py   (then commit public/ + sitemap.xml)
"""
import json, html, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://gigislongbranch.com"
DATA = json.load(open(ROOT / "data" / "landing-pages.json"))

# --- real prices, read straight out of the Clover-derived menu -------------------
# Every price shown on these pages comes from src/data/menuGenerated.ts, which is
# generated from the shop's live Clover inventory. Nothing here is hand-typed, so a
# menu change in Clover flows through on the next build instead of going stale.
def load_prices():
    src = (ROOT / "src" / "data" / "menuGenerated.ts").read_text()
    items = {}
    for name, price in re.findall(r'\{ name: "([^"]+)", price: "\$([\d.]+)"', src):
        items.setdefault(name, price)          # first occurrence wins
    mods = {}
    for name, delta in re.findall(r'\{ name: "([^"]+)", delta: "\+\$([\d.]+)" \}', src):
        mods.setdefault(name, delta)
    if not items:
        raise SystemExit("build-landing-pages: parsed 0 prices from menuGenerated.ts — refusing "
                         "to publish price tables. Check the generated file's shape.")
    return items, mods

PRICES, MODIFIERS = load_prices()

def from_location_ts():
    """Read the verified rooftop coords + socials out of src/data/location.ts.

    These were hardcoded here as 40.3010/-73.9990 while location.ts (the source of truth,
    verified against the US Census geocoder and OpenStreetMap) says 40.284619/-73.988707 —
    a 1.26-mile error that shipped into the schema of all seven pages. Never hardcode them
    again; read them, and fail if they cannot be read.
    """
    src = (ROOT / "src" / "data" / "location.ts").read_text()
    lat = re.search(r"^\s*lat:\s*(-?[\d.]+),", src, re.M)
    lng = re.search(r"^\s*lng:\s*(-?[\d.]+),", src, re.M)
    if not (lat and lng):
        raise SystemExit("build-landing-pages: could not read lat/lng from src/data/location.ts.")
    return float(lat.group(1)), float(lng.group(1))

def ratings_from_reviews_ts():
    """Read the attributed rating tiles from src/data/reviews.ts instead of inlining them,
    so the hero trust line cannot silently go stale the way it already did once."""
    src = (ROOT / "src" / "data" / "reviews.ts").read_text()
    out = []
    # Restaurant Guru was dropped on 2026-07-29: the 4.3 it showed is Google's rating that
    # Restaurant Guru republishes, while its own aggregateRating is 2.9/5 — so the tile paired
    # Google's score with Restaurant Guru's review count and credited both to Restaurant Guru.
    # Add a "google" key to RATING_SNAPSHOT here once the score AND count both come from the
    # Business Profile. Never mix a score from one source with a count from another.
    for label, key in (("Restaurantji", "restaurantji"),):
        m = re.search(key + r":\s*\{\s*score:\s*([\d.]+),\s*count:\s*(\d+)", src)
        if not m:
            raise SystemExit(f"build-landing-pages: could not read {key} from src/data/reviews.ts.")
        out.append(f"★ {m.group(1)} {label} ({m.group(2)})")
    return out

LAT, LNG = from_location_ts()
RATINGS = ratings_from_reviews_ts()

def price_of(key, kind=None):
    """Resolve a price row to a real menu price, or fail loudly.

    Some names exist as BOTH a menu item and a modifier — "Gluten Free" is a $17.68 pie and
    also a +$2.60 pasta substitution. Rows that mean the modifier must say so with
    "kind": "mod", otherwise they would silently render the pie's price.
    """
    if kind == "mod":
        if key in MODIFIERS:
            return MODIFIERS[key], "mod"
        raise SystemExit(f"build-landing-pages: '{key}' is not a modifier in the Clover menu.")
    if kind == "item" or kind is None:
        if key in PRICES:
            return PRICES[key], "item"
    if kind is None and key in MODIFIERS:
        return MODIFIERS[key], "mod"
    raise SystemExit(f"build-landing-pages: '{key}' is not a real item or modifier in the "
                     f"Clover menu. Fix data/landing-pages.json — do not invent prices.")

# --- verified business facts (single source; keep in sync with src/data/*) ---
BIZ = {
    "name": "Gigi's NY Style Pizza",
    "street": "140 Brighton Avenue",
    "city": "Long Branch", "state": "NJ", "zip": "07740",
    "phone_display": "(732) 377-2468", "phone_tel": "+17323772468",
    "hours_line": "Mon–Wed 10 AM–11 PM · Thu–Sun 10 AM–midnight · Open 7 days",
    "areas": "West End · Pier Village · Elberon · West Long Branch · Monmouth Beach · Deal · Eatontown · Allenhurst · Oceanport",
}
E = lambda s: html.escape(str(s), quote=True)

STYLE = """
/* Self-hosted so nothing render-blocking sits between the visitor and the first paint.
   Previously a fonts.googleapis.com stylesheet was the ONLY render-blocking resource on the
   page (measured 145-241ms) and the LCP element is a text node, so nothing painted until a
   cross-origin round trip finished. Only weights 400 and 700 are used and there is no italic,
   so this loads 3 files where the Google stylesheet pulled 9 weights plus italic.
   Inter ships as a variable font, so one file covers the whole 100-900 range.
   The *-Fallback faces carry metric overrides measured from the real font binaries with
   fontTools (advance width of a representative sentence, not the unreliable xAvgCharWidth),
   so swapping from the local fallback to the webfont does not reflow the page. */
@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;
src:url(/fonts/inter-400.woff2) format("woff2")}
@font-face{font-family:"Playfair Display";font-style:normal;font-weight:700;font-display:swap;
src:url(/fonts/playfair-700.woff2) format("woff2")}
@font-face{font-family:"Bebas Neue";font-style:normal;font-weight:400;font-display:swap;
src:url(/fonts/bebas-neue-400.woff2) format("woff2")}
@font-face{font-family:"Inter Fallback";font-weight:400;src:local("Arial"),local("Helvetica");
size-adjust:107.8%;ascent-override:89.9%;descent-override:22.4%;line-gap-override:0%}
@font-face{font-family:"Inter Fallback";font-weight:700;src:local("Arial Bold"),local("Arial-BoldMT"),local("Helvetica Bold");
size-adjust:101.9%;ascent-override:95.1%;descent-override:23.7%;line-gap-override:0%}
@font-face{font-family:"Playfair Fallback";src:local("Georgia"),local("Times New Roman");
size-adjust:104.7%;ascent-override:103.3%;descent-override:24.0%;line-gap-override:0%}
@font-face{font-family:"Bebas Fallback";src:local("Impact"),local("Arial Narrow");
size-adjust:84.6%;ascent-override:106.4%;descent-override:35.5%;line-gap-override:0%}
:root{--red:#9b121a;--red-dark:#6e0b12;--red-bright:#c0221d;--cream:#faf2e1;--cream-dark:#f0e5c8;
--ink:#1a1210;--ink-soft:#3c2f2a;--ink-mute:#6a5a52;--gold:#c89441;--green:#008751;
--font-display:"Bebas Neue","Bebas Fallback",Impact,sans-serif;--font-serif:"Playfair Display","Playfair Fallback",Georgia,serif;
--font-sans:"Inter","Inter Fallback",ui-sans-serif,system-ui,-apple-system,Arial,sans-serif}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--font-sans);background:var(--cream);color:var(--ink);line-height:1.6;font-size:17px}
a{color:var(--red)}img{max-width:100%;display:block}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}
header.site{background:var(--red);color:#fff;position:sticky;top:0;z-index:20}
header.site .row{display:flex;align-items:center;gap:12px;padding:10px 20px;max-width:900px;margin:0 auto}
header.site img{height:40px;width:auto;border-radius:6px}
header.site .name{font-family:var(--font-display);font-size:1.35rem;letter-spacing:.02em;line-height:1;flex:1}
header.site .name small{display:block;font-family:var(--font-sans);font-size:.6rem;letter-spacing:.14em;opacity:.85;margin-top:2px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4em;font-family:var(--font-display);
letter-spacing:.04em;font-size:1.05rem;padding:.62em 1.1em;border-radius:9px;text-decoration:none;white-space:nowrap}
.btn-gold{background:var(--gold);color:#1a1210}.btn-gold:hover{background:#e6b45e}
.btn-cream{background:var(--cream);color:var(--red);border:2px solid var(--cream)}
.btn-ghost{background:transparent;color:#fff;border:2px solid rgba(255,255,255,.6)}
.hero{background:linear-gradient(160deg,#6e0b12,#9b121a 60%);color:var(--cream);padding:38px 0 34px}
.hero .eyebrow{font-family:var(--font-sans);font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:#f0c274;font-weight:700}
.hero h1{font-family:var(--font-display);font-weight:400;font-size:clamp(2.3rem,8vw,3.6rem);line-height:.98;margin:.35em 0 .3em;letter-spacing:.01em}
.hero .dek{font-size:1.08rem;max-width:640px;color:#fbe6d6}
.hero .cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}
.trust{font-size:.82rem;color:#f3d9be;margin-top:18px;display:flex;flex-wrap:wrap;gap:6px 16px}
main section{padding:30px 0;border-bottom:1px solid var(--cream-dark)}
main h2{font-family:var(--font-serif);font-weight:700;font-size:clamp(1.5rem,5vw,2rem);line-height:1.15;color:var(--red-dark);margin:0 0 .5em}
main p{margin:0 0 1em;color:var(--ink-soft)}
.faq details{background:#fff;border:1px solid var(--cream-dark);border-radius:10px;padding:2px 16px;margin:10px 0}
.faq summary{font-family:var(--font-serif);font-weight:700;color:var(--red-dark);cursor:pointer;padding:12px 0;font-size:1.05rem;list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";float:right;color:var(--gold);font-weight:700}
.faq details[open] summary::after{content:"–"}
.faq details p{padding-bottom:14px}
.ptable{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--cream-dark);
border-radius:10px;overflow:hidden;font-size:.98rem;margin:0 0 12px}
.ptable caption{text-align:left;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;
color:var(--ink-mute);font-weight:700;padding:0 0 8px}
.ptable th,.ptable td{padding:11px 14px;border-bottom:1px solid var(--cream-dark);text-align:left}
.ptable thead th{background:var(--cream-dark);font-family:var(--font-sans);font-size:.74rem;
letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft)}
.ptable td.p{text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:var(--red-dark);white-space:nowrap}
.ptable tr:last-child td{border-bottom:none}
.ptable td .what{display:block;font-size:.85rem;color:var(--ink-mute);font-weight:400;margin-top:2px}
.pnote{font-size:.84rem;color:var(--ink-mute);margin:0 0 1em}
.hours{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--cream-dark);border-radius:10px;overflow:hidden;font-size:.98rem}
.hours th,.hours td{padding:10px 12px;border-bottom:1px solid var(--cream-dark);text-align:left}
.hours td.t{text-align:right;font-variant-numeric:tabular-nums}
.hours tr:last-child th,.hours tr:last-child td{border-bottom:none}
.direct{background:#fff;border:1px solid var(--cream-dark);border-left:4px solid var(--green);
border-radius:10px;padding:16px 18px}
.direct ul{margin:.4em 0 0;padding-left:1.1em}.direct li{margin:.35em 0;color:var(--ink-soft)}
.cta-band{background:var(--ink);color:var(--cream);text-align:center;padding:34px 20px}
.cta-band h2{font-family:var(--font-display);font-weight:400;color:var(--gold);font-size:clamp(1.8rem,6vw,2.6rem);margin:0 0 .3em}
.cta-band .cta{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:16px}
.cta-band a.btn-ghost{color:var(--cream)}
footer.site{background:var(--red-dark);color:#fbe9d6;font-size:.9rem;padding:28px 0 96px}
footer.site a{color:var(--gold)}
footer.site .links{display:flex;flex-wrap:wrap;gap:8px 18px;margin:14px 0}
footer.site .fine{font-size:.78rem;color:#e8b9a0;margin-top:14px}
.stickybar{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;background:var(--red-dark);
box-shadow:0 -6px 20px rgba(0,0,0,.25)}
.stickybar a{flex:1;text-align:center;padding:14px 6px;color:#fff;text-decoration:none;font-family:var(--font-display);
font-size:1.05rem;letter-spacing:.03em;border-right:1px solid rgba(255,255,255,.15)}
.stickybar a:last-child{border-right:none}.stickybar a.order{background:var(--gold);color:#1a1210}
@media(min-width:760px){.stickybar{display:none}footer.site{padding-bottom:28px}}
"""

def order_url():
    return f"{BASE}/#menu"

HOURS = [("Monday – Wednesday", "10:00 AM – 11:00 PM", ["Mo", "Tu", "We"], "10:00", "23:00"),
         ("Thursday – Sunday", "10:00 AM – 12:00 AM", ["Th", "Fr", "Sa", "Su"], "10:00", "24:00")]

def hours_ld():
    return [{"@type": "OpeningHoursSpecification", "dayOfWeek": days,
             "opens": o, "closes": c} for _, _, days, o, c in HOURS]

def render_prices(page):
    """Visible price table built from real Clover prices."""
    pb = page.get("priceBlock")
    if not pb:
        return "", []
    rows, ld = [], []
    for r in pb["rows"]:
        amount, kind = price_of(r["item"], r.get("kind"))
        label = r.get("label", r["item"])
        shown = f"+${amount}" if kind == "mod" else f"${amount}"
        what = f"<span class=\"what\">{E(r['what'])}</span>" if r.get("what") else ""
        rows.append(f"<tr><th scope=\"row\">{E(label)}{what}</th><td class=\"p\">{shown}</td></tr>")
        if kind == "item":
            ld.append({"@type": "MenuItem", "name": label,
                       **({"description": r["what"]} if r.get("what") else {}),
                       "offers": {"@type": "Offer", "price": amount, "priceCurrency": "USD",
                                  "availability": "https://schema.org/InStock",
                                  "url": order_url()}})
    table = (f"<section class=\"wrap\"><h2>{E(pb['h2'])}</h2>"
             f"<p>{E(pb['intro'])}</p>"
             f"<table class=\"ptable\"><caption>{E(pb.get('caption', 'Current prices'))}</caption>"
             f"<thead><tr><th scope=\"col\">Item</th><th scope=\"col\" style=\"text-align:right\">Price</th></tr></thead>"
             f"<tbody>{''.join(rows)}</tbody></table>"
             f"<p class=\"pnote\">Straight from Gigi's register. "
             f"Prices can change &mdash; your total is confirmed before you pay.</p>"
             f"</section>")
    return table, ld

def covers(page, pattern):
    """True if the page's own hand-written sections already cover this ground.

    The hours and order-direct blocks were originally appended unconditionally, which produced
    pages carrying "Hours & How to Order" immediately followed by "Hours & Where to Find Us",
    and pushed mean cross-page text similarity from 28.5% to 43.3% — the wrong direction for
    URLs Google had already declined to crawl.
    """
    return any(re.search(pattern, s["h2"], re.I) for s in page["sections"])

def render_hours(page):
    if covers(page, r"hour|how late|open|find us"):
        return ""
    rows = "".join(f"<tr><th scope=\"row\">{E(d)}</th><td class=\"t\">{E(t)}</td></tr>"
                   for d, t, _, _, _ in HOURS)
    return (f"<section class=\"wrap\"><h2>Hours &amp; Where to Find Us</h2>"
            f"<table class=\"hours\"><tbody>{rows}</tbody></table>"
            f"<p style=\"margin-top:14px\">Gigi's is at <strong>{E(BIZ['street'])}, {E(BIZ['city'])}, "
            f"{E(BIZ['state'])} {E(BIZ['zip'])}</strong>, in the West End. Open seven days. "
            f"Call <a href=\"tel:{BIZ['phone_tel']}\">{E(BIZ['phone_display'])}</a>.</p></section>")

def render_direct(page):
    """The one genuine differentiator vs Slice and DoorDash: this is Gigi's own ordering stack.

    Deliberately short. An earlier version ran five bullets and an intro paragraph, which put
    ~120 byte-identical words on all seven pages. Every claim here traces to the ordering code.
    """
    if covers(page, r"\border|how to order\b"):
        return ""
    return ("<section class=\"wrap\"><h2>Order Direct, Not Through a Middleman</h2>"
            "<div class=\"direct\"><ul style=\"margin:0\">"
            "<li><strong>No app service fee and no menu markup</strong> &mdash; gigislongbranch.com "
            "goes straight to Gigi's own register, and your ticket prints in the kitchen the moment "
            "you place it.</li>"
                        "<li><strong>A free plain cheese pie for new VIP members</strong> &mdash; one per "
            f"household, code good for 90 days. <a href=\"{BASE}/#vip-club\">Join the club</a>.</li>"
            "</ul></div></section>")

def head(page):
    slug = page["slug"]
    url = f"{BASE}/{slug}/"
    faq_ld = {
        "@type": "FAQPage",
        "mainEntity": [{"@type": "Question", "name": q["q"],
                        "acceptedAnswer": {"@type": "Answer", "text": q["a"]}} for q in page["faq"]],
    }
    breadcrumb = {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": BASE + "/"},
        {"@type": "ListItem", "position": 2, "name": page["h1"], "item": url}]}
    # index.html OWNS https://gigislongbranch.com/#restaurant and defines it once, in full.
    # Its own WebPage node points at it with a BARE @id reference and nothing else, and these pages
    # must do the same. Re-declaring properties under a shared @id does not "mirror" the entity — in
    # JSON-LD identical @id means identical entity, and because address/geo/openingHoursSpecification
    # are anonymous blank nodes they get UNIONED rather than deduplicated. Seven pages each adding
    # their own copy gave the canonical business two telephone literals ("(732) 377-2468" here vs
    # "+1-732-377-2468" on the homepage), two street spellings ("140 Brighton Avenue" vs
    # "140 Brighton Ave"), eight GeoCoordinates, sixteen OpeningHoursSpecifications with non-schema
    # "Mo"/"Tu" day codes and an out-of-range closes "24:00", and eight competing hasMenu values that
    # overwrote the real 5-section site menu with a 2-7 row marketing list.
    webpage = {"@type": "WebPage", "name": page["titleTag"], "url": url,
               "description": page["metaDescription"], "isPartOf": {"@id": BASE + "/#website"},
               "about": {"@id": BASE + "/#restaurant"}}
    graph = {"@context": "https://schema.org", "@graph": [webpage, faq_ld, breadcrumb]}
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{E(page['titleTag'])}</title>
<meta name="description" content="{E(page['metaDescription'])}">
<link rel="canonical" href="{url}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta name="theme-color" content="#9b121a">
<link rel="icon" href="/favicon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="geo.region" content="US-NJ"><meta name="geo.placename" content="Long Branch, New Jersey">
<meta name="geo.position" content="{LAT};{LNG}">
<meta property="og:type" content="website"><meta property="og:site_name" content="{E(BIZ['name'])} — Long Branch">
<meta property="og:title" content="{E(page['titleTag'])}"><meta property="og:description" content="{E(page['metaDescription'])}">
<meta property="og:url" content="{url}"><meta property="og:image" content="{BASE}/og-image.jpg">
<meta property="og:image:width" content="1920"><meta property="og:image:height" content="1080"><meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{E(page['titleTag'])}">
<meta name="twitter:description" content="{E(page['metaDescription'])}"><meta name="twitter:image" content="{BASE}/og-image.jpg">
<link rel="preload" href="/fonts/inter-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/bebas-neue-400.woff2" as="font" type="font/woff2" crossorigin>
<style>{STYLE}</style>
<script type="application/ld+json">{json.dumps(graph, separators=(',', ':'))}</script>
</head>"""

def body(page, others, price_html):
    order = order_url()
    tel = f"tel:{BIZ['phone_tel']}"
    sections = "".join(
        f"<section class=\"wrap\"><h2>{E(s['h2'])}</h2>{''.join(f'<p>{E(p)}</p>' for p in s['paragraphs'])}</section>"
        for s in page["sections"])
    faq = "".join(f"<details><summary>{E(q['q'])}</summary><p>{E(q['a'])}</p></details>" for q in page["faq"])
    # internal links to EVERY sibling landing page. Google reported /pizza-delivery-elberon/
    # and /pizza-delivery-pier-village/ as "Discovered - currently not indexed" with no
    # referring URLs, so every page now links to every other one rather than the first five.
    sib = "".join(f'<a href="/{o["slug"]}/">{E(o["linklabel"])}</a>' for o in others)
    # Each page describes only 4 siblings, not all 6, chosen by a fixed rotation. That cuts how
    # many times each blurb is repeated across the site (6 -> 4) while keeping the link graph
    # provably balanced: every page links out to exactly 4 and receives exactly 4 inbound
    # descriptive links, so nothing gets orphaned the way /pizza-delivery-elberon/ was. The footer
    # still links to every sibling, so full crawl reachability is unchanged.
    idx = [o["slug"] for o in DATA].index(page["slug"])
    ring = [DATA[(idx + k) % len(DATA)] for k in range(1, 5)]
    related = "".join(
        f'<li><a href="/{o["slug"]}/">{E(o["linklabel"])}</a> &mdash; {E(o["relatedblurb"])}</li>'
        for o in ring)
    return f"""<body>
<header class="site"><div class="row">
<img src="/logo-sm.png" alt="{E(BIZ['name'])} logo" width="145" height="120" fetchpriority="high" decoding="async">
<div class="name">GIGI'S<small>NY STYLE PIZZA · LONG BRANCH</small></div>
<a class="btn btn-gold" href="{order}">Order Now</a></div></header>

<section class="hero"><div class="wrap">
<p class="eyebrow">{E(page['keyword'])} · Long Branch, NJ</p>
<h1>{E(page['h1'])}</h1>
<p class="dek">{E(page['dek'])}</p>
<div class="cta"><a class="btn btn-gold" href="{order}">See the Menu &amp; Order</a>
<a class="btn btn-ghost" href="{tel}">Call {E(BIZ['phone_display'])}</a></div>
<div class="trust">{"".join(f"<span>{E(r)}</span>" for r in RATINGS)}<span>{E(BIZ["hours_line"])}</span></div>
</div></section>

<main>{sections}
{price_html}
{render_hours(page)}
{render_direct(page)}
<section class="wrap faq"><h2>Good to know</h2>{faq}</section>
<section class="wrap"><h2>More from Gigi's Long Branch</h2>
<ul style="padding-left:1.1em">{related}</ul></section></main>

<div class="cta-band"><h2>Hungry now?</h2>
<p>Order online for pickup or delivery, or call and we'll get it going.</p>
<div class="cta"><a class="btn btn-gold" href="{order}">Order Online</a>
<a class="btn btn-ghost" href="{tel}">Call {E(BIZ['phone_display'])}</a></div></div>

<footer class="site"><div class="wrap">
<strong>{E(BIZ['name'])} — Long Branch</strong><br>{E(BIZ['street'])}, {E(BIZ['city'])}, {E(BIZ['state'])} {E(BIZ['zip'])} · <a href="{tel}">{E(BIZ['phone_display'])}</a><br>
{E(BIZ['hours_line'])}<br>
<span style="font-size:.82rem">Delivery: {E(BIZ['areas'])}</span>
<div class="links"><a href="{BASE}/">Home</a><a href="{order}">Menu &amp; Order</a>{sib}</div>
<p class="fine">© Gigi's NY Style Pizza, Long Branch NJ. New York–style pizza, heroes, pasta &amp; Italian dinners — pickup, delivery &amp; catering.</p>
</div></footer>

<nav class="stickybar" aria-label="Order actions">
<a href="{tel}">Call</a><a href="{order}" class="order">Order Now</a></nav>
</body></html>"""

def main():
    # a short link label per page for cross-linking footers
    labels = {
        "late-night-pizza-long-branch": "Late-Night Pizza",
        "gluten-free-pizza-long-branch": "Gluten-Free Pizza",
        "vegan-pizza-long-branch": "Vegan Pizza",
        "catering-long-branch": "Catering",
        "pizza-delivery-pier-village": "Pier Village Delivery",
        "pizza-delivery-west-end-long-branch": "West End Pizza",
        "pizza-delivery-elberon": "Elberon Delivery",
    }
    for p in DATA:
        p["linklabel"] = labels.get(p["slug"], p["h1"][:22])
        p.setdefault("relatedblurb", p["keyword"])
    written = []
    for p in DATA:
        others = [o for o in DATA if o["slug"] != p["slug"]]
        price_html, menu_ld = render_prices(p)
        out = ROOT / "public" / p["slug"] / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(head(p) + body(p, others, price_html), encoding="utf-8")
        words = len(re.sub(r"<[^>]+>", " ", (ROOT / "public" / p["slug"] / "index.html").read_text()).split())
        written.append((f"/{p['slug']}/", len(menu_ld), words))
    print(f"generated {len(written)} landing pages:")
    for u, n, w in written:
        print(f"  {u:42s} {n:2d} priced items  ~{w} words")

if __name__ == "__main__":
    main()
