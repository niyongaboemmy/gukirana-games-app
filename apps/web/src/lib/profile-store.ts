"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LOOK, DEFAULT_OUTFIT, type AvatarLook, type BodyType, type HairStyle, type Outfit } from "@/world/outfits";

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
  setBodyType: (b: BodyType) => void;
  setSkinTone: (hex: string) => void;
  setHairStyle: (h: HairStyle) => void;
  setHairColor: (hex: string) => void;
  setOutfit: (o: Partial<Outfit>) => void;
  /** Saves a full look from the avatar creator (`accent` maps to the existing `color`). */
  setLook: (l: AvatarLook) => void;
}

/** Current look of the local player, assembled from the profile. */
export const lookOf = (s: Pick<ProfileState, "bodyType" | "skinTone" | "hairStyle" | "hairColor" | "outfit" | "color">): AvatarLook => ({
  bodyType: s.bodyType ?? DEFAULT_LOOK.bodyType,
  skinTone: s.skinTone ?? DEFAULT_LOOK.skinTone,
  hairStyle: s.hairStyle ?? DEFAULT_LOOK.hairStyle,
  hairColor: s.hairColor ?? DEFAULT_LOOK.hairColor,
  outfit: { ...DEFAULT_OUTFIT, ...s.outfit },
  accent: s.color,
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
        set({ bodyType: l.bodyType, skinTone: l.skinTone, hairStyle: l.hairStyle, hairColor: l.hairColor, outfit: { ...l.outfit }, color: l.accent }),
    }),
    { name: "gukirana-profile" },
  ),
);
