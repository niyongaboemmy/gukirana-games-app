"use client";
import { create } from "zustand";
import { selfPose, useWorld } from "@/lib/world-store";

/**
 * Proximity voice (SRS FR-COM-01/02/03/07/13) — peer-to-peer WebRTC with spatial (HRTF) audio.
 * Signalling goes through the plaza / hall room (the server never relays across a block). Push-to-talk by default:
 * hold the mic button (or V) to talk, tap it to lock the mic open. Private 1:1 calls (voice/call.ts) reuse the same
 * peer connection with a separate, always-open track and no distance falloff.
 * Good for small groups / MVP; production swaps the transport for a LiveKit SFU behind the same API (P1-COM-03).
 */
export const VOICE_RANGE = 8; // metres — silent beyond this (DESIGN-SPEC §6.1)
const CONNECT_RANGE = 10;
const DISCONNECT_RANGE = 14;
const MAX_PEERS = 8;
/** a press shorter than this on the mic button / V toggles the open-mic lock instead of push-to-talk */
export const TAP_MS = 260;

/**
 * Acoustic zones (P2-ADM-04, the Administrative Block offices): `allow(id)` false = you can't hear that person at
 * all (they are in another closed office, or you are in an office and they are not); `room(id)` true = you share a
 * private room with them (an office conversation): no distance falloff inside it. Unset = open space (plaza / halls).
 * The realtime server enforces the same rule on the voice signalling.
 */
export const voiceScope: { allow: ((id: string) => boolean) | null; room: ((id: string) => boolean) | null } = { allow: null, room: null };

type Status = "off" | "starting" | "on" | "denied" | "error";
interface VoiceState {
  status: Status;
  transmitting: boolean;
  openMic: boolean;
  /** remote sessionId → speaking now */
  talking: Record<string, boolean>;
  /** remote sessionId → has voice switched on */
  available: Record<string, boolean>;
  muted: Record<string, boolean>;
  /** remote sessionId → volume 0…1.5 (default 1) */
  volume: Record<string, number>;
  connected: string[];
  /** connected people within hearing range right now ("N people can hear you") */
  hearers: number;
  selfTalking: boolean;
  /** private call partner (session id) */
  callPeer: string | null;
  callMuted: boolean;
  callPeerTalking: boolean;
}
export const useVoice = create<VoiceState>()(() => ({
  status: "off",
  transmitting: false,
  openMic: false,
  talking: {},
  available: {},
  muted: {},
  volume: {},
  connected: [],
  hearers: 0,
  selfTalking: false,
  callPeer: null,
  callMuted: false,
  callPeerTalking: false,
}));

type Send = (type: string, payload: unknown) => void;
let send: Send = () => undefined;
export const bindVoiceTransport = (s: Send) => (send = s);

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  sender?: RTCRtpSender;
  audio?: HTMLAudioElement;
  nodes?: { source: MediaStreamAudioSourceNode; panner: PannerNode; gain: GainNode; level: AnalyserNode };
}
const peers = new Map<string, Peer>();
let stream: MediaStream | null = null;
let callTrack: MediaStreamTrack | null = null;
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let manageTimer: ReturnType<typeof setInterval> | null = null;
let talkTimer: ReturnType<typeof setInterval> | null = null;
let raf = 0;

function iceServers(): RTCIceServer[] {
  try {
    return JSON.parse(process.env.NEXT_PUBLIC_ICE_SERVERS ?? "[]") as RTCIceServer[];
  } catch {
    return [];
  }
}
const me = () => useWorld.getState().you ?? "";
const syncConnected = () => useVoice.setState({ connected: [...peers.keys()] });
const mainTrack = () => stream?.getAudioTracks()[0] ?? null;
const trackFor = (id: string) => (id === useVoice.getState().callPeer && callTrack ? callTrack : mainTrack());

