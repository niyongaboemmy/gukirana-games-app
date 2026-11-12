"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { ArrowRight, Shirt } from "lucide-react";
import { AVATAR_COLORS, useProfile } from "@/lib/profile-store";
import { BODY_TYPES, HAIR_STYLES, itemById } from "@/world/outfits";

// Lazy: keeps three.js out of the 2D lobby's first paint (DESIGN-SPEC §16.2, ≤ 200 KB shell).
const AvatarCreator = dynamic(() => import("./AvatarCreator").then((m) => m.AvatarCreator), { ssr: false });

/** Quick avatar setup (DESIGN-SPEC §10.1 step 3). Phone OTP + passkeys arrive with P0-AUTH. */
export function Onboarding({ onDone }: { onDone?: () => void }) {
  const profile = useProfile();
  const [name, setName] = useState(profile.name);
  const [color, setColor] = useState(profile.color);
  const [styling, setStyling] = useState(false);
  const valid = name.trim().length >= 2;
  const summary = [
    BODY_TYPES.find((b) => b.id === profile.bodyType)?.label,
    HAIR_STYLES.find((h) => h.id === profile.hairStyle)?.label,
    itemById(profile.outfit?.top ?? "")?.label,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        profile.setProfile({ name: name.trim().slice(0, 16), color });
        onDone?.();
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-white/80">Choose a username</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.replace(/[^\p{L}\p{N}_ .-]/gu, ""))}
          maxLength={16}
          placeholder="e.g. Aline_K"
          className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-lg font-semibold outline-none focus:border-[#3DA9FC]"
        />
      </label>
      <div>
        <p className="mb-2 text-sm font-semibold text-white/80">Accent colour</p>
        <div className="flex flex-wrap gap-2">
          {AVATAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
              className={`size-10 rounded-full border-2 transition ${color === c ? "scale-110 border-white ring-4 ring-white/30" : "border-white/20"}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setStyling(true)}
        className="flex items-center gap-3 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-left hover:bg-white/10"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full" style={{ background: color }}>
          <Shirt size={20} strokeWidth={1.85} />
        </span>
        <span className="min-w-0">
          <span className="block font-bold">Style your avatar</span>
          <span className="block truncate text-xs text-white/60">{summary || "Body, skin, hair and outfit"}</span>
        </span>
      </button>
      <button disabled={!valid} className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#3DA9FC] to-[#2F80ED] py-3 text-lg font-extrabold shadow-lg disabled:opacity-40">
        Let&apos;s play <ArrowRight size={20} strokeWidth={2} />
      </button>
      {styling && (
        <AvatarCreator
          onClose={() => setStyling(false)}
          onSaved={(l) => setColor(l.accent)}
        />
      )}
    </form>
  );
}
