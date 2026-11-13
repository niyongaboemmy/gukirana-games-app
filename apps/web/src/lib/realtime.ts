"use client";
import { Client, type Room } from "colyseus.js";
import { useWorld, type RemotePlayer } from "./world-store";
import { reasonText, useMatch, type IncomingProposal } from "./match-store";
import { bindVoiceTransport, disableVoice, handleSignal, handleVoiceState, onPlayerLeft } from "@/voice/voice";
import { lookOf, useProfile } from "./profile-store";
import { encodeLook } from "@/world/outfits";

/** Realtime connection to the plaza room (plan P1-WLD-01/02). Works over LAN for phone testing. */
let room: Room | null = null;
let connecting = false;

function realtimeUrl(): string {
  if (process.env.NEXT_PUBLIC_REALTIME_URL) return process.env.NEXT_PUBLIC_REALTIME_URL;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.hostname}:2567`;
}

/** Joins the plaza (default) or a game hall interior ({ name: "hall", game }). */
export async function connectPlaza(
  profile: { name: string; color: string; level: number; token?: string | null; look?: string },
  target: { name: "plaza" | "hall"; game?: string } = { name: "plaza" },
): Promise<void> {
  if (room || connecting) return;
  connecting = true;
  const w = useWorld.getState();
  try {
    const client = new Client(realtimeUrl());
    // `look` is optional: servers that don't know it ignore it; when passed through it renders the chosen avatar.
    const look = profile.look ?? encodeLook(lookOf(useProfile.getState()));
    room = await client.joinOrCreate(target.name, target.name === "hall" ? { ...{ ...profile, look }, game: target.game } : { ...profile, look });
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
    room.onMessage("left", (m: { id: string }) => {
      useWorld.getState().removePlayer(m.id);
      onPlayerLeft(m.id);
    });
    // proximity voice signalling
    bindVoiceTransport((type, payload) => room?.send(type, payload));
    room.onMessage("voice-signal", (m: { from: string; data: Parameters<typeof handleSignal>[1] }) => void handleSignal(m.from, m.data));
    room.onMessage("voice-state", handleVoiceState);
    // hall seats (one player per chair)
    room.onMessage("seats", (m: Record<string, string>) => useWorld.setState({ seats: m }));
    room.onMessage("seat-taken", () => useWorld.setState({ seatTaken: Date.now() }));
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
    // in-world proposals + Quick Match (SRS §8.4.2)
    room.onMessage("proposal", (p: IncomingProposal) => useMatch.setState((s) => ({ incoming: [...s.incoming.filter((x) => x.id !== p.id), p] })));
    room.onMessage("proposal-sent", (p) => useMatch.setState({ outgoing: p, notice: null }));
    room.onMessage("proposal-failed", (m: { reason: string }) => useMatch.setState({ notice: reasonText(m.reason) }));
    room.onMessage("proposal-closed", (m: { id: string; reason: string }) =>
      useMatch.setState((s) => ({
        incoming: s.incoming.filter((x) => x.id !== m.id),
        outgoing: s.outgoing?.id === m.id ? null : s.outgoing,
        notice: s.outgoing?.id === m.id || m.reason !== "EXPIRED" ? reasonText(m.reason) : s.notice,
      })),
    );
    room.onMessage("quickmatch", (m: { status: "idle" | "waiting" | "error"; game?: "igisoro" | "ludo"; stake?: number; reason?: string }) =>
      useMatch.setState({ quick: m, notice: m.status === "error" ? reasonText(m.reason) : null }),
    );
    room.onMessage("match-ready", (m) => useMatch.setState({ ready: m, incoming: [], outgoing: null, quick: { status: "idle" } }));
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
  disableVoice();
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
export const sitAt = (seat: string) => room?.send("sit", { seat });
export const standUp = () => room?.send("stand");
export const propose = (to: string, game: "igisoro" | "ludo", stake: number) => room?.send("propose", { to, game, stake });
export const respondProposal = (id: string, accept: boolean) => {
  room?.send("proposal-respond", { id, accept });
  useMatch.setState((s) => ({ incoming: s.incoming.filter((x) => x.id !== id) }));
};
export const quickMatchJoin = (game: "igisoro" | "ludo", stake: number) => room?.send("quickmatch-join", { game, stake });
export const quickMatchLeave = () => room?.send("quickmatch-leave");
export const sendEmote = (emote: number) => room?.send("emote", { emote });
