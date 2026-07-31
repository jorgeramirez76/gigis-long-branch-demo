import { useState } from "react";
import { LOCATION } from "../data/location";
import { Turnstile } from "./Turnstile";
import { turnstileEnabled } from "../lib/turnstile";
// Quoted VERBATIM in the A2P 10DLC campaign registration (message_flow) — see
// lib/vipConsent.ts, the single canonical copy for the app.
import { CONSENT_TEXT } from "../lib/vipConsent";

const TURNSTILE_ON = turnstileEnabled();

type Status = "idle" | "submitting" | "success" | "error";

export function VipClub() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [apt, setApt] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [emailConsent, setEmailConsent] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<{ code?: string; alreadyMember?: boolean; message?: string }>({});
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);

  function bumpTurnstile() {
    if (TURNSTILE_ON) {
      setTurnstileToken(null);
      setTurnstileReset((n) => n + 1);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim() || !email.trim() || address.trim().length < 4) {
      setStatus("error");
      setErrorMsg("Please fill in your name, phone, email, and street address for your free pie.");
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
          smsConsent,
          emailConsent,
          consentText: CONSENT_TEXT,
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
          : data.error === "verification_failed" ? "Verification failed — please try again."
          : data.error === "rate_limited" ? "Too many attempts — please wait a bit."
          : "Something went wrong — try again or call us.",
        );
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
                Here's your welcome code — show it at Gigi's for your <strong>free plain cheese pie</strong>:
              </p>
              {result.code && (
                <div className="mx-auto mt-6 inline-block rounded-2xl border-2 border-dashed border-[var(--color-gold-bright)] bg-black/20 px-8 py-5">
                  <div className="text-3xl font-extrabold tracking-[0.15em] text-[var(--color-gold-bright)] md:text-4xl">
                    {result.code}
                  </div>
                </div>
              )}
              <p className="mt-6 text-sm text-white/80">
                We also sent it to your phone and email. One pie per new member. See you soon!
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
            Join the Gigi's VIP Club and we'll text or email you a code for a
            complimentary plain cheese pie — plus first dibs on weekly deals.
            New members only, one per household. No spam, cancel anytime.
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
