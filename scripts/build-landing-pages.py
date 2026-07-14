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
:root{--red:#9b121a;--red-dark:#6e0b12;--red-bright:#c0221d;--cream:#faf2e1;--cream-dark:#f0e5c8;
--ink:#1a1210;--ink-soft:#3c2f2a;--ink-mute:#6a5a52;--gold:#c89441;--green:#008751;
--font-display:"Bebas Neue","Oswald",Impact,system-ui,sans-serif;--font-serif:"Playfair Display",Georgia,serif;
--font-sans:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
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
.hero .eyebrow{font-family:var(--font-sans);font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);font-weight:700}
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
    webpage = {"@type": "WebPage", "name": page["titleTag"], "url": url,
               "description": page["metaDescription"], "isPartOf": {"@type": "WebSite", "name": BIZ["name"], "url": BASE + "/"},
               "about": {"@type": "Restaurant", "@id": BASE + "/#restaurant", "name": BIZ["name"] + " — Long Branch",
                         "telephone": BIZ["phone_display"], "servesCuisine": ["Pizza", "Italian"],
                         "priceRange": "$$", "url": BASE + "/",
                         "address": {"@type": "PostalAddress", "streetAddress": BIZ["street"], "addressLocality": BIZ["city"],
                                     "addressRegion": BIZ["state"], "postalCode": BIZ["zip"], "addressCountry": "US"}}}
    graph = {"@context": "https://schema.org", "@graph": [webpage, faq_ld, breadcrumb]}
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{E(page['titleTag'])}</title>
<meta name="description" content="{E(page['metaDescription'])}">
<link rel="canonical" href="{url}">
<meta name="theme-color" content="#9b121a">
<link rel="icon" href="/favicon.svg"><link rel="apple-touch-icon" href="/logo.png">
<meta name="geo.region" content="US-NJ"><meta name="geo.placename" content="Long Branch, New Jersey">
<meta name="geo.position" content="40.3010;-73.9990">
<meta property="og:type" content="website"><meta property="og:site_name" content="{E(BIZ['name'])} — Long Branch">
<meta property="og:title" content="{E(page['titleTag'])}"><meta property="og:description" content="{E(page['metaDescription'])}">
<meta property="og:url" content="{url}"><meta property="og:image" content="{BASE}/og-image.jpg">
<meta property="og:image:width" content="1920"><meta property="og:image:height" content="1080"><meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{E(page['titleTag'])}">
<meta name="twitter:description" content="{E(page['metaDescription'])}"><meta name="twitter:image" content="{BASE}/og-image.jpg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500&family=Inter:wght@400;500;600;700&display=swap">
<style>{STYLE}</style>
<script type="application/ld+json">{json.dumps(graph, separators=(',', ':'))}</script>
</head>"""

def body(page, others):
    order = order_url()
    tel = f"tel:{BIZ['phone_tel']}"
    sections = "".join(
        f"<section class=\"wrap\"><h2>{E(s['h2'])}</h2>{''.join(f'<p>{E(p)}</p>' for p in s['paragraphs'])}</section>"
        for s in page["sections"])
    faq = "".join(f"<details><summary>{E(q['q'])}</summary><p>{E(q['a'])}</p></details>" for q in page["faq"])
    # internal links to sibling landing pages (crawl + authority), max 5
    sib = "".join(f'<a href="/{o["slug"]}/">{E(o["linklabel"])}</a>' for o in others[:5])
    return f"""<body>
<header class="site"><div class="row">
<img src="/logo.png" alt="{E(BIZ['name'])} logo">
<div class="name">GIGI'S<small>NY STYLE PIZZA · LONG BRANCH</small></div>
<a class="btn btn-gold" href="{order}">Order Now</a></div></header>

<section class="hero"><div class="wrap">
<p class="eyebrow">{E(page['keyword'])} · Long Branch, NJ</p>
<h1>{E(page['h1'])}</h1>
<p class="dek">{E(page['dek'])}</p>
<div class="cta"><a class="btn btn-gold" href="{order}">See the Menu &amp; Order</a>
<a class="btn btn-ghost" href="{tel}">Call {E(BIZ['phone_display'])}</a></div>
<div class="trust"><span>★ 4.6 Restaurantji (86)</span><span>★ 4.3 Restaurant Guru (130)</span><span>{E(BIZ['hours_line'])}</span></div>
</div></section>

<main>{sections}
<section class="wrap faq"><h2>Good to know</h2>{faq}</section></main>

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
    written = []
    for p in DATA:
        others = [o for o in DATA if o["slug"] != p["slug"]]
        out = ROOT / "public" / p["slug"] / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(head(p) + body(p, others), encoding="utf-8")
        written.append(f"/{p['slug']}/")
    print(f"generated {len(written)} landing pages:")
    for u in written:
        print("  " + u)

if __name__ == "__main__":
    main()
