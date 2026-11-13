"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";

const Loading = () => <div className="fixed inset-0 grid place-items-center bg-ink-950 font-display font-bold text-white">Setting up the table…</div>;
const GAMES = {
  pool: dynamic(() => import("@/games/PoolGame"), { ssr: false, loading: Loading }),
  ludo: dynamic(() => import("@/games/LudoGame"), { ssr: false, loading: Loading }),
  igisoro: dynamic(() => import("@/games/IgisoroGame"), { ssr: false, loading: Loading }),
} as const;

/**
 * Practice vs AI. The 2D game screens work in portrait and landscape (the Pool table stands up in portrait),
 * so no rotate guard here; the 3D world keeps its landscape guard.
 */
export default function PlayPage() {
  const { game } = useParams<{ game: string }>();
  const Game = GAMES[game as keyof typeof GAMES];
  if (!Game)
    return (
      <div className="grid min-h-dvh place-items-center bg-ink-950 text-white">
        <Link href="/world">Unknown game. Back to the Plaza</Link>
      </div>
    );
  return <Game />;
}
