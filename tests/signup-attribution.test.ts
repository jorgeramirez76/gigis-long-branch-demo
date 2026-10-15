/**
 * VIP signup attribution (2026-10-14). The admin's "Member sources" exists to tell the owner which
 * entry point grows the club, above all whether the QR code on 20,000 printed menus pays off. Once
 * /vip-club/ became a redirect stamped source=menu-qr, the footer, the static /menu/ page and the
 * receipt email were all credited to the printed QR. These tests keep every link honest.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ACCOUNT_SIGNUP_SOURCES } from "../api/lib/accountHandler.js";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

describe("signup attribution", () => {
  it("only the printed QR's /vip URLs are labelled menu-qr", () => {
    const vercel = JSON.parse(read("vercel.json")) as { redirects: { source: string; destination: string }[] };
    const qr = vercel.redirects.filter((r) => r.destination.includes("source=menu-qr")).map((r) => r.source).sort();
    assert.deepEqual(qr, ["/vip", "/vip/"]);
    // The retired /vip-club/ page still redirects to the signup, but credits nobody in particular.
    for (const src of ["/vip-club", "/vip-club/", "/vip-club/index.html"]) {
      const r = vercel.redirects.find((x) => x.source === src);
      assert.equal(r?.destination, "/account/?join=1", src);
    }
  });

  it("each on-site link to the signup names itself, and the server keeps that name", () => {
    const links: [string, string][] = [
      ["src/components/Footer.tsx", "footer"],
      ["src/components/Hero.tsx", "hero"],
      ["src/components/VipClub.tsx", "vip-section"],
      ["src/ordering/RewardsJoin.tsx", "order-confirm"],
      ["scripts/build-menu-page.py", "menu-page"],
      ["public/menu/index.html", "menu-page"],
      ["api/order/create.ts", "receipt"],
      ["scripts/invite-past-customers.mjs", "winback"],
    ];
    for (const [file, source] of links) {
      const src = read(file);
      assert.match(src, new RegExp(`/account/\\?join=1(&|&amp;)source=${source}\\b`), `${file} should link with source=${source}`);
      assert.doesNotMatch(src, /join=1(&|&amp;)source=menu-qr|vip-club\/\?/, `${file} must not link as the printed QR`);
      assert.ok(ACCOUNT_SIGNUP_SOURCES.has(source), `the account signup must accept "${source}"`);
    }
    assert.ok(ACCOUNT_SIGNUP_SOURCES.has("menu-qr"));
    assert.ok(!ACCOUNT_SIGNUP_SOURCES.has("anything-else"), "unknown values still fall back to rewards-account");
  });

  it("the win-back email's link carries no personal data", () => {
    const src = read("scripts/invite-past-customers.mjs");
    const start = src.indexOf("function joinUrl(");
    const fn = src.slice(start, src.indexOf("\n}\n", start) + 2);
    assert.doesNotMatch(fn, /phone|email|address|name|URLSearchParams/);
  });

  it("every account signup source can still recover a missing welcome code", () => {
    const recovery = read("api/vip-code-recovery.ts");
    const list = /const WEB_SOURCES = (\[[^\]]*\])/.exec(recovery)?.[1];
    const web = new Set(JSON.parse(String(list)) as string[]);
    for (const source of [...ACCOUNT_SIGNUP_SOURCES, "rewards-account"]) {
      assert.ok(web.has(String(source)), `recovery must treat "${String(source)}" members as web signups`);
    }
  });
});
