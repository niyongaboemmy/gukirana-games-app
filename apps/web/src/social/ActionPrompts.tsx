"use client";
import { Check, Coffee, Loader2, PersonStanding, X } from "lucide-react";
import { useWorld } from "@/lib/world-store";
import { respondPair } from "@/lib/realtime";
import { EMOTE_PICKER, PAIR_ACTIONS } from "./actions";
import { doAction, goToSpot, people, SPOTS } from "./people";
import { useSocial } from "./social-store";

/**
 * Small action UI for people (keeps the phone HUD light): the emote picker grid, the accept prompt for a contact
 * action someone asks you for, the "waiting for …" chip, and the context prompt at a lamp post / the café.
 * UI strings to move to @gukirana/i18n keys `people.*`.
 */
const glass = "glass rounded-card";

/**
 * Emote picker grid (opened from the HUD Emote button). `w-max` + fixed 4 auto columns: the desktop popover is
 * absolutely positioned inside the 64 px Emote button wrapper, so without an intrinsic width the 4 × 1fr columns
 * collapsed to a few px and the 44 px tiles overlapped (the "stacked / smeared icons" bug).
 */
export function EmotePicker({ onPick, bare = false }: { onPick?: () => void; bare?: boolean }) {
  return (
    <div className={`pointer-events-auto grid w-max grid-cols-[repeat(4,auto)] gap-1.5 ${bare ? "" : "menu p-2"}`} role="menu" aria-label="Emotes">
      {EMOTE_PICKER.map((a) => (
        <button
          key={a.id}
          type="button"
          role="menuitem"
          onClick={() => {
            doAction(a.id);
            onPick?.();
          }}
          className={`tile grid ${bare ? "size-10" : "size-11"} place-items-center rounded-control`}
          aria-label={a.label}
          title={a.label}
        >
          <a.icon size={20} strokeWidth={1.85} />
        </button>
      ))}
    </div>
  );
}

/** "Aline wants to shake hands" — Accept / Not now (contact actions always need consent). */
export function PairInvitePrompt() {
  const inv = useSocial((s) => s.pairInvite);
  if (!inv) return null;
  const def = PAIR_ACTIONS.find((p) => p.kind === inv.kind);
  const Icon = def?.icon ?? Check;
  return (
    <div role="alertdialog" aria-label={`${inv.from.name} wants to ${def?.verb ?? "greet you"}`} className={`${glass} pointer-events-auto flex w-[min(360px,92vw)] items-center gap-3 p-2.5`}>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/30 text-primary-300">
        <Icon size={19} />
      </span>
      <p className="min-w-0 flex-1 truncate text-sm font-bold">
        {inv.from.name} wants to {def?.verb ?? "greet you"}
      </p>
      <button type="button" onClick={() => respondPair(inv.id, false)} aria-label="Not now" className="btn-secondary grid size-10 place-items-center rounded-full">
        <X size={18} />
      </button>
      <button type="button" onClick={() => respondPair(inv.id, true)} aria-label="Accept" className="btn-success grid size-10 place-items-center rounded-full">
        <Check size={19} />
      </button>
    </div>
  );
}

/** Waiting for the other person to accept. */
export function PairPendingChip() {
  const p = useSocial((s) => s.pairPending);
  const name = useWorld((s) => (p ? s.players[p.to]?.name : undefined));
  if (!p) return null;
  const def = PAIR_ACTIONS.find((x) => x.kind === p.kind);
  return (
    <div className={`${glass} pointer-events-auto flex items-center gap-2 px-3 py-1.5 text-xs font-semibold`} role="status">
      <Loader2 size={14} className="animate-spin text-accent" /> Waiting for {name ?? "them"} ({def?.label ?? ""})
      <button type="button" onClick={() => useSocial.setState({ pairPending: null })} aria-label="Hide" className="btn-secondary ml-1 grid size-6 place-items-center rounded-full">
        <X size={12} />
      </button>
    </div>
  );
}

/** At a lamp post or the café glass: "Lean here"; at the café window: "Coffee". */
export function SpotPrompt() {
  const idx = useSocial((s) => s.nearSpot);
  const busy = useWorld((s) => !!s.emote && s.emote.until > Date.now());
  const spot = idx != null ? SPOTS[idx] : undefined;
  if (!spot || busy || people.move) return null;
  const coffee = spot.kind === "coffee";
  return (
    <button type="button" onClick={() => goToSpot(spot)} className={`${glass} press pointer-events-auto flex items-center gap-2 px-3 py-1.5 text-sm font-bold`}>
      {coffee ? <Coffee size={16} /> : <PersonStanding size={16} />} {coffee ? "Get a coffee" : "Lean here"}
    </button>
  );
}
