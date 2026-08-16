export type VipValidation =
  | { ok: true; smsConsent: boolean; emailConsent: boolean; city: string; state: string; zip: string }
  | { ok: false; error: "invalid_consent" | "consent_required" | "invalid_city" | "invalid_state" | "invalid_zip" };

export function validateVipConsentAndLocality(
  sms: unknown,
  email: unknown,
  cityInput: unknown,
  stateInput: unknown,
  zipInput: unknown,
): VipValidation {
  if (typeof sms !== "boolean" || typeof email !== "boolean") return { ok: false, error: "invalid_consent" };
  if (!sms && !email) return { ok: false, error: "consent_required" };
  const city = typeof cityInput === "string" ? cityInput.trim().slice(0, 60) : "";
  const state = typeof stateInput === "string" ? stateInput.trim().toUpperCase() : "";
  const zip = typeof zipInput === "string" ? zipInput.trim() : "";
  if (city.length < 2 || !/^[A-Za-z .'-]+$/.test(city)) return { ok: false, error: "invalid_city" };
  if (!/^[A-Z]{2}$/.test(state)) return { ok: false, error: "invalid_state" };
  if (!/^\d{5}(?:-\d{4})?$/.test(zip)) return { ok: false, error: "invalid_zip" };
  return { ok: true, smsConsent: sms, emailConsent: email, city, state, zip };
}
