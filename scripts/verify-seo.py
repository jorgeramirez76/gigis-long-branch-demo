#!/usr/bin/env python3
"""Validate the generated public SEO contract; --dist also checks prerendered output.

Read-only and offline. Validates actual HTML rather than counting source snippets.
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://gigislongbranch.com'
DIST = '--dist' in sys.argv
PUBLIC = ROOT / ('dist' if DIST else 'public')

class Page(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.assets = []; self.canon = []; self.title = 0; self.h1 = 0; self.robots = ''; self.links = []; self.ld = []; self.in_ld = False
        self.feed(source)
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('src'): self.assets.append(attrs['src'])
        if tag == 'title': self.title += 1
        if tag == 'h1': self.h1 += 1
        if tag == 'link' and attrs.get('rel') == 'canonical': self.canon.append(attrs.get('href'))
        if tag == 'meta' and attrs.get('name') == 'robots': self.robots = attrs.get('content','')
        if tag == 'a' and 'href' in attrs: self.links.append(attrs['href'])
        if tag == 'script' and attrs.get('type') == 'application/ld+json': self.in_ld = True; self.ld.append('')
    def handle_endtag(self, tag):
        if tag == 'script': self.in_ld = False
    def handle_data(self, data):
        if self.in_ld: self.ld[-1] += data

def route_file(path):
    if path == '/': return (ROOT / 'dist/index.html') if DIST else ROOT / 'index.html'
    if path == '/breakfast': return PUBLIC / 'breakfast.html'
    return PUBLIC / path.lstrip('/') / 'index.html'

def main():
    urls = [e.text for e in ET.parse(PUBLIC / 'sitemap.xml').iter() if e.tag.endswith('}loc')]
    assert len(urls) == len(set(urls)), 'Duplicate sitemap URL'
    redirects = json.loads((ROOT / 'vercel.json').read_text())['redirects']
    excluded = {x['source'] for x in redirects if ':' not in x['source'] and not x.get('has')}
    categories = set(re.findall(r'\bid:\s*"([^"]+)"', (ROOT / 'src/data/menuGenerated.ts').read_text()))
    for url in urls:
        assert url.startswith(BASE + '/'), f'Wrong sitemap host: {url}'
        path = urlparse(url).path
        assert path not in excluded, f'Redirected sitemap URL: {path}'
        page = Page(route_file(path).read_text())
        assert page.canon == [url], f'Canonical mismatch: {url} {page.canon}'
        assert 'noindex' not in page.robots, f'Noindex sitemap URL: {url}'
        assert page.title == 1, f'Expected one title: {url}'
        if DIST or path != '/': assert page.h1 == 1, f'Expected one H1: {url}'
        for ld in page.ld: json.loads(ld)
        for asset in page.assets:
            if asset.startswith("/") and not asset.startswith("//") and (DIST or path != "/"):
                assert (PUBLIC / asset.lstrip("/")).is_file(), f"Missing script in {url}: {asset}"
        for link in page.links:
            parsed = urlparse(link)
            if parsed.netloc and parsed.netloc != 'gigislongbranch.com': continue
            category = parse_qs(parsed.query).get('category')
            if category: assert category[0] in categories, f'Unknown category in {url}: {link}'
    account = Page((PUBLIC / 'account/index.html').read_text())
    assert 'noindex' in account.robots, 'Accounts must remain noindex'
    assert BASE + '/vip-club/' not in urls, 'Obsolete VIP sitemap entry'
    # Semantic copy guard: opening/ordering changes must update generators too.
    hours = (ROOT / 'src/lib/openStatus.ts').read_text()
    assert re.search(r'ORDER_LAST_HOUR = 23\b',hours) and re.search(r'DELIVERY_LAST_HOUR = 22\b',hours), 'Review editorial cutoff copy for changed ordering hours'
    for data in json.loads((ROOT / 'data/landing-pages.json').read_text()):
        assert not re.search(r'\$(?:17\.68|20\.79|57\.20|67\.60|2\.92)',json.dumps(data)), 'Do not reintroduce hard-coded card prices in editorial prose'
    print(f'SEO contract OK: {len(urls)} canonical indexable pages, valid JSON-LD/category links, noindex accounts ({"dist" if DIST else "source"})')

if __name__ == '__main__': main()
