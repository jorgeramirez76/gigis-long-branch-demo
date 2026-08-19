import { useEffect, useRef, useState } from "react";
import { LOCATION } from "../data/location";
import { Turnstile } from "./Turnstile";
import { turnstileEnabled } from "../lib/turnstile";
// Quoted VERBATIM in the A2P 10DLC campaign registration (message_flow) — see
// lib/vipConsent.ts, the single canonical copy for the app.
import { CONSENT_TEXT } from "../lib/vipConsent";

const TURNSTILE_ON = turnstileEnabled();

type Status = "idle" | "submitting" | "verify" | "success" | "error";

export function VipClub() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [apt, setApt] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("NJ");
  const [zip, setZip] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [emailConsent, setEmailConsent] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<{ code?: string; alreadyMember?: boolean; message?: string }>({});
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  // Email-verification step: nothing is created until the person taps the Verify button in
  // the email we send. pendingEmail is the server-normalized address it went to; pollId lets
  // THIS tab notice the tap even when it happens on another device (phone vs laptop).
  const [pendingEmail, setPendingEmail] = useState("");
  const [pollId, setPollId] = useState<string | null>(null);
  // Stated by the server so the copy can't drift from the real expiry.
  const [ttlHours, setTtlHours] = useState(24);
  const verifyHeadingRef = useRef<HTMLHeadingElement>(null);

  function bumpTurnstile() {
    if (TURNSTILE_ON) {
      setTurnstileToken(null);
      setTurnstileReset((n) => n + 1);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim() || !email.trim() || address.trim().length < 4 || city.trim().length < 2 || !/^[A-Za-z]{2}$/.test(stateCode.trim()) || !/^\d{5}$/.test(zip.trim())) {
      setStatus("error");
      setErrorMsg("Please fill in your name, phone, email, and full address (street, city, state, ZIP) for your free pie.");
      return;
    }
    if (!smsConsent && !emailConsent) {
      setStatus("error");
      setErrorMsg("Pick at least one way to get your code and deals (text or email).");
      return;
    }
    if (TURNSTILE_ON && !turnstileToken) {
      setStatus("error");
      setErrorMsg("Please complete the verification below.");
      return;
    }
    setStatus("submitting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/vip-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business: "gigis_long_branch",
          name,
          phone,
          email,
          address,
          apt,
          city,
          state: stateCode,
          zip,
          smsConsent,
          emailConsent,
          consentText: CONSENT_TEXT,
          source: "website",
          turnstileToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(
          data.error === "invalid_phone" ? "That phone number doesn't look right."
          : data.error === "invalid_email" ? "That email doesn't look right."
          : data.error === "address_required" ? "Please enter your street address."
          : data.error === "invalid_city" ? "That town doesn't look right — letters only, please."
          : data.error === "invalid_state" ? "Please use your 2-letter state (e.g. NJ)."
          : data.error === "invalid_zip" ? "That ZIP doesn't look right — 5 digits, please."
          : data.error === "verification_failed" ? "Verification failed — please try again."
          : data.error === "rate_limited" ? "Too many attempts — please wait a bit."
          : "Something went wrong — try again or call us.",
        );
        bumpTurnstile();
        return;
      }
      if (data.verifyRequired) {
        // The Verify button is on its way to their inbox; the member + pie code don't exist
        // yet. The consumed Turnstile token is refreshed now so "go back & resend" works
        // without a confusing verification error.
        setPendingEmail(typeof data.email === "string" ? data.email : email.trim().toLowerCase());
        setPollId(typeof data.pollId === "string" ? data.pollId : null);
        if (typeof data.ttlHours === "number" && data.ttlHours > 0) setTtlHours(data.ttlHours);
        setStatus("verify");
        bumpTurnstile();
        return;
      }
      setResult({ code: data.code, alreadyMember: data.alreadyMember, message: data.message });
      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMsg("Couldn't reach the server — try again in a moment.");
      bumpTurnstile();
    }
  }

  // Watch for the tap. Polling (rather than nothing) is what keeps this tab honest when the
  // person opens the email on their phone: without it the screen would sit here forever looking
  // broken while their membership is already live. Stops on success, on a stale/replaced signup,
  // or after ~20 minutes so an abandoned tab isn't polling all day.
  const pollStop = useRef(false);
  useEffect(() => {
    if (status !== "verify" || !pollId) return;
    pollStop.current = false;
    let tries = 0;
    const tick = async () => {
      if (pollStop.current || tries++ > 240) return; // 240 * 5s ≈ 20 min
      try {
        const res = await fetch("/api/vip-verify-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pollId }),
        });
        const data = await res.json();
        if (data.verified) {
          pollStop.current = true;
          const code = typeof data.code === "string" ? data.code : undefined;
          // Verified with no code means an existing membership absorbed this signup. The
          // default success panel promises a code and says we sent it — both untrue here —
          // so take the already-a-member branch, the same way /vip-verify/ does.
          setResult(
            code
              ? { code }
              : {
                  alreadyMember: true,
                  message: "Your email is confirmed and you're in the VIP Club. Watch for our weekly deals!",
                },
          );
          setStatus("success");
          return;
        }
        if (data.stale) pollStop.current = true; // signup replaced or swept — stop looping
      } catch {
        /* transient; keep polling */
      }
    };
    const t = setInterval(tick, 5000);
    return () => {
      pollStop.current = true;
      clearInterval(t);
    };
  }, [status, pollId]);

  // The form is replaced in place, so without this the page can be left scrolled past the new
  // screen — the customer sees nothing happen and assumes the submit failed.
  useEffect(() => {
    if (status !== "verify" && status !== "success") return;
    const h = verifyHeadingRef.current;
    h?.scrollIntoView({ block: "center", behavior: "smooth" });
    h?.focus({ preventScroll: true });
  }, [status]);

  if (status === "verify") {
    return (
      <section id="vip-club" className="scroll-mt-20 bg-[var(--color-brand-red)] py-20 text-white md:py-28">
        <div className="container-x mx-auto max-w-xl text-center" data-reveal>
          <h2 ref={verifyHeadingRef} tabIndex={-1} className="text-4xl md:text-5xl">One last tap 📬</h2>
          <p className="mt-4 text-base md:text-lg text-white/90">
            We just emailed <strong>{pendingEmail}</strong>. Open it, tap{" "}
            <strong>“Verify my email”</strong>, then confirm on the page that opens — your free-pie
            code appears right there.
          </p>
          <div className="mx-auto mt-8 max-w-sm rounded-2xl bg-black/20 px-5 py-5 text-left text-sm text-white/85">
            <p className="font-bold text-white">Don't see it?</p>
            <ul className="mt-2 space-y-1.5">
              <li>• Check your spam or junk folder.</li>
              <li>• The link works for {ttlHours} hours.</li>
              <li>• Wrong email? Go back and submit again for a new one.</li>
            </ul>
          </div>
          <p className="mt-6 text-sm text-white/80">
            <button type="button" onClick={() => setStatus("idle")} className="font-bold underline">
              Go back &amp; fix my email
            </button>{" "}
            — your details are saved.
          </p>
          <p className="mt-3 text-xs text-white/60">
            This page updates by itself once you tap the button, even if you open the email on your phone.
          </p>
        </div>
      </section>
    );
  }

  if (status === "success") {
    return (
      <section id="vip-club" className="scroll-mt-20 bg-[var(--color-brand-red)] py-20 text-white md:py-28">
        <div className="container-x mx-auto max-w-xl text-center" data-reveal>
          {result.alreadyMember ? (
            <>
              <h2 className="text-4xl md:text-5xl">Already a VIP!</h2>
              <p className="mt-4 text-base md:text-lg text-white/90">
                {result.message ?? "You're already in the club — the free welcome pie is one per new member. Watch for our deals!"}
              </p>
            </>
          ) : (
            <>
              <h2 className="text-4xl md:text-5xl">You're in! 🍕</h2>
              <p className="mt-4 text-base md:text-lg text-white/90">
                Here's your welcome code for a <strong>free plain cheese pie</strong>:
              </p>
              {result.code && (
                <div className="mx-auto mt-6 inline-block rounded-2xl border-2 border-dashed border-[var(--color-gold-bright)] bg-black/20 px-8 py-5">
                  <div className="text-3xl font-extrabold tracking-[0.15em] text-[var(--color-gold-bright)] md:text-4xl">
                    {result.code}
                  </div>
                </div>
              )}
              <p className="mt-6 text-sm text-white/80">
                Redeem it at final checkout when you order pickup on this site — or show it at the
                counter. <strong>Pickup orders only</strong>, good for 90 days. We also sent it to{" "}
                {smsConsent && emailConsent ? "your phone and email" : smsConsent ? "your phone" : "your email"}.
                One pie per new member. See you soon!
              </p>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section id="vip-club" className="scroll-mt-20 bg-[var(--color-brand-red)] py-20 text-white md:py-28">
      <div className="container-x">
        <div className="mx-auto max-w-xl text-center" data-reveal>
          <span className="eyebrow text-[var(--color-gold-bright)]">Join the club</span>
          <h2 className="mt-3 text-4xl md:text-5xl">
            Get a <span className="text-[var(--color-gold-bright)]">FREE Plain Pie</span>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/85 md:text-lg">
            Join the Gigi's VIP Club for a code good for a complimentary plain cheese
            pie — plus first dibs on weekly deals. We'll email you a link to confirm it's
            you; one tap and your free-pie code is yours.
            New members only, one per household, pickup orders only. No spam, cancel anytime.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mx-auto mt-10 max-w-xl space-y-4" data-reveal>
          <div>
            <label htmlFor="vip-name" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/70">
              Name
            </label>
            <input
              id="vip-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border-0 bg-white/95 px-4 py-3 text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
              placeholder="Your name"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="vip-phone" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/70">
                Phone
              </label>
              <input
                id="vip-phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border-0 bg-white/95 px-4 py-3 text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
                placeholder="(732) 555-0100"
              />
            </div>
            <div>
              <label htmlFor="vip-email" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/70">
                Email
              </label>
              <input
                id="vip-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border-0 bg-white/95 px-4 py-3 text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
                placeholder="you@email.com"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <div>
              <label htmlFor="vip-address" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/70">
                Street address
              </label>
              <input
                id="vip-address"
                type="text"
                required
                autoComplete="street-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-xl border-0 bg-white/95 px-4 py-3 text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
                placeholder="140 Brighton Ave"
              />
            </div>
            <div>
              <label htmlFor="vip-apt" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/70">
                Apt/Unit <span className="font-normal normal-case text-white/45">(optional)</span>
              </label>
              <input
                id="vip-apt"
                type="text"
                value={apt}
                onChange={(e) => setApt(e.target.value)}
                className="w-full rounded-xl border-0 bg-white/95 px-4 py-3 text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
                placeholder="3B"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_90px_120px]">
            <div>
              <label htmlFor="vip-city" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/70">
                City
              </label>
              <input
                id="vip-city"
                type="text"
                required
                autoComplete="address-level2"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-xl border-0 bg-white/95 px-4 py-3 text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
                placeholder="Long Branch"
              />
            </div>
            <div>
              <label htmlFor="vip-state" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/70">
                State
              </label>
              <input
                id="vip-state"
                type="text"
                required
                maxLength={2}
                autoComplete="address-level1"
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value.toUpperCase())}
                className="w-full rounded-xl border-0 bg-white/95 px-4 py-3 text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
                placeholder="NJ"
              />
            </div>
            <div>
              <label htmlFor="vip-zip" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/70">
                ZIP
              </label>
              <input
                id="vip-zip"
                type="text"
                required
                maxLength={5}
                inputMode="numeric"
                autoComplete="postal-code"
                value={zip}
                onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-xl border-0 bg-white/95 px-4 py-3 text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
                placeholder="07740"
              />
            </div>
          </div>

          <div className="space-y-2.5 rounded-xl bg-black/15 p-4">
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Text me deals</span>
            </label>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={emailConsent} onChange={(e) => setEmailConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Email me deals</span>
            </label>
          </div>

          <p className="text-xs leading-relaxed text-white/85">{CONSENT_TEXT}</p>
          <p className="text-xs text-white/85">
            <a href="/privacy-policy/" className="underline">Privacy Policy</a>
            {" · "}
            <a href="/sms-terms/" className="underline">SMS Terms</a>
          </p>

          {status === "error" && (
            <p className="rounded-lg bg-black/25 px-4 py-2.5 text-sm text-white">{errorMsg}</p>
          )}

          {TURNSTILE_ON && <Turnstile onToken={setTurnstileToken} resetSignal={turnstileReset} />}

          <button
            type="submit"
            disabled={status === "submitting" || (TURNSTILE_ON && !turnstileToken)}
            className="w-full rounded-full bg-[var(--color-gold-bright)] px-5 py-3.5 text-sm font-bold uppercase tracking-wide text-[var(--color-ink)] transition hover:brightness-95 disabled:opacity-60"
          >
            {status === "submitting" ? "Joining…" : "Get My Free Pie"}
          </button>

          <p className="text-center text-xs text-white/80">
            Prefer to call? {LOCATION.phone}
          </p>
        </form>
      </div>
    </section>
  );
}
