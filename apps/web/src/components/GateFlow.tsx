"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BatteryFull, Check, Delete, Glasses, KeyRound, Loader2, ShieldCheck, Shirt, Signal, SkipForward, UserRound, Wifi } from "lucide-react";
import { useGate, USERNAME_RE } from "@/world/gate/gate-store";
import { lookOf, useProfile } from "@/lib/profile-store";
import { BODY_TYPE_HINT, BODY_TYPES } from "@/world/outfits";
import { Joystick } from "@/hud/Joystick";
import { xrStore } from "@/world/WorldCanvas";

const AvatarCreator = dynamic(() => import("./AvatarCreator").then((m) => m.AvatarCreator), { ssr: false });

/** Live clock for the tablet status bar. */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" });
}

/**
 * Handheld check-in tablet (screens; VR uses the world keyboard). It slides up into the player's hands with a 3D
 * tilt, sways slightly as if held, and each screen slides in. Realistic device chrome: aluminium bezel, camera,
 * status bar with Kigali time, signal and battery.
 */
let tabletShown = false; // the tablet slides into the hands once; later screens only swap content

function Card({ children, label, busy = false }: { children: React.ReactNode; label: string; busy?: boolean }) {
  const time = useClock();
  const [first] = useState(() => !tabletShown);
  useEffect(() => {
    tabletShown = true;
  }, []);
  return (
    <div className="gk-tablet-hold pointer-events-auto [perspective:1400px]">
      <section
        aria-label={label}
        className={`${first ? "gk-tablet-in" : "[transform:rotateX(8deg)_rotateZ(-2deg)]"} relative w-[min(400px,48vw)] rounded-[34px] bg-gradient-to-b from-[#d9dde5] via-[#9aa1ad] to-[#6d7380] p-[7px] shadow-[0_40px_80px_-20px_rgba(0,0,0,.75),0_0_0_1px_rgba(255,255,255,.35)_inset] max-sm:w-[min(360px,56vw)] [@media(max-height:430px)]:w-[min(340px,44vw)] phone:w-[min(290px,34vw)]! phone:rounded-[26px]! phone:p-[5px]!`}
      >
        <div className="relative overflow-hidden rounded-[28px] bg-[#0b0d1a] ring-1 ring-black phone:rounded-[21px]!" aria-busy={busy}>
          {busy && <div className="gk-progress absolute inset-x-0 top-0 h-[3px] bg-[#3DA9FC]" role="progressbar" aria-label="Loading" />}
          {/* status bar */}
          <div className="flex items-center justify-between px-5 pb-1 pt-2 text-[11px] font-semibold text-white/85 phone:px-3.5! phone:pt-1.5! phone:text-[10px]!">
            <span className="tabular-nums">{time}</span>
            <span className="absolute left-1/2 top-2 size-2 -translate-x-1/2 rounded-full bg-[#1d2233] ring-1 ring-white/10" aria-hidden />
            <span className="flex items-center gap-1.5">
              <Signal size={12} strokeWidth={2.2} />
              <Wifi size={12} strokeWidth={2.2} />
              <BatteryFull size={15} strokeWidth={2} />
            </span>
          </div>
          {/* screen content */}
          <div key={label} className="gk-screen-in px-5 pb-5 pt-2 text-white max-sm:px-4 [@media(max-height:430px)]:pb-3.5 phone:px-3! phone:pb-2.5! phone:pt-1! phone:text-sm!">
            {children}
          </div>
          {/* glass glare */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,.10)_0%,rgba(255,255,255,0)_38%,rgba(255,255,255,0)_70%,rgba(255,255,255,.05)_100%)]" />
        </div>
      </section>
    </div>
  );
}

/** On-screen numeric keypad (tablet feel); the real input stays focusable for keyboards / autofill / a11y. */
function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const press = (k: string) => {
    if (navigator.vibrate) navigator.vibrate(8);
    if (k === "del") onChange(value.slice(0, -1));
    else if (value.length < 6) onChange(value + k);
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  return (
    <div className="grid grid-cols-3 gap-1.5 [@media(max-height:430px)]:gap-1">
      {keys.map((k, i) =>
        k === "" ? (
          <span key={i} />
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => press(k)}
            aria-label={k === "del" ? "Delete digit" : `Digit ${k}`}
            className="grid h-11 place-items-center rounded-2xl bg-white/[.08] text-xl font-semibold transition active:scale-95 active:bg-white/20 [@media(max-height:430px)]:h-8 [@media(max-height:430px)]:text-base phone:h-7! phone:rounded-xl!"
          >
            {k === "del" ? <Delete size={20} strokeWidth={1.85} /> : k}
          </button>
        ),
      )}
    </div>
  );
}

