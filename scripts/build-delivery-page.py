#!/usr/bin/env python3
"""
Build public/delivery/index.html — the delivery-areas hub.

WHY THIS PAGE EXISTS: "do you deliver to <my town> and what does it cost" is the last question a
customer asks before ordering, and the commission marketplaces structurally cannot answer it because
their fees are dynamic. Gigi's charges a flat, published fee per town, so this page can answer it
outright. That makes it the most defensible content on the site — and the shape AI assistants quote.

It is ONE hub, not ten thin town pages. A previous batch of near-duplicate town pages was never
crawled by Google and raised doorway-page concerns; ten more would repeat that mistake. Every town
gets an honest row here instead.

The fee table is read from src/lib/deliveryZones.ts — the same module the checkout and the order API
compute from — so the page can never advertise a price different from the one actually charged.
The build FAILS rather than publishing a guess.

Run:  python3 scripts/build-delivery-page.py
"""
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://gigislongbranch.com"
OUT = ROOT / "public" / "delivery" / "index.html"
E = lambda s: html.escape(str(s), quote=True)

# Delivery stops at this hour — mirrors DELIVERY_LAST_HOUR in src/lib/openStatus.ts.
DELIVERY_LAST = "10 PM"


def load_fees():
    """Parse the town -> fee map out of the shared module. Never hand-type these."""
    src = (ROOT / "src" / "lib" / "deliveryZones.ts").read_text()
    block = re.search(r"export const DELIVERY_FEES = \{(.*?)\} as const;", src, re.S)
    if not block:
        raise SystemExit("build-delivery-page: could not find DELIVERY_FEES in deliveryZones.ts")
    fees = []
    for m in re.finditer(r'(?:"([^"]+)"|([A-Za-z][A-Za-z0-9_]*))\s*:\s*(\d+)', block.group(1)):
        fees.append(((m.group(1) or m.group(2)), int(m.group(3))))
    if not fees:
        raise SystemExit("build-delivery-page: parsed 0 towns — refusing to publish an empty table.")
    return fees


def load_hours():
    """Read the close hours so the page can't drift from openStatus.ts."""
    src = (ROOT / "src" / "lib" / "openStatus.ts").read_text()
    m = re.search(r"DELIVERY_LAST_HOUR = (\d+)", src)
    if not m or int(m.group(1)) != 22:
        raise SystemExit(
            f"build-delivery-page: DELIVERY_LAST_HOUR is {m.group(1) if m else '?'}, but this page "
            f"says {DELIVERY_LAST}. Update both together."
        )


