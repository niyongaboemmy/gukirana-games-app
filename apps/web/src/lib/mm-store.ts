"use client";
import { create } from "zustand";
import {
  BoxingHallEvt,
  MmEvt,
  MmMsg,
  type InviteClosedMsg,
  type InviteMsg,
  type InviteSentMsg,
  type MmClosedMsg,
  type MmFoundMsg,
  type MmGoMsg,
  type MmStatusMsg,
  type OnlineMsg,
  type VenuesMsg,
} from "@gukirana/contracts";
import { onRoomMessage, roomSend } from "./realtime";
import { reasonText, type GameId } from "./match-store";
import { notify } from "@/social/social-store";
import { withRules } from "@/rules/rules-store";
import { hasKey, mf } from "@/match/mm-strings";

/**
 * Matchmaking v2 on the web (P2-MM-05, docs/MATCHMAKING-V2.md): my search, a found opponent to accept, challenges to
 * me and from me, the place I am sent to, the live venue list (Quick Play) and who is online. The server decides
 * everything; this only mirrors its messages and sends my choices.
 *
 * Kill switch: NEXT_PUBLIC_FF_MATCH_V2=0 (the v1 Quick Match / in-room challenge UI comes back).
 */
export const MM_V2 = process.env.NEXT_PUBLIC_FF_MATCH_V2 !== "0";

/** a clock on this device: `until` = now + the server's ttl when the message came */
const until = (ttlMs: number) => Date.now() + ttlMs;

export interface Found extends MmFoundMsg {
  until: number;
  /** I said yes; waiting for them */
  accepted: boolean;
}
export interface Incoming extends InviteMsg {
  until: number;
}
export interface Outgoing extends InviteSentMsg {
  until: number;
}
export interface Go extends MmGoMsg {
  until: number;
  at: number;
}
export type Venues = VenuesMsg & { waits?: Record<string, { name: string; stakes: number[] }>; at: number };

interface MmState {
  search: (MmStatusMsg & { since: number }) | { status: "idle" };
  found: Found | null;
  incoming: Incoming[];
  outgoing: Outgoing[];
  go: Go | null;
  venues: Partial<Record<GameId, Venues>>;
  online: OnlineMsg["people"] | null;
  /** the Quick Play sheet, the challenge sheet (for whom) */
  quickPlay: { game?: GameId; place?: string } | null;
  challenge: { uid?: string; name?: string; game?: GameId; stake?: number; place?: string } | null;
}

export const useMm = create<MmState>()(() => ({ search: { status: "idle" }, found: null, incoming: [], outgoing: [], go: null, venues: {}, online: null, quickPlay: null, challenge: null }));

// ---------------------------------------------------------------- actions

/** search for `game` at these stakes (preferred first); the rules card first when it is the first live match */
export function findOpponent(game: GameId, stakes: number[], place?: string): void {
  withRules(game, () => roomSend(MmMsg.find, { game, stakes, ...(place ? { venue: { place } } : {}) }));
}
export const cancelSearch = () => roomSend(MmMsg.cancel, {});
export const widenSearch = (stakes: number[]) => roomSend(MmMsg.widen, { stakes });
export function respondFound(accept: boolean): void {
  const f = useMm.getState().found;
  if (!f) return;
  const send = () => {
    roomSend(MmMsg.respond, { id: f.id, accept });
    useMm.setState({ found: accept ? { ...f, accepted: true } : null });
  };
  if (accept) withRules(f.game, send);
  else send();
}
export function sendChallenge(to: string, game: GameId, stake: number, place?: string): void {
  withRules(game, () => roomSend(MmMsg.invite, { to, game, stake, ...(place ? { venue: { place } } : {}) }));
}
export function respondInvite(id: string, accept: boolean): void {
  const i = useMm.getState().incoming.find((x) => x.id === id);
  const send = () => {
    roomSend(MmMsg.inviteRespond, { id, accept });
    useMm.setState((s) => ({ incoming: s.incoming.filter((x) => x.id !== id) }));
  };
  if (accept && i) withRules(i.game, send);
  else send();
}
export const cancelInvite = (id: string) => roomSend(MmMsg.inviteCancel, { id });
export const askVenues = (game: GameId) => roomSend(MmMsg.venues, { game });
export const askOnline = () => roomSend(MmMsg.online, {});
export const openQuickPlay = (p: { game?: GameId; place?: string } = {}) => useMm.setState({ quickPlay: p });
export const openChallenge = (p: NonNullable<MmState["challenge"]> = {}) => useMm.setState({ challenge: p, quickPlay: null });

