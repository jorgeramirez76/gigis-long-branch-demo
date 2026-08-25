#!/usr/bin/env python3
"""
Generate public/sitemap.xml by walking what actually exists in public/ and dist/.

WHY: the sitemap used to be hand-maintained. That is exactly how /pizza-party-long-branch/ shipped
without a sitemap entry and stayed "URL is unknown to Google" — nobody remembered to add the line.
Discovering the routes from the filesystem means a new page cannot be silently omitted again.

lastmod tracks CONTENT, not file writes. Each page's meaningful markup is hashed and recorded in
sitemap-manifest.json; lastmod only advances when that hash actually changes. Using file mtime
instead was wrong: simply re-running the page generator rewrote every file and, once the clock
passed midnight, moved every lastmod to "today" while the content was byte-identical. Announcing a
change that did not happen is a false signal, and Google openly discounts lastmod on sites where it
proves unreliable. Commit sitemap-manifest.json — it is the memory that makes this honest.

Google ignores changefreq and priority, but they are cheap and harmless, so they stay honest
rather than uniform.

Run:  python3 scripts/build-sitemap.py
Then: verify with `curl -s https://gigislongbranch.com/sitemap.xml | grep -c '<loc>'`
"""
import datetime
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
BASE = "https://gigislongbranch.com"
MANIFEST = ROOT / "sitemap-manifest.json"

# Routes that exist but must never be advertised to search engines.
# vip-verify holds one-time verification landing pages (?t=<token>) — noindex'd, and it must never
# be advertised to a crawler.
EXCLUDE_DIRS = {"img", "fonts", "assets", "vip-verify"}
EXCLUDE_FILES = {"admin.html", "llms.txt", "robots.txt", "sitemap.xml"}
# Search-engine ownership-verification stubs. These MUST stay on disk — deleting
# public/googlececb096098599354.html un-verifies Search Console — but they are not content and
# must never appear in the sitemap.
EXCLUDE_PATTERNS = (re.compile(r"^google[0-9a-f]+$"),
                    re.compile(r"^BingSiteAuth$"),
                    re.compile(r"^[0-9a-f]{32}$"))          # IndexNow key file

# Pages whose weight we state deliberately rather than by accident.
PRIORITY = {"/": "1.0", "/breakfast": "0.8"}
DEFAULT_PRIORITY = "0.7"
LEGAL = {"/privacy-policy/", "/sms-terms/"}


def routes():
    """Every indexable public route, discovered from disk."""
    found = []

    # the React app's own entry point
    index = ROOT / "index.html"
    if index.exists():
        found.append(("/", index))

    # extensionless top-level pages shipped as public/<name>.html
    for f in sorted(PUBLIC.glob("*.html")):
        if f.name in EXCLUDE_FILES or any(rx.match(f.stem) for rx in EXCLUDE_PATTERNS):
            continue
        found.append((f"/{f.stem}", f))

    # directory-style pages: public/<slug>/index.html
    for d in sorted(PUBLIC.iterdir()):
        if not d.is_dir() or d.name in EXCLUDE_DIRS:
            continue
        idx = d / "index.html"
        if idx.exists():
            found.append((f"/{d.name}/", idx))
    return found


def content_hash(path: Path) -> str:
    """Hash the page's meaningful markup.

    Deliberately excludes the <lastmod>-irrelevant noise a rebuild churns: nothing here should
    change unless a human changed copy, data or markup.
    """
    t = path.read_text(errors="ignore")
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)      # build comments
    t = re.sub(r"\s+", " ", t).strip()                # whitespace/reflow
    return hashlib.sha256(t.encode()).hexdigest()[:16]


def canonical_of(path: Path):
    m = re.search(r'<link rel="canonical" href="([^"]+)"', path.read_text(errors="ignore"))
    return m.group(1) if m else None


def main():
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    new_manifest, changed = {}, []
    today = datetime.date.today().isoformat()
    entries, problems = [], []
    for route, src in routes():
        url = BASE + route
        # A URL in the sitemap whose canonical points somewhere else is a contradictory signal.
        canon = canonical_of(src)
        if canon and canon.rstrip("/") != url.rstrip("/"):
            problems.append(f"{route}: canonical is {canon}, not {url}")
        h = content_hash(src)
        prev = manifest.get(url)
        if prev and prev.get("hash") == h:
            lastmod = prev["lastmod"]           # content unchanged — do not move the date
        else:
            lastmod = today
            changed.append(route)
        new_manifest[url] = {"hash": h, "lastmod": lastmod}
        if route in LEGAL:
            # Utility pages: noindexed (they were ranking for stray brand queries), so they
            # don't belong in the sitemap either.
            continue
        elif route == "/":
            freq, prio = "weekly", PRIORITY["/"]
        else:
            freq, prio = "weekly", PRIORITY.get(route, DEFAULT_PRIORITY)
        entries.append((url, lastmod, freq, prio))

    if problems:
        print("sitemap: refusing to write — canonical/sitemap disagreement:", file=sys.stderr)
        for p in problems:
            print("   " + p, file=sys.stderr)
        raise SystemExit(1)

    body = "\n".join(
        f"  <url>\n    <loc>{u}</loc>\n    <lastmod>{m}</lastmod>\n"
        f"    <changefreq>{f}</changefreq>\n    <priority>{p}</priority>\n  </url>"
        for u, m, f, p in entries)
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<!-- Generated by scripts/build-sitemap.py from what actually exists in public/.\n'
           '     Do not hand-edit: a hand-maintained sitemap is how /pizza-party-long-branch/\n'
           '     was omitted and stayed unknown to Google. -->\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           f"{body}\n</urlset>\n")
    (PUBLIC / "sitemap.xml").write_text(xml)
    MANIFEST.write_text(json.dumps(new_manifest, indent=2, sort_keys=True) + "\n")
    print(f"sitemap.xml written — {len(entries)} URLs, discovered from disk")
    if changed:
        print(f"   lastmod advanced to {today} for {len(changed)} genuinely-changed page(s):")
        for r in changed:
            print(f"      {r}")
    else:
        print("   no content changed — every lastmod left exactly as it was")


if __name__ == "__main__":
    main()
