import { edgeAhead, type SeatActivity } from "@/world/human/activity";
import { SEAT_BACK } from "@/world/human/seat-profiles";
import { adminSeat, MEETING_CHAIR_R, MEETING_R, officeFurniture, officePlan } from "@/admin-block/plan";
import { FLOOR_Y, STAGE } from "@/arena/bowl";
import type { HallLayout } from "./layouts";

/**
 * Which seated activity (world/human/activity.ts) a hall seat gets, with the table geometry it needs: the table /
 * desk height and how far its near edge is in front of the seated origin. Pure, cached per layout + seat.
 */
const cache = new WeakMap<HallLayout, Map<string, SeatActivity | null>>();

/** the Igisoro board stands ~6 cm proud of its low table */
const IGISORO_BOARD = 0.06;

function compute(layout: HallLayout, seatId: string): SeatActivity | null {
  const s = layout.seats.find((x) => x.id === seatId);
  if (!s) return null;
  const ox = s.x - Math.sin(s.yaw) * SEAT_BACK;
  const oz = s.z - Math.cos(s.yaw) * SEAT_BACK;
  const t = layout.tables.find((x) => x.id === s.table);
  switch (layout.game) {
    case "pool":
      // the lounge chairs beside a table: watch the game on it
      return t ? { kind: "watch", deskH: t.h, reach: 9, focus: { x: t.x, y: t.h, z: t.z } } : null;
    case "ludo":
      return t ? { kind: "board", deskH: t.h, reach: edgeAhead(ox, oz, s.yaw, t), focus: { x: t.x, y: t.h, z: t.z } } : null;
    case "igisoro":
      return t ? { kind: "sow", deskH: t.h + IGISORO_BOARD, reach: edgeAhead(ox, oz, s.yaw, t), focus: { x: t.x, y: t.h, z: t.z } } : null;
    case "admin": {
      const a = adminSeat(seatId);
      const o = a && officePlan(a.table);
      if (!a || !o) return null; // the lobby: just sitting
      const f = officeFurniture(o);
      if (a.kind === "officer") {
        const desk = f.desks.reduce((b, d) => (Math.abs(d.x - a.x) < Math.abs(b.x - a.x) ? d : b), f.desks[0]!);
        return { kind: "type", deskH: desk.h, reach: edgeAhead(ox, oz, s.yaw, desk), focus: { x: desk.x, y: desk.h + 0.3, z: desk.z } };
      }
      if (a.kind === "visitor") {
        // facing the officer across the desk: look at whoever sits there (head height)
        const c = f.chairs.reduce((b, d) => (Math.abs(d.x - o.cx) < Math.abs(b.x - o.cx) ? d : b), f.chairs[0]!);
        return { kind: "visit", deskH: 0.75, reach: 9, focus: { x: c.x, y: 1.2, z: c.z } };
      }
      return { kind: "meet", deskH: 0.76, reach: MEETING_CHAIR_R + SEAT_BACK - MEETING_R, focus: { x: f.meeting.x, y: 0.76, z: f.meeting.z } };
    }
    case "arena":
      // the bowl seats face the centre already: eyes on the stage
      return { kind: "watch", deskH: 0, reach: 9, focus: { x: 0, y: FLOOR_Y + STAGE.h + 1.2, z: STAGE.z } };
  }
  return null;
}

export function seatActivity(layout: HallLayout, seatId: string): SeatActivity | null {
  let m = cache.get(layout);
  if (!m) cache.set(layout, (m = new Map()));
  if (!m.has(seatId)) m.set(seatId, compute(layout, seatId));
  return m.get(seatId)!;
}
