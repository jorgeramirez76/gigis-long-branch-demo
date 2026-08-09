import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";
import { rateLimitAll } from "./rateLimit.js";

/** Trusted client IP. Vercel sets x-real-ip to the true client IP; deliberately NOT falling back to
 * x-forwarded-for, whose leftmost hop is client-spoofable off-platform (which would let an attacker
 * rotate past the IP limit below). Mirrors clientIp() in api/order/create.ts. */
function clientIp(req: VercelRequest): string {
  const real = req.headers["x-real-ip"];
  return typeof real === "string" && real ? real : "unknown";
}

const IP_MAX = 10; // attempts per IP per 5 minutes
const IP_WINDOW = 300;
const GLOBAL_MAX = 60; // total attempts across all IPs per hour
const GLOBAL_WINDOW = 3600;

/**
 * Guards /api/admin/* — requires an `x-admin-token` header matching ADMIN_TOKEN.
 *
 * RATE LIMITED because ADMIN_TOKEN is a single static shared secret with no rotation and no second
 * factor, and it unlocks the entire customer database: GET /api/admin/members returns every VIP
 * member's name, phone and email, and POST /api/admin/broadcast sends real SMS and email from the
 * shop's registered A2P number. Every public endpoint here was already throttled; this one — the
 * most valuable — was not, so an online guessing campaign could run unthrottled and unlogged.
 *
 * Two buckets: per-IP absorbs a single attacker, global absorbs a distributed one. Both sit well
 * above a real admin session (the panel makes a handful of calls per page) and far below a useful
 * guessing rate.
 *
 * Fails CLOSED if the limiter itself errors, unlike the public endpoints. A customer blocked from
 * ordering is a lost sale; an attacker let through here is a customer-data breach, so the trade-off
 * flips.
 */
export async function requireAdmin(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "admin_not_configured" });
    return false;
  }

  // Throttle BEFORE the comparison, so a guessing campaign is stopped by attempt count rather than
  // by whether it happens to guess right.
  const ip = clientIp(req);
  let allowed: boolean;
  try {
    allowed = await rateLimitAll([
      { bucket: `admin:ip:${ip}`, max: IP_MAX, windowSec: IP_WINDOW },
      { bucket: "admin:global", max: GLOBAL_MAX, windowSec: GLOBAL_WINDOW },
    ]);
  } catch (err) {
    console.error("[adminAuth] rate limiter unavailable — failing closed", err);
    res.status(503).json({ error: "unavailable" });
    return false;
  }
  if (!allowed) {
    console.warn(`[adminAuth] rate limited ip=${ip}`);
    res.setHeader("Retry-After", String(IP_WINDOW));
    res.status(429).json({ error: "rate_limited" });
    return false;
  }

  const got = req.headers["x-admin-token"];
  // Compare BYTE lengths, not string lengths: a multibyte token can match on
  // UTF-16 code units while producing shorter buffers, and timingSafeEqual throws
  // a RangeError on a length mismatch — turning a wrong token into a 500 crash
  // instead of a clean 401.
  const a = typeof got === "string" ? Buffer.from(got) : null;
  const b = Buffer.from(expected);
  if (!a || a.length !== b.length || !timingSafeEqual(a, b)) {
    // Logged so repeated failures are visible in the function logs at all — previously a guessing
    // campaign left no trace anywhere.
    console.warn(`[adminAuth] failed auth ip=${ip} path=${req.url ?? "?"}`);
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}