def main():
    load_hours()
    fees = load_fees()
    by_fee = {}
    for town, cents in fees:
        by_fee.setdefault(cents, []).append(town)
    tiers = sorted(by_fee.items())

    rows = "".join(
        f'<tr><th scope="row">{E(t)}</th><td class="fee">${c // 100}</td></tr>'
        for c, towns in tiers
        for t in towns
    )
    town_list = [t for _, towns in tiers for t in towns]

    faq = [
        ("Do you deliver to my town?",
         "Gigi's delivers to " + ", ".join(town_list[:-1]) + " and " + town_list[-1] +
         ". If your town isn't listed, call (732) 377-2468 — we may still be able to help."),
        ("How much is delivery?",
         "$" + str(tiers[0][0] // 100) + " to " + " and ".join(tiers[0][1]) + ", and $" +
         str(tiers[-1][0] // 100) + " to every other town we cover. It's a flat fee, the same whether "
         "you order online or over the phone."),
        (f"How late do you deliver?",
         f"Delivery runs until {DELIVERY_LAST}. The kitchen keeps going after that — pickup is "
         "available until we close, 11 PM Monday through Wednesday and midnight Thursday through Sunday."),
        ("Is there a delivery minimum?",
         "Call (732) 377-2468 and we'll tell you — it isn't set on the website."),
    ]
    faq_html = "".join(
        f"<details><summary>{E(q)}</summary><p>{E(a)}</p></details>" for q, a in faq
    )
    faq_ld = {
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
            for q, a in faq
        ],
    }

    import json
    # The Restaurant node re-states the canonical /#restaurant @id, so it carries ONLY properties
    # that are additive and cannot contradict the homepage's definition: the delivery footprint and
    # its charges. Name/address/geo/hours are deliberately omitted — re-declaring those under a
    # shared @id is what previously published two conflicting versions of the business.
    delivery_ld = {
        "@type": "Restaurant",
        "@id": f"{BASE}/#restaurant",
        "hasDeliveryMethod": {"@type": "DeliveryMethod", "@id": "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"},
        "areaServed": [
            {"@type": "City", "name": t, "addressRegion": "NJ", "addressCountry": "US"}
            for t in town_list
        ],
        "hasOfferCatalog": {
            "@type": "OfferCatalog",
            "name": "Delivery areas and fees",
            "itemListElement": [
                {
                    "@type": "Offer",
                    "name": f"Delivery to {t}",
                    "eligibleRegion": {"@type": "City", "name": t, "addressRegion": "NJ"},
                    "priceSpecification": {
                        "@type": "DeliveryChargeSpecification",
                        "price": f"{c / 100:.2f}",
                        "priceCurrency": "USD",
                        "appliesToDeliveryMethod": {"@id": "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"},
                        "eligibleRegion": {"@type": "City", "name": t, "addressRegion": "NJ"},
                    },
                }
                for c, towns in tiers
                for t in towns
            ],
        },
    }
    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {"@type": "WebPage", "name": "Pizza Delivery Areas & Fees — Gigi's Long Branch",
             "url": f"{BASE}/delivery/",
             "description": "Every town Gigi's delivers to, with the flat delivery fee for each.",
             "isPartOf": {"@id": f"{BASE}/#website"},
             "about": {"@id": f"{BASE}/#restaurant"}},
            delivery_ld,
            faq_ld,
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{BASE}/"},
                {"@type": "ListItem", "position": 2, "name": "Delivery areas", "item": f"{BASE}/delivery/"}]},
        ],
    }

    # Naming all 12 towns and slicing the result to 110 characters chopped the last town
    # mid-word ("Deal, Allenhur.") and silently dropped four others — in the sentence search
    # engines show as the snippet. Name a few per tier and count the rest, so the description
    # is short enough to survive whole.
    def tier_phrase(cents: int, towns: list[str], named: int = 3) -> str:
        rest = len(towns) - named
        head = ", ".join(towns[:named])
        return f"${cents // 100} to {head}" + (f" + {rest} more" if rest > 0 else "")

    if len(tiers) == 2 and len(tiers[0][1]) <= 2:
        tier_summary = (
            f"${tiers[0][0] // 100} to {' and '.join(tiers[0][1])}, "
            f"${tiers[-1][0] // 100} to the other {len(tiers[-1][1])} towns"
        )
    else:
        tier_summary = " · ".join(tier_phrase(c, towns) for c, towns in tiers)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pizza Delivery Areas &amp; Fees &mdash; Long Branch &amp; Nearby | Gigi's</title>
