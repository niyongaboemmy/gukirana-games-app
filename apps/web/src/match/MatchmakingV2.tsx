"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { create } from "zustand";
import { Bot, Check, Loader2, MapPin, Search, Star, Swords, Users, X, Zap } from "lucide-react";
import type { VenueStatus } from "@gukirana/contracts";
import { CORNER_COLORS } from "@gukirana/contracts";
import { selfPose, useWorld } from "@/lib/world-store";
import { GAME_LABEL, useMatch, type GameId } from "@/lib/match-store";
import {
  askOnline,
  askVenues,
  cancelInvite,
  cancelSearch,
  findOpponent,
  openChallenge,
  openQuickPlay,
  respondFound,
  respondInvite,
  sendChallenge,
  useMm,
  widenSearch,
  type Incoming,
} from "@/lib/mm-store";
import { choicesFor, useGameOffer } from "@/lib/games-offer";
import { useSession } from "@/lib/session";
import { rememberBeforeGame } from "@/lib/return-point";
import { setMmTarget, clearMmTarget } from "@/lib/mm-target";
import { useRoom } from "@/rooms/room-store";
import { useSocial } from "@/social/social-store";
import { QUICK_MATCH_EVENT, usePhoneHud } from "@/hud/usePhoneHud";
import { promptWrap } from "@/hud/Prompt";
import { getUp, pickedTable, walkToTable } from "@/rooms/RoomPlayer";
import { walkToRing, goToRingFromLobby } from "@/fight/ring-goto";
import { travelTo, useStage } from "@/world/stage";
import type { HallGame } from "@/rooms/layouts";
import { PaperCard } from "@/ui/PaperCard";
import { DieIcon, PoolBallIcon, SeedsIcon } from "@/ui/game-icons";
import { defaultStake, StakeChips, useStakeChoices } from "./StakeChips";
import { mf } from "./mm-strings";
import { M } from "./strings";
import { hallOf, hallTitle, isFree, nearestFree, placesOf, stakeWords, widerStakes } from "./quick-play";
import { MM_TIMING, type RingId } from "@gukirana/contracts";

/**
 * Matchmaking v2 overlay (P2-MM-05, docs/MATCHMAKING-V2.md): mounted on the plaza and in every hall by
 * MatchmakingPanel when NEXT_PUBLIC_FF_MATCH_V2 is on. Search card, "Opponent found", challenges in and out, the
 * walk to the reserved place, the Quick Play sheet and the challenge sheet. Every window is a PaperCard (cream /
 * near-black glass in the dark theme) with chocolate buttons; none blocks the world except the two sheets.
 */

const GAMES: { id: GameId; icon: typeof DieIcon; color: string }[] = [
  { id: "ludo", icon: DieIcon, color: "#FF8A1F" },
  { id: "igisoro", icon: SeedsIcon, color: "#27AE60" },
  { id: "pool", icon: PoolBallIcon, color: "#8a6a4a" },
  { id: "boxing", icon: Swords as unknown as typeof DieIcon, color: CORNER_COLORS.red },
];
const gameOf = (id: GameId) => GAMES.find((g) => g.id === id)!;
const stakeText = (s: number) => (s === 0 ? M.friendly : `${s} Stars each`);
const placeLabel = (game: GameId, place?: string) => {
  if (!place) return game === "boxing" ? mf("go.ring") : hallTitle(game);
  return game === "boxing" ? `Ring ${place.slice(1)} · ${hallTitle(game)}` : mf("go.table", { n: Number(place.slice(1)) + 1, hall: hallTitle(game) });
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function useNow(on = true, ms = 500) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [on, ms]);
  return now;
}
const secsLeft = (until: number, now: number) => Math.max(0, Math.ceil((until - now) / 1000));

