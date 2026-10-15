import { sql } from "./db.js";

/**
 * Neon-backed fixed-window rate limiter. Serverless functions share no memory,
 * so counts live in the DB. The counter is incremented with a single atomic
 * UPSERT (the row lock on ON CONFLICT DO UPDATE serializes concurrent requests),
 * so a burst of simultaneous requests cannot slip past the limit (no TOCTOU).
 *
 * Fail-OPEN: if the limiter DB errors we allow rather than block a paying
 * customer, and log loudly.
 */
let ensured = false;
let calls = 0;

async function ensure() {
  if (ensured) return;
  await sql`CREATE TABLE IF NOT EXISTS rate_counters (
    bucket TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, window_start)
  )`;
  ensured = true;
}

/**
 * @returns true if ALLOWED. Atomically increments the (bucket, window) counter
 * and allows while the count is within `max` for the current fixed window.
 */
export async function rateLimit(bucket: string, max: number, windowSec: number): Promise<boolean> {
  try {
    await ensure();
    const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
    const r = await sql`
      INSERT INTO rate_counters (bucket, window_start, n)
      VALUES (${bucket}, ${windowStart}, 1)
      ON CONFLICT (bucket, window_start) DO UPDATE SET n = rate_counters.n + 1
      RETURNING n
    `;
    const n = (r.rows[0]?.n as number) ?? 1;
    // Opportunistic cleanup — horizon well past the longest window (24h) we use.
    if (++calls % 50 === 0) await pruneRateCounters().catch(() => {});
    return n <= max;
  } catch (e) {
    console.error("[rateLimit] fail-open due to error", e);
    return true;
  }
}

/** Rows older than this are finished windows: the longest window or claim in use is 24 hours. */
const RATE_COUNTER_HORIZON_SEC = 26 * 3600;

/**
 * Delete finished windows. rateLimit() does this on every 50th call per warm instance, which a
 * quiet shop rarely reaches, and rateLimitStrict/claimWindow never did, so the daily-digest cron
 * also runs it once a day. Throws on a storage error; callers decide whether that matters.
 */
export async function pruneRateCounters(now = Date.now()): Promise<void> {
  await ensure();
  const cutoff = Math.floor(now / 1000) - RATE_COUNTER_HORIZON_SEC;
  await sql`DELETE FROM rate_counters WHERE window_start < ${cutoff}`;
}

/** Admin/login variant: propagates storage errors so authentication can fail closed. */
export async function rateLimitStrict(bucket: string, max: number, windowSec: number): Promise<boolean> {
  await ensure();
  const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
  const r = await sql`
    INSERT INTO rate_counters (bucket, window_start, n)
    VALUES (${bucket}, ${windowStart}, 1)
    ON CONFLICT (bucket, window_start) DO UPDATE SET n = rate_counters.n + 1
    RETURNING n
  `;
  return ((r.rows[0]?.n as number) ?? 1) <= max;
}

/** Check every limit; returns false (blocked) if ANY is over. Increments all. */
export async function rateLimitAll(
  limits: { bucket: string; max: number; windowSec: number }[],
): Promise<boolean> {
  // Evaluate all (so every window counts this attempt), then block if any failed.
  const results = await Promise.all(limits.map((l) => rateLimit(l.bucket, l.max, l.windowSec)));
  return results.every(Boolean);
}

export async function rateLimitAllStrict(
  limits: { bucket: string; max: number; windowSec: number }[],
): Promise<boolean> {
  const results = await Promise.all(limits.map((l) => rateLimitStrict(l.bucket, l.max, l.windowSec)));
  return results.every(Boolean);
}

/**
 * Atomic presence-row claim: exactly ONE caller per (bucket, window) gets true.
 * Ported from Sea Bright, where it serializes staff pages; here it serializes
 * the code-recovery mint. Fail-OPEN on a DB error (matching rateLimit's rule) —
 * callers that need stronger guarantees re-check state after claiming.
 */
export async function claimWindow(bucket: string, windowSec: number): Promise<boolean> {
  try {
    await ensure();
    const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
    const r = await sql`
      INSERT INTO rate_counters (bucket, window_start, n)
      VALUES (${bucket}, ${windowStart}, 1)
      ON CONFLICT (bucket, window_start) DO NOTHING
      RETURNING n
    `;
    return r.rowCount === 1;
  } catch (e) {
    console.error("[rateLimit] claimWindow storage error", e);
    if (bucket.startsWith("staff-page:")) return true;
    return false;
  }
}

/** Read a fixed window's count without adding to it (0 when nothing was counted). Throws on a
 *  storage error. `windowStart` is in seconds, as rateLimit() computes it. */
export async function peekWindowCount(bucket: string, windowStart: number): Promise<number> {
  await ensure();
  const r = await sql`SELECT n FROM rate_counters WHERE bucket = ${bucket} AND window_start = ${windowStart}`;
  return Number(r.rows[0]?.n ?? 0);
}

/** Hand back an unused claim so the next occurrence can retry. */
export async function releaseWindow(bucket: string, windowSec: number): Promise<void> {
  try {
    await ensure();
    const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
    await sql`DELETE FROM rate_counters WHERE bucket = ${bucket} AND window_start = ${windowStart}`;
  } catch (e) {
    console.error("[rateLimit] releaseWindow failed (claim stays spent)", bucket, e);
  }
}
