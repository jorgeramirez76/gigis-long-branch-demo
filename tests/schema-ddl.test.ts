/**
 * Schema created at runtime must also live in the numbered migrations, and runtime DDL must not
 * run on every request. Migration 010 brings the campaign and scheduled-blast tables into the
 * history; completeSignup's sms_requested ALTER now runs once per warm instance.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
process.env.DATABASE_URL = "postgres://test:test@fake-neon.test/test";
import { completeSignup, type ValidatedSignup } from "../api/lib/vipSignupShared.js";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

/** table -> column names, from CREATE TABLE bodies and ADD COLUMN statements in some SQL text. */
function columns(sql: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (t: string, c: string) => { if (!out.has(t)) out.set(t, new Set()); out.get(t)!.add(c); };
  for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\s*\)/g)) {
    for (const line of m[2].split("\n")) {
      const col = /^\s*([a-z_]+)\s+[A-Z]/.exec(line)?.[1];
      if (col) add(m[1], col);
    }
  }
  for (const m of sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/g)) add(m[1], m[2]);
  return out;
}

describe("migration 010", () => {
  const migration = columns(read("db/migrations/010_campaigns_and_scheduled_blasts.sql"));
  const runtime = columns(read("api/lib/campaignPromo.ts") + "\n" + read("api/cron/send-scheduled.ts"));

  it("creates every column the runtime's lazy DDL creates", () => {
    for (const table of ["campaign_promos", "campaign_redemptions", "scheduled_broadcasts"]) {
      const want = runtime.get(table);
      assert.ok(want && want.size >= 5, `runtime DDL for ${table} not found`);
      for (const col of want) assert.ok(migration.get(table)?.has(col), `010 is missing ${table}.${col}`);
    }
  });

  it("is listed in the runbook", () => {
    const runbook = read("docs/ACCOUNT-DATABASE-OPERATIONS.md");
    assert.match(runbook, /currently ends at `010_campaigns_and_scheduled_blasts\.sql`/);
    assert.match(runbook, /\| 010 \|/);
  });
});

describe("completeSignup's sms_requested ALTER", () => {
  it("runs once per warm instance, not on every signup", async () => {
    const queries: string[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      queries.push((JSON.parse(String(init?.body)) as { query: string }).query);
      // Every INSERT finds an existing household, so each signup stops at "already a member".
      return new Response(JSON.stringify({ command: "SELECT", rowCount: 0, fields: [], rows: [] }));
    }) as typeof fetch;
    const signup = {
      name: "Fixture", phone: "+15555550100", email: "fixture@example.test", fullAddress: "1 Main St, Long Branch, NJ 07740",
      apt: null, addrKey: "k", legacyAddrKey: "k", smsConsent: true, emailConsent: true, source: "website",
    } as unknown as ValidatedSignup;
    for (let i = 0; i < 3; i++) assert.equal((await completeSignup("gigis_long_branch", signup)).alreadyMember, true);
    assert.equal(queries.filter((q) => q.includes("ALTER TABLE vip_members ADD COLUMN IF NOT EXISTS sms_requested")).length, 1);
    assert.equal(queries.filter((q) => q.includes("INSERT INTO vip_members")).length, 3);
  });
});
