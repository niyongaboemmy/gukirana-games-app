"use client";
import { nav } from "@/world/navigation";
import { selfPose } from "@/lib/world-store";
import { hallHooks, walkQueue } from "@/rooms/hall-hooks";
import { useRoom } from "@/rooms/room-store";
import { arenaStand, floorAllowed, requestSeat, seatDenial, useArena } from "./arena-client";
import { aisleSpot, bowlSeat, groundAt, VIP, LOBBY, OUTER_R, PORTAL_HW, routeBetween, snapWalkable, walkable } from "./bowl";

/**
 * The arena's extensions of the generic hall controller (rooms/RoomPlayer via rooms/hall-hooks): walking on several
 * levels (raked rows, stair aisles, the sunken floor), the walkable space, routes along the concourse, seat rows
 * left along the row back to the aisle, and a follow camera that stays inside the bowl. Registered when this module
 * loads (rooms/TournamentArena imports it), before the arena's controller mounts.
 */
hallHooks.arena = {
  ground: groundAt,
  walkable: (x, z) => walkable(x, z, floorAllowed()),
  chairR: 0.18,
  route: routeBetween,
  tap: (p) => snapWalkable(p, floorAllowed()),
  standSpot: (id) => {
    const s = bowlSeat(id);
    return s ? aisleSpot(s) : null;
  },
  stand: arenaStand,
  camClamp: (c) => {
    const r = Math.hypot(c.x, c.z);
    const inLobby = selfPose.z > 0 && Math.hypot(selfPose.x, selfPose.z) > OUTER_R;
    if (inLobby) {
      // in the lobby: stay out of the drum wall (except through the entry portal)
      if (r < OUTER_R + 0.35 && Math.abs(c.x) > PORTAL_HW - 0.4) {
        const k = (OUTER_R + 0.35) / Math.max(r, 1e-3);
        c.x *= k;
        c.z *= k;
      }
      c.x = Math.max(-LOBBY.hw + 0.3, Math.min(LOBBY.hw - 0.3, c.x));
      c.y = Math.min(c.y, 4.3);
    } else if (r > OUTER_R - 0.5 && !(c.z > 0 && Math.abs(c.x) < PORTAL_HW - 0.3)) {
      const k = (OUTER_R - 0.5) / r;
      c.x *= k;
      c.z *= k;
    }
    // inside a VIP box the camera stays below its roof
    if (!inLobby && r > VIP.front && groundAt(c.x, c.z) === VIP.floorY) c.y = Math.min(c.y, VIP.floorY + 2.8);
    // and always below the space-frame roof
    c.y = Math.min(c.y, 14.4);
  },
};

/** Walk to a seat: along the concourse and down / up its stair aisle; the seat request goes out on arrival. */
export function goToSeat(id: string) {
  const s = bowlSeat(id);
  if (!s) return;
  const d = seatDenial(id);
  if (d) return void useArena.setState({ denied: { action: "sit", reason: d }, cardOpen: d === "NO_PASS" });
  if (useRoom.getState().seated) {
    arenaStand();
    useRoom.getState().set({ seated: null });
  }
  const spot = aisleSpot(s);
  const legs = routeBetween({ x: selfPose.x, z: selfPose.z }, spot);
  nav.goal = null;
  nav.target = legs[0] ?? spot;
  nav.progress = { best: Infinity, since: performance.now(), detours: 0 };
  walkQueue.legs = legs.slice(1);
  useArena.setState({ walkingTo: id, denied: null, pending: null });
}

/** Per frame while the arena is on screen: arrive at the aisle → ask for the seat; manual walking cancels. */
export function updateSeatWalk() {
  const id = useArena.getState().walkingTo;
  if (!id) return;
  const s = bowlSeat(id);
  if (!s) return void useArena.setState({ walkingTo: null });
  const spot = aisleSpot(s);
  if (Math.hypot(selfPose.x - spot.x, selfPose.z - spot.z) < 0.7) return requestSeat(id);
  if (!nav.target && !walkQueue.legs.length) useArena.setState({ walkingTo: null }); // taken over by hand / blocked
}
