import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";

/** Guards /api/admin/* — requires `x-admin-token` header matching ADMIN_TOKEN. */
export function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "admin_not_configured" });
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
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}
