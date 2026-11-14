"use client";
import { Gauge, Hand, Info, Palette, SlidersHorizontal, Target, Volume2, Bot } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Modal } from "./GameShell";
import { useGamePrefs, type AiLevel, type AimGuide, type AnimSpeed, type GamePrefsData } from "./feedback";
import { t, type GameKey } from "./i18n";
import type { GameId } from "./GameShell";

type BoolKey = { [K in keyof GamePrefsData]: GamePrefsData[K] extends boolean ? K : never }[keyof GamePrefsData];

/** A paper switch row bound to one boolean game preference. */
export function PrefSwitch({ k, label }: { k: BoolKey; label: GameKey }) {
  const on = useGamePrefs((s) => s[k]);
  const set = useGamePrefs((s) => s.set);
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => set({ [k]: !on })} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-control text-left text-sm font-semibold">
      <span>{t(label)}</span>
      <span aria-hidden className="pswitch shrink-0" aria-checked={on} />
    </button>
  );
}

function Segments<V extends string | number>({ label, value, options, onChange }: { label: GameKey; value: V; options: { v: V; k: GameKey }[]; onChange: (v: V) => void }) {
  return (
    <div role="group" aria-label={t(label)} className="pseg">
      {options.map((o) => (
        <button key={String(o.v)} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)} className="!min-h-10 !px-1 !text-sm">
          {t(o.k)}
        </button>
      ))}
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: GameKey; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <p className="plabel flex items-center gap-1.5">
        <Icon size={14} className="text-gold" /> {t(title)}
      </p>
      {children}
    </section>
  );
}

/**
 * Per-device game settings (presentation + practice). In a live match the AI and aim-guide rows are hidden: nothing
 * here changes rules, timers or what the other player can do.
 */
export function GameSettings({ game, live, onClose }: { game: GameId; live: boolean; onClose: () => void }) {
  const p = useGamePrefs();
  return (
    <Modal onClose={onClose} label={t("settings.title")} title={t("settings.title")} icon={SlidersHorizontal}>
      <div className="flex flex-col gap-4">
        <Section icon={Gauge} title="settings.speed">
          <Segments<AnimSpeed>
            label="settings.speed"
            value={p.speed}
            onChange={(speed) => p.set({ speed, skipAnim: false })}
            options={[
              { v: "relaxed", k: "settings.relaxed" },
              { v: "normal", k: "settings.normal" },
              { v: "fast", k: "settings.fast" },
            ]}
          />
          <PrefSwitch k="skipAnim" label="settings.skip" />
        </Section>

        {!live && (
          <Section icon={Bot} title="settings.ai">
            <Segments<AiLevel>
              label="settings.ai"
              value={p.aiLevel}
              onChange={(aiLevel) => p.set({ aiLevel })}
              options={[
                { v: 1, k: "game.easy" },
                { v: 2, k: "game.medium" },
                { v: 3, k: "game.hard" },
                { v: 5, k: "game.expert" },
              ]}
            />
          </Section>
        )}

        <Section icon={Hand} title="settings.play">
          {game !== "pool" && <PrefSwitch k="autoMove" label="game.autoMove" />}
          {game !== "pool" && <PrefSwitch k="confirmMove" label="settings.confirm" />}
          <PrefSwitch k="hints" label="settings.hints" />
        </Section>

        {game === "pool" && !live && (
          <Section icon={Target} title="settings.aimGuide">
            <Segments<AimGuide>
              label="settings.aimGuide"
              value={p.aimGuide}
              onChange={(aimGuide) => p.set({ aimGuide })}
              options={[
                { v: "short", k: "settings.short" },
                { v: "medium", k: "settings.medium" },
                { v: "long", k: "settings.long" },
              ]}
            />
          </Section>
        )}

        <Section icon={Volume2} title="settings.feedback">
          <PrefSwitch k="sound" label="game.sound" />
          <PrefSwitch k="haptics" label="game.haptics" />
        </Section>

        <Section icon={Palette} title="settings.layout">
          <PrefSwitch k="leftHanded" label="settings.leftHanded" />
          <PrefSwitch k="colorBlind" label="settings.colorBlind" />
        </Section>

        <p className="pnote !text-xs">
          <Info size={14} className="mt-0.5 shrink-0" /> {t(live ? "settings.liveNote" : "settings.practiceNote")}
        </p>
        <button type="button" data-autofocus onClick={onClose} className="btn-primary min-h-12 w-full rounded-control font-bold">
          {t("game.gotIt")}
        </button>
      </div>
    </Modal>
  );
}
