"use client";
import dynamic from "next/dynamic";
import { BX } from "@/world/human/boxing/strings";

/**
 * Dev-only boxing lab (P3-FGT-02): motion library, ring kit and the 50-ring field for perf checks. Never shipped:
 * production builds render a notice and never load the lab chunk.
 */
const Loading = () => <div className="fixed inset-0 grid place-items-center bg-ink-950 font-display font-bold text-white">{BX.loading}</div>;
const Lab = process.env.NODE_ENV === "development" ? dynamic(() => import("@/world/human/boxing/BoxingLab"), { ssr: false, loading: Loading }) : null;

export default function BoxingLabPage() {
  if (!Lab) return <div className="grid min-h-dvh place-items-center bg-ink-950 text-white">{BX.notAvailable}</div>;
  return <Lab />;
}
