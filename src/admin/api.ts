/** Thin client for /api/admin/* — token travels in the x-admin-token header. */

export type Business = "gigis_long_branch";

export const BUSINESSES: { value: Business; label: string }[] = [
  { value: "gigis_long_branch", label: "Gigi's Pizza — Long Branch" },
];

export type Member = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  sms_consent: boolean;
  email_consent: boolean;
  source: string;
  created_at: string;
};

export type Stats = {
  members: { total: number; sms_ok: number; email_ok: number; new_7d: number };
  sends: { sent: number; failed: number };
  broadcasts: { total: number };
  channels: { sms: boolean; email: boolean };
};

export type BroadcastRow = {
  id: number;
  subject: string | null;
  message: string;
  channels: string;
  sms_total: number;
  email_total: number;
  promo_code: string | null;
  sent: number;
  failed: number;
  created_at: string;
};

const TOKEN_KEY = "gigis_admin_token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  /** Full JSON body, so callers can read a friendly `message` / extra fields. */
  payload: Record<string, unknown>;
  constructor(status: number, message: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

/** Free-pie welcome code, as returned by /api/admin/promo. */
export type PromoLookup = {
  code: string;
  description: string;
  member: { name: string; phone: string | null; email: string | null } | null;
  redeemed: boolean;
  redeemedAt: string | null;
  expired: boolean;
  inUse: boolean;
  reservedAt: string | null;
  expiresAt: string | null;
  valid: boolean;
  justRedeemed?: boolean;
  holdReleased?: boolean;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": getToken(),
      ...init?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data as { error?: string; message?: string };
    throw new ApiError(res.status, d.message ?? d.error ?? "request_failed", data as Record<string, unknown>);
  }
  return data as T;
}