/** close on Escape (the sheets) */
function useEscape(on: boolean, close: () => void) {
  useEffect(() => {
    if (!on) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [on, close]);
}

/* ---------------------------------------------------------------- a trip I asked for (Quick Play) */

/**
 * Quick Play's "go there": the hall, then the table / ring, then what to do on arrival (practice → the practice game;
 * find → search with this table as my place). The meeting walk (mm-go) uses the same steps.
 */
interface Trip {
  game: GameId;
  place?: string;
  then: "practice" | "find" | "sit" | "ring";
  stake?: number;
  walked?: boolean;
}
const useTrip = create<{ trip: Trip | null }>()(() => ({ trip: null }));

/**
 * Walk to `table` and sit, robustly: the hall controller drops a pending pick while it (re)mounts during the arrival,
 * so the request is repeated until the walk is under way (pickedTable) or done (`done()`); gives up after `ms`.
 */
function keepWalking(table: string, done: () => boolean, ms = 25_000): () => void {
  const t0 = Date.now();
  const id = setInterval(() => {
    if (done() || Date.now() - t0 > ms) return clearInterval(id);
    if (pickedTable() === table) return;
    const seated = useRoom.getState().seated;
    if (seated && !seated.startsWith(`${table}s`)) getUp();
    walkToTable(table);
  }, 700);
  return () => clearInterval(id);
}

function useTravel() {
  const router = useRouter();
  const path = usePathname();
  const roomId = useWorld((s) => s.roomId);
  const connected = useWorld((s) => s.connected);
  const seated = useRoom((s) => s.seated);
  const go = useMm((s) => s.go);
  const trip = useTrip((s) => s.trip);

  // the meeting (both said yes): to the hall instance that keeps my chair, then on to the chair
  const walkedFor = useRef<string | null>(null);
  const pushedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!go) return;
    // a meeting replaces my own Quick Play trip (it knows the table kept for both of us)
    if (useTrip.getState().trip) useTrip.setState({ trip: null });
    const hallPath = `/room/${go.hall}`;
    if (path !== hallPath) {
      if (pushedFor.current === `${go.id}:${path}`) return;
      pushedFor.current = `${go.id}:${path}`;
      setMmTarget(go.hall, go.roomId, Math.max(5000, go.until - Date.now()));
      // from the Fight lobby the Boxing hall is through its doorway; anywhere else straight to the hall's door
      if (go.hall === "boxing" && path === "/room/fight") goToRingFromLobby("R3" as RingId);
      // P3-FGT-25: the place on screen stays live while the hall gets ready, then a live cut (no boot screen)
      else if (!travelTo(go.hall as HallGame, hallPath)) router.push(hallPath);
      return;
    }
    if (!connected || roomId !== go.roomId || walkedFor.current === go.id) return;
    walkedFor.current = go.id;
    clearMmTarget();
    if (go.table && go.seat && seated !== go.seat) {
      const id = go.id;
      // (not tied to this effect: it stops by itself once seated / the meeting is over)
      keepWalking(go.table, () => useMm.getState().go?.id !== id || useRoom.getState().seated === go.seat, Math.max(5000, go.until - Date.now()));
    }
  }, [go, path, connected, roomId, seated, router]);

  // Quick Play's own trip
  useEffect(() => {
    if (!trip) return;
    const hallPath = `/room/${hallOf(trip.game)}`;
    if (path !== hallPath) {
      if (trip.game === "boxing" && path === "/room/fight" && trip.place) goToRingFromLobby(trip.place as RingId);
      else if (!travelTo(hallOf(trip.game) as HallGame, hallPath)) router.push(hallPath);
      return;
    }
    if (!connected || trip.walked) return;
    useTrip.setState({ trip: { ...trip, walked: true } });
    if (trip.game === "boxing") {
      setTimeout(() => {
        if (trip.place) walkToRing(trip.place as RingId);
        if (trip.then === "find") findOpponent("boxing", [trip.stake ?? 0]);
        useTrip.setState({ trip: null });
      }, 900);
    } else if (trip.place) {
      const place = trip.place;
      keepWalking(place, () => useTrip.getState().trip?.place !== place || !!useRoom.getState().seated?.startsWith(`${place}s`));
    }
  }, [trip, path, connected, router]);

  // seated at the trip's table: practice opens the game; find searches with this table as my place
  useEffect(() => {
    if (!trip || !trip.walked || !seated || trip.game === "boxing") return;
    if (trip.place && !seated.startsWith(`${trip.place}s`)) return;
    useTrip.setState({ trip: null });
    if (trip.then === "practice") {
      rememberBeforeGame(seated);
      router.push(`/play/${trip.game}`);
    } else if (trip.then === "find") findOpponent(trip.game, [trip.stake ?? 0], trip.place);
  }, [trip, seated, router]);
}

/* ---------------------------------------------------------------- search card */

