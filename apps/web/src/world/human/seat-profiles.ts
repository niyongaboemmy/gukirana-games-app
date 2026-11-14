/**
 * Seat profiles (P2-AVA-06): how a seated person fits each kind of seat in the playground.
 *
 * The seated mocap loops are authored for one seat: buttocks on a 0.46 m surface, hips over the avatar origin, feet
 * wherever the actor had them. Real seats differ (a 0.44 m Igisoro stool, a 0.54 m lounge armchair, a deep bucket
 * lounge chair, stadium seats over a raked row), so every seat kind gets one profile here, used for YOU and for
 * everyone else seen seated (world/Avatar → world/human/seat-fit applies it after the mixer):
 *  - the body is raised / lowered so the buttocks rest on the cushion (`seatH`) and slid along the seat (`hipFwd`),
 *  - the feet stay planted: on the floor (never under it), inside the legroom (`legroom`: not into the row in front),
 *    optionally placed further forward (`footFwd`, deep bucket seats raise the knees over the front lip),
 *  - the torso reclines onto a deep back (`lean`).
 * Avatar frame: origin = the seated origin on the floor (the seat point moved SEAT_BACK behind the chair centre),
 * +y up, +z forward (towards the table / stage). Metres, radians.
 */

/** Height of the buttocks' contact in the seated mocap loops (m): the seat surface they were authored for. */
export const CLIP_SEAT_H = 0.46;
/** The seated origin sits this far behind a hall seat point (away from the table), same for you and for others. */
export const SEAT_BACK = 0.08;

export type SeatKind =
  | "bench" // plaza bench (the mocap seat)
  | "lounge" // Pool Hall: mid-century bucket lounge chair (deep, front lip, reclined back)
  | "armchairLudo" // Ludo Lounge: walnut armchair (×0.9)
  | "stool" // Igisoro Court: low upholstered drum stool, no back
  | "sofa" // Administrative Block lobby: deep three-seat sofa
  | "armchair" // lobby armchair (×1.0: high cushion)
  | "waitBench" // lobby waiting bench (upholstered, low back)
  | "task" // officer's task chair
  | "visitor" // visitor / meeting chair
  | "stadium" // arena bowl seat over a raked row (legroom ends at the step)
  | "vip"; // arena VIP box seat (wider, flat floor)

export interface SeatProfile {
  /** seat surface the buttocks rest on, above the floor under the seat (m) */
  seatH: number;
  /** hips moved forward (+) / back (−) from the seated origin (m) */
  hipFwd: number;
  /** torso recline onto the back rest (rad, + = leaning back) */
  lean: number;
  /** furthest the ankles may be in front of the seated origin (m): the legroom */
  legroom: number;
  /** ankles at least this far in front of the hips (m): raises the knees over a deep seat's front lip; 0 = as animated */
  footFwd: number;
}

export const SEAT_PROFILES: Record<SeatKind, SeatProfile> = {
  bench: { seatH: 0.46, hipFwd: 0, lean: 0, legroom: 0.8, footFwd: 0 },
  // bucket shell: cushion 0.36–0.40 under the hips rising to a 0.49 m front lip 0.55 m ahead; back reclined ~45°.
  // Sit well back in the bucket, knees up over the lip, feet forward, leaning back into it.
  lounge: { seatH: 0.42, hipFwd: 0.1, lean: 0.2, legroom: 0.85, footFwd: 0.5 },
  // cushion 0.49 m, back 0.19 m behind the origin
  armchairLudo: { seatH: 0.48, hipFwd: 0.02, lean: 0.05, legroom: 0.8, footFwd: 0 },
  // drum cushion 0.444 m (soft): the stool's centre is the seat point, so slide onto its middle
  stool: { seatH: 0.43, hipFwd: 0.05, lean: 0, legroom: 0.7, footFwd: 0 },
  // seat 0.45 m, deep: back cushion 0.32 m behind the origin, front 0.33 m ahead
  sofa: { seatH: 0.43, hipFwd: -0.04, lean: 0.17, legroom: 0.9, footFwd: 0 },
  // cushion 0.54 m
  armchair: { seatH: 0.53, hipFwd: 0.02, lean: 0.05, legroom: 0.9, footFwd: 0 },
  // pad 0.48 m, back pad 0.18 m behind the origin
  waitBench: { seatH: 0.47, hipFwd: 0.01, lean: 0, legroom: 0.8, footFwd: 0 },
  // fabric seat 0.51 m, back plate 0.125 m behind the origin
  task: { seatH: 0.5, hipFwd: 0.06, lean: 0, legroom: 0.7, footFwd: 0 },
  // seat 0.495 m, back 0.13 m behind the origin
  visitor: { seatH: 0.49, hipFwd: 0.06, lean: 0, legroom: 0.7, footFwd: 0 },
  // pad 0.4775 m; the tread ends 0.61 m ahead of the origin (then the step down to the row in front)
  stadium: { seatH: 0.47, hipFwd: 0, lean: 0, legroom: 0.46, footFwd: 0 },
  // pad 0.497 m (seat scaled ×1.04 high), flat box floor
  vip: { seatH: 0.49, hipFwd: 0, lean: 0.04, legroom: 0.6, footFwd: 0 },
};

