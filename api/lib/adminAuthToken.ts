import { createHash, timingSafeEqual } from "node:crypto";

/** Fixed-size, constant-time comparison for shared webhook/admin secrets. */
export function secretMatches(got: unknown, expected: string): boolean {
  if (typeof got !== "string") return false;
  const actual = createHash("sha256").update(got).digest();
  const wanted = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actual, wanted);
}

export const adminTokenMatches = secretMatches;
