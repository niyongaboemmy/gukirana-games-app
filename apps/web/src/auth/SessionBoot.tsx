"use client";
import { useEffect } from "react";
import { refreshSession } from "@/lib/session";

/** Restores the session from the httpOnly refresh cookie on first load. */
export function SessionBoot() {
  useEffect(() => {
    void refreshSession();
  }, []);
  return null;
}