/**
 * The seats as built (measured from the furniture code / glTF props, scaled as placed), in the seated avatar frame:
 * `top` = cushion / pad surface under the hips, `back` = front face of the back rest at hip height (distance behind
 * the seated origin; Infinity = no back), `front` = the seat's front edge ahead of the origin.
 * Sources: rooms/PoolHall.tsx (mid_century_lounge_chair ×0.95), rooms/LudoLounge.tsx (modern_arm_chair_01 ×0.9),
 * rooms/IgisoroCourt.tsx (cushionGeometry), rooms/AdminBlock.tsx (sofa_02 ×1.1, modern_arm_chair_01 ×1, benches,
 * taskChair, visitorChair), rooms/TournamentArena.tsx (seatGeometry; VIP ×1.22/1.04/1.12), plaza benches
 * (@gukirana/contracts PLAZA_BENCH_SEAT_Y).
 */
export const SEAT_FURNITURE: Record<SeatKind, { top: number; back: number; front: number; lip?: number }> = {
  bench: { top: 0.46, back: 0.2, front: 0.3 },
  // bucket shell: the cushion rises to a rolled front lip 0.49 m high
  lounge: { top: 0.38, back: 0.05, front: 0.55, lip: 0.49 },
  armchairLudo: { top: 0.49, back: 0.19, front: 0.41 },
  stool: { top: 0.444, back: Infinity, front: 0.32 },
  sofa: { top: 0.45, back: 0.32, front: 0.33 },
  armchair: { top: 0.54, back: 0.22, front: 0.45 },
  waitBench: { top: 0.48, back: 0.18, front: 0.34 },
  task: { top: 0.51, back: 0.125, front: 0.32 },
  visitor: { top: 0.495, back: 0.13, front: 0.32 },
  stadium: { top: 0.4775, back: 0.12, front: 0.22 },
  vip: { top: 0.497, back: 0.16, front: 0.24 },
};

/**
 * The seated mocap body (both animation sets, measured): how far the buttocks reach behind the hips, the kneecaps
 * ahead of them, and the toes ahead of the ankles (m).
 */
export const CLIP_BODY = { buttBack: 0.13, kneeFront: 0.41, toeLen: 0.14 } as const;

/** Which seat kind a seat id is, per area ("plaza" or the hall game). Unknown ids sit on the mocap seat. */
export function seatKindFor(area: string | null | undefined, seatId: string | null | undefined): SeatKind {
  if (!seatId) return "bench";
  switch (area) {
    case "pool":
      return "lounge";
    case "ludo":
      return "armchairLudo";
    case "igisoro":
      return "stool";
    case "arena":
      return seatId.startsWith("V") ? "vip" : "stadium";
    case "admin": {
      const lobby = /^lobby-(\d+)$/.exec(seatId);
      if (lobby) {
        const n = Number(lobby[1]);
        // admin-block/plan.ts lobbySeats(): three sofa places, two armchairs, then the waiting benches
        return n < 3 ? "sofa" : n < 5 ? "armchair" : "waitBench";
      }
      if (seatId.endsWith("-officer")) return "task";
      return "visitor";
    }
    default:
      return "bench";
  }
}

export const seatProfileFor = (area: string | null | undefined, seatId: string | null | undefined): SeatProfile => SEAT_PROFILES[seatKindFor(area, seatId)];

/** Vertical body shift that puts the mocap buttocks onto this seat's surface (m). */
export const seatLift = (p: SeatProfile) => p.seatH - CLIP_SEAT_H;

/**
 * How far both feet are raised so neither goes under the floor (m): the lowest of the ankle / ball of the foot,
 * measured against their standing heights (`ankleH` / `toeH`, sole on the floor). Both feet share the lift, so
 * crossed ankles stay crossed.
 */
export function footLift(feet: readonly { ankleY: number; toeY: number }[], floorY: number, ankleH: number, toeH: number): number {
  let lift = 0;
  for (const f of feet) lift = Math.max(lift, floorY + ankleH - f.ankleY, floorY + toeH - f.toeY);
  return lift;
}

/**
 * Where an ankle goes (avatar frame, z forward): forward of the hips by at least `footFwd` (deep seats), never past
 * the legroom.
 */
export function footZ(animZ: number, hipZ: number, p: SeatProfile): number {
  let z = animZ;
  if (p.footFwd > 0) z = Math.max(z, hipZ + p.footFwd);
  return Math.min(z, p.legroom);
}
