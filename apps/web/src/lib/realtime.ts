"use client";
import { Client, type Room } from "colyseus.js";
import { useWorld, type RemotePlayer } from "./world-store";
import { reasonText, useMatch, type IncomingProposal } from "./match-store";
import { bindVoiceTransport, disableVoice, handleSignal, handleVoiceState, onPlayerLeft } from "@/voice/voice";
import { bindCallTransport, hangUp, onCallEnded, onCallFailed, onCallIncoming, onCallRinging, onCallStart } from "@/voice/call";
import { lookOf, useProfile } from "./profile-store";
import { encodeLook } from "@/world/outfits";
import { dropTrack, pushPose, setEmote, tracks } from "@/social/motion";
import { addDm, notify, showBubble, useSocial } from "@/social/social-store";
import { loadBlocks, persistBlock, persistUnblock } from "@/social/api";

/** Realtime connection to the plaza / hall room (plan P1-WLD-01/02, P1-COM-01). Works over LAN for phone testing. */
let room: Room | null = null;
let connecting = false;

function realtimeUrl(): string {
  if (process.env.NEXT_PUBLIC_REALTIME_URL) return process.env.NEXT_PUBLIC_REALTIME_URL;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.hostname}:2567`;
}

const sysLine = (text: string) => useWorld.getState().pushChat({ id: "sys", name: "", color: "", text, t: Date.now(), system: true });

const DM_REASONS: Record<string, string> = {
  WAITING: "Wait until they accept your chat request.",
  UNAVAILABLE: "That person can't receive messages right now.",
  LOGIN_REQUIRED: "Sign in to send private messages.",
  RATE_LIMITED: "Slow down a little.",
};

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
    // my block list applies before anyone becomes visible (server-enforced: invisible + silent both ways)
    const blocks = await loadBlocks().catch(() => [] as string[]);
    const options = { ...profile, look, blocks };
    room = await client.joinOrCreate(target.name, target.name === "hall" ? { ...options, game: target.game } : options);
    w.set({ connected: true });
    const name = (id: string) => useWorld.getState().players[id]?.name ?? "Someone";
    room.onMessage("snapshot", (m: { you: string; players: RemotePlayer[] }) => {
      const players: Record<string, RemotePlayer> = {};
      tracks.clear();
      for (const p of m.players) if (p.id !== m.you) players[p.id] = p;
      useWorld.setState({ you: m.you, players });
      for (const p of Object.values(players)) pushPose(p.id, p.x, p.z, p.yaw, p.anim);
    });
    room.onMessage("joined", (p: RemotePlayer) => {
      if (p.id === useWorld.getState().you) return;
      const known = !!useWorld.getState().players[p.id];
      useWorld.getState().upsertPlayer(p);
      pushPose(p.id, p.x, p.z, p.yaw, p.anim);
      if (!known) sysLine(`${p.name} joined`);
    });
    room.onMessage("left", (m: { id: string }) => {
      useWorld.getState().removePlayer(m.id);
      dropTrack(m.id);
      onPlayerLeft(m.id);
      useSocial.setState((s) => ({
        menu: s.menu === m.id ? null : s.menu,
        threads: s.threads[m.id] ? { ...s.threads, [m.id]: { ...s.threads[m.id]!, gone: true } } : s.threads,
      }));
    });
    // batched, distance-tiered movement: [id, x(cm), z(cm), yaw16, anim][]
    room.onMessage("moves", (list: [string, number, number, number, number][]) => {
      const now = performance.now();
      const players = useWorld.getState().players;
      for (const [id, x, z, yaw, anim] of list) {
        const p = players[id];
        if (!p) continue;
        p.anim = anim;
        p.yaw = yaw;
        pushPose(id, x, z, yaw, anim, now);
      }
    });
    // older servers relay single moves
    room.onMessage("move", (m: RemotePlayer) => useWorld.getState().players[m.id] && pushPose(m.id, m.x, m.z, m.yaw, m.anim));
    // proximity voice signalling + private calls
    bindVoiceTransport((type, payload) => room?.send(type, payload));
    bindCallTransport((type, payload) => room?.send(type, payload));
    room.onMessage("voice-signal", (m: { from: string; data: Parameters<typeof handleSignal>[1] }) => void handleSignal(m.from, m.data));
    room.onMessage("voice-state", handleVoiceState);
    room.onMessage("call-ringing", onCallRinging);
    room.onMessage("call-incoming", onCallIncoming);
    room.onMessage("call-start", (m) => void onCallStart(m));
    room.onMessage("call-ended", onCallEnded);
    room.onMessage("call-failed", onCallFailed);
    // seats: hall chairs + plaza bench places (one person per seat)
    room.onMessage("seats", (m: Record<string, string>) => useWorld.setState({ seats: m }));
    room.onMessage("seat-taken", () => useWorld.setState({ seatTaken: Date.now() }));
    room.onMessage("emote", (m: { id: string; emote: number }) => setEmote(m.id, m.emote));
    room.onMessage("waved", (m: { from: { id: string; name: string } | null }) => {
      if (!m.from) return;
      const from = m.from;
      notify(`${from.name} waved at you`, { label: "Wave back", run: () => waveAt(from.id) });
    });
    room.onMessage("chat", (c: { id: string; name: string; color: string; text: string; t: number; masked?: boolean; scope?: "nearby" | "room" }) => {
      useWorld.getState().pushChat({ ...c, scope: c.scope ?? "room" });
      showBubble(c.id, c.text);
    });
    room.onMessage("chat-warning", (m: { reason?: string }) =>
      sysLine(m?.reason === "rate" ? "Slow down a little: too many messages." : "Message blocked: never pay anyone outside Gukirana. All games go through escrow."),
    );
    // private messages (chat requests first)
    room.onMessage("dm", (m: { mid: string; from: string; name: string; color: string; to: string; text: string; t: number; masked?: boolean; request?: boolean }) => {
      const you = useWorld.getState().you;
      const mine = m.from === you;
      const peerId = mine ? m.to : m.from;
      const p = useWorld.getState().players[peerId];
      const peer = { id: peerId, name: mine ? (p?.name ?? "") : m.name, color: mine ? (p?.color ?? "#3DA9FC") : m.color, uid: p?.uid };
      addDm(peer, { mid: m.mid, mine, text: m.text, t: m.t, masked: m.masked }, m.request ? (mine ? "outgoing" : "incoming") : null);
    });
    room.onMessage("dm-failed", (m: { to: string; reason: string }) => notify(DM_REASONS[m.reason] ?? "Message not sent."));
    room.onMessage("dm-accepted", (m: { by: string }) => {
      useSocial.setState((s) => (s.threads[m.by] ? { threads: { ...s.threads, [m.by]: { ...s.threads[m.by]!, request: null } } } : {}));
      notify(`${name(m.by)} accepted your chat request`);
    });
    room.onMessage("blocked", (m: { key: string; name: string; uid?: string }) => void persistBlock({ key: m.key, name: m.name, uid: m.uid }));
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
    room.onMessage("quickmatch", (m: { status: "idle" | "waiting" | "error"; game?: "igisoro" | "ludo" | "pool"; stake?: number; reason?: string }) =>
      useMatch.setState({ quick: m, notice: m.status === "error" ? reasonText(m.reason) : null }),
    );
    room.onMessage("match-ready", (m) => useMatch.setState({ ready: m, incoming: [], outgoing: null, quick: { status: "idle" } }));
    room.onLeave(() => {
      room = null;
      resetSocial();
      useWorld.setState({ connected: false, players: {}, seats: {} });
    });
  } catch {
    useWorld.setState({ connected: false });
  } finally {
    connecting = false;
  }
}

/** Session-scoped social state (threads, calls, bubbles) does not carry over to another room. */
function resetSocial() {
  tracks.clear();
  useSocial.setState({ threads: {}, thread: null, bubbles: {}, menu: null, call: { status: "idle" }, seated: null, nearSeat: null, challenge: null });
}

export function leavePlaza(): void {
  hangUp();
  disableVoice();
  void room?.leave();
  room = null;
  resetSocial();
}

let lastSent = 0;
export function sendMove(x: number, z: number, yaw: number, anim: number): void {
  const now = performance.now();
  if (!room || now - lastSent < 66) return; // ~15 Hz
  lastSent = now;
  const y16 = Math.round((((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * (65535 / (2 * Math.PI)));
  room.send("move", { x: Math.round(x * 100), y: 0, z: Math.round(z * 100), yaw: y16, anim, t: Math.round(now) });
}

export const sendChat = (text: string, scope: "nearby" | "room" = "room") => room?.send("chat", { text, scope });
export const sendDm = (to: string, text: string) => room?.send("dm", { to, text });
export const acceptDm = (from: string) => {
  room?.send("dm-accept", { to: from });
  useSocial.setState((s) => (s.threads[from] ? { threads: { ...s.threads, [from]: { ...s.threads[from]!, request: null } } } : {}));
};
export const blockPerson = (id: string) => room?.send("block", { to: id });
export async function unblockKey(key: string) {
  room?.send("unblock", { key });
  await persistUnblock(key);
}
export const sitAt = (seat: string) => room?.send("sit", { seat });
export const standUp = () => room?.send("stand");
export const propose = (to: string, game: "igisoro" | "ludo" | "pool", stake: number) => room?.send("propose", { to, game, stake });
export const respondProposal = (id: string, accept: boolean) => {
  room?.send("proposal-respond", { id, accept });
  useMatch.setState((s) => ({ incoming: s.incoming.filter((x) => x.id !== id) }));
};
export const quickMatchJoin = (game: "igisoro" | "ludo" | "pool", stake: number) => room?.send("quickmatch-join", { game, stake });
export const quickMatchLeave = () => room?.send("quickmatch-leave");
export const sendEmote = (emote: number, to?: string) => room?.send("emote", to ? { emote, to } : { emote });

/** Local emote (my avatar) + broadcast, respecting the server's short cooldown. Returns false while cooling down. */
export function playEmote(emote: number, to?: string): boolean {
  const now = Date.now();
  if (now < useSocial.getState().emoteReadyAt) return false;
  useSocial.setState({ emoteReadyAt: now + 1500 });
  useWorld.getState().set({ emote: { id: emote, until: now + 2500 } });
  sendEmote(emote, to);
  return true;
}
export const waveAt = (id: string) => playEmote(10, id);
