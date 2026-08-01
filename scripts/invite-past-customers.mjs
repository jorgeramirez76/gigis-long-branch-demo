#!/usr/bin/env node
/**
 * One-time VIP Club invite to people who have already ordered on the website.
 *
 * Nine customers have ordered and none were ever asked to join the club (the
 * signup lived behind a hero button they scrolled past). This emails each of
 * them once, with the join form prefilled from their own order.
 *
 * EMAIL ONLY — never SMS. These people gave a phone number to receive an order,
 * not consent to be texted; a promotional text without express written consent
 * is a TCPA violation. Email is permissible under CAN-SPAM's opt-out regime,
 * and every message carries the shop's physical address, a working one-click
 * unsubscribe, and a truthful subject.
 *
 * Excluded automatically: our own test orders, abandoned checkouts, anyone
 * already in the club, anyone who has ever unsubscribed, and anyone this
 * campaign has already reached (outreach_sends is the ledger — a re-run is a
 * no-op, not a second email).
 *
 *   node scripts/invite-past-customers.mjs            # dry run: who + the copy
 *   node scripts/invite-past-customers.mjs --send     # actually sends
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { neon } from "@neondatabase/serverless";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CAMPAIGN = "vip-invite-past-customers-2026-07";
const SEND = process.argv.includes("--send");
const PACE_MS = 700; // Resend allows ~2 requests/second

// Local runs read the gitignored env files; on a server the real env wins.
for (const f of [".env.local", ".env.crm.local", ".env"]) {
  try {
    for (const line of readFileSync(`${ROOT}/${f}`, "utf8").split("\n")) {
      if (!line.includes("=") || line.trim().startsWith("#")) continue;
      const k = line.slice(0, line.indexOf("=")).trim();
      const v = line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* file absent — fine */ }
}

const { DATABASE_URL, RESEND_API_KEY, EMAIL_FROM, UNSUB_SECRET } = process.env;
const BASE = process.env.PUBLIC_BASE_URL || "https://gigislongbranch.com";
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");
if (SEND && (!RESEND_API_KEY || !EMAIL_FROM || !UNSUB_SECRET)) {
  throw new Error("--send needs RESEND_API_KEY, EMAIL_FROM and UNSUB_SECRET");
}
const sql = neon(DATABASE_URL, { fullResults: true });

/** The site's own branded email shell (TS) compiled for this script, so the
 *  campaign can't drift from the template every other email already uses. */
