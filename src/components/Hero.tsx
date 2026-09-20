import { LOCATION, DIRECTIONS_URL } from "../data/location";
import { HERO_IMAGE } from "../data/gallery";
import { PhoneIcon, ArrowIcon } from "./Icons";
import { OpenStatusPill } from "./OpenStatusPill";

export function Hero() {
  return (
    <section id="top" className="food-hero">
      <div className="food-hero-grid container-x">
        <div className="food-hero-copy">
          <p className="eyebrow">Your neighborhood pizza spot · Long Branch</p>
          <h1>Big slices.<br />Big cravings.<br /><span>That’s Gigi’s.</span></h1>
          <p className="food-hero-description">Real NY-style pizza. Bubbling cheese, a crisp golden crust, and the kind of slice you fold with both hands. Hungry yet?</p>
          <div className="food-hero-actions">
            <a href="#menu" className="btn-primary">Order pickup or delivery<ArrowIcon className="h-5 w-5" /></a>
            <a href={`tel:${LOCATION.phoneTel}`} className="food-call" aria-label={`Call Gigi's Long Branch at ${LOCATION.phone}`}><PhoneIcon className="h-4 w-4" />Call the shop</a>
          </div>
          <a href="/account/?join=1" className="hero-vip-ticket">
            <span className="hero-vip-icon" aria-hidden="true">★</span>
            <span><small>A little welcome gift</small><strong>Your first VIP perk? A free pie.</strong><span>New members · Pickup only. Plus exclusive deals.</span></span>
            <ArrowIcon className="h-5 w-5 shrink-0" />
          </a>
          <div className="food-hero-details">
            <p><OpenStatusPill /> <span aria-hidden="true"> · </span><a href={DIRECTIONS_URL} target="_blank" rel="noreferrer">{LOCATION.street}</a></p>
            <p>Online pickup until 11 PM · Delivery until 10 PM</p>
            <p>Counter until 11 PM Mon–Wed / midnight Thu–Sun.</p>
            <p>Looking for our other shop? <a href="https://gigisnystylepizza.com/sea-bright">Visit Sea Bright →</a></p>
          </div>
        </div>
        <div className="food-hero-photo">
          <picture>
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
