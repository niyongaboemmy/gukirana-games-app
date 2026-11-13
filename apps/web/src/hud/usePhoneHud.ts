"use client";
import { useEffect, useState } from "react";

/** Same query as the `phone:` Tailwind variant (app/globals.css): a phone held in landscape (short + touch). */
export const PHONE_HUD_QUERY = "(max-height: 500px) and (pointer: coarse)";

/** True on a phone in landscape: the HUD switches to its slim layout (avatar chip, 48 px action bar, "more" menu). */
export function usePhoneHud() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_HUD_QUERY);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

/** Quick Match lives in the action bar's "more" menu on phones; the matchmaking panel owns the sheet. */
export const QUICK_MATCH_EVENT = "gk:quick-match";
export const openQuickMatch = () => window.dispatchEvent(new Event(QUICK_MATCH_EVENT));
