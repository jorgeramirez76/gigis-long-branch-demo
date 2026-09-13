import { timingSafeEqual } from "node:crypto";
/** Constant-time byte comparison. Callers separately reject an unconfigured secret. */
export function cronAuthorized(header: unknown, secret: string): boolean {
  const got = typeof header === "string" ? Buffer.from(header) : null;
  const want = Buffer.from(`Bearer ${secret}`);
  return !!got && got.length === want.length && timingSafeEqual(got, want);
}
