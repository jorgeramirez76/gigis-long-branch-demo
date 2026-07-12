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
  if (
    typeof got !== "string" ||
    got.length !== expected.length ||
    !timingSafeEqual(Buffer.from(got), Buffer.from(expected))
  ) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}
