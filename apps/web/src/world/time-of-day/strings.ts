/**
 * Time-of-day HUD strings (P2-WLD-19), English catalogue — i18n-ready like hud/strings.ts, to move to
 * @gukirana/i18n keys `hud.time.*` (the key of each entry is noted beside it).
 */
export const TOD_STR = {
  /** hud.time.title */
  title: "Time of day",
  /** hud.time.chipLabel — aria label of the chip: "Time of day: 21:00, Night. Change" */
  chipLabel: (time: string, phase: string) => `Time of day: ${time}, ${phase}. Change`,
  /** hud.time.close */
  close: "Close",
  /** hud.time.mode.* */
  mode: {
    now: "Now in Rwanda",
    morning: "Morning",
    midday: "Midday",
    sunset: "Sunset",
    night: "Night",
    custom: "Custom time",
  },
  /** hud.time.modeSub.now — "21:04 in Musanze" */
  nowSub: (time: string) => `${time} in Musanze`,
  /** hud.time.note */
  note: "Only you see this. It changes the sky and the lights, nothing else.",
  /** hud.time.scrubber (testing only) */
  scrubber: "Test time",
  /** hud.time.phase.* (aria labels, the chip tooltip) */
  phase: {
    night: "Night",
    dawn: "Dawn",
    sunrise: "Sunrise",
    morning: "Morning",
    midday: "Midday",
    afternoon: "Afternoon",
    golden: "Golden hour",
    sunset: "Sunset",
    dusk: "Dusk",
  },
} as const;
