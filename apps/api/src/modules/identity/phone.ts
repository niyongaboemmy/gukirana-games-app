/** Normalises Rwandan and E.164 numbers. Returns null if invalid. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s().-]/g, "");
  if (/^07[2389]\d{7}$/.test(digits)) return `+250${digits.slice(1)}`;
  if (/^2507[2389]\d{7}$/.test(digits)) return `+${digits}`;
  if (/^\+2507[2389]\d{7}$/.test(digits)) return digits;
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}

export const maskPhone = (e164: string) => `${e164.slice(0, 6)}••••${e164.slice(-3)}`;

export type LoginId = { kind: "phone" | "email"; value: string };

/** Phone (Rwandan or E.164) or email → canonical login identifier. */
export function parseLoginId(raw: string): LoginId | null {
  const s = raw.trim();
  if (s.includes("@")) {
    const email = s.toLowerCase();
    return /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/.test(email) ? { kind: "email", value: email } : null;
  }
  const phone = normalizePhone(s);
  return phone ? { kind: "phone", value: phone } : null;
}

export const maskEmail = (e: string) => {
  const [u, d] = e.split("@");
  return `${u!.slice(0, 2)}•••@${d}`;
};
export const maskLoginId = (id: LoginId) => (id.kind === "email" ? maskEmail(id.value) : maskPhone(id.value));
