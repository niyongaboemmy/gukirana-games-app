"use client";
/** Tiny synthesized UI sounds (WebAudio, no audio files). Muted users: browsers block audio until a gesture anyway. */
let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.12) {
  const a = ac();
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
  tone(659.25, 0, 0.35);
  tone(987.77, 0.12, 0.55);
}
/** Error: short low buzz. */
export function buzz() {
  tone(140, 0, 0.18, "square", 0.05);
}
/** Key press tick. */
export function tick() {
  tone(1800, 0, 0.04, "triangle", 0.03);
}
