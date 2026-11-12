"use client";
import Link from "next/link";
import { useState } from "react";
import { Gift, Globe, Glasses, LogOut, ShieldCheck, Sparkles, Star, Trophy, User, Zap } from "lucide-react";
import { coins, quoteChallenge } from "@gukirana/money";
import { LoginFlow } from "@/auth/LoginFlow";
import { claimDailyStars, logout, useSession } from "@/lib/session";
import { DieIcon, PoolBallIcon, SeedsIcon } from "@/ui/game-icons";

const GAMES = [
  { id: "pool", name: "8-Ball Pool", icon: PoolBallIcon, color: "#2F80ED", tag: "Aim · power · spin" },
  { id: "ludo", name: "Ludo", icon: DieIcon, color: "#FF8A1F", tag: "Fair dice · tactics" },
  { id: "igisoro", name: "Igisoro", icon: SeedsIcon, color: "#27AE60", tag: "Rwandan strategy" },
];

export default function Home() {
  const { status, me } = useSession();
  const ready = status === "authenticated" && !!me?.username;
  const [daily, setDaily] = useState<string | null>(null);
  const q = quoteChallenge(coins(100));

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#0b0d1a] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,#3DA9FC55,transparent_55%),radial-gradient(ellipse_at_90%_20%,#9B51E055,transparent_50%),radial-gradient(ellipse_at_50%_110%,#27AE6044,transparent_55%)]" />
      <div className="relative mx-auto flex min-h-dvh max-w-[1280px] flex-col gap-8 px-4 py-6 md:px-8">
        <header className="flex items-center justify-between">
          <p className="text-xl font-black tracking-tight">
            GUKIRANA <span className="text-[#FFC83D]">PLAYGROUND</span>
          </p>
          {ready && (
            <div className="flex items-center gap-2 text-sm font-bold">
              <span className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5"><Sparkles size={14} className="text-[#FFC83D]" /> Lvl {me.level}</span>
              <span className="flex items-center gap-1 rounded-full bg-[#7CC4FF]/20 px-3 py-1.5 tabular-nums"><Star size={14} className="fill-[#7CC4FF] text-[#7CC4FF]" /> {me.stars}</span>
              <button type="button" onClick={() => void logout()} aria-label="Sign out" className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/15"><LogOut size={16} /></button>
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
              Walk into a 3D games world in the hills of Rwanda. Meet real people, talk, agree on a game and sit at the table. Pool, Ludo and Rwanda&apos;s own Igisoro, on your phone, computer or VR headset.
            </p>
            {ready && (
              <div className="flex flex-wrap gap-3">
                <Link href="/world" className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#3DA9FC] to-[#9B51E0] px-6 py-4 text-lg font-extrabold shadow-[0_10px_40px_-10px_#3DA9FC] transition hover:scale-[1.02]">
                  <Globe size={22} /> Enter the 3D world
                </Link>
                <Link href="/play/ludo" className="flex items-center gap-2 rounded-2xl border border-white/20 bg-white/5 px-6 py-4 text-lg font-bold backdrop-blur hover:bg-white/10">
                  <Zap size={20} className="text-[#FFC83D]" /> Practice now
                </Link>
              </div>
            )}
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/5 p-6 shadow-2xl backdrop-blur-xl">
            {status === "loading" ? (
              <div className="h-40 animate-pulse rounded-2xl bg-white/5" />
            ) : ready ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-white/60">Welcome back</p>
                <div className="flex items-center gap-3">
                  <div className="grid size-14 place-items-center rounded-full" style={{ background: me.color }}><User size={26} /></div>
                  <div>
                    <p className="text-2xl font-extrabold">{me.username}</p>
                    <p className="flex items-center gap-1 text-sm text-[#FFC83D]"><Sparkles size={14} /> Level {me.level} · {me.xp} XP · {me.phone ?? me.email}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  {["igisoro", "ludo", "pool"].map((g) => (
                    <div key={g} className="rounded-xl bg-white/5 p-2">
                      <p className="text-xs capitalize text-white/50">{g}</p>
                      <p className="font-extrabold tabular-nums">{me.ratings[g]?.rating ?? 1500}</p>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void claimDailyStars().then((r) => setDaily(r.granted ? `+${r.granted} Stars added` : "Already claimed today. Come back tomorrow."))}
                  className="flex items-center justify-center gap-2 rounded-xl border border-[#7CC4FF]/40 bg-[#7CC4FF]/10 py-2.5 font-bold"
                >
                  <Gift size={18} className="text-[#7CC4FF]" /> Claim daily Stars
                </button>
                {daily && <p className="text-center text-sm text-white/70">{daily}</p>}
              </div>
            ) : (
              <>
                <p className="mb-1 text-2xl font-extrabold">Muraho!</p>
                <p className="mb-4 text-sm text-white/60">Sign in with your phone or email to play real people.</p>
                <LoginFlow />
              </>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-white/90">Games</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {GAMES.map((g) => (
              <li key={g.id}>
                <Link
                  href={ready ? `/play/${g.id}` : "#"}
                  className="group relative flex aspect-[4/3] flex-col justify-between overflow-hidden rounded-3xl border-2 bg-white/5 p-4 backdrop-blur transition hover:-translate-y-1"
                  style={{ borderColor: g.color, boxShadow: `0 12px 40px -18px ${g.color}` }}
                >
                  <g.icon size={110} className="absolute -right-5 -top-5 opacity-15 transition group-hover:scale-110" style={{ color: g.color }} />
                  <span className="grid size-12 place-items-center rounded-2xl" style={{ background: `${g.color}33`, color: g.color }}><g.icon size={26} /></span>
                  <div>
                    <p className="text-lg font-extrabold">{g.name}</p>
                    <p className="text-xs text-white/60">{g.tag}</p>
                  </div>
                </Link>
              </li>
            ))}
            <li className="flex aspect-[4/3] flex-col justify-between rounded-3xl border-2 border-dashed border-white/20 p-4 text-white/50">
              <span className="grid size-12 place-items-center rounded-2xl bg-white/5"><Trophy size={24} /></span>
              <div>
                <p className="text-lg font-extrabold">Coming soon</p>
                <p className="text-xs">Draughts · Chess · Carrom</p>
              </div>
            </li>
          </ul>
        </section>

        <section className="grid gap-3 text-sm sm:grid-cols-3">
          {[
            { icon: ShieldCheck, t: "Provably fair", d: "Every dice roll can be verified after the match." },
            { icon: Trophy, t: "Winner takes 2×", d: `Stake ${q.stake} + fee ${q.fee} → winner gets ${q.pot}. Coins arrive with the licensed pilot; today you play with Stars.` },
            { icon: Glasses, t: "Phone · PC · VR", d: "One world for every device. Play in landscape on phones." },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="flex items-center gap-2 text-lg font-bold"><Icon size={20} className="text-[#3DA9FC]" /> {t}</p>
              <p className="text-white/65">{d}</p>
            </div>
          ))}
        </section>
        <footer className="mt-auto pb-2 text-center text-xs text-white/40">Stars are practice currency with no cash value. 18+ for real-money play.</footer>
      </div>
    </main>
  );
}
