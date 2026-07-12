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
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? "request_failed");
  return data as T;
}
