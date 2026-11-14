"use client";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

/** dev-only test bed for the boxing HUD + controls in practice (P3-FGT-01); off in production and without the flag */
const FightDev = dynamic(() => import("@/fight/game/FightDev").then((m) => m.FightDev), { ssr: false });

export default function FightLabPage() {
  if (process.env.NODE_ENV !== "development" || process.env.NEXT_PUBLIC_FF_FIGHT !== "1") notFound();
  return <FightDev />;
}
