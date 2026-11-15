"use client";
import { Text } from "@react-three/drei";
import { PORTALS, portalTransform } from "@/world/layout";
import { useFightBridge } from "./bridge";
import { LIVE_BOARD, ROOF_SIGN, SIGN } from "./exterior";
import { FIGHT_BUILDING } from "./plan";
import { ringCounts } from "./rings";
import { F } from "./strings";

const FONT = "/fonts/Baloo2.ttf";

/**
 * The Fight hall facade's lit parts (plan §4.1, P3-FGT-03), in the building's door frame (portalTransform: moving the
 * building moves them with it): the "FIGHT GAMES" letters on the sign over the lobby roof and on the rooftop light box
 * (P2-WLD-14), and the live board on the
 * left wing — the sport, the live fights and the free rings ("Boxing · Open / 12 fights on now / 30 rings free").
 */
export function FightFacadeBoard() {
  const counts = useFightBridge((s) => (Object.keys(s.rings).length ? `${ringCounts(s.rings).fights}:${ringCounts(s.rings).free}` : ""));
  const p = PORTALS.find((q) => q.id === "fight")!;
  const t = portalTransform(p);
  const [fights, free] = counts ? counts.split(":").map(Number) : [null, null];
  const B = LIVE_BOARD;
  return (
    <group position={[t.x, 0, t.z]} rotation-y={t.rotY}>
      <Text font={FONT} fontSize={1.45} position={[0, SIGN.y + 0.12, FIGHT_BUILDING.front + 0.26]} anchorX="center" anchorY="middle" letterSpacing={0.08}>
        {F.hall.toUpperCase()}
        <meshBasicMaterial color={[1.9, 1.85, 1.78]} toneMapped={false} />
      </Text>
      {/* the rooftop light box over the pavilion, turned towards the arrival (P2-WLD-14): both faces; it names the sport so it never repeats the main sign */}
      <group position={[ROOF_SIGN.x, ROOF_SIGN.y, ROOF_SIGN.z]} rotation-y={ROOF_SIGN.rotY}>
        {[0, Math.PI].map((face) => (
          <Text key={face} rotation-y={face} font={FONT} fontSize={1.05} position={[Math.sin(face) * 0.19, 0.04, Math.cos(face) * 0.19]} anchorX="center" anchorY="middle" letterSpacing={0.14}>
            {F.subhall.boxing.toUpperCase()}
            <meshBasicMaterial color={[2.2, 0.55, 0.45]} toneMapped={false} />
          </Text>
        ))}
      </group>
      <group position={[B.x, B.y, B.z]}>
        <mesh>
          <planeGeometry args={[B.w, B.h]} />
          <meshBasicMaterial color="#0d0d0f" />
        </mesh>
        <mesh position={[0, B.h / 2 - 0.42, 0.005]}>
          <planeGeometry args={[B.w - 0.3, 0.04]} />
          <meshBasicMaterial color={[1.8, 0.45, 0.38]} toneMapped={false} />
        </mesh>
        <Text font={FONT} fontSize={0.3} position={[0, B.h / 2 - 0.24, 0.01]} anchorX="center" anchorY="middle" letterSpacing={0.12}>
          {`${F.subhall.boxing} · ${F.open}`.toUpperCase()}
          <meshBasicMaterial color={[1.25, 1.2, 1.15]} toneMapped={false} />
        </Text>
        <Text font={FONT} fontSize={0.5} position={[0, 0.02, 0.01]} anchorX="center" anchorY="middle" maxWidth={B.w - 0.3}>
          {fights == null ? F.boxingHall.toUpperCase() : F.fightsOn(fights).toUpperCase()}
          <meshBasicMaterial color={[2.2, 0.6, 0.5]} toneMapped={false} />
        </Text>
        <Text font={FONT} fontSize={0.36} position={[0, -B.h / 2 + 0.42, 0.01]} anchorX="center" anchorY="middle" maxWidth={B.w - 0.3}>
          {free == null ? F.ringsFree(50) : F.ringsFree(free)}
          <meshBasicMaterial color={[0.5, 1.6, 0.8]} toneMapped={false} />
        </Text>
      </group>
    </group>
  );
}
