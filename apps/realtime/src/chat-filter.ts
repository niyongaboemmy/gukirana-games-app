/**
 * Text safety filter (SRS FR-COM-09). Blocks phone / MoMo numbers, payment requests and links,
 * so players can't arrange side deals outside escrow. Profanity list is a placeholder (P1-COM-02).
 */
const PHONE = /(\+?\d[\d\s.-]{7,}\d)/g;
const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;
const PAYMENT = /\b(?:send|pay|ohereza|tuma)\b[^.!?]{0,30}\b(?:momo|money|mobile money|airtel|amafaranga|pesa|rwf|frw)\b/i;
const PROFANITY = ["fuck", "shit", "bitch"]; // placeholder; real lists per language in P1-COM-02

export interface FilterResult {
  text: string;
  blocked: boolean;
  reason?: "contact-or-payment" | "profanity";
}

export function filterChat(raw: string): FilterResult {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 200);
  if (PAYMENT.test(text)) {
    return { text: "", blocked: true, reason: "contact-or-payment" };
  }
  let out = text.replace(PHONE, "•••").replace(LINK, "•••");
  const masked = out !== text;
  let profane = false;
  for (const w of PROFANITY) {
    const re = new RegExp(`\\b${w}\\b`, "gi");
    if (re.test(out)) {
      profane = true;
      out = out.replace(re, "•".repeat(w.length));
    }
  }
  if (masked) return { text: out, blocked: false, reason: "contact-or-payment" };
  return profane ? { text: out, blocked: false, reason: "profanity" } : { text: out, blocked: false };
}

export function sanitizeName(raw: unknown): string {
  const name = String(raw ?? "")
    .replace(/[^\p{L}\p{N}_ .-]/gu, "")
    .trim()
    .slice(0, 16);
  return name.length >= 2 ? name : `Player${Math.floor(Date.now() % 10000)}`;
}
