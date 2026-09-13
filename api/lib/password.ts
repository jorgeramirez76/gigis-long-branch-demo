import { hash, compare, truncates } from "bcryptjs";
export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && !truncates(value);
}
export async function hashPassword(password: string): Promise<string> {
  if (!validPassword(password)) throw new Error("Use at least 12 characters and at most 72 UTF-8 bytes.");
  return hash(password, 12);
}
// A valid cost-12 hash ensures missing accounts still perform the same expensive comparison.
const DUMMY = "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";
export async function verifyPassword(password: unknown, stored?: string): Promise<boolean> {
  if (typeof password !== "string" || truncates(password)) return false;
  const matches = await compare(password, stored || DUMMY);
  return !!stored && matches;
}
