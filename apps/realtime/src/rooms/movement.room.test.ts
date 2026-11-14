/** Movement clamp wired into the world room (GAP-014): others never see a teleport, walking is relayed as sent. */
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { WorldRoom } from "./world-room.js";
import { moveConfig } from "../social/movement.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let http: HttpServer;
let game: Server;
let url = "";

type Entry = [string, number, number, number, number];
async function guest(name: string) {
  const room: Room = await new Client(url).joinOrCreate("plaza", { name });
  const moves: Entry[] = [];
  room.onMessage("*", (type, msg) => {
    if (type === "moves") moves.push(...(msg as Entry[]));
  });
  return { room, sid: room.sessionId, moves };
}
const move = (r: Room, x: number, z: number) => r.send("move", { x, y: 0, z, yaw: 0, anim: 1, t: Date.now() });

beforeAll(async () => {
  http = createServer();
  game = new Server({ transport: new WebSocketTransport({ server: http }) });
  game.define("plaza", WorldRoom);
  await game.listen(0);
  url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
}, 20_000);
afterAll(async () => {
  await game.gracefullyShutdown(false).catch(() => undefined);
}, 20_000);

describe("world room movement", () => {
  it("spawn anywhere, walk freely, but a teleport across the plaza is clamped for everyone else", async () => {
    const a = await guest("Walker");
    const b = await guest("Watcher");
    await wait(150);
    move(a.room, 3000, 3000); // first fix: spawn / restored position
    await wait(250);
    move(a.room, 3100, 3000); // a 1 m step
    await wait(250);
    // what the watcher sees of the walker
    const lastOfA = () => b.moves.filter((m) => m[0] === a.sid).at(-1);
    expect(lastOfA()?.slice(1, 3)).toEqual([3100, 3000]);
    move(a.room, -5000, 3000); // 81 m in one message
    await wait(250);
    const x = lastOfA()![1];
    expect(x).toBeLessThan(3100);
    expect(3100 - x).toBeLessThanOrEqual(moveConfig.burstCm + moveConfig.speedCmS); // at most one burst + refill
    await a.room.leave();
    await b.room.leave();
  });
});
