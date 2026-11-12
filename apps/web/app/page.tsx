import { quoteChallenge, coins } from "@gukirana/money";
import { LOBBY_GAMES } from "@/features/lobby/games";

export default function HomePage() {
  const example = quoteChallenge(coins(100));
  return (
    <main className="mx-auto flex min-h-dvh max-w-[1440px] flex-col gap-6 px-4 py-4 md:px-6 lg:px-8">
      <header className="flex items-center justify-between rounded-2xl bg-[var(--surface)] px-4 py-3 shadow-sm">
        <div>
          <p className="text-lg font-extrabold text-brand-indigo dark:text-brand-gold">Gukirana Playground</p>
          <p className="text-xs opacity-70">Play · Meet · Win</p>
        </div>
        <span className="rounded-full bg-coin/15 px-3 py-1 text-sm font-semibold tabular-nums">🪙 0</span>
      </header>

      <section aria-labelledby="games" className="flex flex-col gap-3">
        <h1 id="games" className="text-xl font-bold">
          Games
        </h1>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {LOBBY_GAMES.map((g) => (
            <li
              key={g.id}
              className="flex aspect-[4/3] flex-col justify-between rounded-2xl border-2 bg-[var(--surface)] p-4 shadow-sm"
              style={{ borderColor: g.colorVar }}
            >
              <span className="text-4xl" aria-hidden>
                {g.emoji}
              </span>
              <span className="font-semibold">{g.name}</span>
              <span className="text-xs opacity-70">{g.id === "soon" ? "Notify me" : `${g.live} live`}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-[var(--surface)] p-4 text-sm shadow-sm">
        <p className="font-semibold">How a challenge works</p>
        <p className="opacity-80">
          Stake {example.stake} 🪙 + fee {example.fee} 🪙 = you pay {example.totalToPay} 🪙. Winner gets{" "}
          {example.pot} 🪙.
        </p>
      </section>

      <p className="mt-auto text-center text-xs opacity-60">
        Walking skeleton (Phase 0). The 3D world lands in P0-3D-01.
      </p>
    </main>
  );
}