/** Six code boxes mirroring the hidden input. */
function CodeBoxes({ code, onFocus }: { code: string; onFocus: () => void }) {
  return (
    <button type="button" onClick={onFocus} className="grid grid-cols-6 gap-1.5 phone:gap-1!" aria-hidden tabIndex={-1}>
      {Array.from({ length: 6 }, (_, i) => (
        <span
          key={i}
          className={`grid h-12 place-items-center rounded-xl border text-2xl font-bold tabular-nums transition [@media(max-height:430px)]:h-9 [@media(max-height:430px)]:text-lg phone:h-8! phone:rounded-lg! phone:text-base! ${
            i === code.length ? "border-[#3DA9FC] bg-[#3DA9FC]/10" : code[i] ? "border-white/30 bg-white/10" : "border-white/15 bg-white/5"
          }`}
        >
          {code[i] ?? ""}
        </span>
      ))}
    </button>
  );
}

const input =
  "w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-lg font-semibold outline-none placeholder:text-white/35 focus:border-[#3DA9FC] [@media(max-height:430px)]:py-2 [@media(max-height:430px)]:text-base phone:px-3! phone:py-1.5! phone:text-sm!";
const primary =
  "flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#3DA9FC] to-[#2F80ED] py-3 text-base font-extrabold shadow-lg disabled:opacity-40 [@media(max-height:430px)]:py-2 phone:py-1.5! phone:text-sm!";

/** Keeps a loading state visible for at least `min` ms so fast responses don't just flicker. */
function useVisibleBusy(busy: boolean, min = 550) {
  const [show, setShow] = useState(false);
  const since = useRef(0);
  useEffect(() => {
    if (busy) {
      since.current = Date.now();
      setShow(true);
      return;
    }
    const left = min - (Date.now() - since.current);
    if (left <= 0) return setShow(false);
    const t = setTimeout(() => setShow(false), left);
    return () => clearTimeout(t);
  }, [busy, min]);
  return show;
}

