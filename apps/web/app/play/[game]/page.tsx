"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { RotateGuard } from "@/hud/RotateGuard";

const Loading = () => <div className="fixed inset-0 grid place-items-center bg-[#0b0d1a] font-bold text-white">Setting up the table…</div>;
const GAMES = {
  pool: dynamic(() => import("@/games/PoolGame"), { ssr: false, loading: Loading }),
  ludo: dynamic(() => import("@/games/LudoGame"), { ssr: false, loading: Loading }),
  igisoro: dynamic(() => import("@/games/IgisoroGame"), { ssr: false, loading: Loading }),
} as const;

export default function PlayPage() {
  const { game } = useParams<{ game: string }>();
  const Game = GAMES[game as keyof typeof GAMES];
  if (!Game)
    return (
      <div className="grid min-h-dvh place-items-center bg-[#0b0d1a] text-white">
        <Link href="/world">Unknown game. Back to the Plaza</Link>
      </div>
    );
  return (
    <>
      <Game />
      <RotateGuard />
    </>
  );
}
