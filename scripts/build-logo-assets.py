#!/usr/bin/env python3
"""
Generate every logo asset the site serves from ONE master file.

Why a script: the logo lives in eight places at five sizes (nav, footer srcset, landing-page headers,
legal pages, breakfast, the iOS icon, and outgoing email). Hand-exporting those is how a rebrand ends
up half-applied — the 2026-08-07 change from the red/green wordmark to the red/black badge touched all
of them. Re-run this whenever the master changes; never edit the outputs by hand.

The master is a JPEG on near-white paper. Two things are done to it:

 1. TRIM to the artwork, so every output has the same framing and no dead margin. The artwork is NOT
    square (1097x1191) — the "LONG BRANCH, NJ" banner hangs below the circle — so the aspect ratio is
    preserved everywhere and the width/height attributes in the HTML must match it, or the browser
    reserves the wrong box and the page shifts as it loads.

 2. Make the paper OUTSIDE the badge transparent, by flood-filling inward from the border. The white
    INSIDE the badge is enclosed by the red ring, so it survives — which is the point: the logo has to
    sit on cream (#faf2e1), on brand red (#9b121a), and on the dark footer without carrying a white
    box around with it. The previous logo was an opaque white rectangle, which is why
    public/vip-club/index.html had to round its corners to disguise the plate.

Run: python3 scripts/build-logo-assets.py [path/to/master.jpg]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "src" / "assets" / "brand" / "logo-master.png"

# Anything this close to paper white, reachable from the edge, becomes transparent.
FLOOD_THRESH = 26
PAD = 12  # even breathing room around the trimmed artwork, in master pixels

# (output path, target WIDTH, opaque?) — heights follow the master's aspect ratio.
# Widths are ~3x their largest CSS display size so the badge stays crisp on retina without paying
# for pixels nobody sees: the largest on-page logo is 160px wide (landing-page headers).
#
# Every output is QUANTIZED to a 64-colour palette. This is flat vector-style art, so the palette is
# visually lossless, and it takes logo.png from 203 KB to 15 KB — the un-quantized PNG was heavier
# than the logo it replaced, and the old one was already flagged as an LCP drag at 152 KB.
OUTPUTS = [
    ("src/assets/brand/logo.png", 400, False),  # Nav + Footer import (display 56px tall)
    ("public/logo.png", 512, False),            # JSON-LD org logo, breakfast, legal pages
    ("public/logo-sm.png", 320, False),         # landing-page / vip headers (display 64-160px)
    ("public/logo-email.png", 480, True),       # email clients: no alpha, must be opaque
]

# Palette size for the quantized outputs.
PALETTE = 64

# Square home-screen / browser icons: opaque (transparency tiles BLACK on iOS), badge contained
# with a little inset. These must stay SQUARE — the logo itself is not, so it is letterboxed rather
# than stretched, and the declared `sizes` in index.html has to match the file.
SQUARE_ICONS = [
    ("public/apple-touch-icon.png", 180),  # iOS home screen
    ("public/icon-192.png", 192),          # <link rel=icon sizes=192x192> (Android/Chrome)
]


def load_master(src: Path) -> Image.Image:
    im = Image.open(src).convert("RGB")
    px = im.load()
    w, h = im.size

    # --- trim to the artwork -------------------------------------------------
    def is_ink(x: int, y: int) -> bool:
        r, g, b = px[x, y]
        return (r + g + b) < 720 or (max(r, g, b) - min(r, g, b)) > 25

    xs = [x for x in range(w) if any(is_ink(x, y) for y in range(0, h, 3))]
    ys = [y for y in range(h) if any(is_ink(x, y) for x in range(0, w, 3))]
    if not xs or not ys:
        sys.exit("build-logo-assets: found no artwork in the master — wrong file?")
    box = (max(0, min(xs) - PAD), max(0, min(ys) - PAD),
           min(w, max(xs) + 1 + PAD), min(h, max(ys) + 1 + PAD))
    im = im.crop(box)

    # --- knock out the paper OUTSIDE the badge ------------------------------
    # NOT a flood fill from the edges: tried that first and it leaked straight through the thin
    # anti-aliased red ring and erased the badge's white interior (72% of the frame went
    # transparent). The geometry is knowable instead, so use it.
    #
    #   keep = inside the ring's circle  OR  is ink
    #
    # The red ring is the outermost RED element, so the bounding box of red pixels IS the circle.
    # Keeping "ink anywhere" preserves the black LONG BRANCH, NJ banner, whose ribbon ends flare out
    # past the circle. Everything else — the paper in the four corners — goes.
    w2, h2 = im.size
    px2 = im.load()

    def is_red(x: int, y: int) -> bool:
        r, g, b = px2[x, y]
        return r > 90 and r - max(g, b) > 45

    rxs = [x for x in range(w2) if any(is_red(x, y) for y in range(0, h2, 2))]
    rys = [y for y in range(h2) if any(is_red(x, y) for x in range(0, w2, 2))]
    if not rxs or not rys:
        sys.exit("build-logo-assets: no red ring found — is this the right logo?")
    cx = (min(rxs) + max(rxs)) / 2.0
    cy = (min(rys) + max(rys)) / 2.0
    radius = ((max(rxs) - min(rxs)) + (max(rys) - min(rys))) / 4.0 + 2
    print(f"  ring: centre ({cx:.0f},{cy:.0f}) radius {radius:.0f}")

    def is_ink2(x: int, y: int) -> bool:
        r, g, b = px2[x, y]
        return (r + g + b) < 700 or (max(r, g, b) - min(r, g, b)) > 28

    mask = Image.new("L", im.size, 0)
    mpx = mask.load()
    r2 = radius * radius
    outside = 0
    for y in range(h2):
        dy2 = (y - cy) ** 2
        for x in range(w2):
            if (x - cx) ** 2 + dy2 <= r2 or is_ink2(x, y):
                mpx[x, y] = 255
            else:
                outside += 1
    # Soften the cut by a hair so the circle's edge isn't jagged.
    mask = mask.filter(ImageFilter.GaussianBlur(0.6))

    out = im.convert("RGBA")
    out.putalpha(mask)

    pct = 100.0 * outside / (w2 * h2)
    print(f"  trimmed to {w2}x{h2} (aspect {w2 / h2:.4f}); {pct:.1f}% made transparent")
    # Sanity: the four corners left over by a circle inscribed in a square are 1 - pi/4 = 21.5% of
    # the frame, less whatever the banner overhang claims back. Far outside that band means the ring
    # was mis-detected — refuse rather than ship a logo with its middle punched out.
    if not (8.0 < pct < 32.0):
        sys.exit(f"build-logo-assets: {pct:.1f}% transparent is implausible — refusing to write assets")
    return out


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else MASTER
    if not src.exists():
        sys.exit(f"build-logo-assets: master not found at {src}")
    print(f"master: {src}")
    logo = load_master(src)
    aspect = logo.size[1] / logo.size[0]

    # Keep a lossless master in the repo so this is re-runnable without the original JPEG.
    if src != MASTER:
        MASTER.parent.mkdir(parents=True, exist_ok=True)
        logo.save(MASTER, "PNG", optimize=True)
        print(f"  wrote master → {MASTER.relative_to(ROOT)}")

    for rel, width, opaque in OUTPUTS:
        height = round(width * aspect)
        im = logo.resize((width, height), Image.LANCZOS)
        if opaque:
            flat = Image.new("RGB", im.size, (255, 255, 255))
            flat.paste(im, mask=im.split()[3])
            im = flat
        # FASTOCTREE is the only PIL quantizer that keeps an alpha channel.
        im = im.quantize(colors=PALETTE, method=Image.FASTOCTREE, dither=Image.NONE)
        p = ROOT / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        im.save(p, "PNG", optimize=True)
        print(f"  {rel:38} {width}x{height}  {p.stat().st_size // 1024} KB")

    # Square icons — opaque white canvas, badge contained with an inset.
    for rel, size in SQUARE_ICONS:
        inset = round(size * 0.06)
        fit = size - inset * 2
        scale = min(fit / logo.size[0], fit / logo.size[1])
        badge = logo.resize((max(1, round(logo.size[0] * scale)), max(1, round(logo.size[1] * scale))), Image.LANCZOS)
        canvas = Image.new("RGB", (size, size), (255, 255, 255))
        canvas.paste(badge, ((size - badge.size[0]) // 2, (size - badge.size[1]) // 2), badge)
        canvas = canvas.quantize(colors=PALETTE, method=Image.FASTOCTREE, dither=Image.NONE)
        p = ROOT / rel
        canvas.save(p, "PNG", optimize=True)
        print(f"  {rel:38} {size}x{size}  {p.stat().st_size // 1024} KB (opaque, square)")

    print(f"\nHTML/JSX width+height attributes must use aspect {logo.size[0]}:{logo.size[1]} "
          f"({1 / aspect:.4f}) — e.g. width 145 → height {round(145 * aspect)}")


if __name__ == "__main__":
    main()
