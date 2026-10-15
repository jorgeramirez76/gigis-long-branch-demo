import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type Rule = { source: string; headers: { key: string; value: string }[] };

test("the admin page gets its own CSP: no third-party scripts, API calls to this site only", () => {
  const rules = (JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { headers: Rule[] }).headers;
  const catchAll = rules.findIndex((r) => r.source === "/(.*)");
  const admin = rules.findIndex((r) => r.source === "/admin.html");
  // Later rules win for the same header key, so the admin rule must come after the site-wide one.
  assert.ok(catchAll >= 0 && admin > catchAll, "the /admin.html rule must follow the catch-all");
  const csp = rules[admin].headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /connect-src 'self';/);
  assert.match(csp, /frame-ancestors 'none'/);
  // The admin page holds the token that unlocks every member's data and the blast sender; it
  // needs none of checkout's Clover, Cloudflare or Google script origins.
  assert.doesNotMatch(csp, /google|gstatic|clover|cloudflare/);
  const site = rules[catchAll].headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
  assert.match(site, /https:\/\/challenges\.cloudflare\.com/, "the site-wide CSP (checkout, /account/ Turnstile) is unchanged");
});
