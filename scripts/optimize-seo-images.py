#!/usr/bin/env python3
"""Optional asset-maintenance command (requires Pillow), not a deployment dependency.
Re-encode only genuine, committed owner photographs. Originals remain unchanged.
"""
from pathlib import Path
from PIL import Image

BRAND = Path(__file__).resolve().parents[1] / 'src/assets/brand'
for stem, widths in [('slice-hero-portrait', [480, 768, 900]), ('slice-full', [640]), ('fanz-full', [640])]:
    original = Image.open(BRAND / f'{stem}.jpg')
    for width in widths:
        image = original.copy()
        image.thumbnail((width, round(original.height * width / original.width)), Image.Resampling.LANCZOS)
        target = BRAND / f'{stem}-{width}.webp'
        image.save(target, 'WEBP', quality=68, method=6)
        print(f'{target.name}: {target.stat().st_size:,} bytes')
