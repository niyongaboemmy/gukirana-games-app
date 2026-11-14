"use client";
/** Tiny synthesized UI sounds (WebAudio, no audio files). Muted users: browsers block audio until a gesture anyway. */
import { uiAudio as ac } from "@/lib/audio";
import { useGamePrefs } from "@/games/feedback";

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.12) {
  const a = useGamePrefs.getState().sound ? ac() : null; // the "Game sounds" setting (P2-WLD-09)
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = a.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Access granted: rising two-note chime. */
export function chime() {
  tone(659.25, 0, 0.35, "sine", 0.09);
  tone(987.77, 0.12, 0.55, "sine", 0.08);
}
/** Error: a short soft low "dum" (triangle, not a harsh square buzz). */
export function buzz() {
  tone(196, 0, 0.16, "triangle", 0.06);
  tone(147, 0.09, 0.22, "triangle", 0.05);
}
/** Key press tick. */
export function tick() {
  tone(1800, 0, 0.04, "triangle", 0.03);
}
