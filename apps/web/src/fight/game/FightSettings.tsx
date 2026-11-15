"use client";
import { useEffect, useState } from "react";
import { Gamepad2, Gauge, GraduationCap, Hand, Keyboard, RotateCcw, SlidersHorizontal, Smartphone, Volume2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Modal } from "@/games/GameShell";
import { useFightPrefs, type ButtonSize, type FightPrefsData, type TrainingSpeed } from "./prefs";
import { actionKey, ft, type FgKey } from "./strings";
import { BIND_ACTIONS, boundKey, keyLabel, rebind, RESERVED_KEYS, type BindAction } from "./input-map";

type BoolKey = { [K in keyof FightPrefsData]: FightPrefsData[K] extends boolean ? K : never }[keyof FightPrefsData];

function Switch({ k, label }: { k: BoolKey; label: FgKey }) {
  const on = useFightPrefs((s) => s[k]);
  const set = useFightPrefs((s) => s.set);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => set({ [k]: !on })}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-control text-left text-sm font-semibold"
    >
      <span>{ft(label)}</span>
      <span aria-hidden className="pswitch shrink-0" aria-checked={on} />
    </button>
  );
}

function Segments<V extends string>({ label, value, options, onChange }: { label: FgKey; value: V; options: { v: V; k: FgKey }[]; onChange: (v: V) => void }) {
  return (
    <div role="group" aria-label={ft(label)} className="pseg">
      {options.map((o) => (
        <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)} className="!min-h-10 !px-1 !text-sm">
          {ft(o.k)}
        </button>
      ))}
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: FgKey; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <p className="plabel flex items-center gap-1.5">
        <Icon size={14} className="text-gold" /> {ft(title)}
      </p>
      {children}
    </section>
  );
}

/** rebindable keys: tap an action, press the new key (Escape cancels); a key never does two things */
function KeyBinder() {
  const keys = useFightPrefs((s) => s.keys);
  const set = useFightPrefs((s) => s.set);
  const [wait, setWait] = useState<BindAction | null>(null);
  useEffect(() => {
    if (!wait) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape" && !RESERVED_KEYS.has(e.code)) set({ keys: rebind(useFightPrefs.getState().keys, wait, e.code) });
      setWait(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [wait, set]);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold">{ft("settings.rebind")}</p>
      <div className="grid grid-cols-2 gap-1.5 phone:grid-cols-3">
        {BIND_ACTIONS.map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={wait === a}
            onClick={() => setWait(wait === a ? null : a)}
            className={`pbtn ${wait === a ? "pbtn-primary" : "pbtn-secondary"} !min-h-9 !justify-between !px-2.5 !py-1 !text-xs`}
          >
            <span>{ft(actionKey(a))}</span>
            <span className="kbd px-1.5 text-[11px]">{wait === a ? ft("settings.pressKey") : keyLabel(boundKey(keys, a))}</span>
          </button>
        ))}
      </div>
      <button type="button" className="pbtn pbtn-secondary !min-h-9 !text-xs" onClick={() => set({ keys: {} })}>
        <RotateCcw size={14} /> {ft("settings.resetKeys")}
      </button>
    </div>
  );
}

/** Boxing settings (plan §2.9): device-only, never changes the rules; training speed shows in practice only */
export function FightSettings({ live, onClose }: { live: boolean; onClose: () => void }) {
  const p = useFightPrefs();
  return (
    <Modal onClose={onClose} label={ft("settings.title")} title={ft("settings.title")} icon={SlidersHorizontal}>
      <div className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto">
        <Section icon={Volume2} title="settings.feedback">
          <Switch k="sound" label="settings.sound" />
          <Switch k="vibration" label="settings.vibration" />
          <Switch k="voice" label="settings.voice" />
          <Switch k="crowd" label="settings.crowd" />
          <Switch k="reducedMotion" label="settings.reducedMotion" />
          <Switch k="coach" label="settings.coach" />
        </Section>
        <Section icon={Hand} title="settings.layout">
          <Segments<ButtonSize>
            label="settings.buttonSize"
            value={p.buttonSize}
            onChange={(buttonSize) => p.set({ buttonSize })}
            options={[
              { v: "s", k: "settings.size.s" },
              { v: "m", k: "settings.size.m" },
              { v: "l", k: "settings.size.l" },
            ]}
          />
          <Switch k="guardToggle" label="settings.guardToggle" />
          <Switch k="leftHanded" label="settings.leftHanded" />
        </Section>
        {!live && (
          <Section icon={Gauge} title="settings.speed">
            <Segments<TrainingSpeed>
              label="settings.speed"
              value={p.speed}
              onChange={(speed) => p.set({ speed })}
              options={[
                { v: "slow", k: "settings.speed.slow" },
                { v: "normal", k: "settings.speed.normal" },
              ]}
            />
            <p className="pnote text-xs">{ft("settings.speedNote")}</p>
          </Section>
        )}
        <Section icon={Keyboard} title="settings.controls">
          <KeyBinder />
          <p className="text-xs text-[var(--muted)]">{ft("settings.keys")}</p>
          <p className="flex items-start gap-1.5 text-xs text-[var(--muted)]">
            <Gamepad2 size={14} className="mt-0.5 shrink-0" /> {ft("settings.pad")}
          </p>
          <p className="flex items-start gap-1.5 text-xs text-[var(--muted)]">
            <Smartphone size={14} className="mt-0.5 shrink-0" /> {ft("settings.touch")}
          </p>
          <button type="button" className="pbtn pbtn-secondary !min-h-9 !text-xs" onClick={() => p.set({ tutorialDone: false })}>
            <GraduationCap size={14} /> {ft("settings.tutorial")}
          </button>
        </Section>
        <button type="button" className="pbtn pbtn-primary" onClick={onClose}>
          {ft("settings.done")}
        </button>
      </div>
    </Modal>
  );
}