async function loadTemplate() {
  const out = `${tmpdir()}/gigis-emailTemplate.mjs`;
  await build({ entryPoints: [`${ROOT}/api/lib/emailTemplate.ts`], outfile: out, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  return import(pathToFileURL(out).href);
}

const unsubUrl = (email) =>
  `${BASE}/api/unsubscribe?e=${encodeURIComponent(email.toLowerCase())}&t=${createHmac("sha256", UNSUB_SECRET || "dry-run").update(email.toLowerCase()).digest("hex").slice(0, 32)}`;

/** The join link, prefilled from the customer's own order. */
function joinUrl(c) {
  const q = new URLSearchParams({ name: c.name, src: "winback" });
  if (c.phone) q.set("phone", c.phone);
  if (c.email) q.set("email", c.email);
  if (c.address) q.set("address", c.address);
  return `${BASE}/vip-club/?${q.toString()}`;
}

const firstName = (n) => (n || "").trim().split(/\s+/)[0] || "there";

function bodyText(c) {
  return [
    `Hi ${firstName(c.name)} — thanks for ordering from Gigi's. We're glad the new website found its way to you.`,
    `We've started a VIP Club, and we'd like you in it: join and your next plain cheese pie is on us. Members also hear about the weekly specials first — a couple of messages a month, no more than that.`,
    `Everything is already filled in from your order, so it's a tick and a tap. The free pie is one per household and yours is good for 90 days.`,
    `— Tommy and the crew at Gigi's`,
  ].join("\n\n");
}

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS outreach_sends (
      campaign    TEXT NOT NULL,
      email       TEXT NOT NULL,
      provider_id TEXT,
      sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (campaign, email)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS email_suppressions (
      email      TEXT PRIMARY KEY,
      source     TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // One row per person: their most recent completed order supplies the prefill.
  // `status <> 'pending'` drops abandoned checkouts — those were never customers.
  const rows = await sql`
    SELECT DISTINCT ON (lower(customer_email))
           lower(customer_email) AS email, customer_name AS name, customer_phone AS phone,
           address, created_at, total
    FROM web_orders
    WHERE business = 'gigis_long_branch'
      AND status <> 'pending'
      AND customer_email IS NOT NULL AND customer_email <> ''
      AND customer_email NOT ILIKE '%@example.com'
      AND customer_email <> 'jorgeramirez76@gmail.com'      -- our own test orders
      AND customer_name NOT ILIKE 'WEB SMOKE TEST%'
    ORDER BY lower(customer_email), created_at DESC
  `;
  const members = new Set((await sql`SELECT lower(email) AS e FROM vip_members WHERE email IS NOT NULL`).rows.map((r) => r.e));
  const suppressed = new Set((await sql`SELECT lower(email) AS e FROM email_suppressions`).rows.map((r) => r.e));
  const already = new Set((await sql`SELECT lower(email) AS e FROM outreach_sends WHERE campaign = ${CAMPAIGN}`).rows.map((r) => r.e));

  const skipped = [];
  const targets = rows.rows.filter((c) => {
    const why = members.has(c.email) ? "already a VIP member"
      : suppressed.has(c.email) ? "unsubscribed"
      : already.has(c.email) ? "already emailed by this campaign"
      : null;
    if (why) skipped.push(`${c.email} — ${why}`);
    return !why;
  });

  console.log(`campaign : ${CAMPAIGN}`);
  console.log(`customers: ${rows.rowCount} with an email  →  ${targets.length} to invite, ${skipped.length} skipped`);
  skipped.forEach((s) => console.log(`   skip: ${s}`));
  targets.forEach((c) =>
    console.log(`   send: ${c.name} <${c.email}> — last ordered ${new Date(c.created_at).toLocaleDateString("en-US", { timeZone: "America/New_York" })} ($${(c.total / 100).toFixed(2)})`),
  );

  if (!SEND) {
    const sample = targets[0];
    if (sample) {
      const { emailHtml } = await loadTemplate();
      const preview = `${tmpdir()}/vip-invite-preview.html`;
      console.log(`\n--- subject ---\nYour next pie is on us, ${firstName(sample.name)}`);
      console.log(`\n--- body ---\n${bodyText(sample)}`);
      console.log(`\n--- button ---\nClaim my free pie → ${joinUrl(sample)}`);
      console.log(`\n--- unsubscribe ---\n${UNSUB_SECRET ? unsubUrl(sample.email) : "(UNSUB_SECRET not loaded — link not shown)"}`);
      writeFileSync(preview, emailHtml({ bodyText: bodyText(sample), unsubUrl: unsubUrl(sample.email), ctaText: "Claim my free pie", ctaUrl: joinUrl(sample) }));
      console.log(`\nHTML preview: ${preview}`);
    }
    console.log(`\nDRY RUN — nothing sent. Re-run with --send to email these ${targets.length} people.`);
    return;
  }

  const { emailHtml } = await loadTemplate();
  let sent = 0;
  for (const c of targets) {
    const unsub = unsubUrl(c.email);
    const html = emailHtml({ bodyText: bodyText(c), unsubUrl: unsub, ctaText: "Claim my free pie", ctaUrl: joinUrl(c) });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [c.email],
        subject: `Your next pie is on us, ${firstName(c.name)}`,
        html,
        text: `${bodyText(c)}\n\nJoin here: ${joinUrl(c)}\n\nUnsubscribe: ${unsub}`,
        headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
    });
    if (!res.ok) {
      console.error(`   FAILED ${c.email}: ${(await res.text()).slice(0, 200)}`);
      continue;
    }
    const { id } = await res.json();
    // Ledger written per-send, so an interrupted run never re-emails the people it reached.
    await sql`
      INSERT INTO outreach_sends (campaign, email, provider_id) VALUES (${CAMPAIGN}, ${c.email}, ${id})
      ON CONFLICT (campaign, email) DO NOTHING
    `;
    sent++;
    console.log(`   sent ${c.email} (${id})`);
    await new Promise((r) => setTimeout(r, PACE_MS));
  }
  console.log(`\nSENT ${sent}/${targets.length}.`);
}

main();
