"use client";
import { Client, type Room } from "colyseus.js";
import { useWorld, type RemotePlayer } from "./world-store";

/** Realtime connection to the plaza room (plan P1-WLD-01/02). Works over LAN for phone testing. */
let room: Room | null = null;
let connecting = false;

function realtimeUrl(): string {
  if (process.env.NEXT_PUBLIC_REALTIME_URL) return process.env.NEXT_PUBLIC_REALTIME_URL;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.hostname}:2567`;
}

export async function connectPlaza(profile: { name: string; color: string; level: number }): Promise<void> {
  if (room || connecting) return;
  connecting = true;
  const w = useWorld.getState();
  try {
    const client = new Client(realtimeUrl());
    room = await client.joinOrCreate("plaza", profile);
    w.set({ connected: true });
    room.onMessage("snapshot", (m: { you: string; players: RemotePlayer[] }) => {
      const players: Record<string, RemotePlayer> = {};
      for (const p of m.players) if (p.id !== m.you) players[p.id] = p;
      useWorld.setState({ you: m.you, players });
    });
    room.onMessage("joined", (p: RemotePlayer) => {
      useWorld.getState().upsertPlayer(p);
      useWorld.getState().pushChat({ id: "sys", name: "", color: "", text: `${p.name} joined the plaza`, t: Date.now(), system: true });
    });
    room.onMessage("left", (m: { id: string }) => useWorld.getState().removePlayer(m.id));
    room.onMessage("move", (m: Partial<RemotePlayer> & { id: string }) => useWorld.getState().upsertPlayer(m));
    room.onMessage("emote", (m: { id: string; emote: number }) =>
      useWorld.getState().upsertPlayer({ id: m.id, anim: m.emote, emoteUntil: Date.now() + 2500 }),
    );
    room.onMessage("chat", (c) => useWorld.getState().pushChat(c));
    room.onMessage("chat-warning", () =>
      useWorld.getState().pushChat({
        id: "sys",
        name: "",
        color: "",
        text: "Message blocked: never pay anyone outside Gukirana. All games go through escrow.",
        t: Date.now(),
        system: true,
      }),
    );
    room.onLeave(() => {
      room = null;
      useWorld.setState({ connected: false, players: {} });
    });
  } catch {
    useWorld.setState({ connected: false });
  } finally {
    connecting = false;
  }
}

export function leavePlaza(): void {
  void room?.leave();
  room = null;
}

let lastSent = 0;
export function sendMove(x: number, z: number, yaw: number, anim: number): void {
  const now = performance.now();
  if (!room || now - lastSent < 66) return; // ~15 Hz
  lastSent = now;
  const y16 = Math.round((((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * (65535 / (2 * Math.PI)));
  room.send("move", { x: Math.round(x * 100), y: 0, z: Math.round(z * 100), yaw: y16, anim, t: Math.round(now) });
}

export const sendChat = (text: string) => room?.send("chat", { text });
export const sendEmote = (emote: number) => room?.send("emote", { emote });
