import { describe, expect, it } from "vitest";
import { arrival, behind, INTRO_S, OUT_INTRO_S } from "./arrival";
import { HALLS } from "./layouts";
import { BOXING_DOOR_LINE_Z, LOBBY_BACK_Z, boxingToLobby, lobbyToBoxing } from "@/fight/plan";

const lobby = HALLS.fight;
const boxing = HALLS.boxing;
const near = (a: number, b: number, eps = 1e-6) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < eps;
/** where the camera stands for an orbit yaw (RoomPlayer convention) */
const camAt = (x: number, z: number, yaw: number, d = 5) => ({ x: x + Math.sin(yaw) * d, z: z + Math.cos(yaw) * d });

describe("hall arrival pose per direction (P3-FGT-12)", () => {
  it("walking in through a hall's own door: facing into the room, walk-in, camera behind (door side)", () => {
    const a = arrival({ door: lobby.door, size: lobby.size, hand: { x: 0.2, z: lobby.size.d / 2 - 0.2, yaw: Math.PI - 0.1 } });
    expect(a.kind).toBe("front");
    expect(a.heading).toBe(Math.PI);
    expect(a.intro).toBe(INTRO_S);
    expect(camAt(a.x, a.z, a.camYaw).z).toBeGreaterThan(a.z); // behind you = towards the door you came through
  });

  it("Boxing hall → lobby: comes OUT of the passage facing into the lobby, never turned back towards the door", () => {
    // the person steps out of the Boxing hall's south door heading south (+z, yaw 0)
    const out = boxingToLobby(boxing.door.x, boxing.size.d / 2 + 0.7, 0.08);
    const a = arrival({ door: lobby.door, size: lobby.size, hand: { ...out, via: "subhall" } });
    expect(a.kind).toBe("subhall");
    // arrives on the lobby side of the back-wall doorway
    expect(a.z).toBeGreaterThan(BOXING_DOOR_LINE_Z);
    expect(a.z).toBeLessThan(LOBBY_BACK_Z + 1.5);
    // keeps the heading it came with on the first frame and walks on AWAY from the door (+z)
    expect(near(a.facing, 0.08)).toBe(true);
    expect(a.heading).toBe(0);
    expect(a.intro).toBe(OUT_INTRO_S);
    // the camera is behind (in the passage, −z side), so the lobby appears in front
    expect(near(a.camYaw, behind(0))).toBe(true);
    expect(camAt(a.x, a.z, a.camYaw).z).toBeLessThan(a.z);
    // and never further back than the room allows
    expect(a.z - (a.camMax ?? 0)).toBeGreaterThanOrEqual(-lobby.size.d / 2 + 0.3 - 1e-9);
  });

  it("lobby → Boxing hall: the hand-over through the hall's own door is a normal walk-in", () => {
    const p = lobbyToBoxing(boxing.door.x, BOXING_DOOR_LINE_Z - 0.7, Math.PI);
    const a = arrival({ door: boxing.door, size: boxing.size, hand: p });
    expect(a.kind).toBe("front");
    expect(a.z).toBeLessThan(boxing.size.d / 2);
    expect(a.heading).toBe(Math.PI);
    expect(camAt(a.x, a.z, a.camYaw).z).toBeGreaterThan(a.z);
  });

  it("the two door maps are inverse (no drift across a round trip)", () => {
    const p = lobbyToBoxing(-8.1, -3.9, 3.0);
    const q = boxingToLobby(p.x, p.z, p.yaw);
    expect(q.x).toBe(-8.1);
    expect(q.z).toBeCloseTo(-3.9, 9);
    expect(q.yaw).toBe(3.0);
  });

  it("reload / back from a game: the exact pose, no scripted walk, camera behind your heading", () => {
    const a = arrival({ door: boxing.door, size: boxing.size, hand: null, restore: { x: 12, z: -3, yaw: 1.2 } });
    expect(a).toMatchObject({ kind: "restore", x: 12, z: -3, facing: 1.2, heading: null, intro: 0 });
    expect(near(a.camYaw, 1.2 + Math.PI)).toBe(true);
  });

  it("a restore wins over a stale hand-over; a cold deep link walks in from the door", () => {
    expect(arrival({ door: lobby.door, size: lobby.size, hand: { x: 0, z: 0, yaw: 0, via: "subhall" }, restore: { x: 1, z: 1, yaw: 0 } }).kind).toBe("restore");
    const a = arrival({ door: lobby.door, size: lobby.size });
    expect(a).toMatchObject({ kind: "door", x: lobby.door.x, z: lobby.size.d / 2 - 1.0, facing: Math.PI, heading: Math.PI });
  });
});
