"use client";
import { updateMe, useSession } from "@/lib/session";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Footprints, Glasses, Hand, Palette, Scissors, Shirt, Sparkles, UserRound, X, type LucideIcon } from "lucide-react";
import { AVATAR_COLORS, lookOf, useProfile } from "@/lib/profile-store";
import {
  BODY_TYPE_HINT,
  BODY_TYPES,
  HAIR_COLORS,
  HAIR_STYLES,
  itemsFor,
  SKIN_TONES,
  type AvatarLook,
  type OutfitItem,
  type Slot,
  encodeLook,
} from "@/world/outfits";
import { fabricTexture } from "@/world/textures";

const AvatarPreview = dynamic(() => import("./AvatarPreview"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-white/50">Loading preview…</div>,
});

/** UI strings (to move to @gukirana/i18n keys `avatar.*` when the catalogue is localised). */
const STR = {
  title: "Style your avatar",
  bodyNote: "You choose your body style. We never guess it from your name or number.",
  showAll: "Show all items",
  suggested: "Suggested",
  save: "Save look",
  cancel: "Cancel",
  wave: "Wave",
  accent: "Accent colour",
  hairColour: "Hair colour",
  headwear: "Headwear",
  accessory: "Accessory",
} as const;

type Tab = "body" | "skin" | "hair" | "top" | "bottom" | "shoes" | "extras";
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "body", label: "Body", icon: UserRound },
  { id: "skin", label: "Skin", icon: Palette },
  { id: "hair", label: "Hair", icon: Scissors },
  { id: "top", label: "Top", icon: Shirt },
  { id: "bottom", label: "Bottom", icon: Shirt },
  { id: "shoes", label: "Shoes", icon: Footprints },
  { id: "extras", label: "Extras", icon: Glasses },
];

function swatchStyle(item: OutfitItem, accent: string): React.CSSProperties {
  if (item.print) {
    const img = fabricTexture(item.print).image as HTMLCanvasElement;
    return { backgroundImage: `url(${img.toDataURL()})`, backgroundSize: "cover" };
  }
  const c = item.color === "accent" ? accent : item.color;
  const c2 = item.color2 === "accent" ? accent : item.color2;
  return { background: c2 ? `linear-gradient(135deg, ${c} 60%, ${c2} 60%)` : c };
}

function Chip({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={`relative flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
        active ? "border-[#3DA9FC] bg-[#3DA9FC]/20 text-white" : "border-white/15 bg-white/5 text-white/85 hover:bg-white/10"
      }`}
    >
      {children}
      {active && <Check size={14} strokeWidth={2.2} className="ml-auto text-[#3DA9FC]" />}
    </button>
  );
}

