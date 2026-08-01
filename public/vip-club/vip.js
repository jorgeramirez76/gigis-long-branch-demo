/**
 * VIP Club signup for the printed-menu QR landing page at /vip/.
 *
 * External (not inline) on purpose: the site CSP is `script-src 'self' ...`, which forbids inline
 * scripts but allows this file. It posts to the SAME /api/vip-signup endpoint the homepage form
 * uses, with the same payload shape, so there is exactly one signup path to keep correct.
 *
 * This URL is printed on 20,000 paper menus and can never be changed, so the failure modes matter
 * more than usual:
 *   - Turnstile may be switched on later. /api/vip-config reports whether a token will be required
 *     and the widget renders only then; otherwise enabling it would 403 every scan silently.
 *   - Consent text must match the server's CANONICAL_CONSENT_TEXT byte for byte or the API rejects
 *     the signup with consent_text_required. It is also the A2P-registered opt-in language.
 */
(function () {
  "use strict";

  // MUST stay byte-identical to CONSENT_TEXT in src/components/VipClub.tsx and
  // CANONICAL_CONSENT_TEXT in api/vip-signup.ts.
  var CONSENT_TEXT =
    'By checking "Text me deals," I agree to receive recurring promotional texts (weekly specials and promo codes) from Gigi\'s NY Style Pizza, 140 Brighton Ave, Long Branch, NJ, sent by automated technology to the number I provided. Consent is not a condition of any purchase. Message frequency varies, typically up to 4 per month. Message & data rates may apply. Reply STOP to opt out, HELP for help. By checking "Email me deals," I agree to receive promotional emails; unsubscribe anytime via the link in any email.';

  var form = document.getElementById("vip");
  var btn = document.getElementById("go");
  var errEl = document.getElementById("err");
  var doneEl = document.getElementById("done");
  var tsBox = document.getElementById("turnstile");
  var tsToken = null;
  var tsWidgetId = null;
  var SIGNUP_SOURCE = "menu-qr";

  document.getElementById("legal").textContent = CONSENT_TEXT;

  function $(id) { return document.getElementById(id); }
  function val(id) { return ($(id).value || "").trim(); }

  // Prefill from an order-receipt link (/vip-club/?name=…&phone=…&email=…). The customer typed all
  // of this to place the order minutes ago; a blank form is what the old receipt link cost us.
  // Values only land in the inputs and stay editable — the server re-validates them and re-checks
  // the phone/email/address dedupe, and the consent boxes are deliberately left unticked.
  (function prefill() {
    try {
      var q = new URLSearchParams(window.location.search);
      // One page, several audiences: a bare URL is the printed-menu QR code, `?src=receipt`
      // is the button in an order receipt, `?src=winback` the past-customer invite.
      // Tracked separately so we can tell which one actually works.
      var src = q.get("src");
      if (src === "receipt" || src === "winback") SIGNUP_SOURCE = src;
      var filled = 0;
      ["name", "phone", "email", "address", "apt"].forEach(function (id) {
        var v = (q.get(id) || "").trim();
        if (!v) return;
        $(id).value = v.slice(0, 160);
        filled++;
      });
      // Pickup orders arrive without an address — put the cursor on the one field left to fill.
      if (filled && !val("address")) $("address").focus({ preventScroll: true });
    } catch (e) { /* no URLSearchParams — the form still works, just empty */ }
  })();

  function showErr(msg, focusId) {
    errEl.textContent = msg;
    errEl.hidden = false;
    errEl.scrollIntoView({ block: "center", behavior: "smooth" });
    if (focusId) {
      var el = $(focusId);
      el.setAttribute("aria-invalid", "true");
      el.focus({ preventScroll: true });
    }
  }
  function clearErr() {
    errEl.hidden = true;
    ["name", "phone", "email", "address"].forEach(function (id) {
      $(id).removeAttribute("aria-invalid");
    });
  }

  // Mirror the server's checks so people get an instant, specific message instead of a round trip.
  // The server remains the authority — this only avoids obviously-doomed submissions.
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function digits(s) { return (s || "").replace(/\D/g, ""); }
  function phoneLooksValid(p) {
    var d = digits(p);
    if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
    return d.length === 10 && d.charAt(0) !== "0" && d.charAt(0) !== "1";
  }

  // --- Turnstile, only if the server says a token will be required ------------------------------
  // The widget runs in Cloudflare's managed mode: for a normal visitor it solves itself and hands
  // back a token with nothing to click, so this is invisible in the common case.
  //
  // Do NOT render on the script tag's own `onload`. window.turnstile is created before the SDK
  // finishes attaching render(), so onload fires while `turnstile.render` is still undefined and
  // the widget silently never appears — which would block every submission from a printed menu.
  // api.js's documented `onload=` parameter fires only once render() genuinely exists; the poll is
  // a belt-and-braces fallback in case that callback is ever missed.
  function renderTurnstile(siteKey) {
    if (tsWidgetId !== null || !window.turnstile || typeof window.turnstile.render !== "function") return;
    try {
      tsWidgetId = window.turnstile.render(tsBox, {
        sitekey: siteKey,
        callback: function (t) { tsToken = t; },
        "expired-callback": function () { tsToken = null; },
        "error-callback": function () { tsToken = null; },
        "timeout-callback": function () { tsToken = null; },
        theme: "auto"
      });
    } catch (e) { tsToken = null; }
  }

  fetch("/api/vip-config", { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || !cfg.turnstileRequired || !cfg.turnstileSiteKey) return;
      tsBox.dataset.required = "1";

      window.__vipTurnstileReady = function () { renderTurnstile(cfg.turnstileSiteKey); };

      if (window.turnstile && typeof window.turnstile.render === "function") {
        renderTurnstile(cfg.turnstileSiteKey);          // SDK already present
      } else {
        var s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__vipTurnstileReady";
        s.async = true;
        s.defer = true;
        document.head.appendChild(s);
      }

      // Fallback poll — stops as soon as the widget exists, and gives up after ~15s.
      var tries = 0;
      var poll = setInterval(function () {
        if (tsWidgetId !== null || ++tries > 60) { clearInterval(poll); return; }
        renderTurnstile(cfg.turnstileSiteKey);
      }, 250);
    })
    .catch(function () { /* config unreachable — submit anyway; the server decides */ });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearErr();

    if (val("name").length < 2) return showErr("Please enter your name.", "name");
    if (!phoneLooksValid(val("phone"))) return showErr("That phone number doesn't look right. Please include the area code.", "phone");
    if (!EMAIL_RE.test(val("email"))) return showErr("That email doesn't look right.", "email");
    if (val("address").length < 4) return showErr("Please enter your street address — the welcome pie is one per household.", "address");

    var sms = $("sms").checked, em = $("email_ok").checked;
    if (!sms && !em) return showErr("Please tick at least one box so we can send your free-pie code.");
    if (tsBox.dataset.required === "1" && !tsToken) return showErr("Please complete the verification above.");

    btn.disabled = true;
    var original = btn.textContent;
    btn.textContent = "Joining…";

    fetch("/api/vip-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business: "gigis_long_branch",
        name: val("name"),
        phone: val("phone"),
        email: val("email"),
        address: val("address"),
        apt: val("apt"),
        smsConsent: sms,
        emailConsent: em,
        consentText: CONSENT_TEXT,
        source: SIGNUP_SOURCE,
        turnstileToken: tsToken || undefined
      })
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (r) {
        if (!r.ok) {
          var e2 = r.data && r.data.error;
          var msg =
            e2 === "invalid_phone" ? "That phone number doesn't look right." :
            e2 === "invalid_email" ? "That email doesn't look right." :
            e2 === "address_required" ? "Please enter your street address." :
            e2 === "consent_required" ? "Please tick at least one box so we can send your code." :
            e2 === "verification_failed" ? "Verification failed — please try again." :
            e2 === "rate_limited" ? "Too many attempts — please wait a few minutes and try again." :
            "Something went wrong. Please try again, or call (732) 377-2468 and we'll sign you up.";
          btn.disabled = false;
          btn.textContent = original;
          if (tsWidgetId !== null && window.turnstile) { window.turnstile.reset(tsWidgetId); tsToken = null; }
          return showErr(msg);
        }

        form.style.display = "none";
        doneEl.style.display = "block";
        if (r.data.alreadyMember) {
          $("doneTitle").textContent = "You're already a VIP!";
          $("doneMsg").textContent = r.data.message ||
            "You're already in the VIP Club — the free welcome pie is one per new member. Watch for our deals!";
        } else {
          $("doneTitle").textContent = "You're in! \u{1F355}";
          $("doneMsg").textContent = "Here's your code for a free plain cheese pie. We've also sent it to you.";
          if (r.data.code) {
            $("doneCode").textContent = r.data.code;
            $("doneCode").hidden = false;
          }
          $("doneNote").textContent = "Show this code at Gigi's, 140 Brighton Avenue. Good for 90 days.";
        }
        doneEl.scrollIntoView({ block: "center", behavior: "smooth" });
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = original;
        showErr("We couldn't reach the server. Please check your connection and try again, or call (732) 377-2468.");
      });
  });
})();
