import type { GameId } from "@gukirana/contracts";

/**
 * Rules cards and resume / waiting strings (P2-NET-05), English source catalogue (i18n keys `rules.*`, `net.*`; the
 * rw / fr / sw catalogues in packages/i18n drop in later). This is the ONE place each game's rules text lives; it
 * follows docs/GAME-EXIT-RULES.md. Changing a game's text in substance = bump GAME_RULES_VERSION[game] in
 * packages/contracts (everyone accepts again). `{x}` placeholders are filled from the game's live settings.
 */
const en = {
  "rules.title": "{game} rules",
  "rules.intro": "Read these before your first live {game} match. You accept them once; we ask again only when they change.",
  "rules.introPractice": "Practice is you against the AI: no stake and nothing counts. The same rules apply to live matches.",
  "rules.version": "Rules version {v}",
  "rules.h.howTo": "How to play",
  "rules.h.win": "How to win",
  "rules.h.time": "Time limits",
  "rules.h.connection": "If a connection drops",
  "rules.h.leave": "Leaving and forfeits",
  "rules.h.stakes": "Stakes and fees",
  "rules.h.fair": "Fair play",

  "rules.igisoro.howTo": "Pick one of your pits with 2 or more seeds and sow them one by one around your two rows. If the last seed lands in an occupied pit you keep sowing from there.",
  "rules.igisoro.win": "In your front row, if both facing opponent pits hold seeds, you capture them and sow them on. A player left with no pit of 2+ seeds loses. After 300 moves the side with more seeds wins (equal = draw).",
  "rules.ludo.howTo": "Roll a 6 to bring a token out. A 6, a capture or reaching home gives you another roll. Land on an opponent to send it back to base; star and start squares are safe. Three 6s in a row lose the turn.",
  "rules.ludo.win": "Bring all four of your tokens home first.",
  "rules.pool.howTo": "8-Ball. The first ball you pot decides your group (solids 1–7 or stripes 9–15). Hit your own group first and make a ball reach a cushion; after a foul your opponent gets ball in hand.",
  "rules.pool.win": "Pot all of your group, then call a pocket and sink the 8. Sinking the 8 too early, or in the wrong pocket, loses.",
  "rules.boxing.howTo": "Real-time boxing in a ring: jab, cross, hooks and uppercuts to head or body, guard, slip and move. Stamina drains as you throw and comes back when you defend, move out of range and in the corner; head and body damage stay. Knocked down: press a punch in a steady rhythm to get up before ten, or you are counted out.",
  "rules.boxing.win": "{rounds} rounds of {roundSecs} s. Five virtual judges score every round (10-point must); a knockout or a stopped fight (3 knockdowns in a round) ends it early. Fouls draw warnings; enough warnings disqualify.",

  "rules.time.turn": "You have {turn} s for each turn. Run out and the game moves for you (a strike); {maxTimeouts} timeouts in a row is a forfeit. Your own move resets the count.",
  "rules.time.fight": "No turns: the fight runs live. Not acting at all for {idle} s in a round is a strike; {maxTimeouts} in a row is a forfeit.",
  "rules.time.match": "A match may last at most {maxMin} min; past that it is cancelled and every stake refunded.",
  "rules.connection.turn": "Reload or lose the network and your seat is kept: come back within {wait} s and you continue where you were. While it is your turn and you are away, your clock waits. Your opponent sees a countdown and waits for you.",
  "rules.connection.fight": "Lose the connection and the referee calls a time-out: the clock stops for both fighters for up to {wait} s. Back in time, the round resumes after a 3 s countdown.",
  "rules.connection.budget": "Each player may lose the connection at most {drops} times in a match, {budget} s away in all. Past that, or not back in time, the match is a forfeit (cancelled if no one had moved yet). If both players are gone, it is cancelled and every stake refunded.",
  "rules.leave.text": "Leaving before the first move cancels the match for free. Leaving after it is a forfeit: your opponent wins, you lose rating points and get no XP. In a friendly match you may also leave without penalty while your opponent is disconnected (the match is cancelled).",
  "rules.stakes.text": "Staked: both players put in the same stake, held in escrow by the server before the first move; the winner gets the whole pot. Stakes for {game}: {stakes} Stars each. Table fee: {fee}. A draw or a cancelled match returns every stake.",
  "rules.stakes.none": "Friendly matches only for {game} right now: no stake.",
  "rules.stakes.feeNone": "none",
  "rules.stakes.feeEach": "{fee} Stars each",
  "rules.fair.text": "The server decides every move, roll and result; randomness is provably fair (seed commit before the match, reveal after). No bots in live matches. One account per person, adults only. Collusion, scripts or abuse lead to suspension.",
  "rules.accept": "I have read and accept these rules",
  "rules.continue": "Accept and continue",
  "rules.cancel": "Not now",
  "rules.saving": "Saving…",
  "rules.failed": "Couldn't save your acceptance. Check your connection and try again.",

  // resume + waiting (LiveMatch, fight HUD)
  "net.reconnecting": "Connection lost. Reconnecting… {secs} s left to get back",
  "net.reconnectingNoTime": "Connection lost. Reconnecting…",
  "net.oppWaitTitle": "Your opponent lost connection",
  "net.oppWait": "Waiting for {name} to come back ({time}). If they don't, you win by forfeit.",
  "net.oppWaitBeforeStart": "Waiting for {name} to come back ({time}). No one has moved yet: if they don't return the match is cancelled and stakes refunded.",
  "net.keepWaiting": "Keep waiting",
  "net.leaveFree": "Leave without penalty",
  "net.leaveFreeNote": "Friendly match: leaving now cancels it. Nobody gains or loses anything.",
  "net.stakedWait": "Staked match: wait for the countdown. Leaving now would be a forfeit.",
  "net.clockPaused": "Clock paused while {name} is away",
  "net.budget": "Connection losses left this match: {n}",
  "net.resuming": "Taking you back to your {game} match…",
  "net.fightPaused": "Time-out: {name} lost connection ({time})",
} as const;

export type NetKey = keyof typeof en;
export const tr = (k: NetKey, vars: Record<string, string | number> = {}): string => en[k].replace(/\{(\w+)\}/g, (_, x: string) => (vars[x] === undefined ? `{${x}}` : String(vars[x])));

/** the per-game keys of a rules card */
export const gameKey = (g: GameId, part: "howTo" | "win"): NetKey => `rules.${g}.${part}` as NetKey;

export const mmss = (secs: number): string => {
  const s = Math.max(0, Math.ceil(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
