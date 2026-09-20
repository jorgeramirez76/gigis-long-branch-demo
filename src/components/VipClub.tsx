import { FAVORITES } from "../data/gallery";
import { ArrowIcon } from "./Icons";

export function VipClub() {
  const pizza = FAVORITES[0];
  return <section id="vip-club" className="vip-feature" aria-labelledby="vip-heading">
    <div className="container-x">
      <div className="vip-feature-card">
        <div className="vip-feature-photo">
          <picture><source type="image/webp" srcSet={pizza.webp} sizes="(min-width: 900px) 35vw, 100vw" /><img src={pizza.src} alt="Gigi’s classic plain cheese pizza pie" loading="lazy" decoding="async" /></picture>
          <span className="vip-photo-label">Your welcome pie is on us.</span>
        </div>
        <div className="vip-feature-copy">
          <p className="vip-eyebrow">Gigi’s VIP Club · A tastier kind of membership</p>
          <h2 id="vip-heading">Good pizza.<br /><span>Even better perks.</span></h2>
          <p>Join the family and get a <strong>free plain cheese pizza pie</strong> when you sign up. Stay for the exclusive discounts and delicious deals.</p>
          <a className="btn-gold" href="/account/?join=1">Get my free pizza pie<ArrowIcon className="h-5 w-5" /></a>
          <p className="vip-terms">New members: verify your email and activate your account to get your code. One welcome pie per eligible household. Pickup only. Choose email or text updates for deals.</p>
          <a className="vip-signin" href="/account/">Already a VIP? Sign in to your rewards →</a>
        </div>
      </div>
    </div>
  </section>;
}
