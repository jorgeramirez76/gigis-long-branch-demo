import { useState } from "react";
import { LOCATION } from "../data/location";
import { Turnstile } from "./Turnstile";
import { turnstileEnabled } from "../lib/turnstile";

const CONSENT_TEXT =
  "By joining, you agree to receive promotional texts and/or emails from Gigi's NY Style Pizza (Long Branch, NJ). Message/data rates may apply. Message frequency varies. Reply STOP to unsubscribe from texts, or use the unsubscribe link in any email. No purchase necessary.";

const TURNSTILE_ON = turnstileEnabled();

type Status = "idle" | "submitting" | "success" | "error";

export function VipClub() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [emailConsent, setEmailConsent] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
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
    if (!smsConsent && !emailConsent) {
      setStatus("error");
      setErrorMsg("Pick at least one way to hear from us (text or email).");
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
          phone: smsConsent ? phone : undefined,
          email: emailConsent ? email : undefined,
          smsConsent,
          emailConsent,
          consentText: CONSENT_TEXT,
          turnstileToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error === "invalid_phone" ? "That phone number doesn't look right." : data.error === "invalid_email" ? "That email doesn't look right." : data.error === "verification_failed" ? "Verification failed — please try again." : data.error === "rate_limited" ? "Too many attempts — please wait a bit." : "Something went wrong — try again or call us.");
        bumpTurnstile();
        return;
      }
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
          <h2 className="text-4xl md:text-5xl">You're in!</h2>
          <p className="mt-4 text-base md:text-lg">
            Check your phone/email for your welcome offer. Talk soon.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="vip-club" className="scroll-mt-20 bg-[var(--color-brand-red)] py-20 text-white md:py-28">
      <div className="container-x">
        <div className="mx-auto max-w-xl text-center" data-reveal>
          <span className="eyebrow text-[var(--color-gold-bright)]">Join the club</span>
          <h2 className="mt-3 text-4xl md:text-5xl">The VIP Club</h2>
          <p className="mt-4 text-base leading-relaxed text-white/85 md:text-lg">
            Sign up for text or email deals — first one's on us. No spam, cancel anytime.
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
                Phone (for texts)
              </label>
              <input
                id="vip-phone"
                type="tel"
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border-0 bg-white/95 px-4 py-3 text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
                placeholder="you@email.com"
              />
            </div>
          </div>

          <div className="space-y-2.5 rounded-xl bg-black/15 p-4">
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Text me deals ({phone ? phone : "phone number required above"})</span>
            </label>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={emailConsent} onChange={(e) => setEmailConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Email me deals ({email ? email : "email required above"})</span>
            </label>
          </div>

          <p className="text-xs leading-relaxed text-white/85">{CONSENT_TEXT}</p>

          {status === "error" && (
            <p className="rounded-lg bg-black/25 px-4 py-2.5 text-sm text-white">{errorMsg}</p>
          )}

          {TURNSTILE_ON && <Turnstile onToken={setTurnstileToken} resetSignal={turnstileReset} />}

          <button
            type="submit"
            disabled={status === "submitting" || (TURNSTILE_ON && !turnstileToken)}
            className="w-full rounded-full bg-[var(--color-gold-bright)] px-5 py-3.5 text-sm font-bold uppercase tracking-wide text-[var(--color-ink)] transition hover:brightness-95 disabled:opacity-60"
          >
            {status === "submitting" ? "Joining…" : "Join the VIP Club"}
          </button>

          <p className="text-center text-xs text-white/80">
            Prefer to call? {LOCATION.phone}
          </p>
        </form>
      </div>
    </section>
  );
}
