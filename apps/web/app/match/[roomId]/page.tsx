"use client";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { LiveMatch } from "@/match/LiveMatch";
import { RotateGuard } from "@/hud/RotateGuard";

export default function MatchPage() {
  const { roomId } = useParams<{ roomId: string }>();
  return (
    <Suspense fallback={null}>
      <LiveMatch roomId={roomId} />
      <RotateGuard />
    </Suspense>
  );
}
