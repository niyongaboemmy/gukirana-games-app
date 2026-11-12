"use client";
import { useState } from "react";
import { ApiError, requestOtp, updateMe, useSession, verifyOtp } from "@/lib/session";
import { AVATAR_COLORS } from "@/lib/profile-store";

const STYLES = [
  { id: "feminine", label: "Feminine" },
  { id: "masculine", label: "Masculine" },
  { id: "neutral", label: "Neutral" },
] as const;

const ERRORS: Record<string, string> = {
  VALIDATION_ERROR: "Enter a valid phone (e.g. 078 812 3456) or email.",
  OTP_INVALID: "That code is wrong or expired. Try again.",
  OTP_RATE_LIMITED: "Too many codes requested. Wait a few minutes.",
  USERNAME_TAKEN: "That username is taken. Try another one.",
};

/**
 * Phone OTP sign-in (FR-ACC-01) + profile setup. Avatar style is the player's own choice,
 * never inferred (outfits are suggested for it but every outfit stays available).
 */
export function LoginFlow({ onDone }: { onDone?: () => void }) {
  const me = useSession((s) => s.me);
  const [step, setStep] = useState<"phone" | "code" | "profile">(me && !me.username ? "profile" : "phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [name, setName] = useState(me?.username ?? "");
  const [color, setColor] = useState(me?.color ?? AVATAR_COLORS[0]!);
  const [style, setStyle] = useState<(typeof STYLES)[number]["id"]>(me?.bodyType ?? "neutral");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(ERRORS[e instanceof ApiError ? e.code : ""] ?? "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const input = "rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-lg font-semibold outline-none focus:border-[#3DA9FC]";
  const primary = "rounded-xl bg-gradient-to-r from-[#3DA9FC] to-[#2F80ED] py-3 text-lg font-extrabold shadow-lg disabled:opacity-40";

  if (step === "phone")
    return (
      <form className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), run(async () => { const r = await requestOtp(phone); setDevCode(r.devCode ?? null); setStep("code"); }))}>
        <label className="text-sm font-semibold text-white/80">Phone or email</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode={/[a-z@]/i.test(phone) ? "email" : "tel"} autoComplete="username" placeholder="078 812 3456 or you@email.com" className={input} data-testid="login-id" />
        <p className="text-xs text-white/50">We&apos;ll send you a 6-digit code. 18+ only for real-money play.</p>
        {error && <p className="text-sm text-[#ff8a8a]">{error}</p>}
        <button disabled={busy || phone.trim().length < 6} className={primary}>{busy ? "Sending…" : "Send code"}</button>
      </form>
    );

  if (step === "code")
    return (
      <form className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), run(async () => { const r = await verifyOtp(phone, code); const m = useSession.getState().me; if (r.isNew || !m?.username) setStep("profile"); else onDone?.(); }))}>
        <label className="text-sm font-semibold text-white/80">Enter the code sent to {phone}</label>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" className={`${input} tracking-[0.5em]`} />
        {devCode && (
          <p className="rounded-lg bg-[#F59E0B]/15 px-3 py-2 text-xs text-[#ffd27a]">
            Dev mode: no SMS gateway yet. Your code is <b className="tracking-widest">{devCode}</b>
          </p>
        )}
        {error && <p className="text-sm text-[#ff8a8a]">{error}</p>}
        <button disabled={busy || code.length !== 6} className={primary}>{busy ? "Checking…" : "Verify"}</button>
        <button type="button" onClick={() => setStep("phone")} className="text-sm text-white/60">Change number</button>
      </form>
    );

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => (e.preventDefault(), run(async () => { await updateMe({ username: name.trim(), color, bodyType: style }); onDone?.(); }))}>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-white/80">Choose a username</span>
        <input value={name} onChange={(e) => setName(e.target.value.replace(/[^\p{L}\p{N}_.-]/gu, ""))} maxLength={16} placeholder="e.g. Aline_K" className={input} />
      </label>
      <div>
        <p className="mb-2 text-sm font-semibold text-white/80">Avatar style <span className="font-normal text-white/50">(your choice, change any time)</span></p>
        <div className="grid grid-cols-3 gap-2">
          {STYLES.map((s) => (
            <button key={s.id} type="button" onClick={() => setStyle(s.id)} className={`rounded-xl border-2 py-2 font-semibold ${style === s.id ? "border-white bg-white/15" : "border-white/15"}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-white/80">Hoodie colour</p>
        <div className="flex flex-wrap gap-2">
          {AVATAR_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Colour ${c}`} className={`size-10 rounded-full border-2 transition ${color === c ? "scale-110 border-white ring-4 ring-white/30" : "border-white/20"}`} style={{ background: c }} />
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-[#ff8a8a]">{error}</p>}
      <button disabled={busy || name.trim().length < 2} className={primary}>{busy ? "Saving…" : "Let's play →"}</button>
    </form>
  );
}
