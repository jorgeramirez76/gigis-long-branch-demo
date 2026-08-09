import type { VercelRequest, VercelResponse } from "@vercel/node";
import { rateLimitAll } from "./lib/rateLimit.js";
import { pollVerifyStatus } from "./lib/vipSignupShared.js";

/**
 * Status poll for the browser tab still showing "check your email".
 *
 * Why it exists: people sign up on a laptop and tap the link on their phone. Without this, the
 * original tab would sit on the waiting screen forever and read as broken. The tab polls with the
 * opaque `pollId` the signup handed it and flips to the success screen the moment the link is used.
 *
 * The pollId is a random 16-byte value tied to one pending signup. It can only reveal whether a
 * signup the caller already initiated has been verified, and cannot verify anything itself — so
 * it is safe to hold in a browser. Nothing here mutates state.
 */

function clientIp(req: VercelRequest): string | undefined {
  const real = req.headers["x-real-ip"];
  return typeof real === "string" && real ? real : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const pollId = typeof body.pollId === "string" ? body.pollId.trim() : "";
  if (!pollId || pollId.length < 10 || pollId.length > 120) {
    res.status(400).json({ error: "invalid_poll_id" });
    return;
  }

  const ip = clientIp(req);
  // Generous: a waiting tab polls every few seconds, and several people may be on one shop IP.
  const allowed = await rateLimitAll([
    ...(ip ? [{ bucket: `pollv:ip:${ip}`, max: 240, windowSec: 600 }] : []),
    { bucket: "pollv:global", max: 4000, windowSec: 3600 },
  ]);
  if (!allowed) {
    // Not an error the customer should see — the tab just keeps waiting.
    res.status(200).json({ verified: false, throttled: true });
    return;
  }

  try {
    const s = await pollVerifyStatus(pollId);
    // A missing row is reported as "not verified, stop polling": it means the pending signup was
    // swept or replaced, and the tab should stop rather than loop forever.
    res.status(200).json({ verified: s.verified, code: s.code, stale: !s.found });
  } catch (err) {
    console.error("[vip-verify-status] error", err);
    res.status(200).json({ verified: false });
  }
}
