"use client";
import { Text } from "@react-three/drei";
import { PORTALS, portalTransform } from "@/world/layout";
import { useFightBridge } from "./bridge";
import { FIGHT_BUILDING } from "./plan";
import { ringCounts } from "./rings";
import { F } from "./strings";

const FONT = "/fonts/Baloo2.ttf";

/** The small LED board on the Fight hall facade (plan §4.1): the live count ("12 fights on now"), else the hall line. */
export function FightFacadeBoard() {
  const n = useFightBridge((s) => (Object.keys(s.rings).length ? ringCounts(s.rings).fights : -1));
  const p = PORTALS.find((q) => q.id === "fight")!;
  const t = portalTransform(p);
  const text = n >= 0 ? F.fightsOn(n).toUpperCase() : `${F.subhall.boxing.toUpperCase()} · 50`;
  return (
    <group position={[t.x, 0, t.z]} rotation-y={t.rotY}>
      <Text font={FONT} fontSize={0.34} position={[-9.5, FIGHT_BUILDING.lobbyH - 1.6, 0.13]} anchorX="center" anchorY="middle" maxWidth={3.2}>
        {text}
        <meshBasicMaterial color={[2.2, 0.55, 0.45]} toneMapped={false} />
      </Text>
    </group>
  );
}