function createPeer(id: string): Peer {
  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  const peer: Peer = { pc, polite: me() > id, makingOffer: false, ignoreOffer: false };
  const track = trackFor(id);
  if (track && stream) peer.sender = pc.addTrack(track, stream);
  pc.onicecandidate = ({ candidate }) => candidate && send("voice-signal", { to: id, data: { candidate: candidate.toJSON() } });
  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      send("voice-signal", { to: id, data: { description: pc.localDescription?.toJSON() } });
    } catch {
      /* renegotiation will retry */
    } finally {
      peer.makingOffer = false;
    }
  };
  pc.ontrack = ({ streams }) => streams[0] && attachAudio(peer, streams[0]);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") dropPeer(id);
  };
  peers.set(id, peer);
  syncConnected();
  return peer;
}

function attachAudio(peer: Peer, remote: MediaStream) {
  if (!ctx) return;
  // Chrome only feeds remote WebRTC audio into Web Audio when an element also plays it (muted)
  const audio = new Audio();
  audio.srcObject = remote;
  audio.muted = true;
  void audio.play().catch(() => undefined);
  const source = ctx.createMediaStreamSource(remote);
  // inverse falloff from 2 m, plus a soft fade to silence at the edge of the range (spatialize)
  const panner = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 2, maxDistance: VOICE_RANGE, rolloffFactor: 1.5 });
  const gain = ctx.createGain();
  const level = ctx.createAnalyser();
  level.fftSize = 256;
  source.connect(level);
  source.connect(panner).connect(gain).connect(ctx.destination);
  peer.audio = audio;
  peer.nodes = { source, panner, gain, level };
}

export function dropPeer(id: string, notify = false) {
  const p = peers.get(id);
  if (!p) return;
  if (notify) send("voice-signal", { to: id, data: { bye: true } });
  p.pc.close();
  p.nodes?.source.disconnect();
  p.nodes?.gain.disconnect();
  if (p.audio) p.audio.srcObject = null;
  peers.delete(id);
  syncConnected();
}

/** Perfect negotiation (W3C pattern): either side may offer; the "polite" peer yields on collision. */
export async function handleSignal(from: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; bye?: boolean; ready?: boolean }) {
  if (data?.ready) {
    // call partner's mic is up: (re)start the connection from the offering side so no early offer is lost
    if (from === useVoice.getState().callPeer && useVoice.getState().status === "on" && me() < from && peers.get(from)?.pc.connectionState !== "connected") {
      dropPeer(from);
      createPeer(from);
    }
    return;
  }
  if (data?.bye) {
    if (from !== useVoice.getState().callPeer) dropPeer(from);
    return;
  }
  if (useVoice.getState().status !== "on") return;
  let peer = peers.get(from);
  if (!peer) {
    const isCall = from === useVoice.getState().callPeer;
    if (!isCall && peers.size >= MAX_PEERS) return;
    peer = createPeer(from);
  }
  const pc = peer.pc;
  try {
    if (data.description) {
      const collision = data.description.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(data.description);
      if (data.description.type === "offer") {
        await pc.setLocalDescription();
        send("voice-signal", { to: from, data: { description: pc.localDescription?.toJSON() } });
      }
    } else if (data.candidate) {
      await pc.addIceCandidate(data.candidate).catch((e) => {
        if (!peer!.ignoreOffer) throw e;
      });
    }
  } catch {
    /* ignore transient negotiation errors */
  }
}

export function handleVoiceState(m: { id: string; on: boolean; talking: boolean }) {
  useVoice.setState((s) => ({ available: { ...s.available, [m.id]: m.on }, talking: { ...s.talking, [m.id]: m.on && m.talking } }));
  if (!m.on && m.id !== useVoice.getState().callPeer) dropPeer(m.id);
}

export function onPlayerLeft(id: string) {
  dropPeer(id);
  useVoice.setState((s) => {
    const available = { ...s.available };
    const talking = { ...s.talking };
    delete available[id];
    delete talking[id];
    return { available, talking };
  });
}

