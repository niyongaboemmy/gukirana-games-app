"use client";
import { useState } from "react";
import { AVATAR_COLORS, useProfile } from "@/lib/profile-store";

/** Quick avatar setup (DESIGN-SPEC §10.1 step 3). Phone OTP + passkeys arrive with P0-AUTH. */
export function Onboarding({ onDone }: { onDone?: () => void }) {
  const profile = useProfile();
  const [name, setName] = useState(profile.name);
  const [color, setColor] = useState(profile.color);
  const valid = name.trim().length >= 2;
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
        <p className="mb-2 text-sm font-semibold text-white/80">Hoodie colour</p>
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
      <button disabled={!valid} className="rounded-xl bg-gradient-to-r from-[#3DA9FC] to-[#2F80ED] py-3 text-lg font-extrabold shadow-lg disabled:opacity-40">
        Let&apos;s play →
      </button>
    </form>
  );
}
