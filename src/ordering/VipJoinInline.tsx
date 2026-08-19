import { useEffect, useRef, useState } from "react";
import { Turnstile } from "../components/Turnstile";
import { turnstileEnabled } from "../lib/turnstile";
import { CONSENT_TEXT } from "../lib/vipConsent";

const TURNSTILE_ON = turnstileEnabled();

/**
 * One-tap VIP Club signup on the order-confirmation screen.
 *
 * The customer just typed their name, phone, and email to place the order, so this reuses those
 * instead of sending them to a blank form (the previous #vip-club link converted 1 member from 8
 * paying customers). Only what's missing is asked for: pickup orders have no address, and the
 * welcome pie is one per household, so the server requires one for dedupe.
 *
 * Posts to the SAME /api/vip-signup endpoint as the homepage form — one signup path, one set of
 * server rules. Consent boxes start UNCHECKED (matching the homepage form): the A2P registration
 * and TCPA both expect an affirmative opt-in, so pre-checking is not an option no matter how much
 * it would help conversion.
 */
export function VipJoinInline({
  name,
  phone,
  email,
  address,
  town,
}: {
  name: string;
  phone: string;
  email: string;
  /** Empty for pickup orders — the form asks for it; prefilled for delivery. */
  address: string;
  /** The delivery town, which the checkout collects in its own dropdown. Empty for pickup. */
  town?: string;
}) {
  // Email is editable here even though it came from the order: it's the channel the
  // verification code is sent to, so a typo in the order email must be fixable rather
  // than dead-ending the customer on the code screen.
  const [joinEmail, setJoinEmail] = useState(email);
  const [addr, setAddr] = useState(address);
  const [apt, setApt] = useState("");
  const [city, setCity] = useState(town ?? "");
  const [stateCode, setStateCode] = useState("NJ");
  const [zip, setZip] = useState("");
  // Delivery orders prefill the street line and the town, so only the ZIP is still missing.
  // The street line used to be treated as a COMPLETE address, posting empty city/state/zip, which
  // the server rejects with invalid_city — every delivery customer who tapped "Join & claim my
  // free pie" got a generic failure.
  const [smsConsent, setSmsConsent] = useState(false);
  const [emailConsent, setEmailConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "verify" | "success" | "already">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  // Email-verification step: the person must tap "Verify my email" in the email before the
  // member and free-pie code exist. pendingEmail = server-normalized recipient; pollId lets
  // this panel notice the tap even if they open the email elsewhere.
  const [pendingEmail, setPendingEmail] = useState("");
  const [pollId, setPollId] = useState<string | null>(null);
  const [ttlHours, setTtlHours] = useState(24);

  async function join() {
    setErrorMsg("");
    if (!smsConsent && !emailConsent) {
      setErrorMsg("Tick at least one box so we can send your free-pie code.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(joinEmail.trim())) {
      setErrorMsg("Please enter a valid email — that's where your verification code goes.");
      return;
    }
    if (addr.trim().length < 4) {
      setErrorMsg("Please enter your home address — the welcome pie is one per household.");
      return;
    }
    if (city.trim().length < 2 || !/^\d{5}$/.test(zip.trim())) {
      setErrorMsg("Please add your town and 5-digit ZIP.");
      return;
    }
    if (!/^[A-Za-z]{2}$/.test(stateCode.trim())) {
      setErrorMsg("Please add your 2-letter state (e.g. NJ).");
      return;
    }
    if (TURNSTILE_ON && !turnstileToken) {
      setErrorMsg("Please complete the verification below.");
      return;
    }
    setStatus("submitting");
    try {
      const res = await fetch("/api/vip-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business: "gigis_long_branch",
          name,
          phone,
          email: joinEmail,
          address: addr,
          apt,
          city,
          state: stateCode,
          zip,
          smsConsent,
          emailConsent,
          consentText: CONSENT_TEXT,
          source: "checkout",
          turnstileToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("idle");
        setErrorMsg(
          data.error === "invalid_phone" ? "That phone number doesn't look right."
          : data.error === "invalid_email" ? "That email doesn't look right."
          : data.error === "address_required" ? "Please enter your street address."
          : data.error === "invalid_city" ? "That town doesn't look right — letters only, please."
          : data.error === "invalid_state" ? "Please use your 2-letter state (e.g. NJ)."
          : data.error === "invalid_zip" ? "That ZIP doesn't look right — 5 digits, please."
          : data.error === "verification_failed" ? "Verification failed — please try again."
          : data.error === "rate_limited" ? "Too many attempts — please wait a bit and try again."
          : "Something went wrong — you can also join from the VIP Club section anytime.",
        );
        // The token was consumed by the failed attempt; force a fresh challenge for the retry.
        if (TURNSTILE_ON) {
          setTurnstileToken(null);
          setTurnstileReset((n) => n + 1);
        }
        return;
      }
      if (data.alreadyMember) {
        setStatus("already");
      } else if (data.verifyRequired) {
        // Verify link emailed; nothing created yet. Refresh the consumed Turnstile token
        // so going back to resend doesn't hit a stale-token error.
        setPendingEmail(typeof data.email === "string" ? data.email : joinEmail.trim().toLowerCase());
        setPollId(typeof data.pollId === "string" ? data.pollId : null);
        if (typeof data.ttlHours === "number" && data.ttlHours > 0) setTtlHours(data.ttlHours);
        setStatus("verify");
        if (TURNSTILE_ON) {
          setTurnstileToken(null);
          setTurnstileReset((n) => n + 1);
        }
      } else {
        setCode(typeof data.code === "string" ? data.code : null);
        setStatus("success");
      }
    } catch {
      setStatus("idle");
      setErrorMsg("We couldn't reach the server — please try again.");
      if (TURNSTILE_ON) {
        setTurnstileToken(null);
        setTurnstileReset((n) => n + 1);
      }
    }
  }

  // Notice the tap even when the email is opened on a different device — otherwise this panel
  // would sit on "check your email" while the membership is already live.
  const pollStop = useRef(false);
  useEffect(() => {
    if (status !== "verify" || !pollId) return;
    pollStop.current = false;
    let tries = 0;
    const tick = async () => {
      if (pollStop.current || tries++ > 240) return; // ~20 min
      try {
        const res = await fetch("/api/vip-verify-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pollId }),
        });
        const data = await res.json();
        if (data.verified) {
          pollStop.current = true;
          const issued = typeof data.code === "string" ? data.code : null;
          setCode(issued);
          // No code means an existing membership absorbed this signup — the success panel
          // would promise a code and say we sent it, neither of which happened.
          setStatus(issued ? "success" : "already");
          return;
        }
        if (data.stale) pollStop.current = true;
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

  if (status === "verify") {
    return (
      <div className="rounded-2xl bg-[var(--color-brand-red)] p-5 text-center text-white" data-vip-inline="verify">
        <p className="text-lg font-extrabold">📬 One last tap</p>
        <p className="mt-1.5 text-sm text-white/85">
          We emailed <strong>{pendingEmail}</strong>. Open it, tap <strong>“Verify my email”</strong>,
          then confirm on the page that opens — your code appears right there.
        </p>
        <p className="mt-3 rounded-xl bg-black/20 px-3 py-2.5 text-xs text-white/80">
          Check spam if you don't see it. The link works for {ttlHours} hours. This box updates
          itself once you tap.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-3 text-xs font-bold underline"
        >
          Wrong email? Go back and fix it
        </button>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="rounded-2xl border-2 border-[var(--color-gold-bright)] bg-white p-5 text-center" data-vip-inline="success">
        <p className="text-lg font-extrabold text-[var(--color-ink)]">🎉 You're in the VIP Club!</p>
        {code && (
          <p className="mx-auto mt-3 max-w-xs rounded-xl border-2 border-dashed border-[var(--color-gold-bright)] bg-[var(--color-cream)] px-4 py-3 font-display text-3xl tracking-widest text-[var(--color-brand-red)]">
            {code}
          </p>
        )}
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
          Redeem it at final checkout on your next <strong>pickup</strong> order — there's a
          VIP code box right above the total — or show it at the counter. Pickup orders only,
          good for 90 days. We've also sent it to you.
        </p>
      </div>
    );
  }

  if (status === "already") {
    return (
      <div className="rounded-2xl bg-white p-4 text-sm text-[var(--color-ink-soft)]" data-vip-inline="already">
        You're already in the VIP Club — watch for our weekly deals! (The free welcome pie is one
        per new member.)
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[var(--color-brand-red)] p-5 text-left text-white" data-vip-inline="form">
      <p className="text-center text-lg font-extrabold">🍕 Get a FREE plain pie</p>
      <p className="mt-1 text-center text-sm text-white/85">
        Join Gigi's VIP Club with one tap — we'll use the details from your order:
      </p>
      <p className="mt-2 rounded-xl bg-white/10 px-3 py-2 text-center text-xs text-white/90">
        {name} · {phone}
      </p>
      <label className="mt-2 block">
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/70">Email (for your code)</span>
        <input
          type="email"
          value={joinEmail}
          onChange={(e) => setJoinEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@email.com"
          className="mt-1 w-full rounded-xl border-0 bg-white/95 px-3 py-2.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
        />
      </label>

      {/* The welcome pie is one per household, so a complete address is required. Delivery orders
          arrive with the street line and town already filled; only the ZIP is left to type. */}
      {(
        <div className="mt-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="Home address (for your one-per-household pie)"
            autoComplete="street-address"
            className="w-full rounded-xl border-0 bg-white/95 px-3 py-2.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
          />
          <input
            type="text"
            value={apt}
            onChange={(e) => setApt(e.target.value)}
            placeholder="Apt"
            autoComplete="address-line2"
            className="w-20 shrink-0 rounded-xl border-0 bg-white/95 px-3 py-2.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City"
            autoComplete="address-level2"
            className="w-full rounded-xl border-0 bg-white/95 px-3 py-2.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
          />
          <input
            type="text"
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value.toUpperCase())}
            maxLength={2}
            placeholder="NJ"
            autoComplete="address-level1"
            className="w-16 shrink-0 rounded-xl border-0 bg-white/95 px-3 py-2.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
          />
          <input
            type="text"
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))}
            maxLength={5}
            inputMode="numeric"
            placeholder="ZIP"
            autoComplete="postal-code"
            className="w-24 shrink-0 rounded-xl border-0 bg-white/95 px-3 py-2.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-gold-bright)]"
          />
        </div>
        </div>
      )}

      <div className="mt-3 space-y-2 text-left text-sm">
        <label className="flex items-start gap-2.5">
          <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Text me deals</span>
        </label>
        <label className="flex items-start gap-2.5">
          <input type="checkbox" checked={emailConsent} onChange={(e) => setEmailConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Email me deals</span>
        </label>
      </div>
      <p className="mt-2 text-left text-[10px] leading-relaxed text-white/70">{CONSENT_TEXT}</p>

      {TURNSTILE_ON && <Turnstile onToken={setTurnstileToken} resetSignal={turnstileReset} />}

      {errorMsg && (
        <p className="mt-2 rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold" role="alert">
          {errorMsg}
        </p>
      )}

      <button
        type="button"
        onClick={join}
        disabled={status === "submitting"}
        className="mt-3 w-full rounded-full bg-[var(--color-gold-bright)] px-5 py-3 text-sm font-bold uppercase tracking-wide text-[var(--color-ink)] transition hover:brightness-105 disabled:opacity-60"
      >
        {status === "submitting" ? "Joining…" : "Join & claim my free pie"}
      </button>
    </div>
  );
}
