"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DoorOpen } from "lucide-react";
import { coins, quoteChallenge } from "@gukirana/money";
import { Onboarding } from "@/components/Onboarding";
import { levelForXp, useProfile } from "@/lib/profile-store";

const GAMES = [
  { id: "pool", name: "8-Ball Pool", emoji: "🎱", color: "#2F80ED", tag: "Aim · power · spin" },
  { id: "ludo", name: "Ludo", emoji: "🎲", color: "#FF8A1F", tag: "Fair dice · tactics" },
  { id: "igisoro", name: "Igisoro", emoji: "🌰", color: "#27AE60", tag: "Rwandan strategy" },
];

export default function Home() {
  const profile = useProfile();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const q = quoteChallenge(coins(100));

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#0b0d1a] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,#3DA9FC55,transparent_55%),radial-gradient(ellipse_at_90%_20%,#9B51E055,transparent_50%),radial-gradient(ellipse_at_50%_110%,#27AE6044,transparent_55%)]" />
      <div className="relative mx-auto flex min-h-dvh max-w-[1280px] flex-col gap-8 px-4 py-6 md:px-8">
        <header className="flex items-center justify-between">
          <p className="text-xl font-black tracking-tight">
            GUKIRANA <span className="text-[#FFC83D]">PLAYGROUND</span>
          </p>
          {hydrated && profile.onboarded && (
            <div className="flex items-center gap-2 text-sm font-bold">
              <span className="rounded-full bg-white/10 px-3 py-1.5">★ Lvl {levelForXp(profile.xp)}</span>
              <span className="rounded-full bg-[#7CC4FF]/20 px-3 py-1.5 tabular-nums">⭐ {profile.stars}</span>
            </div>
          )}
        </header>

        <section className="grid items-center gap-8 lg:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col gap-5">
            <h1 className="text-4xl font-black leading-[1.05] sm:text-6xl">
              Play. Meet.
              <br />
              <span className="bg-gradient-to-r from-[#FFC83D] via-[#FF8A1F] to-[#9B51E0] bg-clip-text text-transparent">Win.</span>
            </h1>
            <p className="max-w-xl text-base text-white/75 sm:text-lg">
              Walk into a 3D games world, meet real people, talk, agree on a game and sit at the table. Pool, Ludo and Rwanda&apos;s own Igisoro, on your phone, computer or VR headset.
            </p>
            {hydrated && (
              <div className="flex flex-wrap gap-3">
                {/* 3D entry goes through the arrival gate (ID check); signed-in players skip straight inside */}
                <Link href="/gate" className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#3DA9FC] to-[#9B51E0] px-6 py-4 text-lg font-extrabold shadow-[0_10px_40px_-10px_#3DA9FC] transition hover:scale-[1.02]">
                  <DoorOpen size={22} strokeWidth={1.85} /> Enter
                </Link>
                {profile.onboarded && (
                  <Link href="/play/ludo" className="rounded-2xl border border-white/20 bg-white/5 px-6 py-4 text-lg font-bold backdrop-blur hover:bg-white/10">
                    ⚡ Quick Play
                  </Link>
                )}
              </div>
            )}
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/5 p-6 shadow-2xl backdrop-blur-xl">
            {hydrated && (profile.onboarded ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-white/60">Welcome back</p>
                <div className="flex items-center gap-3">
                  <div className="grid size-14 place-items-center rounded-full text-2xl" style={{ background: profile.color }}>🙂</div>
                  <div>
                    <p className="text-2xl font-extrabold">{profile.name}</p>
                    <p className="text-sm text-[#FFC83D]">★ Level {levelForXp(profile.xp)} · {profile.xp} XP</p>
                  </div>
                </div>
                <details className="mt-2 text-sm text-white/70">
                  <summary className="cursor-pointer">Edit avatar</summary>
                  <div className="mt-3"><Onboarding /></div>
                </details>
              </div>
            ) : (
              <>
                <p className="mb-4 text-2xl font-extrabold">Muraho! 👋</p>
                <Onboarding />
              </>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-white/90">Games</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {GAMES.map((g) => (
              <li key={g.id}>
                <Link
                  href={profile.onboarded ? `/play/${g.id}` : "#"}
                  className="group relative flex aspect-[4/3] flex-col justify-between overflow-hidden rounded-3xl border-2 bg-white/5 p-4 backdrop-blur transition hover:-translate-y-1"
                  style={{ borderColor: g.color, boxShadow: `0 12px 40px -18px ${g.color}` }}
                >
                  <span className="absolute -right-4 -top-4 text-8xl opacity-20 transition group-hover:scale-110">{g.emoji}</span>
                  <span className="text-4xl">{g.emoji}</span>
                  <div>
                    <p className="text-lg font-extrabold">{g.name}</p>
                    <p className="text-xs text-white/60">{g.tag}</p>
                  </div>
                </Link>
              </li>
            ))}
            <li className="flex aspect-[4/3] flex-col justify-between rounded-3xl border-2 border-dashed border-white/20 p-4 text-white/50">
              <span className="text-4xl">♟️</span>
              <div>
                <p className="text-lg font-extrabold">Coming soon</p>
                <p className="text-xs">Draughts · Chess · Carrom</p>
              </div>
            </li>
          </ul>
        </section>

        <section className="grid gap-3 text-sm sm:grid-cols-3">
          {[
            ["🛡️", "Provably fair", "Every dice roll can be verified after the match."],
            ["🪙", "Winner takes 2×", `Stake ${q.stake} + fee ${q.fee} → winner gets ${q.pot}. Coins arrive with the licensed pilot.`],
            ["🥽", "Phone · PC · VR", "One world for every device. Play in landscape on phones."],
          ].map(([i, t, d]) => (
            <div key={t} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-lg font-bold">{i} {t}</p>
              <p className="text-white/65">{d}</p>
            </div>
          ))}
        </section>
        <footer className="mt-auto pb-2 text-center text-xs text-white/40">Practice mode uses Stars ⭐ (no cash value). 18+ for real-money play.</footer>
      </div>
    </main>
  );
}
