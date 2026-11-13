"use client";

/**
 * Action prompts ("Enter Pool Hall", "Sit down", "Leave to the plaza", …), shared by the plaza HUD and the hall
 * overlay. Desktop: above the controls, shifted right while chat is open. Phone (landscape): bottom-centre between
 * the joystick and the action bar, at most 40% of the width, so it never covers the middle of the frame (the
 * people you are looking at). The keyboard glyph only shows where there is a keyboard-like pointer.
 */
export function promptWrap(chatOpen: boolean, lift = 0) {
  const desk = lift ? "bottom-[max(164px,calc(env(safe-area-inset-bottom)+156px))]" : "bottom-[max(104px,calc(env(safe-area-inset-bottom)+96px))]";
  const phone = chatOpen ? "phone:left-[73%] phone:bottom-[72px]" : lift ? "phone:bottom-[max(58px,calc(env(safe-area-inset-bottom)+46px))]" : "phone:bottom-[max(12px,env(safe-area-inset-bottom))]";
  return `absolute ${desk} -translate-x-1/2 ${chatOpen ? "left-[70%]" : "left-1/2"} ${phone}`;
}

export const PROMPT_BTN =
  "pointer-events-auto flex items-center gap-3 whitespace-nowrap rounded-full border border-white/30 bg-[#22266E]/90 py-2 pl-2 pr-5 text-lg font-bold shadow-2xl backdrop-blur-md active:scale-95 [@media(pointer:coarse)]:pl-4 phone:max-w-[40vw] phone:gap-2 phone:overflow-hidden phone:py-1.5 phone:pl-3.5 phone:pr-4 phone:text-sm phone:shadow-lg";

export function KeyHint({ k = "E" }: { k?: string }) {
  return <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-base font-black text-[#22266E] [@media(pointer:coarse)]:hidden">{k}</span>;
}
