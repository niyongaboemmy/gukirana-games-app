"use client";
import { useEffect } from "react";
import { Star } from "lucide-react";
import { GAME_LABEL, STAKES, reasonText, type GameId } from "@/lib/match-store";
import { choicesFor, gameOffer, useGameOffer, type Choice } from "@/lib/games-offer";
import { useSession } from "@/lib/session";
import { fill, M } from "./strings";

/** the options for one game (0 = Friendly), loading the offer when the sheet opens */
export function useStakeChoices(game: GameId): { choices: Choice[]; friendly: { left: number; limit: number } | null } {
  const offer = useGameOffer((s) => s.offer);
  const stars = useSession((s) => s.me?.stars ?? 0);
  useEffect(() => void useGameOffer.getState().load(), []);
  const g = gameOffer(offer, game);
  return { choices: choicesFor(offer, game, stars, STAKES), friendly: g ? { left: g.friendly.left, limit: g.friendly.limit } : null };
}

/** the default pick: 25 Stars (or the biggest allowed stake below it), else Friendly when it is open */
export function defaultStake(choices: Choice[]): number {
  const ok = choices.filter((c) => c.ok);
  return [...ok].reverse().find((c) => c.stake > 0 && c.stake <= 25)?.stake ?? ok.find((c) => c.stake === 0)?.stake ?? ok[0]?.stake ?? 0;
}

/**
 * Friendly + the game's stakes as chips. A stake you can't play is disabled with its reason (title + the line below
 * when it is picked or when only Friendly is left); the friendly games left today are shown under the chips.
 */
export function StakeChips({ game, value, onChange, compact = false }: { game: GameId; value: number; onChange: (s: number) => void; compact?: boolean }) {
  const { choices, friendly } = useStakeChoices(game);
  const picked = choices.find((c) => c.stake === value);
  const ctx = { game, limit: friendly?.limit };
  const onlyFriendly = choices.length > 1 && choices.every((c) => c.stake === 0 || (!c.ok && c.reason === "INSUFFICIENT_FUNDS"));
  // the picked stake became unavailable (offer refreshed, game changed): move to one that is
  useEffect(() => {
    if (picked && picked.ok) return;
    const next = defaultStake(choices);
    if (next !== value && choices.some((c) => c.stake === next && c.ok)) onChange(next);
  }, [choices.map((c) => `${c.stake}:${c.ok}`).join(","), value]);
  const note = picked && !picked.ok ? reasonText(picked.reason, ctx) : onlyFriendly ? M.onlyFriendly : null;
  return (
    <div>
      <div className={`flex flex-wrap gap-1.5 ${compact ? "phone:flex-nowrap phone:gap-1 phone:overflow-x-auto" : ""}`}>
        {choices.map((c) => (
          <button
            key={c.stake}
            type="button"
            disabled={!c.ok}
            title={c.ok ? undefined : reasonText(c.reason, ctx)}
            aria-pressed={value === c.stake}
            onClick={() => onChange(c.stake)}
            className={`ptab num flex shrink-0 items-center gap-1 min-h-10! flex-none! rounded-full! px-3.5! text-sm! disabled:opacity-30 ${compact ? "min-h-8! px-3! phone:px-2.5!" : ""} ${value === c.stake ? "is-on" : ""}`}
          >
            {c.stake === 0 ? M.friendly : <>{c.stake} <Star size={12} className="fill-current" /></>}
          </button>
        ))}
      </div>
      {friendly && (
        <p className={`mt-1.5 text-xs ${friendly.left === 0 ? "pminus font-semibold" : "pmuted"}`}>
          {friendly.left > 0 ? fill(M.friendlyLeft, { n: friendly.left, limit: friendly.limit }) : fill(M.friendlyNone, { game: GAME_LABEL[game] })}
        </p>
      )}
      {note && <p className="pnote mt-2 text-xs! font-semibold">{note}</p>}
    </div>
  );
}


/** the stake line under the chips: what you pay and what the winner gets */
export function stakeNote(c: Choice | undefined): string {
  if (!c || c.stake === 0) return M.friendlyNote;
  return c.fee > 0 ? fill(M.stakeFeeNote, { total: c.total, stake: c.stake, fee: c.fee, pot: c.stake * 2 }) : fill(M.stakeNote, { pot: c.stake * 2 });
}
