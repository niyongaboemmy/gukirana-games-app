"use client";
import { Gamepad2, Gauge, Hand, Keyboard, SlidersHorizontal, Volume2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Modal } from "@/games/GameShell";
import { useFightPrefs, type ButtonSize, type FightPrefsData, type TrainingSpeed } from "./prefs";
import { ft, type FgKey } from "./strings";

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

/** Boxing settings (plan §2.9): device-only, never changes the rules; training speed shows in practice only */
export function FightSettings({ live, onClose }: { live: boolean; onClose: () => void }) {
  const p = useFightPrefs();
  return (
    <Modal onClose={onClose} label={ft("settings.title")} title={ft("settings.title")} icon={SlidersHorizontal}>
      <div className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto">
        <Section icon={Volume2} title="settings.feedback">
          <Switch k="sound" label="settings.sound" />
          <Switch k="vibration" label="settings.vibration" />
          <Switch k="reducedMotion" label="settings.reducedMotion" />
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
          <p className="text-xs text-[var(--muted)]">{ft("settings.keys")}</p>
          <p className="flex items-start gap-1.5 text-xs text-[var(--muted)]">
            <Gamepad2 size={14} className="mt-0.5 shrink-0" /> {ft("settings.pad")}
          </p>
        </Section>
        <button type="button" className="pbtn pbtn-primary" onClick={onClose}>
          {ft("settings.done")}
        </button>
      </div>
    </Modal>
  );
}
