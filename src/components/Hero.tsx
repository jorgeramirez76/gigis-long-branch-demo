import { LOCATION, DIRECTIONS_URL } from "../data/location";
import { HERO_IMAGE } from "../data/gallery";
import { PhoneIcon, PinIcon, ArrowIcon } from "./Icons";
import { OpenStatusPill } from "./OpenStatusPill";

export function Hero() {
  return (
    <section id="top" className="food-hero">
      <div className="food-hero-grid container-x">
        <div className="food-hero-copy">
          {/* Owner request (Kenny, 2026-09-24): Sea Bright must be as easy to find from here as Long
              Branch is from Sea Bright, a highlighted button on first load.
              Owner request (Tommy, 2026-10-20): match Sea Bright's phone layout. On a phone this sat
              dead center under the photo and pulled the eye away from ordering; it now opens the
              hero as a small strip, the way Sea Bright's does, so the Order button is what sits
              in the middle of the screen. */}
          <a href="https://gigisnystylepizza.com/sea-bright" className="food-hero-crosslink">
            Closer to Sea Bright? Order from our Sea Bright location
            <ArrowIcon className="h-3.5 w-3.5 shrink-0" />
          </a>
          <p className="food-hero-address">{LOCATION.street} · {LOCATION.city}</p>
          {/* The kicker sits inside the H1 so the page's main heading names what and where
              (search engines weigh the H1; the slogan alone said neither). It keeps the old
              eyebrow's look. */}
          <h1><span className="eyebrow food-hero-kicker">New York–style pizza in Long Branch, NJ</span>{" "}Big slices.<br />Big cravings.<br /><span>That’s Gigi’s.</span></h1>
          <p className="food-hero-description">Real NY-style pizza. Bubbling cheese, a crisp golden crust, and the kind of slice you fold with both hands. Hungry yet?</p>
          <div className="food-hero-actions">
            <a href="#menu" className="btn-primary">Order pickup or delivery<ArrowIcon className="h-5 w-5" /></a>
            <a href={`tel:${LOCATION.phoneTel}`} className="btn-outline food-hero-secondary" aria-label={`Call Gigi's Long Branch at ${LOCATION.phone}`}><PhoneIcon className="h-4 w-4" />Call the shop</a>
            <a href={DIRECTIONS_URL} target="_blank" rel="noreferrer" className="btn-outline food-hero-secondary"><PinIcon className="h-4 w-4" />Directions</a>
          </div>
          {/* Owner request (Tommy, 2026-10-20): a red Join VIP button right under Order / Call /
              Directions, in the same spot as Sea Bright's, so it shows on a phone without
              scrolling. The free pie is for new members and pickup only; keep that line. */}
          <a href="/account/?join=1&source=hero" className="hero-vip-button">
            <span className="hero-vip-icon" aria-hidden="true">★</span>
            <span><strong>Join VIP: get a free pie</strong><span>New members · Pickup only. Plus exclusive deals.</span></span>
            <ArrowIcon className="h-5 w-5 shrink-0" />
          </a>
          <div className="food-hero-details">
            <p><span>Counter:</span><OpenStatusPill /></p>
            <p>Online pickup until 11 PM · Delivery until 10 PM</p>
            <p>Counter until 11 PM Mon–Wed / midnight Thu–Sun.</p>
          </div>
        </div>
        <div className="food-hero-photo">
          <picture>
            {/* Phones show this photo as a short, full-width strip (storefront.css: 170-230px tall
                under 768px), so the 900x1350 portrait was mostly cropped away. The wide crop fits
                that strip as it is and is about a third of the bytes, so the likely mobile LCP
                image gets lighter. Desktop and tablet keep the portrait. */}
            <source media="(max-width: 767px)" type="image/webp" srcSet={HERO_IMAGE.webpWide} sizes="(max-height: 500px) 50vw, 100vw" />
            <source type="image/webp" srcSet={HERO_IMAGE.webpPortrait} sizes="(min-width: 900px) 50vw, 100vw" />
            <img src={HERO_IMAGE.srcPortrait} alt={HERO_IMAGE.alt} loading="eager" {...{ fetchpriority: "high" }} decoding="async" />
          </picture>
          <div className="food-photo-stamp"><span>Hand-stretched.</span><strong>Fold-worthy.</strong><span>Shore soul.</span></div>
          <span className="food-photo-caption">Made for your next pizza night.</span>
        </div>
      </div>
      <div className="food-hero-strip"><span>NY-style pies &amp; big slices</span><span aria-hidden="true">✦</span><span>Heroes, pasta &amp; Italian favorites</span><span aria-hidden="true">✦</span><span>140 Brighton Ave · Long Branch</span></div>
    </section>
  );
}
