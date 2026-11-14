"use client";
import { create } from "zustand";
import { ApiError, requestOtp, updateMe, verifyOtp, useSession } from "@/lib/session";
import { useProfile } from "@/lib/profile-store";
import { encodeLook, type AvatarLook } from "@/world/outfits";
import { chime, buzz } from "./sfx";

/**
 * Arrival gate flow (diegetic "show your ID" check). Shared by the DOM kiosk overlay (screens) and the
 * world-space keyboard (VR), so both stay in sync. Auth itself lives in lib/session.ts (not reimplemented here).
 *
 * arrive → id → code → opening → (setup for new players) → entering → /world
 * leaving: signing out, the person walks back out through the turnstiles (then → id for the next visitor)
 */
export type GateStep = "arrive" | "id" | "code" | "opening" | "setup" | "entering" | "leaving";

interface GateState {
  step: GateStep;
  identifier: string;
  code: string;
  devCode: string | null;
  error: string | null;
  busy: boolean;
  isNew: boolean;
  username: string;
  /** True while a WebXR session is running (the DOM kiosk overlay hides; the world keyboard shows). */
  inXR: boolean;
  set: (p: Partial<GateState>) => void;
  key: (k: string) => void;
  submitId: () => Promise<void>;
  submitCode: () => Promise<void>;
  finishSetup: (look: AvatarLook) => Promise<void>;
  back: () => void;
}

/** Messages shown on the kiosk (to move to @gukirana/i18n keys `gate.*`). */
export const GATE_MSG: Record<string, string> = {
  VALIDATION_ERROR: "That doesn't look right. Check it and try again.",
  OTP_INVALID: "Wrong or expired code. Try again.",
  OTP_RATE_LIMITED: "Too many attempts. Wait a minute, then request a new code.",
  ACCOUNT_INACTIVE: "This account is suspended. Contact support.",
  USERNAME_TAKEN: "That username is taken. Try another.",
  BAD_ID: "Enter a phone number (e.g. 0788 123 456) or an email address.",
  BAD_CODE: "Enter the 6-digit code.",
  BAD_NAME: "Usernames are 3–16 letters, numbers, _ . or -",
  NETWORK: "Can't reach Gukirana right now. Check your connection.",
};

export const normaliseId = (s: string) => {
  const t = s.trim();
  return t.includes("@") ? t.toLowerCase() : t.replace(/[\s()-]/g, "");
};
export const isValidId = (s: string) => {
  const t = normaliseId(s);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) || /^\+?\d{9,13}$/.test(t);
};
export const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,16}$/u;

/** API error → the kiosk message (unknown codes read as a validation problem) */
export const errMsg = (e: unknown) => (e instanceof ApiError ? (GATE_MSG[e.code] ?? GATE_MSG.VALIDATION_ERROR!) : GATE_MSG.NETWORK!);

export const useGate = create<GateState>()((set, get) => ({
  step: "arrive",
  identifier: "",
  code: "",
  devCode: null,
  error: null,
  busy: false,
  isNew: false,
  username: "",
  inXR: false,
  set: (p) => set(p),
  /** Virtual keyboard input (VR keypad and on-screen keypad share this). */
  key: (k) => {
    const s = get();
    const field = s.step === "code" ? "code" : s.step === "setup" ? "username" : "identifier";
    const cur = s[field];
    if (k === "DEL") return set({ [field]: cur.slice(0, -1), error: null } as Partial<GateState>);
    if (k === "OK") {
      if (s.step === "id") void s.submitId();
      else if (s.step === "code") void s.submitCode();
      return;
    }
    const max = field === "code" ? 6 : field === "username" ? 16 : 64;
    if (field === "code" && !/^\d$/.test(k)) return;
    if (cur.length >= max) return;
    set({ [field]: cur + k, error: null } as Partial<GateState>);
    if (field === "code" && cur.length + 1 === 6) setTimeout(() => void get().submitCode(), 150);
  },
  submitId: async () => {
    const s = get();
    if (s.busy) return;
    if (!isValidId(s.identifier)) {
      buzz();
      return set({ error: GATE_MSG.BAD_ID! });
    }
    set({ busy: true, error: null });
    try {
      const r = await requestOtp(normaliseId(s.identifier));
      set({ step: "code", code: "", devCode: r.devCode ?? null, busy: false });
    } catch (e) {
      buzz();
      set({ busy: false, error: errMsg(e) });
    }
  },
  submitCode: async () => {
    const s = get();
    if (s.busy || s.step !== "code") return;
    if (!/^\d{6}$/.test(s.code)) {
      buzz();
      return set({ error: GATE_MSG.BAD_CODE! });
    }
    set({ busy: true, error: null });
    try {
      const { isNew } = await verifyOtp(normaliseId(s.identifier), s.code);
      const me = useSession.getState().me;
      chime();
      set({ step: "opening", busy: false, isNew: isNew || !me?.username, username: me?.username ?? "" });
    } catch (e) {
      buzz();
      set({ busy: false, code: "", error: errMsg(e) });
    }
  },
  finishSetup: async (look) => {
    const s = get();
    if (s.busy) return;
    const username = s.username.trim();
    if (!USERNAME_RE.test(username)) {
      buzz();
      return set({ error: GATE_MSG.BAD_NAME! });
    }
    set({ busy: true, error: null });
    try {
      await updateMe({ username, color: look.accent, bodyType: look.bodyType, look: encodeLook(look) });
      useProfile.getState().setLook(look);
      useProfile.getState().setProfile({ name: username, color: look.accent });
      chime();
      set({ busy: false, step: "entering" });
    } catch (e) {
      buzz();
      set({ busy: false, error: errMsg(e) });
    }
  },
  back: () => set({ step: "id", code: "", devCode: null, error: null }),
}));