<meta name="description" content="Gigi's delivers to {len(town_list)} towns near Long Branch. Flat fee: {tier_summary}. Delivery until {DELIVERY_LAST}, pickup until close.">
<link rel="canonical" href="{BASE}/delivery/">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta name="theme-color" content="#9b121a">
<link rel="icon" href="/favicon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website"><meta property="og:title" content="Where Gigi's delivers, and what it costs">
<meta property="og:description" content="Flat delivery fee by town. Delivery until {DELIVERY_LAST}, pickup until close.">
<meta property="og:url" content="{BASE}/delivery/"><meta property="og:image" content="{BASE}/og-image.jpg">
<link rel="preload" href="/fonts/inter-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/bebas-neue-400.woff2" as="font" type="font/woff2" crossorigin>
<style>
@font-face{{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/inter-400.woff2) format("woff2")}}
@font-face{{font-family:"Bebas Neue";font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/bebas-neue-400.woff2) format("woff2")}}
@font-face{{font-family:"Inter Fallback";font-weight:400;src:local("Arial");size-adjust:107.8%;ascent-override:89.9%;descent-override:22.4%;line-gap-override:0%}}
@font-face{{font-family:"Bebas Fallback";src:local("Impact");size-adjust:84.6%;ascent-override:106.4%;descent-override:35.5%;line-gap-override:0%}}
:root{{--red:#9b121a;--red-dark:#6e0b12;--cream:#faf2e1;--cream-dark:#f0e5c8;--ink:#1a1210;--ink-soft:#3c2f2a;--ink-mute:#6a5a52;--gold:#c89441;
--disp:"Bebas Neue","Bebas Fallback",Impact,sans-serif;--sans:"Inter","Inter Fallback",ui-sans-serif,system-ui,Arial,sans-serif}}
*{{box-sizing:border-box}}html{{-webkit-text-size-adjust:100%}}
body{{margin:0;font-family:var(--sans);background:var(--cream);color:var(--ink);line-height:1.6;font-size:17px}}
img{{max-width:100%;height:auto;display:block}}
.wrap{{max-width:760px;margin:0 auto;padding:0 20px}}
header.site{{background:var(--red);color:#fff;position:sticky;top:0;z-index:20}}
header.site .row{{display:flex;align-items:center;gap:12px;padding:10px 20px;max-width:900px;margin:0 auto}}
header.site img{{height:40px;width:auto;border-radius:6px}}
header.site .name{{font-family:var(--disp);font-size:1.35rem;letter-spacing:.02em;line-height:1;flex:1}}
header.site .name small{{display:block;font-family:var(--sans);font-size:.6rem;letter-spacing:.14em;opacity:.85;margin-top:2px}}
.btn{{display:inline-flex;align-items:center;justify-content:center;font-family:var(--disp);letter-spacing:.04em;font-size:1.05rem;
padding:.62em 1.1em;border-radius:9px;text-decoration:none;white-space:nowrap;background:var(--gold);color:#1a1210}}
.hero{{background:linear-gradient(160deg,#6e0b12,#9b121a 60%);color:var(--cream);padding:36px 0 30px}}
.hero h1{{font-family:var(--disp);font-weight:400;font-size:clamp(2.2rem,8vw,3.4rem);line-height:.98;margin:.2em 0 .3em}}
.hero p{{font-size:1.06rem;color:#fbe6d6;margin:0;max-width:34em}}
main section{{padding:28px 0;border-bottom:1px solid var(--cream-dark)}}
h2{{font-family:var(--disp);font-weight:400;font-size:clamp(1.6rem,5vw,2.1rem);letter-spacing:.02em;color:var(--red-dark);margin:0 0 .5em}}
table{{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--cream-dark);border-radius:12px;overflow:hidden}}
caption{{text-align:left;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-mute);font-weight:700;padding:0 0 8px}}
th,td{{padding:11px 14px;border-bottom:1px solid var(--cream-dark);text-align:left;font-weight:400}}
thead th{{background:var(--cream-dark);font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft);font-weight:700}}
td.fee{{text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:var(--red-dark);white-space:nowrap}}
tr:last-child th,tr:last-child td{{border-bottom:none}}
.note{{font-size:.9rem;color:var(--ink-mute);margin:12px 0 0}}
details{{background:#fff;border:1px solid var(--cream-dark);border-radius:10px;padding:2px 16px;margin:10px 0}}
summary{{font-weight:700;color:var(--red-dark);cursor:pointer;padding:12px 0;list-style:none}}
summary::-webkit-details-marker{{display:none}}
summary::after{{content:"+";float:right;color:var(--gold);font-weight:700}}
details[open] summary::after{{content:"\\2013"}}
.cta{{background:var(--ink);color:var(--cream);text-align:center;padding:30px 20px}}
.cta h2{{color:var(--gold)}}
.cta a{{margin:6px 6px 0}}
footer{{background:var(--red-dark);color:#fbe9d6;font-size:.9rem;padding:26px 0 40px}}
footer a{{color:var(--gold)}}
.links{{display:flex;flex-wrap:wrap;gap:8px 18px;margin:14px 0}}
</style>
<script type="application/ld+json">{json.dumps(graph, separators=(',', ':'))}</script>
</head><body>

<header class="site"><div class="row">
<img src="/logo-sm.png" alt="Gigi's NY Style Pizza logo" width="145" height="157" fetchpriority="high" decoding="async">
<div class="name">GIGI'S<small>NY STYLE PIZZA &middot; LONG BRANCH</small></div>
<a class="btn" href="{BASE}/#menu">Order Now</a></div></header>

<section class="hero"><div class="wrap">
<h1>Where We Deliver</h1>
<p>Gigi's runs its own delivery &mdash; no app in the middle. The fee below is the whole fee, and
it's the same whether you order online or call us.</p>
</div></section>

<main>
  <section class="wrap">
    <h2>Delivery fee by town</h2>
    <table>
      <caption>Flat fee &middot; same online or by phone</caption>
      <thead><tr><th scope="col">Town</th><th scope="col" style="text-align:right">Delivery</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>
    <p class="note">Long Branch covers the West End, Pier Village and Elberon &mdash; they're all
    Long Branch addresses, so they're on the ${tiers[0][0] // 100} rate. Don't see your town?
    Call <a href="tel:+17323772468">(732)&nbsp;377-2468</a> and ask.</p>
  </section>

  <section class="wrap">
    <h2>Delivery hours</h2>
    <p><strong>Delivery runs until {DELIVERY_LAST}, seven days a week.</strong> After that the
    kitchen is still going &mdash; pickup is available right up to closing: 11 PM Monday through
    Wednesday, midnight Thursday through Sunday.</p>
  </section>

  <section class="wrap">
    <h2>Good to know</h2>
    {faq_html}
  </section>

  <section class="wrap">
    <h2>More from Gigi's</h2>
    <ul>
      <li><a href="/pizza-delivery-west-end-long-branch/">West End delivery</a></li>
      <li><a href="/pizza-delivery-pier-village/">Pier Village delivery</a></li>
      <li><a href="/pizza-delivery-elberon/">Elberon delivery</a></li>
      <li><a href="/gluten-free-pizza-long-branch/">Gluten-free pizza</a></li>
      <li><a href="/vegan-pizza-long-branch/">Vegan pizza</a></li>
      <li><a href="/late-night-pizza-long-branch/">Open late</a></li>
      <li><a href="/catering-long-branch/">Catering</a></li>
    </ul>
  </section>
</main>

<div class="cta">
  <h2>Hungry now?</h2>
  <a class="btn" href="{BASE}/#menu">Order Online</a>
  <a class="btn" href="tel:+17323772468">Call (732) 377-2468</a>
</div>

<footer><div class="wrap">
<strong>Gigi's NY Style Pizza &mdash; Long Branch</strong><br>
140 Brighton Avenue, Long Branch, NJ 07740 &middot; <a href="tel:+17323772468">(732) 377-2468</a><br>
Mon&ndash;Wed 10 AM&ndash;11 PM &middot; Thu&ndash;Sun 10 AM&ndash;midnight &middot; delivery until {DELIVERY_LAST}
<div class="links"><a href="{BASE}/">Home</a><a href="{BASE}/#menu">Menu &amp; Order</a>
<a href="/privacy-policy/">Privacy</a><a href="/sms-terms/">SMS Terms</a></div>
</div></footer>
</body></html>
""", encoding="utf-8")
    print(f"delivery hub written — {len(town_list)} towns, {len(tiers)} fee tiers")
    for c, towns in tiers:
        print(f"   ${c // 100}: {', '.join(towns)}")


if __name__ == "__main__":
    main()
