import { randomBytes, createHash } from "node:crypto";
import { sql } from "./db.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
export const ACCOUNT_BUSINESS = "gigis_long_branch";
export const ACCOUNT_ORIGIN = "https://gigislongbranch.com";
export const SESSION_COOKIE = "__Host-gigis_session";
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export type Account = { id: number; name: string; email: string; phone: string | null; member_id: number | null; password_hash: string };
export function sameOrigin(req: VercelRequest): boolean {
  return req.headers.origin === ACCOUNT_ORIGIN && String(req.headers["content-type"] || "").split(";")[0] === "application/json";
}
export function sessionToken(req: VercelRequest): string | null {
  const cookie = typeof req.headers.cookie === "string" ? req.headers.cookie : "";
  const value = cookie.split(";").map(s => s.trim()).find(s => s.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
function setCookie(res: VercelResponse, token: string, age = 2592000) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`);
}
export async function createSession(id: number, res: VercelResponse, expectedHash: string) {
  const token = randomBytes(32).toString("base64url");
  const result = await sql`INSERT INTO account_sessions (id, account_id, expires_at, credential_version)
    SELECT ${hashToken(token)}, id, now() + interval '30 days', credential_version FROM accounts
    WHERE id=${id} AND business=${ACCOUNT_BUSINESS} AND password_hash=${expectedHash} AND deleted_at IS NULL RETURNING id`;
  if (!result.rowCount) throw new Error("credentials_changed");
  setCookie(res, token);
}
export async function readSession(req: VercelRequest, res?: VercelResponse): Promise<Account | null> {
  const token = sessionToken(req);
  if (!token) return null;
  const result = await sql`SELECT a.id, a.name, a.email, a.phone, a.member_id, a.password_hash
    FROM account_sessions s JOIN accounts a ON a.id = s.account_id
    WHERE s.id = ${hashToken(token)} AND s.expires_at > now() AND s.credential_version=a.credential_version AND a.deleted_at IS NULL AND a.business = ${ACCOUNT_BUSINESS}`;
  const account = result.rows[0] as Account | undefined;
  if (!account) return null;
  if (res) {
    await sql`UPDATE account_sessions SET expires_at = now() + interval '30 days' WHERE id = ${hashToken(token)}`;
    setCookie(res, token);
  }
  return account;
}
export async function logout(req: VercelRequest, res: VercelResponse) {
  const token = sessionToken(req);
  if (token) await sql`DELETE FROM account_sessions WHERE id = ${hashToken(token)}`;
  setCookie(res, "", 0);
}
