"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LOOK, DEFAULT_OUTFIT, seededLook, type AvatarLook, type BodyType, type HairStyle, type Outfit } from "@/world/outfits";

/**
 * Local player profile (dev stub until identity + ledger APIs exist: P0-AUTH, P1-STR, P1-LVL).
 * Stars are practice currency only — never convertible to money (FR-CUR-05).
 */
export const AVATAR_COLORS = ["#2F80ED", "#FF8A1F", "#27AE60", "#9B51E0", "#E53935", "#00ACC1", "#F5B301", "#1B1B1B"];

export const totalXpForLevel = (level: number) => 25 * level * (level - 1);
export const levelForXp = (xp: number) => Math.floor((1 + Math.sqrt(1 + (4 * xp) / 25)) / 2);

interface ProfileState {
  name: string;
  color: string;
  xp: number;
  stars: number;
  onboarded: boolean;
  dailyXp: { day: string; xp: number };
  setProfile: (p: { name: string; color: string }) => void;
  addXp: (amount: number) => number;
  addStars: (amount: number) => void;
  // avatar look (DESIGN-SPEC §7.2) — always chosen by the player, never inferred
  bodyType: BodyType;
  skinTone: string;
  hairStyle: HairStyle;
  hairColor: string;
  outfit: Outfit;
  /** Muted top colour of a default (seeded) look; cleared when the player picks their own accent. */
  topColor?: string;
  setBodyType: (b: BodyType) => void;
  setSkinTone: (hex: string) => void;
  setHairStyle: (h: HairStyle) => void;
  setHairColor: (hex: string) => void;
  setOutfit: (o: Partial<Outfit>) => void;
  /** Saves a full look from the avatar creator (`accent` maps to the existing `color`). */
  setLook: (l: AvatarLook) => void;
}

/** Current look of the local player, assembled from the profile. */
export const lookOf = (s: Pick<ProfileState, "bodyType" | "skinTone" | "hairStyle" | "hairColor" | "outfit" | "color"> & { topColor?: string }): AvatarLook => ({
  bodyType: s.bodyType ?? DEFAULT_LOOK.bodyType,
  skinTone: s.skinTone ?? DEFAULT_LOOK.skinTone,
  hairStyle: s.hairStyle ?? DEFAULT_LOOK.hairStyle,
  hairColor: s.hairColor ?? DEFAULT_LOOK.hairColor,
  outfit: { ...DEFAULT_OUTFIT, ...s.outfit },
  accent: s.color,
  ...(s.topColor ? { topColor: s.topColor } : {}),
});

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Kigali" });

export const useProfile = create<ProfileState>()(
  persist(
    (set, get) => ({
      name: "",
      color: AVATAR_COLORS[0]!,
      xp: 0,
      stars: 500,
      onboarded: false,
      dailyXp: { day: today(), xp: 0 },
      setProfile: ({ name, color }) => set({ name, color, onboarded: true }),
      addXp: (amount) => {
        const d = get().dailyXp.day === today() ? get().dailyXp : { day: today(), xp: 0 };
        const granted = Math.max(0, Math.min(amount, 400 - d.xp)); // daily cap (SRS §5.9.1)
        set({ xp: get().xp + granted, dailyXp: { day: d.day, xp: d.xp + granted } });
        return granted;
      },
      addStars: (amount) => set({ stars: Math.max(0, get().stars + amount) }),
      bodyType: DEFAULT_LOOK.bodyType,
      skinTone: DEFAULT_LOOK.skinTone,
      hairStyle: DEFAULT_LOOK.hairStyle,
      hairColor: DEFAULT_LOOK.hairColor,
      outfit: DEFAULT_OUTFIT,
      setBodyType: (bodyType) => set({ bodyType }),
      setSkinTone: (skinTone) => set({ skinTone }),
      setHairStyle: (hairStyle) => set({ hairStyle }),
      setHairColor: (hairColor) => set({ hairColor }),
      setOutfit: (o) => set({ outfit: { ...DEFAULT_OUTFIT, ...get().outfit, ...o } }),
      setLook: (l) =>
        set({
          bodyType: l.bodyType,
          skinTone: l.skinTone,
          hairStyle: l.hairStyle,
          hairColor: l.hairColor,
          outfit: { ...l.outfit },
          color: l.accent,
          // a newly picked accent recolours the top again (the seeded muted colour only lasts until then)
          topColor: l.topColor && (l.accent === get().color || !get().topColor) ? l.topColor : undefined,
        }),
    }),
    { name: "gukirana-profile" },
  ),
);

/**
 * Accounts without a saved look get their own deterministic default (the same one the API assigns at sign-up), never
 * the shared default clone or a look left on this device by another account. Loaded lazily: session.ts imports this
 * module, so a static import back would be circular.
 */
if (typeof window !== "undefined") {
  void import("./session").then(({ useSession }) => {
    let seededFor: string | null = null;
    const apply = (me: { id: string; look: string | null; color: string; bodyType: BodyType } | null) => {
      if (!me || me.look || seededFor === me.id) return;
      seededFor = me.id;
      const body = me.bodyType === "feminine" || me.bodyType === "masculine" ? me.bodyType : null;
      // after session.ts has mirrored the rest of the profile (it runs right after the session update)
      queueMicrotask(() => useProfile.getState().setLook(seededLook(me.id, me.color, body)));
    };
    apply(useSession.getState().me);
    useSession.subscribe((s) => apply(s.me));
  });
}