export function GateFlow() {
  const g = useGate();
  const busyShown = useVisibleBusy(g.busy);
  const profile = useProfile();
  const [styling, setStyling] = useState(false);
  const [vr, setVr] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void navigator.xr?.isSessionSupported("immersive-vr").then(setVr).catch(() => setVr(false));
  }, []);
  useEffect(() => {
    if (g.step === "id" || g.step === "code" || g.step === "setup") setTimeout(() => ref.current?.focus(), 50);
  }, [g.step]);

  if (g.inXR) return null;
  const busyIcon = <Loader2 size={18} className="animate-spin" />;

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-end p-[max(12px,env(safe-area-inset-right))] pr-[max(16px,env(safe-area-inset-right))] text-white">
      <div className="absolute left-[max(12px,env(safe-area-inset-left))] top-3 flex items-center gap-2 rounded-full bg-[#22266E]/60 px-4 py-1.5 text-sm font-semibold backdrop-blur-md">
        <ShieldCheck size={16} strokeWidth={1.85} className="text-[#7CC4FF]" /> Gukirana Playground · Entrance
      </div>
      {busyShown && (
        <div role="status" aria-live="polite" className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#3DA9FC]/50 bg-[#0f1222]/85 px-4 py-2 text-sm font-bold shadow-xl backdrop-blur-md">
          <Loader2 size={16} className="animate-spin text-[#7CC4FF]" />
          {g.step === "id" || (g.step === "code" && !g.code) ? "Sending your code…" : g.step === "code" ? "Checking your code…" : g.step === "opening" ? "Verified · opening the gate…" : "Saving your player…"}
        </div>
      )}
      {(g.step === "id" || g.step === "code") && (
        <>
          <div className="pointer-events-auto absolute bottom-[max(14px,env(safe-area-inset-bottom))] left-[max(14px,env(safe-area-inset-left))]">
            <Joystick />
          </div>
          <p className="absolute bottom-3 left-1/2 hidden -translate-x-1/2 text-xs text-white/75 [@media(pointer:fine)]:block">
            Keep walking while you sign in: W/S walk · A/D turn · click the ground to walk there · drag to look
          </p>
        </>
      )}
      {vr && (g.step === "id" || g.step === "arrive") && (
        <button
          type="button"
          onClick={() => void xrStore.enterVR()}
          className="pointer-events-auto absolute right-[max(12px,env(safe-area-inset-right))] top-3 flex items-center gap-2 rounded-2xl border border-white/30 bg-[#9B51E0]/80 px-3 py-2 text-sm font-bold backdrop-blur-md"
        >
          <Glasses size={18} strokeWidth={1.85} /> Enter in VR
        </button>
      )}

      {g.step === "arrive" && (
        <button
          type="button"
          onClick={() => g.set({ step: "id" })}
          className="pointer-events-auto absolute bottom-6 right-6 flex items-center gap-2 rounded-full border border-white/30 bg-white/15 px-4 py-2 text-sm font-bold backdrop-blur-xl"
        >
          <SkipForward size={16} strokeWidth={1.85} /> Skip intro
        </button>
      )}

      {g.step === "id" && (
        <Card label="Show your ID" busy={busyShown}>
          <form
            className="flex flex-col gap-3 phone:gap-2!"
            onSubmit={(e) => {
              e.preventDefault();
              void g.submitId();
            }}
          >
            <div className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-full bg-[#3DA9FC]/25 text-[#7CC4FF] phone:size-7!">
                <UserRound size={18} strokeWidth={1.85} />
              </span>
              <h1 className="text-xl font-extrabold phone:text-base!">Show your ID</h1>
            </div>
            <p className="text-sm text-white/70 [@media(max-height:430px)]:hidden">Enter your phone number or email. We&apos;ll send a one-time code.</p>
            <label className="sr-only" htmlFor="gate-id">
              Phone number or email
            </label>
            <input
              id="gate-id"
              ref={ref}
              value={g.identifier}
              onChange={(e) => g.set({ identifier: e.target.value, error: null })}
              placeholder="0788 123 456 or you@mail.com"
              autoComplete="username"
              inputMode="email"
              maxLength={64}
              className={input}
              aria-invalid={!!g.error}
              aria-describedby={g.error ? "gate-err" : undefined}
            />
            {g.error && (
              <p id="gate-err" role="alert" className="text-sm text-[#ff9b9b]">
                {g.error}
              </p>
            )}
            <button className={primary} disabled={g.busy || !g.identifier.trim()}>
              {g.busy ? busyIcon : <ArrowRight size={18} strokeWidth={2} />} Send code
            </button>
          </form>
        </Card>
      )}

      {g.step === "code" && (
        <Card label="Enter your code" busy={busyShown}>
          <form
            className="flex flex-col gap-3 phone:gap-2!"
            onSubmit={(e) => {
              e.preventDefault();
              void g.submitCode();
            }}
          >
            <div className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-full bg-[#3DA9FC]/25 text-[#7CC4FF] phone:size-7!">
                <KeyRound size={18} strokeWidth={1.85} />
              </span>
              <h1 className="text-xl font-extrabold phone:text-base!">Enter your code</h1>
            </div>
            <p className="text-sm text-white/70">
              Sent to <b className="text-white">{g.identifier}</b>
            </p>
            {g.devCode && (
              <button type="button" onClick={() => {
                  g.set({ code: g.devCode ?? "" });
                  setTimeout(() => void useGate.getState().submitCode(), 120);
                }} className="w-fit rounded-lg bg-[#7CC4FF]/15 px-2 py-1 text-xs font-bold text-[#7CC4FF]">
                Dev code: {g.devCode} (tap to fill)
              </button>
            )}
            <label className="sr-only" htmlFor="gate-code">
              6-digit code
            </label>
            <input
              id="gate-code"
              ref={ref}
              value={g.code}
              onChange={(e) => {
                const code = e.target.value.replace(/\D/g, "").slice(0, 6);
                g.set({ code, error: null });
                if (code.length === 6) setTimeout(() => void useGate.getState().submitCode(), 120);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              className="absolute size-px opacity-0"
              aria-invalid={!!g.error}
              aria-describedby={g.error ? "gate-err" : undefined}
            />
            <CodeBoxes code={g.code} onFocus={() => ref.current?.focus()} />
            <Keypad
              value={g.code}
              onChange={(code) => {
                g.set({ code, error: null });
                if (code.length === 6) setTimeout(() => void useGate.getState().submitCode(), 160);
              }}
            />
            {g.error && (
              <p id="gate-err" role="alert" className="text-sm text-[#ff9b9b]">
                {g.error}
              </p>
            )}
            <button className={primary} disabled={g.busy || g.code.length !== 6}>
              {g.busy ? busyIcon : <Check size={18} strokeWidth={2} />} Verify
            </button>
            <button type="button" onClick={g.back} className="flex items-center gap-1 text-sm font-semibold text-white/65 hover:text-white">
              <ArrowLeft size={15} strokeWidth={1.85} /> Use a different number or email
            </button>
          </form>
        </Card>
      )}

      {g.step === "opening" && (
        <div role="status" className="absolute bottom-[18%] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#27AE60]/60 bg-[#0f3a26]/80 px-5 py-2.5 text-lg font-bold backdrop-blur-xl">
          <ShieldCheck size={22} strokeWidth={1.85} className="text-[#6fe39b]" /> Access granted. Welcome!
        </div>
      )}

      {g.step === "setup" && (
        <Card label="Set up your player" busy={busyShown}>
          <form
            className="flex flex-col gap-3 phone:gap-2!"
            onSubmit={(e) => {
              e.preventDefault();
              void g.finishSetup(lookOf(useProfile.getState()));
            }}
          >
            <h1 className="text-xl font-extrabold phone:text-base!">Welcome to the wardrobe</h1>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-white/80">Username</span>
              <input
                ref={ref}
                value={g.username}
                onChange={(e) => g.set({ username: e.target.value.replace(/[^\p{L}\p{N}_.-]/gu, "").slice(0, 16), error: null })}
                placeholder="e.g. Aline_K"
                className={input}
                aria-invalid={!!g.error}
              />
            </label>
            <fieldset>
              <legend className="mb-1 text-sm font-semibold text-white/80">Body style (your choice)</legend>
              <div className="grid grid-cols-3 gap-1.5">
                {BODY_TYPES.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    title={BODY_TYPE_HINT[b.id]}
                    aria-pressed={profile.bodyType === b.id}
                    onClick={() => profile.setBodyType(b.id)}
                    className={`rounded-lg border px-2 py-2 text-sm font-bold ${profile.bodyType === b.id ? "border-[#3DA9FC] bg-[#3DA9FC]/20" : "border-white/15 bg-white/5"}`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <button type="button" onClick={() => setStyling(true)} className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-sm font-bold hover:bg-white/10">
              <Shirt size={18} strokeWidth={1.85} /> Skin, hair &amp; outfit
              <ArrowRight size={15} className="ml-auto" />
            </button>
            {g.error && (
              <p role="alert" className="text-sm text-[#ff9b9b]">
                {g.error}
              </p>
            )}
            <button className={primary} disabled={g.busy || !USERNAME_RE.test(g.username)}>
              {g.busy ? busyIcon : <ArrowRight size={18} strokeWidth={2} />} Enter the playground
            </button>
          </form>
        </Card>
      )}

      {g.step === "entering" && (
        // never cover the player: a small status pill while they keep walking into the playground
        <div role="status" className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/25 bg-[#0f1222]/80 px-4 py-2 text-sm font-bold shadow-xl backdrop-blur-md">
          <Loader2 size={16} className="animate-spin text-[#7CC4FF]" /> Entering the playground…
        </div>
      )}
      {styling && (
        <div className="pointer-events-auto">
          <AvatarCreator onClose={() => setStyling(false)} />
        </div>
      )}
      <style>{`@keyframes fadein { 0% { opacity: 0 } 40% { opacity: 0 } 100% { opacity: 1 } }`}</style>
    </div>
  );
}