/** a refusal / close code in plain words: the v2 catalogue first, then the shared v1 words */
export function mmText(prefix: "closed" | "inviteClosed" | "error", reason: string | undefined, vars: { name?: string; game?: string; limit?: number } = {}): string {
  const k = `${prefix}.${reason}`;
  if (hasKey(k)) return mf(k, { name: vars.name ?? "They" });
  return reasonText(reason, vars);
}

// ---------------------------------------------------------------- server messages

if (typeof window !== "undefined" && MM_V2) {
  onRoomMessage<MmStatusMsg>(MmEvt.status, (m) => {
    if (m.status === "error") {
      useMm.setState({ search: { status: "idle" } });
      return notify(mmText("error", m.reason, { game: m.game, ...(m.limit !== undefined ? { limit: m.limit } : {}) }));
    }
    if (m.status === "idle") return useMm.setState({ search: { status: "idle" } });
    useMm.setState((s) => ({ search: { ...m, since: s.search.status === "searching" && s.search.game === m.game && "since" in s.search ? s.search.since : Date.now() - (m.waitedMs ?? 0) } }));
  });
  onRoomMessage<MmFoundMsg>(MmEvt.found, (m) => useMm.setState({ found: { ...m, until: until(m.ttlMs), accepted: false } }));
  onRoomMessage<MmClosedMsg>(MmEvt.closed, (m) => {
    const s = useMm.getState();
    const name = m.kind === "found" ? s.found?.opponent.name : s.go?.opponent.name;
    if (m.kind === "found" && s.found?.id === m.id) useMm.setState({ found: null });
    if (m.kind === "meet") useMm.setState({ go: null });
    notify(mmText("closed", m.reason, { name, game: m.game, ...(m.limit !== undefined ? { limit: m.limit } : {}) }));
  });
  onRoomMessage<MmGoMsg>(MmEvt.go, (m) => useMm.setState({ go: { ...m, until: until(m.ttlMs), at: Date.now() }, found: null, search: { status: "idle" }, quickPlay: null, challenge: null }));
  onRoomMessage<InviteMsg>(MmEvt.invite, (m) => useMm.setState((s) => ({ incoming: [...s.incoming.filter((x) => x.id !== m.id), { ...m, until: until(m.ttlMs) }] })));
  onRoomMessage<InviteSentMsg>(MmEvt.inviteSent, (m) => useMm.setState((s) => ({ outgoing: [...s.outgoing.filter((x) => x.id !== m.id), { ...m, until: until(m.ttlMs) }] })));
  onRoomMessage<InviteClosedMsg>(MmEvt.inviteClosed, (m) => {
    useMm.setState((s) => ({ incoming: s.incoming.filter((x) => x.id !== m.id), outgoing: s.outgoing.filter((x) => x.id !== m.id) }));
    notify(mmText("inviteClosed", m.reason, { name: m.name, game: m.game, ...(m.limit !== undefined ? { limit: m.limit } : {}) }));
  });
  onRoomMessage<VenuesMsg>(MmEvt.venues, (m) => useMm.setState((s) => ({ venues: { ...s.venues, [m.game]: { ...m, at: Date.now() } } })));
  onRoomMessage<OnlineMsg>(MmEvt.online, (m) => useMm.setState({ online: m.people }));
  // a match started: nothing of the matchmaking is open any more
  onRoomMessage("match-ready", () => useMm.setState({ go: null, found: null, search: { status: "idle" } }));
  // Boxing has no "match-ready": the meeting ends when the hall gives me my ring / the fight room (P3-FGT-24: the
  // "Go to a ring" card stayed on screen through the whole fight, frozen at "0 s to get there")
  const boxingMet = () => {
    if (useMm.getState().go?.game === "boxing") useMm.setState({ go: null, found: null, search: { status: "idle" } });
  };
  onRoomMessage<{ ring: string | null }>(BoxingHallEvt.assigned, (a) => a.ring && boxingMet());
  onRoomMessage(BoxingHallEvt.fightReady, boxingMet);
}
