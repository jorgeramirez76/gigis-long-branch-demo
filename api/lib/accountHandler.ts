import { EMAIL_RE } from "./emailAddress.js";
import { randomBytes } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "./db.js";
import { ACCOUNT_BUSINESS, ACCOUNT_ORIGIN, hashToken, sameOrigin, readSession, createSession, logout } from "./session.js";
import { hashPassword, validPassword, verifyPassword } from "./password.js";
import { rateLimitAllStrict } from "./rateLimit.js";
import { sendReceiptEmail, sendSms } from "./notify.js";
import { normalizePhone } from "./phone.js";
import { addressDedupeKey, legacyAddressDedupeKey } from "./address.js";
import { CANONICAL_CONSENT_TEXT } from "./vipSignupShared.js";
import { accountOrders, claimGuestOrders, finishEnrollment } from "./accountStore.js";
import { usualItems } from "./upsell.js";
import { priceLines, type ClientLine } from "./menuCatalog.js";
import { liveItemNames } from "./menuLive.js";

const GENERIC = { ok: true, message: "If this email can be used, a secure link will arrive shortly. Check your inbox and spam folder." };
const text = (value: unknown, max = 160) => typeof value === "string" ? value.trim().slice(0,max) : "";
const cleanEmail = (value: unknown) => text(value,254).toLowerCase();
async function botCheck(token: unknown, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || typeof token !== "string" || !token) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method:"POST", body:new URLSearchParams({secret,response:token,remoteip:ip}), signal:AbortSignal.timeout(8000),
    });
    return r.ok && (await r.json()).success === true;
  } catch { return false; }
}
async function emailLink(email: string, purpose: string, payload: unknown) {
  const token = randomBytes(32).toString("base64url");
  const key = hashToken(token);
  await sql`INSERT INTO account_tokens (token_hash,business,email,purpose,payload,expires_at)
    VALUES (${key},${ACCOUNT_BUSINESS},${email},${purpose},${JSON.stringify(payload)}::jsonb,now()+interval '30 minutes')`;
  // Hash fragment is not sent in HTTP requests, server logs, or referrers.
  const url = `${ACCOUNT_ORIGIN}/account/#token=${token}`;
  const result = await sendReceiptEmail(email,"Your Gigi's Rewards secure link",
    `<p>Finish signing in to Gigi's Rewards. Choose your password after opening this link.</p><p><a href="${url}">Continue to Gigi's Rewards</a></p><p>This link expires in 30 minutes. If you didn't request it, ignore this email.</p>`,
    `Continue to Gigi's Rewards: ${url}\nThis link expires in 30 minutes. If you didn't request it, ignore it.`);
  if (!result.sent) {
    await sql`DELETE FROM account_tokens WHERE token_hash = ${key}`;
    throw new Error("account_email_unavailable");
  }
}
export function accountHandler(action: string) {
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Referrer-Policy","no-referrer");
    const get = ["me","orders","config"].includes(action);
    if (req.method !== (get ? "GET" : "POST")) return void res.status(405).json({error:"method_not_allowed"});
    if (!get && !sameOrigin(req)) return void res.status(403).json({error:"origin_required"});
    if (process.env.ACCOUNTS_ENABLED !== "true") return void res.status(503).json({error:"accounts_not_enabled"});
    const body = req.body ?? {};
    const ip = text(req.headers["x-real-ip"],80) || "unknown";
    try {
      if (action === "config") return void res.status(200).json({siteKey:process.env.VITE_TURNSTILE_SITE_KEY || "",consentText:CANONICAL_CONSENT_TEXT});
      const email = cleanEmail(body.email);
      const tokenId = typeof body.token === "string" ? hashToken(body.token) : "none";
      const sensitive = ["signup","login","password-reset-request","claim"].includes(action);
      if (!(await rateLimitAllStrict([
        {bucket:`account:${action}:ip:${ip}`,max:action === "login" ? 30 : 60,windowSec:900},
        ...(sensitive ? [{bucket:`account:${action}:email:${hashToken(email)}:${action === "login" ? ip : "all"}`,max:action === "login" ? 10 : 3,windowSec:900}] : []),
        ...(action === "password-reset-confirm" ? [{bucket:`account:verify:${tokenId}`,max:10,windowSec:900}] : []),
      ]))) return void res.status(429).json({error:"rate_limited",message:"Please wait 15 minutes before trying again."});
      if (sensitive && !(await botCheck(body.turnstileToken,ip))) return void res.status(403).json({error:"verification_failed",message:"Complete the verification and try again."});

      if (action === "signup") {
        const name = text(body.name,100), phone = normalizePhone(text(body.phone));
        const street = text(body.address), apt = text(body.apt,40), city = text(body.city,60), state = text(body.state,2).toUpperCase(), zip = text(body.zip,10);
        if (!name || !phone || !EMAIL_RE.test(email) || street.length<4 || city.length<2 || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(zip)) return void res.status(400).json({error:"invalid_profile",message:"Fill in your name, email, phone and complete address."});
        if (typeof body.smsConsent !== "boolean" || typeof body.emailConsent !== "boolean" || body.consentText !== CANONICAL_CONSENT_TEXT) return void res.status(400).json({error:"invalid_consent"});
        const payload = {name,phone,email,fullAddress:`${street}, ${city}, ${state} ${zip}`,apt:apt || null,
          addrKey:addressDedupeKey(street,apt,city,state,zip),legacyAddrKey:legacyAddressDedupeKey(street,apt),smsConsent:body.smsConsent,emailConsent:body.emailConsent,source:body.source === "menu-qr" ? "menu-qr" : "rewards-account",street,city,state,zip};
        await emailLink(email,"signup",payload);
        return void res.status(200).json(GENERIC);
      }
      if (action === "password-reset-request" || action === "claim") {
        const found = await sql`SELECT id FROM accounts WHERE business=${ACCOUNT_BUSINESS} AND email=${email} AND deleted_at IS NULL`;
        const member = await sql`SELECT name,phone,email,address,apt,addr_key FROM vip_members WHERE business=${ACCOUNT_BUSINESS} AND LOWER(email)=${email} LIMIT 1`;
        if (found.rows[0]) await emailLink(email,"reset",{});
        else if (member.rows[0]) await emailLink(email,"claim",member.rows[0]);
        return void res.status(200).json(GENERIC);
      }
      if (action === "password-reset-confirm") {
        if (!/^[A-Za-z0-9_-]{43}$/.test(text(body.token,100)) || !validPassword(body.password)) return void res.status(400).json({error:"invalid_password",message:"Use 12 or more characters (at most 72 UTF-8 bytes)."});
        const result = await sql`SELECT email,purpose,payload FROM account_tokens WHERE token_hash=${tokenId} AND business=${ACCOUNT_BUSINESS} AND used_at IS NULL AND expires_at>now()`;
        const pending = result.rows[0];
        if (!pending) return void res.status(400).json({error:"link_expired",message:"This link was used or expired. Request another."});
        const passwordHash = await hashPassword(body.password);
        // Token consumption and credential write are one SQL statement, so races cannot reuse a reset.
        const created = pending.purpose === "reset" ? await sql`
          WITH token AS (UPDATE account_tokens SET used_at=now() WHERE token_hash=${tokenId} AND business=${ACCOUNT_BUSINESS} AND used_at IS NULL AND expires_at>now() RETURNING email),
          changed AS (UPDATE accounts a SET password_hash=${passwordHash},credential_version=credential_version+1 FROM token t WHERE a.email=t.email AND a.business=${ACCOUNT_BUSINESS} AND a.deleted_at IS NULL RETURNING a.id),
          revoked AS (DELETE FROM account_sessions WHERE account_id IN (SELECT id FROM changed)),
          invalidated AS (UPDATE account_tokens SET used_at=now() WHERE business=${ACCOUNT_BUSINESS} AND email IN (SELECT email FROM token) AND token_hash<>${tokenId} AND used_at IS NULL)
          SELECT id FROM changed` : await sql`
          WITH token AS (UPDATE account_tokens SET used_at=now() WHERE token_hash=${tokenId} AND business=${ACCOUNT_BUSINESS} AND used_at IS NULL AND expires_at>now() RETURNING email,payload)
          INSERT INTO accounts (business,email,name,phone,password_hash,enrollment_payload)
          SELECT ${ACCOUNT_BUSINESS},email,payload->>'name',payload->>'phone',${passwordHash},CASE WHEN ${pending.purpose}='signup' THEN payload ELSE NULL END FROM token
          ON CONFLICT (business,email) DO NOTHING RETURNING id`;
        const accountId = Number(created.rows[0]?.id);
        if (!accountId) return void res.status(409).json({error:"account_exists",message:"An account already exists. Use Sign in or Forgot password."});
        await finishEnrollment(accountId);
        await createSession(accountId,res,passwordHash);
        return void res.status(200).json({ok:true});
      }
      if (action === "login") {
        const result = await sql`SELECT id,password_hash FROM accounts WHERE business=${ACCOUNT_BUSINESS} AND email=${email} AND deleted_at IS NULL`;
        const account = result.rows[0];
        if (!(await verifyPassword(body.password,account?.password_hash as string | undefined))) return void res.status(401).json({error:"invalid_credentials",message:"Email or password is wrong."});
        await finishEnrollment(Number(account.id));
        await createSession(Number(account.id),res,String(account.password_hash));
        await sql`UPDATE accounts SET last_login_at=now() WHERE id=${account.id}`;
        return void res.status(200).json({ok:true});
      }
      if (action === "logout") { await logout(req,res); return void res.status(200).json({ok:true}); }
      let account = await readSession(req,res);
      if (!account) return void res.status(401).json({error:"sign_in_required"});
      if (action === "me") {
        await finishEnrollment(account.id);
        account = await readSession(req);
        if (!account) return void res.status(401).json({error:"sign_in_required"});
        await claimGuestOrders(account.id,account.email);
        const member = (await sql`SELECT sms_consent,email_consent,sms_requested FROM vip_members WHERE id=${account.member_id} AND business=${ACCOUNT_BUSINESS}`).rows[0] || null;
        const pie = (await sql`SELECT code,description,expires_at,redeemed_at,reservation_key FROM vip_promo_codes WHERE member_id=${account.member_id} AND business=${ACCOUNT_BUSINESS} ORDER BY created_at DESC LIMIT 1`).rows[0] || null;
        const addresses = (await sql`SELECT id,street,apt,city,state,zip,is_default FROM saved_addresses WHERE account_id=${account.id} ORDER BY is_default DESC,id`).rows;
        return void res.status(200).json({account:{id:account.id,name:account.name,email:account.email,phone:account.phone},member,pie,addresses,orders:await accountOrders(account.id)});
      }
      if (action === "orders") {
        const page = Math.max(0,Math.min(1000,Number(req.query.page)||0));
        return void res.status(200).json({orders:await accountOrders(account.id,Math.floor(page)*10)});
      }
      if (action === "reorder") {
        const order = (await sql`SELECT items FROM web_orders WHERE id=${Number(body.orderId)||0} AND account_id=${account.id} AND business=${ACCOUNT_BUSINESS}`).rows[0];
        if (!order) return void res.status(404).json({error:"order_not_found"});
        const lines = (typeof order.items === "string" ? JSON.parse(order.items) : order.items) as ClientLine[];
        const priced = priceLines(lines.map(line=>({...line,notes:line.notes?.replace(/FREE — VIP welcome pie PIE-[A-Z0-9]+(?: · )?/g, "")})),await liveItemNames());
        if (!priced.ok) return void res.status(409).json({error:"menu_changed",message:"Some items or options have changed. Please choose from the current menu."});
        return void res.status(200).json({lines:priced.lines});
      }
      if (action === "upsell") {
        const excluded = Array.isArray(body.inCart) ? body.inCart.filter((v:unknown)=>typeof v === "string").slice(0,100) : [];
        const items = await usualItems(account.id,excluded);
        const suggestions = [];
        for (const item of items) {
          const r=await sql`INSERT INTO upsell_impressions(account_id,item) VALUES(${account.id},${item.itemName}) RETURNING id`;
          suggestions.push({...item,impressionId:r.rows[0].id});
        }
        return void res.status(200).json({items:suggestions});
      }
      if (action === "upsell-add") {
        await sql`UPDATE upsell_impressions SET added=true WHERE id=${Number(body.impressionId)||0} AND account_id=${account.id}`;
        return void res.status(200).json({ok:true});
      }
      if (action === "consent") {
        if (!account.member_id || typeof body.sms !== "boolean" || typeof body.email !== "boolean" || body.consentText !== CANONICAL_CONSENT_TEXT) return void res.status(400).json({error:"invalid_consent"});
        // Read the linked member's phone and prior state under the same row lock as the
        // update. Concurrent saves cannot send duplicate opt-in requests, and an account
        // profile phone must never replace the member's consent destination.
        const changed = await sql`WITH previous AS (
          SELECT id,phone,sms_requested,sms_consent FROM vip_members
          WHERE id=${account.member_id} AND business=${ACCOUNT_BUSINESS} FOR UPDATE
        ), updated AS (
          UPDATE vip_members m SET email_consent=${body.email},sms_requested=${body.sms},
            sms_consent=CASE WHEN ${body.sms} THEN m.sms_consent ELSE false END
          FROM previous p WHERE m.id=p.id RETURNING m.id,p.phone,p.sms_requested,p.sms_consent
        ), recorded AS (
          INSERT INTO consent_events(member_id,channel,action,source)
          SELECT id,'email',CASE WHEN ${body.email} THEN 'opt_in' ELSE 'opt_out' END,'rewards-account' FROM updated
        ) SELECT * FROM updated`;
        const member = changed.rows[0];
        if (!member) return void res.status(409).json({error:"membership_unavailable"});
        if (!body.sms && (member.sms_requested || member.sms_consent)) await sql`INSERT INTO consent_events(member_id,channel,action,source) VALUES(${account.member_id},'sms','opt_out','rewards-account')`;
        if (!body.email) await sql`INSERT INTO email_suppressions(email,source) VALUES(${account.email},'rewards-account') ON CONFLICT(email) DO NOTHING`;
        else await sql`DELETE FROM email_suppressions WHERE LOWER(email)=${account.email}`;
        if (body.sms && !member.sms_requested && !member.sms_consent && member.phone) {
          const sent = await sendSms(String(member.phone),"Gigi's Rewards: Reply YES to confirm promotional texts. Up to 4 msgs/mo. Msg&data rates may apply. Reply STOP to opt out, HELP for help.");
          if (!sent.sent) return void res.status(503).json({error:"confirmation_unavailable",message:"Your preferences were saved, but we could not send the confirmation text. Contact the restaurant for help."});
        }
        return void res.status(200).json({ok:true});
      }
      if (action === "delete") {
        if (!(await verifyPassword(body.password,account.password_hash))) return void res.status(401).json({error:"invalid_credentials"});
        // Financial and consent records retain their own required audit history.
        const deleted = await sql`WITH changed AS (UPDATE accounts SET email='deleted-'||id||'@invalid.local',name='Deleted account',phone=NULL,password_hash='',member_id=NULL,enrollment_payload=NULL,deleted_at=now() WHERE id=${account.id} AND business=${ACCOUNT_BUSINESS} AND deleted_at IS NULL AND password_hash=${account.password_hash} RETURNING id),
          sessions AS (DELETE FROM account_sessions WHERE account_id IN (SELECT id FROM changed)),
          addresses AS (DELETE FROM saved_addresses WHERE account_id IN (SELECT id FROM changed)),
          impressions AS (DELETE FROM upsell_impressions WHERE account_id IN (SELECT id FROM changed)),
          tokens AS (DELETE FROM account_tokens WHERE business=${ACCOUNT_BUSINESS} AND email=${account.email} AND EXISTS(SELECT 1 FROM changed)),
          lines AS (UPDATE order_lines SET account_id=NULL WHERE account_id IN (SELECT id FROM changed)),
          orders AS (UPDATE web_orders SET account_id=NULL WHERE account_id IN (SELECT id FROM changed))
          SELECT id FROM changed`;
        if (!deleted.rowCount) return void res.status(409).json({error:"credentials_changed",message:"Your credentials changed. Sign in again before deleting your account."});
        await logout(req,res);
        return void res.status(200).json({ok:true});
      }
      res.status(404).json({error:"not_found"});
    } catch (err) {
      console.error(`[account/${action}] operation failed`,err instanceof Error ? err.name : "unknown");
      res.status(503).json({error:"temporarily_unavailable",message:"Please try again shortly. If you already chose a password, try signing in."});
    }
  };
}
