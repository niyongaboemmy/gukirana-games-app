"use client";
import { notify, useSocial, type PersonCard } from "@/social/social-store";
import { endCallAudio, enableVoice, startCallAudio } from "./voice";

/**
 * Private 1:1 voice call (SRS FR-COM-02: both must accept). Request → the other person accepts → both hear each
 * other anywhere in the room (WebRTC over the existing signalling). Blocks, leaving or either side ending stops it.
 */
type Send = (type: string, payload: unknown) => void;
let send: Send = () => undefined;
export const bindCallTransport = (s: Send) => (send = s);

const REASONS: Record<string, string> = {
  DECLINED: "Call declined",
  NO_ANSWER: "No answer",
  ENDED: "Call ended",
  LEFT: "They left the room",
  BLOCKED: "Call ended",
  BUSY: "You are already in a call",
  TARGET_BUSY: "They are in another call",
  UNAVAILABLE: "They can't take calls right now",
  LOGIN_REQUIRED: "Sign in to make voice calls",
  RATE_LIMITED: "Too many calls, wait a moment",
  MIC: "Microphone needed for calls",
};
export const callReason = (r: string) => REASONS[r] ?? "Call ended";

export async function requestCall(to: PersonCard): Promise<void> {
  if (useSocial.getState().call.status !== "idle") return notify(callReason("BUSY"));
  // ask for the microphone first (user gesture), so the call can start the moment they accept
  if (!(await enableVoice())) return notify(callReason("MIC"));
  useSocial.setState({ call: { status: "outgoing", peer: to } });
  send("call-request", { to: to.id });
}

export async function answerCall(accept: boolean): Promise<void> {
  const c = useSocial.getState().call;
  if (c.status !== "incoming" || !c.id) return;
  if (accept && !(await enableVoice())) {
    send("call-respond", { id: c.id, accept: false });
    useSocial.setState({ call: { status: "idle" } });
    return notify(callReason("MIC"));
  }
  send("call-respond", { id: c.id, accept });
  if (!accept) useSocial.setState({ call: { status: "idle" } });
}

export function hangUp(): void {
  const c = useSocial.getState().call;
  if (c.status === "idle") return;
  send("call-end", c.id ? { id: c.id } : {});
  endCallAudio();
  useSocial.setState({ call: { status: "idle" } });
}

// ---- server events
export function onCallRinging(m: { id: string; to: PersonCard }) {
  useSocial.setState({ call: { status: "outgoing", id: m.id, peer: m.to } });
}
export function onCallIncoming(m: { id: string; from: PersonCard }) {
  if (useSocial.getState().call.status !== "idle") return; // server prevents this; be safe
  useSocial.setState({ call: { status: "incoming", id: m.id, peer: m.from, since: Date.now() } });
}
export async function onCallStart(m: { id: string; peer: PersonCard }) {
  useSocial.setState({ call: { status: "active", id: m.id, peer: m.peer, since: Date.now() } });
  if (!(await startCallAudio(m.peer.id))) hangUp();
}
export function onCallEnded(m: { id?: string; reason: string }) {
  const c = useSocial.getState().call;
  if (c.status === "idle" || (m.id && c.id && m.id !== c.id)) return;
  endCallAudio();
  useSocial.setState({ call: { status: "idle" } });
  notify(callReason(m.reason));
}
export function onCallFailed(m: { reason: string }) {
  useSocial.setState({ call: { status: "idle" } });
  notify(callReason(m.reason));
}
