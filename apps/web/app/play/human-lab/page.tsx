"use client";
import dynamic from "next/dynamic";
import { HL } from "@/qa/human-lab/strings";

/**
 * Dev-only human realism lab (QA-HUM-01): one plaza person under fixed cameras and light rigs, for the repeatable
 * realism assessment (qa/e2e/human-assess). Never shipped: production builds render a notice and never load the lab.
 */
const Loading = () => (
  <div className="fixed inset-0 grid place-items-center bg-ink-950 font-display font-bold text-white">
    {HL.loading}
  </div>
);
const Lab =
  process.env.NODE_ENV === "development"
    ? dynamic(() => import("@/qa/human-lab/HumanLab"), { ssr: false, loading: Loading })
    : null;

export default function HumanLabPage() {
  if (!Lab)
    return <div className="grid min-h-dvh place-items-center bg-ink-950 text-white">{HL.notAvailable}</div>;
  return <Lab />;
}