function SearchCard({ phone }: { phone: boolean }) {
  const search = useMm((s) => s.search);
  const now = useNow(search.status === "searching", 1000);
  const offer = useGameOffer((s) => s.offer);
  const stars = useSession((s) => s.me?.stars ?? 0);
  const router = useRouter();
  const [widenAsked, setWidenAsked] = useState<string | null>(null);
  const found = useMm((s) => !!s.found);
  if (found || search.status !== "searching" || !("game" in search) || !search.game) return null;
  const game = search.game;
  const waited = Math.max(0, Math.floor((now - search.since) / 1000));
  const stakes = search.stakes ?? [0];
  const counts = search.searching ?? {};
  const same = stakes.reduce((n, s) => Math.max(n, counts[String(s)] ?? 0), 0);
  const other = Object.entries(counts).filter(([s]) => !stakes.includes(Number(s))).reduce((n, [, c]) => n + c, 0);
  const label = GAME_LABEL[game];
  const playable = choicesFor(offer, game, stars, [0, 25, 50, 100, 200]).filter((c) => c.ok).map((c) => c.stake);
  const wider = widerStakes(stakes, playable);
  const canWiden = wider.length > stakes.length;
  const key = `${game}:${stakes.join(",")}`;
  const showWiden = canWiden && waited >= MM_TIMING.widenAfterSeconds && widenAsked !== key;
  const showPractice = waited >= MM_TIMING.practiceAfterSeconds && game !== "boxing";
  const countLine = same === 0 ? mf("search.count0", { game: label }) : same === 1 ? mf("search.count1", { game: label }) : mf("search.countN", { n: same, game: label });
  const g = gameOf(game);
  return (
    <div role="status" aria-live="polite" className={`pcard pcard-sm pointer-events-auto w-[min(400px,92vw)] p-3 ${phone ? "w-[min(380px,60vw)] p-2" : ""}`}>
      <div className="relative flex items-center gap-2.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: `${g.color}33`, color: g.color }}>
          <Loader2 size={20} className="animate-spin" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-sm font-bold">{mf("search.title", { game: label })}</p>
          <p className="pmuted text-xs">
            <span className="num tabular-nums">{mmss(waited)}</span> · {mf("search.stakes", { stakes: stakeWords(stakes, M.friendly) })}
          </p>
        </div>
        <button type="button" onClick={() => cancelSearch()} className="pbtn pbtn-secondary min-h-11! w-11! shrink-0 px-0!" aria-label={mf("search.cancel")} title={mf("search.cancel")}>
          <X size={18} />
        </button>
      </div>
      <p className="pmuted relative mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <Users size={13} /> {countLine}
        {other > 0 && <span> · {mf("search.countOther", { n: other })}</span>}
      </p>
      {!phone && waited < MM_TIMING.widenAfterSeconds && <p className="pmuted relative mt-1 text-[11px]">{mf("search.where")}</p>}
      {showWiden && (
        <div className="pnote relative mt-2 text-xs!">
          <p className="font-semibold">{mf("search.widen", { stake: stakeWords(stakes.slice(0, 1), M.friendly), more: stakeWords(wider.slice(stakes.length), M.friendly) })}</p>
          <div className="mt-1.5 flex gap-1.5">
            <button type="button" className="pbtn pbtn-primary min-h-9! flex-1 text-xs!" onClick={() => (widenSearch(wider), setWidenAsked(key))}>{mf("search.widenYes")}</button>
            <button type="button" className="pbtn pbtn-secondary min-h-9! flex-1 text-xs!" onClick={() => setWidenAsked(key)}>{M.cancel}</button>
          </div>
        </div>
      )}
      {showPractice && !showWiden && (
        <div className="pnote relative mt-2 flex items-center gap-2 text-xs!">
          <span className="flex-1">{mf("search.practice")}</span>
          <button type="button" className="pbtn pbtn-primary min-h-9! px-3! text-xs!" onClick={() => (cancelSearch(), rememberBeforeGame(useRoom.getState().seated), router.push(`/play/${game}`))}>
            <Bot size={14} /> {mf("search.practiceGo")}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- opponent found */

function FoundCard() {
  const found = useMm((s) => s.found);
  const now = useNow(!!found);
  const acceptRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (found && !found.accepted) acceptRef.current?.focus();
  }, [found?.id, found?.accepted]);
  if (!found) return null;
  const g = gameOf(found.game);
  const left = secsLeft(found.until, now);
  return (
    <div role="alertdialog" aria-labelledby="mm-found-title" className="pcard pcard-sm pointer-events-auto w-[min(400px,92vw)] p-3">
      <div className="relative flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl" style={{ background: `${g.color}33`, color: g.color }}>
          <g.icon size={22} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p id="mm-found-title" className="font-bold">{mf("found.title")}</p>
          <p className="pmuted text-sm">
            {mf("found.body", { name: found.opponent.name, game: GAME_LABEL[found.game], stake: stakeText(found.stake) })}
          </p>
        </div>
        <span className="num shrink-0 text-lg font-black tabular-nums" aria-label={mf("found.within", { s: left })}>{left}</span>
      </div>
      {found.accepted ? (
        <p className="pmuted relative mt-3 flex items-center gap-2 text-sm"><Loader2 size={15} className="animate-spin" /> {mf("found.waitingOther", { name: found.opponent.name })}</p>
      ) : (
        <div className="relative mt-3 flex gap-2">
          <button type="button" onClick={() => respondFound(false)} className="pbtn pbtn-secondary min-h-12! flex-1"><X size={16} /> {mf("found.decline")}</button>
          <button ref={acceptRef} type="button" onClick={() => respondFound(true)} className="pbtn pbtn-primary min-h-12! flex-1"><Check size={16} /> {mf("found.accept")}</button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the meeting walk */

function GoCard() {
  const go = useMm((s) => s.go);
  const now = useNow(!!go, 1000);
  const path = usePathname();
  if (!go) return null;
  const left = secsLeft(go.until, now);
  const here = path === `/room/${go.hall}`;
  return (
    <div role="status" aria-live="polite" className="pcard pcard-sm pointer-events-auto w-[min(400px,92vw)] p-3 phone:w-[min(420px,52vw)] phone:p-2">
      <div className="relative flex items-center gap-3 phone:gap-2">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 phone:size-8"><MapPin size={18} /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-bold phone:text-sm">{mf("go.title", { place: placeLabel(go.game, go.table) })}</p>
          <p className="pmuted text-xs phone:hidden">{go.game === "boxing" ? mf("go.bodyBoxing") : mf("go.body", { name: go.opponent.name })}</p>
        </div>
        <span className="num shrink-0 text-sm font-bold tabular-nums phone:text-xs">{mf("go.left", { s: left })}</span>
      </div>
      {here && go.table && (
        <button type="button" onClick={() => walkToTable(go.table!)} className="pbtn pbtn-primary relative mt-2 min-h-10! w-full text-sm! phone:mt-1.5 phone:min-h-8! phone:text-xs!">
          <MapPin size={15} /> {mf("go.walk")}
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- challenges */

function InviteCard({ i }: { i: Incoming }) {
  const now = useNow();
  const offer = useGameOffer((s) => s.offer);
  const stars = useSession((s) => s.me?.stars ?? 0);
  useEffect(() => void useGameOffer.getState().load(true), [i.id]);
  const mine = choicesFor(offer, i.game, stars, [i.stake]).find((c) => c.stake === i.stake);
  const blocked = offer && mine && !mine.ok;
  const g = gameOf(i.game);
  const left = secsLeft(i.until, now);
  return (
    <div role="alertdialog" aria-label={mf("invite.title", { name: i.from.name })} className="pcard pcard-sm pointer-events-auto w-[min(400px,92vw)] p-3">
      <div className="relative flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl" style={{ background: `${g.color}33`, color: g.color }}><g.icon size={22} /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-bold">{mf("invite.title", { name: i.from.name })}</p>
          <p className="pmuted flex items-center gap-1 text-sm">
            {GAME_LABEL[i.game]} · {i.stake ? <>{i.stake} <Star size={12} className="fill-current" /> each</> : M.friendly}
          </p>
          {i.venue && <p className="pmuted text-xs">{mf("invite.venue", { place: placeLabel(i.game, i.venue.place) })}</p>}
        </div>
        <span className="num shrink-0 text-lg font-black tabular-nums">{left}</span>
      </div>
      {blocked && <p className="pnote relative mt-2 text-xs! font-semibold" role="status">{mf("invite.cantAccept")}</p>}
      <div className="relative mt-3 flex gap-2">
        <button type="button" onClick={() => respondInvite(i.id, false)} className="pbtn pbtn-secondary min-h-12! flex-1"><X size={16} /> {mf("invite.decline")}</button>
        <button type="button" disabled={!!blocked} onClick={() => respondInvite(i.id, true)} className="pbtn pbtn-primary min-h-12! flex-1 disabled:opacity-40"><Check size={16} /> {mf("invite.accept")}</button>
      </div>
    </div>
  );
}

function OutgoingCards() {
  const outgoing = useMm((s) => s.outgoing);
  const now = useNow(outgoing.length > 0);
  // the server's expiry may never arrive (a hall change): forget it shortly after its time
  useEffect(() => {
    const late = outgoing.filter((o) => now > o.until + 3000);
    if (late.length) useMm.setState((s) => ({ outgoing: s.outgoing.filter((o) => !late.includes(o)) }));
  }, [now, outgoing]);
  return (
    <>
      {outgoing.map((o) => (
        <div key={o.id} className="glass rounded-card pointer-events-auto flex items-center gap-2 px-3 py-2 text-sm font-semibold">
          <Loader2 size={15} className="animate-spin" /> {mf("invite.waiting", { name: o.to.name, game: GAME_LABEL[o.game], s: secsLeft(o.until, now) })}
          <button type="button" onClick={() => cancelInvite(o.id)} className="pbtn pbtn-secondary ml-1 min-h-8! px-2.5! text-xs!">{mf("invite.cancel")}</button>
        </div>
      ))}
    </>
  );
}

/* ---------------------------------------------------------------- the place picker (Quick Play + challenge) */

function PlacePicker({ game, value, onChange, statuses, compact }: { game: GameId; value: string | null; onChange: (id: string) => void; statuses: Record<string, VenueStatus>; compact?: boolean }) {
  const places = useMemo(() => placesOf(game), [game]);
  const cols = Math.max(...places.map((p) => p.col)) + 1;
  const kind = game === "boxing" ? "Ring" : "Table";
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} role="radiogroup" aria-label={game === "boxing" ? mf("qp.ring") : mf("qp.place")}>
      {places.map((p) => {
        const st = statuses[p.id];
        const free = isFree(st);
        const on = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={!free}
            onClick={() => onChange(p.id)}
            title={`${kind} ${p.n} · ${free ? mf("qp.free") : mf(`status.${st ?? "free"}` as "status.free")}`}
            aria-label={`${kind} ${p.n} · ${free ? mf("qp.free") : mf(`status.${st ?? "free"}` as "status.free")}`}
            className={`ptab num min-h-9! flex-none! justify-center! rounded-lg! px-0! text-xs! font-bold disabled:opacity-35 ${compact ? "min-h-8!" : ""} ${on ? "is-on" : ""}`}
            style={{ gridColumn: p.col + 1, gridRow: p.row + 1 }}
          >
            {p.n}
          </button>
        );
      })}
    </div>
  );
}

/** the live venue statuses of a game's hall while `on` (asked every 3 s) */
function useVenues(game: GameId, on: boolean) {
  const v = useMm((s) => s.venues[game]);
  useEffect(() => {
    if (!on) return;
    askVenues(game);
    const id = setInterval(() => askVenues(game), 3000);
    return () => clearInterval(id);
  }, [game, on]);
  return v;
}

/* ---------------------------------------------------------------- Quick Play */

function QuickPlaySheet() {
  const qp = useMm((s) => s.quickPlay);
  const phone = usePhoneHud();
  const authed = useSession((s) => s.status === "authenticated");
  const path = usePathname();
  const hereGame = GAMES.find((g) => path === `/room/${hallOf(g.id)}`)?.id;
  const [game, setGame] = useState<GameId>(qp?.game ?? hereGame ?? "ludo");
  const open = !!qp;
  const venues = useVenues(game, open && authed);
  const statuses = venues?.places ?? {};
  const inHall = path === `/room/${hallOf(game)}`;
  const suggested = useMemo(() => nearestFree(game, statuses, inHall ? { x: selfPose.x, z: selfPose.z } : null), [game, venues?.at, inHall]);
  const [place, setPlace] = useState<string | null>(null);
  const [mode, setMode] = useState<"practice" | "find" | "friend">(authed ? "find" : "practice");
  const { choices } = useStakeChoices(game);
  const [stake, setStake] = useState(() => defaultStake(choices));
  useEffect(() => {
    if (!qp) return;
    setGame(qp.game ?? hereGame ?? "ludo");
    setPlace(qp.place ?? null);
    setMode(authed ? "find" : "practice");
  }, [qp]);
  // P3-FGT-25: Boxing picked → start making the Boxing hall ready now (hidden, time-sliced), so by "Go" the trip is a
  // live cut instead of a wait (the other halls are small: they get ready in the moment the trip itself takes)
  useEffect(() => {
    if (!open || game !== "boxing" || inHall) return;
    const st = useStage.getState();
    if (!st.view || st.view === "hall:boxing") return;
    st.warmHall("boxing");
    // sheet closed without a trip: release it again (not while a trip is getting it ready, nor from the lobby)
    return () =>
      void setTimeout(() => {
        const s = useStage.getState();
        if (s.preparing !== "boxing" && s.view !== "hall:boxing" && s.view !== "hall:fight") s.coolHall("boxing");
      }, 1500);
  }, [open, game, inHall]);
  const close = () => useMm.setState({ quickPlay: null });
  useEscape(open, close);
  if (!qp) return null;
  const chosen = place && isFree(statuses[place]) ? place : suggested;
  const searching = venues?.searching ?? {};
  const looking = Object.values(searching).reduce((a, b) => Math.max(a, b), 0);
  const picked = choices.find((c) => c.stake === stake);
  const canPlay = mode === "practice" || (authed && (!!picked?.ok || choices.length === 0));
  const go = () => {
    close();
    if (mode === "friend") return openChallenge({ game, stake, ...(chosen ? { place: chosen } : {}) });
    if (mode === "find" && !chosen && game !== "boxing") return findOpponent(game, [stake]);
    if (mode === "find" && game !== "boxing" && !inHall) findOpponent(game, [stake]); // the search starts now; the table follows on arrival
    useTrip.setState({ trip: { game, ...(chosen ? { place: chosen } : {}), then: game === "boxing" ? (mode === "find" ? "find" : "ring") : mode === "find" ? "find" : "practice", stake } });
  };
  const goLabel = mode === "practice" ? mf("qp.goPractice") : mode === "find" ? mf("qp.goFind") : mf("qp.goFriend");
  return (
    <div className="pscrim pointer-events-auto z-30 grid place-items-center p-3" onClick={close}>
      <div className="w-[min(520px,96vw)] phone:w-[min(820px,97vw)]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={mf("qp.title")}>
        <PaperCard
          title={mf("qp.title")}
          icon={Zap}
          onClose={close}
          size={phone ? "sm" : "md"}
          className="max-h-[94vh]"
          bodyClassName="max-h-[calc(94vh-140px)] overflow-y-auto phone:max-h-[calc(96vh-112px)] phone:p-2.5!"
          footer={
            <button type="button" disabled={!canPlay} onClick={go} className="pbtn pbtn-primary min-h-12! w-full text-base! disabled:opacity-40" autoFocus>
              {mode === "practice" ? <Bot size={18} /> : mode === "find" ? <Search size={18} /> : <Swords size={18} />} {goLabel}
            </button>
          }
        >
          {/* phone (landscape): two columns — game / mode / stake on the left, the hall's places on the right */}
          <div className="phone:grid phone:grid-cols-2 phone:gap-x-3">
            {/* 1. game */}
            <div className="phone:col-start-1">
              <p className="plabel mb-1.5">{mf("qp.game")}</p>
              <div className="grid grid-cols-4 gap-1.5">
                {GAMES.map((g) => (
                  <button key={g.id} type="button" onClick={() => (setGame(g.id), setPlace(null))} aria-pressed={game === g.id} className={`ptab min-h-14! flex-col! gap-1! px-1! text-xs! phone:min-h-11! phone:gap-0.5! phone:text-[11px]! ${game === g.id ? "is-on" : ""}`}>
                    <span className="grid size-7 place-items-center rounded-lg phone:size-5" style={{ background: `${g.color}33`, color: g.color }}><g.icon size={14} /></span>
                    {GAME_LABEL[g.id]}
                  </button>
                ))}
              </div>
            </div>
            {/* 2. hall + 3. table / ring */}
            <div className="phone:col-start-2 phone:row-span-3 phone:row-start-1">
              <div className="mt-3 flex items-center justify-between gap-2 phone:mt-0">
                <p className="plabel">{mf("qp.hall")}: <span className="font-bold normal-case">{hallTitle(game)}</span></p>
                {authed && <p className="pmuted text-xs">{mf("qp.searching", { n: looking })}</p>}
              </div>
              <p className="plabel mb-1 mt-2 phone:mt-1">{game === "boxing" ? mf("qp.ring") : mf("qp.place")}{chosen ? `: ${chosen.startsWith("R") ? chosen.slice(1) : Number(chosen.slice(1)) + 1}` : ""}</p>
              <PlacePicker game={game} value={chosen} onChange={setPlace} statuses={statuses} compact={game === "boxing"} />
              <p className="pmuted mt-1 text-[11px]">{chosen ? mf("qp.placeHint") : mf("qp.allBusy")}</p>
            </div>
            {/* 4. mode */}
            <div className="phone:col-start-1">
              <p className="plabel mb-1.5 mt-3 phone:mt-2">{mf("qp.mode")}</p>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ["practice", Bot, mf("qp.practice"), mf("qp.practiceSub")],
                    ["find", Search, mf("qp.find"), mf("qp.findSub")],
                    ["friend", Swords, mf("qp.friend"), mf("qp.friendSub")],
                  ] as const
                ).map(([id, Icon, label, sub]) => (
                  <button key={id} type="button" disabled={id !== "practice" && !authed} onClick={() => setMode(id)} aria-pressed={mode === id} className={`ptab min-h-16! flex-col! gap-0.5! px-1! text-xs! disabled:opacity-35 phone:min-h-12! phone:text-[11px]! ${mode === id ? "is-on" : ""}`}>
                    <Icon size={18} />
                    <span className="font-bold">{label}</span>
                    <span className="text-[10px] opacity-75 phone:hidden">{sub}</span>
                  </button>
                ))}
              </div>
              {!authed && (
                <p className="pnote mt-2 text-xs!">
                  {mf("qp.signIn")} <Link href="/gate" className="underline">Sign in</Link>
                </p>
              )}
            </div>
            {/* 5. stake */}
            {mode !== "practice" && authed && (
              <div className="mt-3 phone:col-start-1 phone:mt-2">
                <p className="plabel mb-1.5">{mf("qp.stake")}</p>
                <StakeChips game={game} value={stake} onChange={setStake} compact />
              </div>
            )}
          </div>
        </PaperCard>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- challenge sheet */

function ChallengeSheet() {
  const ch = useMm((s) => s.challenge);
  const phone = usePhoneHud();
  const open = !!ch;
  const authed = useSession((s) => s.status === "authenticated");
  const path = usePathname();
  const hereGame = GAMES.find((g) => path === `/room/${hallOf(g.id)}`)?.id;
  const [who, setWho] = useState<{ uid: string; name: string } | null>(null);
  const [game, setGame] = useState<GameId>(ch?.game ?? hereGame ?? "ludo");
  const { choices } = useStakeChoices(game);
  const [stake, setStake] = useState(() => defaultStake(choices));
  const [place, setPlace] = useState<string | null>(null);
  const venues = useVenues(game, open && authed);
  const statuses = venues?.places ?? {};
  const inHall = path === `/room/${hallOf(game)}`;
  const suggested = useMemo(() => nearestFree(game, statuses, inHall ? { x: selfPose.x, z: selfPose.z } : null), [game, venues?.at, inHall]);
  const players = useWorld((s) => s.players);
  const online = useMm((s) => s.online);
  useEffect(() => {
    if (!ch) return;
    setWho(ch.uid && ch.name ? { uid: ch.uid, name: ch.name } : null);
    setGame(ch.game ?? hereGame ?? "ludo");
    if (ch.stake !== undefined) setStake(ch.stake);
    setPlace(ch.place ?? null);
    askOnline();
  }, [ch]);
  const close = () => useMm.setState({ challenge: null });
  useEscape(open, close);
  if (!ch) return null;
  const here = Object.values(players).filter((p) => p.verified && p.uid);
  const hereUids = new Set(here.map((p) => p.uid));
  const elsewhere = (online ?? []).filter((p) => !hereUids.has(p.uid));
  const chosen = place && isFree(statuses[place]) ? place : suggested;
  const picked = choices.find((c) => c.stake === stake);
  const canSend = authed && !!who && (!!picked?.ok || choices.length === 0);
  const send = () => {
    if (!who) return;
    sendChallenge(who.uid, game, stake, game === "boxing" ? undefined : (chosen ?? undefined));
    close();
  };
  const chip = (p: { uid: string; name: string; color?: string; level?: number }, busy?: boolean, where?: string) => (
    <button
      key={p.uid}
      type="button"
      onClick={() => setWho({ uid: p.uid, name: p.name })}
      aria-pressed={who?.uid === p.uid}
      className={`ptab min-h-11! flex-none! rounded-full! px-3! text-sm! ${who?.uid === p.uid ? "is-on" : ""}`}
    >
      <span className="size-2.5 rounded-full" style={{ background: p.color ?? "#999" }} />
      {p.name}
      {p.level !== undefined && <span className="text-xs opacity-70">Lvl {p.level}</span>}
      {where && <span className="text-[10px] opacity-70">{where === "plaza" ? "Plaza" : hallTitle((["ludo", "pool", "igisoro", "boxing"].includes(where) ? where : "ludo") as GameId)}</span>}
      {busy && <span className="text-[10px] opacity-70">· {mf("challenge.busy")}</span>}
    </button>
  );
  return (
    <div className="pscrim pointer-events-auto z-30 grid place-items-center p-3" onClick={close}>
      <div className="w-[min(500px,96vw)] phone:w-[min(820px,97vw)]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={mf("challenge.title", { name: who?.name ?? "" })}>
        <PaperCard
          title={mf("challenge.title", { name: who?.name ?? "" })}
          icon={Swords}
          onClose={close}
          size={phone ? "sm" : "md"}
          className="max-h-[94vh]"
          bodyClassName="max-h-[calc(94vh-140px)] overflow-y-auto phone:max-h-[calc(96vh-112px)] phone:p-2.5!"
          footer={
            authed ? (
              <button type="button" disabled={!canSend} onClick={send} className="pbtn pbtn-primary min-h-12! w-full text-base! disabled:opacity-40"><Swords size={18} /> {mf("challenge.send")}</button>
            ) : (
              <Link href="/gate" className="pbtn pbtn-primary min-h-12! w-full">{mf("challenge.signIn")}</Link>
            )
          }
        >
          <div className="phone:grid phone:grid-cols-2 phone:gap-x-3">
          <div className="phone:col-start-1">
          <p className="plabel mb-1.5">{mf("challenge.pickPerson")}</p>
          {here.length + elsewhere.length === 0 ? (
            <p className="pmuted text-sm">{mf("challenge.nobody")}</p>
          ) : (
            <div className="flex max-h-36 flex-col gap-1.5 overflow-y-auto">
              {here.length > 0 && <p className="pmuted text-[11px] font-semibold uppercase">{mf("challenge.nearby")}</p>}
              <div className="flex flex-wrap gap-1.5">{here.map((p) => chip({ uid: p.uid!, name: p.name, color: p.color, level: p.level }))}</div>
              {elsewhere.length > 0 && <p className="pmuted mt-1 text-[11px] font-semibold uppercase">{mf("challenge.online")}</p>}
              <div className="flex flex-wrap gap-1.5">{elsewhere.map((p) => chip(p, p.busy, p.where))}</div>
            </div>
          )}
          <p className="plabel mb-1.5 mt-3">{mf("challenge.game")}</p>
          <div className="grid grid-cols-4 gap-1.5">
            {GAMES.map((g) => (
              <button key={g.id} type="button" onClick={() => (setGame(g.id), setPlace(null))} aria-pressed={game === g.id} className={`ptab min-h-12! flex-col! gap-0.5! px-1! text-xs! ${game === g.id ? "is-on" : ""}`}>
                <g.icon size={16} /> {GAME_LABEL[g.id]}
              </button>
            ))}
          </div>
          <p className="plabel mb-1.5 mt-3">{mf("challenge.stake")}</p>
          <StakeChips game={game} value={stake} onChange={setStake} compact />
          </div>
          {game !== "boxing" && (
            <div className="phone:col-start-2 phone:row-start-1">
              <p className="plabel mb-1 mt-3 phone:mt-0">{mf("challenge.venue")}: <span className="normal-case">{chosen ? placeLabel(game, chosen) : mf("challenge.venueAuto")}</span></p>
              <PlacePicker game={game} value={chosen} onChange={setPlace} statuses={statuses} />
            </div>
          )}
          </div>
        </PaperCard>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the panel */

/** Matchmaking v2 inside the 3D world: HUD entry, search, found, challenges, the walk, Quick Play. */
export function MatchmakingV2() {
  const router = useRouter();
  const path = usePathname();
  const authed = useSession((s) => s.status === "authenticated");
  const phone = usePhoneHud();
  const ready = useMatch((s) => s.ready);
  const notice = useMatch((s) => s.notice);
  const incoming = useMm((s) => s.incoming);
  const search = useMm((s) => s.search);
  const nearPlayer = useWorld((s) => s.nearPlayer);
  const target = useWorld((s) => (s.nearPlayer ? s.players[s.nearPlayer] : undefined));
  const sheetOpen = useMm((s) => !!s.quickPlay || !!s.challenge);
  const chatOpen = useSocial((s) => s.chatOpen);
  useTravel();

  // incoming challenges past their time (a missed expiry): forget them; the same for a meeting walk whose time is up
  // (the server closes it, or the match started: never a card frozen at "0 s to get there")
  const go = useMm((s) => s.go);
  const now = useNow(incoming.length > 0 || !!go, 1000);
  useEffect(() => {
    const late = incoming.filter((i) => now > i.until + 3000);
    if (late.length) useMm.setState((s) => ({ incoming: s.incoming.filter((i) => !late.includes(i)) }));
    if (go && now > go.until + 3000) useMm.setState((s) => (s.go === go ? { go: null } : s));
  }, [now, incoming, go]);

  // "Challenge" from the person menu → the challenge sheet for that person
  const socialChallenge = useSocial((s) => s.challenge);
  useEffect(() => {
    if (!socialChallenge) return;
    const p = useWorld.getState().players[socialChallenge.id];
    openChallenge({ ...(p?.uid ? { uid: p.uid } : {}), name: socialChallenge.name });
    useSocial.setState({ challenge: null });
  }, [socialChallenge]);
  // phone: the action bar's "more" menu opens Quick Play
  useEffect(() => {
    const o = () => openQuickPlay();
    window.addEventListener(QUICK_MATCH_EVENT, o);
    return () => window.removeEventListener(QUICK_MATCH_EVENT, o);
  }, []);
  // a match is ready (found / challenge / seat): off to it (Boxing opens in its ring through the hall)
  useEffect(() => {
    if (!ready) return;
    if (ready.game === "boxing") return void useMatch.setState({ ready: null });
    rememberBeforeGame(useRoom.getState().seated);
    router.push(`/match/${ready.roomId}?game=${ready.game}&stake=${ready.stake}`);
    useMatch.setState({ ready: null });
  }, [ready, router]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useMatch.setState({ notice: null }), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const searching = search.status === "searching";
  return (
    <div className="pointer-events-none fixed inset-0 z-20">
      {/* HUD entry (under the profile chip): Quick Play — the search card replaces it while searching */}
      <div className="absolute left-[max(12px,env(safe-area-inset-left))] top-[84px] flex flex-col gap-2 phone:top-[46px]">
        {searching ? null : authed ? (
          <button type="button" onClick={() => openQuickPlay()} className="glass rounded-card icon-button pointer-events-auto flex items-center gap-2 px-4 py-2.5 text-sm font-bold phone:hidden">
            <Zap size={16} className="text-gold" /> {mf("hud.quickPlay")}
          </button>
        ) : (
          <Link href="/gate" className="glass rounded-card icon-button pointer-events-auto flex items-center gap-2 px-4 py-2.5 text-sm font-bold phone:hidden">
            <Zap size={16} className="text-gold" /> {mf("hud.signIn")}
          </Link>
        )}
      </div>

      {/* Challenge the person you stand next to (plaza / hall) */}
      {authed && nearPlayer && target?.verified && target.uid && !sheetOpen && !path.startsWith("/room/boxing") && (
        <div className={promptWrap(chatOpen, 1)}>
          <button
            type="button"
            onClick={() => openChallenge({ uid: target.uid!, name: target.name })}
            className="chip pointer-events-auto flex items-center gap-2 whitespace-nowrap border-gold/45! bg-ink-800/60! px-5 py-2.5 font-bold phone:max-w-[44vw] phone:overflow-hidden phone:px-3.5 phone:py-1.5 phone:text-sm"
          >
            <Swords size={18} className="text-gold" /> Challenge {target.name}
          </button>
        </div>
      )}

      <QuickPlaySheet />
      <ChallengeSheet />

      {/* found / meeting / challenges / notices: the top-centre stack (never blocks the world) */}
      <div className="absolute left-1/2 top-16 flex max-h-[70vh] -translate-x-1/2 flex-col items-center gap-2 overflow-y-auto phone:top-[80px] phone:max-h-[64vh] phone:gap-1.5">
        <SearchCard phone={phone} />
        <FoundCard />
        <GoCard />
        {incoming.map((i) => (
          <InviteCard key={i.id} i={i} />
        ))}
        <OutgoingCards />
        {notice && <div className="toast px-4 py-2 text-sm font-semibold text-warning-soft">{notice}</div>}
      </div>
    </div>
  );
}