function ItemGrid({ slot, look, showAll, onPick }: { slot: Slot; look: AvatarLook; showAll: boolean; onPick: (id: string) => void }) {
  const current = look.outfit[slot];
  const list = itemsFor(slot, look.bodyType, showAll, current);
  return (
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
      {list.map(({ item, suggested }) => (
        <Chip key={item.id} active={current === item.id} onClick={() => onPick(item.id)}>
          {item.kind !== "none" && <span className="size-6 shrink-0 rounded-md border border-white/20" style={swatchStyle(item, look.accent)} />}
          <span className="min-w-0">
            <span className="block truncate">{item.label}</span>
            {showAll && suggested && (
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[#FFC83D]">
                <Sparkles size={10} strokeWidth={2} /> {STR.suggested}
              </span>
            )}
          </span>
        </Chip>
      ))}
    </div>
  );
}

function Swatches({ colors, value, onPick, round = true }: { colors: string[]; value: string; onPick: (c: string) => void; round?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Colour ${c}`}
          aria-pressed={value === c}
          onClick={() => onPick(c)}
          className={`size-10 border-2 transition ${round ? "rounded-full" : "rounded-xl"} ${value === c ? "scale-110 border-white ring-4 ring-white/25" : "border-white/20"}`}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

/**
 * Avatar creator (DESIGN-SPEC §7.2, §10.1 step 3): live 3D preview, body type, skin tone, hair, outfit pieces.
 * Body type is an explicit choice. Outfit lists show items suggested for the chosen body type; "Show all" lists
 * everything and anyone may wear anything.
 */
export function AvatarCreator({ onClose, onSaved }: { onClose: () => void; onSaved?: (look: AvatarLook) => void }) {
  const profile = useProfile();
  const [draft, setDraft] = useState<AvatarLook>(() => lookOf(profile));
  const [tab, setTab] = useState<Tab>("body");
  const [showAll, setShowAll] = useState(false);
  const [emote, setEmote] = useState(0);
  const set = (p: Partial<AvatarLook>) => setDraft((d) => ({ ...d, ...p }));
  const setItem = (slot: Slot, id: string) => setDraft((d) => ({ ...d, outfit: { ...d.outfit, [slot]: id } }));
  const garmentTab = tab === "top" || tab === "bottom" || tab === "shoes" || tab === "extras";
  const look = useMemo(() => draft, [draft]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  if (!mounted) return null;

  // portal: ancestors with backdrop-filter would otherwise trap `position: fixed`
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={STR.title} className="fixed inset-0 z-50 grid place-items-center bg-[#05060f]/75 p-2 backdrop-blur-md sm:p-4">
      <div className="grid h-full max-h-[720px] w-full max-w-5xl grid-rows-[minmax(0,38%)_minmax(0,1fr)] overflow-hidden rounded-3xl border border-white/15 bg-[#0f1222]/95 text-white shadow-2xl sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] sm:grid-rows-1 landscape:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] landscape:grid-rows-1">
        <div className="relative min-h-0 bg-[#141833]">
          <AvatarPreview look={look} emote={emote} />
          <button
            type="button"
            onClick={() => setEmote((e) => (e === 10 ? 11 : 10))}
            className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold backdrop-blur-xl"
          >
            <Hand size={14} strokeWidth={1.85} /> {STR.wave}
          </button>
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <h2 className="text-lg font-extrabold">{STR.title}</h2>
            <button type="button" onClick={onClose} aria-label={STR.cancel} className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/20">
              <X size={18} strokeWidth={1.85} />
            </button>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-b border-white/10 px-3 py-2" aria-label="Avatar sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold transition ${tab === t.id ? "bg-white text-[#12142b]" : "text-white/70 hover:bg-white/10"}`}
              >
                <t.icon size={15} strokeWidth={1.85} /> {t.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {garmentTab && (
              <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-semibold text-white/80">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="size-4 accent-[#3DA9FC]" />
                {STR.showAll}
              </label>
            )}
            {tab === "body" && (
              <>
                <p className="text-sm text-white/65">{STR.bodyNote}</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {BODY_TYPES.map((b) => (
                    <Chip key={b.id} active={draft.bodyType === b.id} onClick={() => set({ bodyType: b.id })}>
                      <span>
                        <span className="block">{b.label}</span>
                        <span className="block text-xs font-normal text-white/55">{BODY_TYPE_HINT[b.id]}</span>
                      </span>
                    </Chip>
                  ))}
                </div>
                <p className="pt-2 text-sm font-semibold text-white/80">{STR.accent}</p>
                <Swatches colors={AVATAR_COLORS} value={draft.accent} onPick={(accent) => set({ accent, topColor: undefined })} />
              </>
            )}
            {tab === "skin" && <Swatches colors={SKIN_TONES} value={draft.skinTone} onPick={(skinTone) => set({ skinTone })} />}
            {tab === "hair" && (
              <>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  {HAIR_STYLES.map((h) => (
                    <Chip key={h.id} active={draft.hairStyle === h.id} onClick={() => set({ hairStyle: h.id })}>
                      {h.label}
                    </Chip>
                  ))}
                </div>
                <p className="text-sm font-semibold text-white/80">{STR.hairColour}</p>
                <Swatches colors={HAIR_COLORS} value={draft.hairColor} onPick={(hairColor) => set({ hairColor })} />
              </>
            )}
            {(tab === "top" || tab === "bottom" || tab === "shoes") && <ItemGrid slot={tab} look={look} showAll={showAll} onPick={(id) => setItem(tab, id)} />}
            {tab === "extras" && (
              <>
                <p className="text-sm font-semibold text-white/80">{STR.headwear}</p>
                <ItemGrid slot="headwear" look={look} showAll={showAll} onPick={(id) => setItem("headwear", id)} />
                <p className="text-sm font-semibold text-white/80">{STR.accessory}</p>
                <ItemGrid slot="accessory" look={look} showAll={showAll} onPick={(id) => setItem("accessory", id)} />
              </>
            )}
          </div>
          <div className="flex gap-2 border-t border-white/10 p-3">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-white/20 py-2.5 font-bold text-white/80 hover:bg-white/5">
              {STR.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                profile.setLook(draft);
                // persist to the account so the look follows the player across devices
                if (useSession.getState().status === "authenticated") void updateMe({ look: encodeLook(draft), bodyType: draft.bodyType }).catch(() => undefined);
                onSaved?.(draft);
                onClose();
              }}
              className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#3DA9FC] to-[#2F80ED] py-2.5 font-extrabold shadow-lg"
            >
              <Check size={18} strokeWidth={2} /> {STR.save}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
