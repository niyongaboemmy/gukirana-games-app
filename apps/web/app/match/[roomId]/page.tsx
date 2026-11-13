"use client";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { LiveMatch } from "@/match/LiveMatch";

/** Live match: portrait and landscape both supported (2D boards), so no rotate guard. */
export default function MatchPage() {
  const { roomId } = useParams<{ roomId: string }>();
  return (
    <Suspense fallback={null}>
      <LiveMatch roomId={roomId} />
    </Suspense>
  );
}
