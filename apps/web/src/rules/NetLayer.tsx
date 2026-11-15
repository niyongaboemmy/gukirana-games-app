"use client";
import { useResume } from "@/lib/active-match";
import { RulesCard } from "./RulesCard";

/** P2-NET-05, mounted once in the root layout: resume into my live match on load, and the rules card when asked */
export function NetLayer() {
  useResume();
  return <RulesCard />;
}