/** Connect to voice-enabled players in range (and the call partner anywhere); drop those who walked away. */
function manage() {
  const { players } = useWorld.getState();
  const { available, callPeer } = useVoice.getState();
  let hearers = 0;
  for (const p of Object.values(players)) {
    const d = Math.hypot(p.x / 100 - selfPose.x, p.z / 100 - selfPose.z);
    const has = peers.has(p.id);
    const isCall = p.id === callPeer;
    const zoned = !voiceScope.allow || voiceScope.allow(p.id);
    const inRoom = zoned && !!voiceScope.room?.(p.id);
    if (!has && p.verified && me() < p.id && (isCall || (zoned && available[p.id] && (inRoom || d < CONNECT_RANGE) && peers.size < MAX_PEERS))) createPeer(p.id);
    if (has && !isCall && (!zoned || (!inRoom && d > DISCONNECT_RANGE))) dropPeer(p.id, true);
    if (has && available[p.id] && d < VOICE_RANGE && peers.get(p.id)?.pc.connectionState === "connected") hearers++;
  }
  for (const id of peers.keys()) if (!players[id]) dropPeer(id);
  if (hearers !== useVoice.getState().hearers) useVoice.setState({ hearers });
}

const levelBuf = new Float32Array(256);
function rms(a: AnalyserNode): number {
  a.getFloatTimeDomainData(levelBuf);
  let sum = 0;
  for (const v of levelBuf) sum += v * v;
  return Math.sqrt(sum / levelBuf.length);
}

/** Per-frame spatial update: listener = my avatar, sources = remote avatars (rendered positions). */
function spatialize() {
  raf = requestAnimationFrame(spatialize);
  if (!ctx) return;
  const L = ctx.listener;
  const fx = Math.sin(selfPose.yaw);
  const fz = Math.cos(selfPose.yaw);
  if (L.positionX) {
    L.positionX.value = selfPose.x;
    L.positionY.value = 1.6;
    L.positionZ.value = selfPose.z;
    L.forwardX.value = fx;
    L.forwardY.value = 0;
    L.forwardZ.value = fz;
    L.upX.value = 0;
    L.upY.value = 1;
    L.upZ.value = 0;
  } else {
    L.setPosition(selfPose.x, 1.6, selfPose.z);
    L.setOrientation(fx, 0, fz, 0, 1, 0);
  }
  const { players } = useWorld.getState();
  const { muted, volume, callPeer } = useVoice.getState();
  for (const [id, peer] of peers) {
    const p = players[id];
    if (!p || !peer.nodes) continue;
    const vol = muted[id] ? 0 : (volume[id] ?? 1);
    if (id === callPeer) {
      // private call: like a phone — right in front of you, no distance falloff
      peer.nodes.panner.positionX.value = selfPose.x + fx * 0.6;
      peer.nodes.panner.positionY.value = 1.6;
      peer.nodes.panner.positionZ.value = selfPose.z + fz * 0.6;
      peer.nodes.gain.gain.setTargetAtTime(vol * 1.6, ctx.currentTime, 0.08);
      continue;
    }
    const x = p.x / 100;
    const z = p.z / 100;
    peer.nodes.panner.positionX.value = x;
    peer.nodes.panner.positionY.value = 1.6;
    peer.nodes.panner.positionZ.value = z;
    const d = Math.hypot(x - selfPose.x, z - selfPose.z);
    // hard cut beyond range (privacy) with a short fade; mute / volume per person (FR-COM-07); acoustic zones
    // (closed offices) cut entirely, a shared office is heard in full
    const zoned = !voiceScope.allow || voiceScope.allow(id);
    const range = !zoned ? 0 : voiceScope.room?.(id) ? 1 : d >= VOICE_RANGE ? 0 : d > VOICE_RANGE - 1.5 ? (VOICE_RANGE - d) / 1.5 : 1;
    peer.nodes.gain.gain.setTargetAtTime(vol * range, ctx.currentTime, 0.08);
  }
}

function detectTalking() {
  if (!analyser) return;
  const v = useVoice.getState();
  const talking = v.transmitting && rms(analyser) > 0.02;
  if (talking !== v.selfTalking) {
    useVoice.setState({ selfTalking: talking });
    send("voice-state", { on: true, talking });
  }
  const cp = v.callPeer ? peers.get(v.callPeer) : undefined;
  const peerTalking = !!cp?.nodes && rms(cp.nodes.level) > 0.015;
  if (peerTalking !== v.callPeerTalking) useVoice.setState({ callPeerTalking: peerTalking });
}

