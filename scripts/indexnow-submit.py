#!/usr/bin/env python3
"""
Submit the sitemap's URLs to IndexNow (Bing, Yandex, Seznam, Naver — one call covers all).

WHY THIS EXISTS: Google's crawl scheduling cannot be forced. Three of Gigi's landing pages sat in
Search Console as "Discovered - currently not indexed" with no crawl at all, and the stored GSC
credential is read-only so sitemap resubmission and Request Indexing both return 403. IndexNow is a
push protocol that does not depend on Google's queue, and Bing currently knows only a fraction of
the site, so there is real headroom there.

Google does NOT participate in IndexNow. This helps Bing/Copilot, DuckDuckGo (which sources from
Bing), Yandex and Naver — not Google. Google still needs Request Indexing in the Search Console UI.

Run:  python3 scripts/indexnow-submit.py            # submit every sitemap URL
      python3 scripts/indexnow-submit.py --dry-run  # print the payload, send nothing
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOST = "gigislongbranch.com"
ENDPOINT = "https://api.indexnow.org/IndexNow"


def main():
    key_file = ROOT / ".indexnow-key"
    if not key_file.exists():
        raise SystemExit("No .indexnow-key found. Generate one and host it at public/<key>.txt.")
    key = key_file.read_text().strip()

    sitemap = (ROOT / "public" / "sitemap.xml").read_text()
    urls = re.findall(r"<loc>([^<]+)</loc>", sitemap)
    if not urls:
        raise SystemExit("No <loc> entries in public/sitemap.xml — nothing to submit.")

    payload = {"host": HOST, "key": key,
               "keyLocation": f"https://{HOST}/{key}.txt",
               "urlList": urls}

    if "--dry-run" in sys.argv:
        print(json.dumps(payload, indent=2))
        return

    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            # 200 accepted, 202 accepted but key still validating
            print(f"IndexNow responded {r.status} for {len(urls)} URLs")
            if r.status == 202:
                print("  202 = accepted, key pending validation. Confirm the key file is reachable:")
                print(f"  curl -s https://{HOST}/{key}.txt")
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        print(f"IndexNow rejected the submission: {e.code}\n  {body}")
        if e.code == 403:
            print(f"  403 usually means the key file is not reachable at "
                  f"https://{HOST}/{key}.txt — deploy first, then re-run.")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
