"""Owner-provided Long Branch photos for the static SEO pages (landing pages, /menu/, /about/).

The React app imports these from src/assets/ through Vite, which hashes the names, so the static
generators cannot link to them. figure() copies the chosen WebP into public/img/food/ under a
stable name and returns the markup. Only photos already used on the live site are listed here
(provenance: research/image-sources.md and src/data/menuPhotos.ts), and every alt text says
what the photo actually shows.
"""
import html
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "img" / "food"

# name -> (source, width, height, alt)
PHOTOS = {
    "plain-pie": ("src/assets/menu/plain-pie-960.webp", 960, 720,
                  "Plain cheese pie from Gigi's NY Style Pizza in Long Branch"),
    "plain-slice": ("src/assets/menu/plain-slice-960.webp", 960, 720,
                    "Plain New York-style cheese slice from Gigi's in Long Branch"),
    "slices": ("src/assets/menu/slices-960.webp", 960, 720,
               "Pizza slices from Gigi's NY Style Pizza in Long Branch"),
    "pepperoni-slice": ("src/assets/menu/pepperoni-slice-960.webp", 960, 720,
                        "Pepperoni slice from Gigi's NY Style Pizza in Long Branch"),
    "margherita": ("src/assets/menu/margherita-960.webp", 960, 720,
                   "Margherita pie from Gigi's NY Style Pizza in Long Branch"),
    "grandma": ("src/assets/menu/grandma-960.webp", 960, 720,
                "Square Grandma pie from Gigi's NY Style Pizza in Long Branch"),
    "bee-sting": ("src/assets/menu/bee-sting-960.webp", 960, 720,
                  "Bee Sting specialty pie from Gigi's NY Style Pizza in Long Branch"),
    "drunken-grandma": ("src/assets/menu/drunken-grandma-960.webp", 960, 720,
                        "Drunken Grandma vodka square pie from Gigi's in Long Branch"),
    "dining-room": ("src/assets/brand/inside-wide-900.webp", 900, 506,
                    "Gigi's dining room at 140 Brighton Avenue, Long Branch, with string lights and the red accent wall"),
    "marquee": ("src/assets/brand/sign-tile-900.webp", 700, 875,
                "Illuminated GIGI'S marquee letters on the dining room brick wall in Long Branch"),
}

STYLE = (".photo{margin:0 0 18px}.photo img{width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;"
         "border-radius:12px;background:#f8f8f8}.photo figcaption{font-size:.84rem;color:#626262;margin-top:6px}"
         ".photo-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}")


def src(name):
    """Copy the photo into public/img/food/ and return its public URL."""
    source, *_ = PHOTOS[name]
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{name}.webp"
    shutil.copyfile(ROOT / source, target)
    return f"/img/food/{name}.webp"


def figure(name, caption="", eager=False):
    _, width, height, alt = PHOTOS[name]
    # Near the top of a page the photo can be the largest paint, and lazy-loading it would
    # delay that; further down, lazy keeps it off the critical path.
    loading = 'loading="eager"' if eager else 'loading="lazy"'
    cap = f"<figcaption>{html.escape(caption)}</figcaption>" if caption else ""
    return (f'<figure class="photo"><img src="{src(name)}" alt="{html.escape(alt, quote=True)}" '
            f'width="{width}" height="{height}" {loading} decoding="async">{cap}</figure>')
