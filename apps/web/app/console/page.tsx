"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { openConsole, useConsole } from "@/console/console-store";

/**
 * Staff console as a page (desktop / tablet / TV): opens the same full-screen console used by the office computer.
 * Logging off returns to the playground.
 */
export default function ConsolePage() {
  const router = useRouter();
  const open = useConsole((s) => s.open);
  useEffect(() => {
    openConsole({ office: null });
  }, []);
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        if (!useConsole.getState().open) router.replace("/world");
      }, 700);
      return () => clearTimeout(t);
    }
  }, [open, router]);
  return null;
}