export async function enableVoice(): Promise<boolean> {
  const st = useVoice.getState().status;
  if (st === "on") return true;
  if (st === "starting") return false;
  useVoice.setState({ status: "starting" });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    ctx = new AudioContext();
    await ctx.resume();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    stream.getAudioTracks().forEach((t) => (t.enabled = false)); // push-to-talk by default
    useVoice.setState({ status: "on", transmitting: false, openMic: false });
    send("voice-state", { on: true, talking: false });
    manageTimer = setInterval(manage, 500);
    talkTimer = setInterval(detectTalking, 150);
    raf = requestAnimationFrame(spatialize);
    return true;
  } catch (e) {
    useVoice.setState({ status: (e as DOMException)?.name === "NotAllowedError" ? "denied" : "error" });
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    return false;
  }
}

export function disableVoice(): void {
  endCallAudio();
  for (const id of [...peers.keys()]) dropPeer(id, true);
  if (manageTimer) clearInterval(manageTimer);
  if (talkTimer) clearInterval(talkTimer);
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  void ctx?.close().catch(() => undefined);
  stream = null;
  ctx = null;
  analyser = null;
  if (useVoice.getState().status === "on") send("voice-state", { on: false, talking: false });
  useVoice.setState({ status: "off", transmitting: false, openMic: false, selfTalking: false, hearers: 0 });
}

export function setTransmitting(on: boolean): void {
  if (useVoice.getState().status !== "on") return;
  const value = on || useVoice.getState().openMic;
  const t = mainTrack();
  if (t) t.enabled = value;
  useVoice.setState({ transmitting: value });
}

export function setOpenMic(openMic: boolean): void {
  useVoice.setState({ openMic });
  setTransmitting(openMic);
}
export const toggleOpenMic = () => setOpenMic(!useVoice.getState().openMic);

/** Hold-to-talk with tap-to-lock (mic button and V key share this). */
let press: { at: number; wasOpen: boolean } | null = null;
export function pttDown(): void {
  if (useVoice.getState().status !== "on" || press) return;
  press = { at: performance.now(), wasOpen: useVoice.getState().openMic };
  setTransmitting(true);
}
export function pttUp(): void {
  if (!press) return;
  const { at, wasOpen } = press;
  press = null;
  const tap = performance.now() - at < TAP_MS;
  if (tap) setOpenMic(!wasOpen);
  else if (!wasOpen) setTransmitting(false);
}

export const setMuted = (id: string, mute: boolean) => useVoice.setState((s) => ({ muted: { ...s.muted, [id]: mute } }));
export const setVolume = (id: string, v: number) => useVoice.setState((s) => ({ volume: { ...s.volume, [id]: Math.max(0, Math.min(1.5, v)) } }));

// ---------------------------------------------------------------- private call audio (voice/call.ts drives it)

/** Start the private-call audio path with `id`: an always-open (unless muted) cloned track, no falloff. */
export async function startCallAudio(id: string): Promise<boolean> {
  if (!(await enableVoice())) return false;
  const base = mainTrack();
  if (!base) return false;
  callTrack?.stop();
  callTrack = base.clone();
  callTrack.enabled = !useVoice.getState().callMuted;
  useVoice.setState({ callPeer: id });
  const peer = peers.get(id);
  if (peer?.sender) await peer.sender.replaceTrack(callTrack).catch(() => undefined);
  else if (!peer && me() < id) createPeer(id);
  if (me() > id) send("voice-signal", { to: id, data: { ready: true } });
  return true;
}

export function endCallAudio(): void {
  const id = useVoice.getState().callPeer;
  if (!id) return;
  const peer = peers.get(id);
  const base = mainTrack();
  if (peer?.sender && base) void peer.sender.replaceTrack(base).catch(() => undefined);
  callTrack?.stop();
  callTrack = null;
  useVoice.setState({ callPeer: null, callPeerTalking: false });
  // the regular range rules take over again (far away → disconnect on the next manage tick)
}

export function setCallMuted(m: boolean): void {
  if (callTrack) callTrack.enabled = !m;
  useVoice.setState({ callMuted: m });
}
