/**
 * Landing page for the "Verify my email" button in the VIP Club signup email.
 *
 * Why this page exists instead of the email linking straight at an API endpoint: mail providers and
 * corporate security appliances routinely PRE-FETCH links in email. If opening the URL created the
 * member and issued the free pie, a scanner would activate accounts nobody clicked.
 *
 * ⚠ MEASURED IN PRODUCTION (2026-08-07): a static page + an automatic scripted POST is NOT enough.
 * Gmail's scanner EXECUTES the page's JavaScript — a test signup self-verified 21 seconds after the
 * email was sent, with no human involved. That defeats the point of the gate: a mistyped address
 * landing in a stranger's real mailbox would confirm itself via their provider's scanner.
 *
 * So verification now requires a GENUINE USER GESTURE: this page shows a "Confirm my email" button
 * and only POSTs from a trusted click event. Scanners render and score the page; they do not press
 * buttons. One tap in the email, one tap here.
 *
 * External (not inline) because the site CSP is `script-src 'self'`.
 *
 * The token is taken from ?t= and removed from the address bar as soon as it's read, so it isn't
 * left sitting in history, or leaked in a Referer header if the visitor clicks through to the menu.
 */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  var confirmEl = $("confirm");
  var working = $("working");
  var doneEl = $("done");
  var badEl = $("bad");
  var retryEl = $("retry");

  var token = null;
  try {
    token = new URLSearchParams(window.location.search).get("t");
  } catch (e) {
    token = null;
  }

  function show(el) {
    [confirmEl, working, doneEl, badEl, retryEl].forEach(function (x) { x.hidden = x !== el; });
    // Move focus to the newly-shown panel's heading so a screen reader announces the outcome
    // instead of leaving the user on a page that silently changed underneath them.
    var h = el.querySelector("h1");
    if (h) {
      h.setAttribute("tabindex", "-1");
      try { h.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
    }
  }

  function showDone(data) {
    if (data.code) {
      $("doneCode").textContent = data.code;
      $("doneCode").hidden = false;
      $("doneMsg").textContent = data.alreadyVerified
        ? "This email was already confirmed. Here's your free-pie code:"
        : "Your email is confirmed. Here's your code for a free plain cheese pie:";
      $("doneNote").textContent =
        "Redeem it at final checkout when you order pickup at gigislongbranch.com, or show it at Gigi's, 140 Brighton Avenue. Pickup orders only. Good for 90 days.";
    } else {
      // Verified, but no code to show (e.g. an existing membership absorbed the signup).
      $("doneTitle").textContent = "You're all set!";
      $("doneMsg").textContent = data.message ||
        "Your email is confirmed and you're in the VIP Club. Watch for our weekly deals!";
      $("doneNote").textContent = "";
    }
    show(doneEl);
  }

  function showBad(msg) {
    $("badMsg").textContent = msg || "That link is no longer valid.";
    show(badEl);
  }

  function showRetry(msg) {
    $("retryMsg").textContent = msg || "Check your connection and try again.";
    show(retryEl);
  }

  function verify() {
    show(working);
    fetch("/api/vip-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token })
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      })
      .then(function (r) {
        if (r.ok) return showDone(r.data);
        // 429 is a THROTTLE, not a verdict on the link — offering "link didn't work" there would
        // push the customer into resubmitting, which retires the perfectly good link they hold.
        // The server marks transient answers with retryable:true.
        if (r.status === 429 || (r.data && r.data.retryable)) {
          return showRetry((r.data && r.data.message) || "Busy right now — give it a few seconds and try again.");
        }
        // Other 4xx = a decided answer about the link (expired / replaced / malformed): a retry
        // will never succeed, so don't offer one.
        if (r.status >= 400 && r.status < 500) return showBad(r.data && r.data.message);
        showRetry((r.data && r.data.message) || "Something went wrong on our end.");
      })
      .catch(function () {
        showRetry("We couldn't reach the server. Check your connection and try again.");
      });
  }

  if (!token) {
    showBad("This link is missing its verification code. Please open the button straight from the email we sent you.");
    return;
  }

  // Strip ?t= from the URL before doing anything else: keeps the one-time token out of browser
  // history and out of the Referer sent to any link this page offers.
  try {
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch (e) { /* non-fatal — verification still proceeds */ }

  // Only a real, user-generated click verifies. isTrusted is false for any click a script
  // synthesises, which is the cheap half of the defence; the expensive half is that automated
  // scanners don't click buttons at all.
  function onGesture(e) {
    if (e && e.isTrusted === false) return;
    verify();
  }

  $("retryBtn").addEventListener("click", onGesture);
  $("confirmBtn").addEventListener("click", onGesture);

  // Show the confirm prompt (NOT a spinner — nothing is happening until they tap).
  show(confirmEl);
})();
