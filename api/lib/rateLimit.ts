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
    if (++calls % 50 === 0) {
      const cutoff = Math.floor(Date.now() / 1000) - 26 * 3600;
      await sql`DELETE FROM rate_counters WHERE window_start < ${cutoff}`.catch(() => {});
    }
    return n <= max;
  } catch (e) {
    console.error("[rateLimit] fail-open due to error", e);
    return true;
  }
}

/** Check every limit; returns false (blocked) if ANY is over. Increments all. */
export async function rateLimitAll(
  limits: { bucket: string; max: number; windowSec: number }[],
): Promise<boolean> {
  // Evaluate all (so every window counts this attempt), then block if any failed.
  const results = await Promise.all(limits.map((l) => rateLimit(l.bucket, l.max, l.windowSec)));
  return results.every(Boolean);
}
