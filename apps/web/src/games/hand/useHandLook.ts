"use client";
import { useMemo } from "react";
import { lookOf, useProfile } from "@/lib/profile-store";
import { handLookOf, type HandLook } from "./look";

/** The local player's hand: skin tone and sleeve from their own avatar look (profile store). */
export function useMyHandLook(): HandLook {
  const skinTone = useProfile((s) => s.skinTone);
  const outfit = useProfile((s) => s.outfit);
  const color = useProfile((s) => s.color);
  const topColor = useProfile((s) => s.topColor);
  return useMemo(() => handLookOf(lookOf({ ...useProfile.getState(), skinTone, outfit, color, topColor })), [skinTone, outfit, color, topColor]);
}
