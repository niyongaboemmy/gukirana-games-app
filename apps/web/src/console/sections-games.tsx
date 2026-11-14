"use client";
import { useEffect, useMemo, useState } from "react";
import { Dices, History, Plus, Save, Undo2, X } from "lucide-react";
import { DEFAULT_FIGHT_RULES, FIGHT_RULE_BOUNDS, GAME_SETTING_BOUNDS, GameSettingsSchema, isFightGame, type FightRules, type GameSettings, type GameSettingsRow } from "@gukirana/contracts";
import { consoleApi, errText } from "./console-api";
import { ReasonField, reasonError } from "./user-drawer";
import { G } from "./strings";

const CATALOGUE = [10, 25, 50, 100, 200, 500, 1000, 2000];
type NumKey = "friendlyPerDay" | "turnSeconds" | "reconnectSeconds" | "joinSeconds" | "maxTimeouts" | "maxMatchMinutes";
const NUMBERS: NumKey[] = ["friendlyPerDay", "turnSeconds", "reconnectSeconds", "joinSeconds", "maxTimeouts", "maxMatchMinutes"];
/** fight games (boxing, P3-FGT-01): the round block; `turnSeconds` is unused there */
type FightKey = keyof FightRules;
const FIGHT_NUMBERS: FightKey[] = ["rounds", "roundSeconds", "restSeconds", "idleSeconds"];

const whoText = (by: string) => (by.startsWith("admin-token:") ? G.backOffice : by === "system" ? G.system : /^[0-9a-f-]{36}$/i.test(by) ? G.staff : by);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** plain-words problems with an edit (same rules as the API: @gukirana/contracts GameSettingsSchema) */
export function settingsProblems(s: GameSettings): string[] {
  const r = GameSettingsSchema.safeParse(s);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const field = String(i.path[0] ?? "");
    if (field === "fight") {
      const fk = String(i.path[1] ?? "") as FightKey;
      const fb = FIGHT_RULE_BOUNDS[fk];
      return fb ? G.between(G.fightFields[fk] ?? fk, fb.min, fb.max) : `${G.fightTitle}: ${i.message}`;
    }
    const label = G.fields[field] ?? field;
    const b = GAME_SETTING_BOUNDS[(field === "stakes" ? "stake" : field) as keyof typeof GAME_SETTING_BOUNDS];
    if (i.message === "DUPLICATE_STAKE") return G.dupStake;
    if (i.message === "TOO_MANY_STAKES") return G.tooManyStakes(GAME_SETTING_BOUNDS.stakesCount.max);
    if (i.message === "RECONNECT_TOO_LONG") return G.reconnectTooLong;
    return b ? G.between(label, b.min, b.max) : `${label}: ${i.message}`;
  });
}

function GameCard({ row, canEdit, toast, onSaved }: { row: GameSettingsRow; canEdit: boolean; toast: (t: string) => void; onSaved: (r: GameSettingsRow) => void }) {
  const [draft, setDraft] = useState<GameSettings>(row.settings);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState("");
  const [history, setHistory] = useState<GameSettingsRow[] | null>(null);
  useEffect(() => setDraft(row.settings), [row]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(row.settings);
  const problems = useMemo(() => settingsProblems(draft), [draft]);
  const setNum = (k: NumKey, v: string) => setDraft((d) => ({ ...d, [k]: v === "" ? Number.NaN : Number(v) }));
  const fightGame = isFightGame(row.game);
  const setFight = (k: FightKey, v: string) => setDraft((d) => ({ ...d, fight: { ...(d.fight ?? DEFAULT_FIGHT_RULES), [k]: v === "" ? Number.NaN : Number(v) } }));
  const toggleStake = (s: number) => setDraft((d) => ({ ...d, stakes: d.stakes.includes(s) ? d.stakes.filter((x) => x !== s) : [...d.stakes, s].sort((a, b) => a - b) }));
  const addCustom = () => {
    const n = Number(custom);
    if (!Number.isInteger(n) || n < GAME_SETTING_BOUNDS.stake.min || n > GAME_SETTING_BOUNDS.stake.max) return setErr(G.between(G.fields.stakes ?? "Stake", GAME_SETTING_BOUNDS.stake.min, GAME_SETTING_BOUNDS.stake.max));
    if (!draft.stakes.includes(n)) toggleStake(n);
    setCustom("");
    setErr(null);
  };
  const save = async () => {
    const re = reasonError(reason);
    if (problems.length) return setErr(problems[0]!);
    if (re) return setErr(re);
    setBusy(true);
    try {
      const r = await consoleApi.setGame(row.game, draft, reason.trim());
      onSaved(r);
      setReason("");
      setErr(null);
      setHistory(null);
      toast(G.saved(row.name, r.version));
    } catch (e) {
      const code = (e as { code?: string }).code;
      setErr(code === "SETTINGS_CHANGED" ? G.changedMeanwhile : code === "INVALID_SETTINGS" ? G.invalid : errText(e));
    } finally {
      setBusy(false);
    }
  };
  const openHistory = () => void consoleApi.gameHistory(row.game).then(setHistory).catch((e) => toast(errText(e)));

  return (
    <section className="gkc-card">
      <h2>
        <Dices size={16} /> {row.name}
        <small>
          <span className={`gkc-pill ${draft.enabled ? "ok" : "bad"}`}>{draft.enabled ? G.live : G.paused}</span>
        </small>
      </h2>
      <p className="gkc-row-sub mb-3">{G.version(row.version, when(row.updatedAt), whoText(row.updatedBy))}</p>

      <div className="mb-3 flex items-center gap-3">
        <span className="flex-1 font-bold">{draft.enabled ? G.enabledOn : G.enabledOff}</span>
        <button type="button" role="switch" aria-checked={draft.enabled} aria-label={`${row.name}: ${G.fields.enabled}`} disabled={!canEdit || busy} className="gkc-switch disabled:opacity-50" onClick={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {NUMBERS.filter((k) => !(fightGame && k === "turnSeconds")).map((k) => {
          const b = GAME_SETTING_BOUNDS[k];
          const id = `${row.game}-${k}`;
          return (
            <div key={k} className="grid gap-1">
              <label htmlFor={id} className="gkc-row-sub">
                {G.fields[k]} <span className="gkc-muted">({b.min}–{b.max})</span>
              </label>
              <div className="gkc-input">
                <input id={id} type="number" inputMode="numeric" min={b.min} max={b.max} step={1} disabled={!canEdit} value={Number.isNaN(draft[k]) ? "" : draft[k]} onChange={(e) => setNum(k, e.target.value)} />
                <span className="gkc-muted text-xs">{G.units[k]}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="gkc-row-sub mt-1">{draft.friendlyPerDay === 0 ? G.friendlyOff : G.friendlyHelp}</p>

      {fightGame && (
        <div className="mt-3 grid gap-1.5">
          <span className="gkc-row-sub font-bold">{G.fightTitle}</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {FIGHT_NUMBERS.map((k) => {
              const b = FIGHT_RULE_BOUNDS[k];
              const id = `${row.game}-fight-${k}`;
              const v = (draft.fight ?? DEFAULT_FIGHT_RULES)[k];
              return (
                <div key={k} className="grid gap-1">
                  <label htmlFor={id} className="gkc-row-sub">
                    {G.fightFields[k]} <span className="gkc-muted">({b.min}–{b.max})</span>
                  </label>
                  <div className="gkc-input">
                    <input id={id} type="number" inputMode="numeric" min={b.min} max={b.max} step={1} disabled={!canEdit} value={Number.isNaN(v) ? "" : v} onChange={(e) => setFight(k, e.target.value)} />
                    <span className="gkc-muted text-xs">{G.fightUnits[k]}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="gkc-row-sub">{G.fightHelp}</p>
        </div>
      )}

      <div className="mt-3 grid gap-1.5">
        <span className="gkc-row-sub">{G.fields.stakes}</span>
        <div className="flex flex-wrap gap-1.5">
          {[...new Set([...CATALOGUE, ...draft.stakes])].sort((a, b) => a - b).map((s) => (
            <button key={s} type="button" disabled={!canEdit} aria-pressed={draft.stakes.includes(s)} onClick={() => toggleStake(s)} className={`gkc-btn sm ${draft.stakes.includes(s) ? "primary" : "secondary"}`}>
              {s}
            </button>
          ))}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <div className="gkc-input flex-1">
              <input type="number" inputMode="numeric" placeholder={G.customStake} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label={G.customStake} />
            </div>
            <button type="button" className="gkc-btn secondary" onClick={addCustom}>
              <Plus size={15} /> {G.add}
            </button>
          </div>
        )}
        <p className="gkc-row-sub">{draft.stakes.length ? G.stakesHelp : G.friendlyOnly}</p>
      </div>

      {canEdit && dirty && (
        <div className="mt-3 grid gap-2">
          {problems.length > 0 && (
            <ul className="gkc-note">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <ReasonField id={`${row.game}-reason`} value={reason} onChange={(v) => (setReason(v), setErr(null))} error={err} placeholder={G.reasonPh} label={G.reasonLabel} />
          <p className="gkc-row-sub">{G.appliesTo}</p>
          <div className="gkc-foot">
            <button type="button" className="gkc-btn secondary" disabled={busy} onClick={() => (setDraft(row.settings), setErr(null))}>
              <Undo2 size={15} /> {G.undo}
            </button>
            <button type="button" className="gkc-btn primary" disabled={busy || problems.length > 0} onClick={() => void save()}>
              <Save size={15} /> {G.save}
            </button>
          </div>
        </div>
      )}
      {!dirty && err && <p className="gkc-field-err mt-2">{err}</p>}

      <div className="mt-3">
        {history ? (
          <div className="grid gap-1">
            <div className="flex items-center justify-between">
              <span className="gkc-row-sub font-bold">{G.history}</span>
              <button type="button" className="gkc-icon-btn" aria-label={G.closeHistory} onClick={() => setHistory(null)}>
                <X size={15} />
              </button>
            </div>
            <ul className="gkc-list">
              {history.map((h) => (
                <li key={h.version} className="gkc-row">
                  <span className="grid">
                    <span className="gkc-row-title">
                      v{h.version} · {h.reason ?? "—"}
                    </span>
                    <span className="gkc-row-sub">
                      {when(h.updatedAt)} · {whoText(h.updatedBy)} · {G.summary(h.settings)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <button type="button" className="gkc-btn secondary sm" onClick={openHistory}>
            <History size={14} /> {G.showHistory}
          </button>
        )}
      </div>
    </section>
  );
}

/** Games (P1-GAME-06): per-game live-match rules — open / paused, friendly games per day, stakes, timers. Audited. */
export function Games({ canEdit, toast }: { canEdit: boolean; toast: (t: string) => void }) {
  const [rows, setRows] = useState<GameSettingsRow[] | null>(null);
  useEffect(() => void consoleApi.games().then(setRows).catch((e) => toast(errText(e))), [toast]);
  if (!rows) return <div className="gkc-skel h-60" />;
  return (
    <>
      <p className="gkc-note mb-3">{G.intro}</p>
      <div className="gkc-cols">
        {rows.map((r) => (
          <GameCard key={r.game} row={r} canEdit={canEdit} toast={toast} onSaved={(n) => setRows((l) => l?.map((x) => (x.game === n.game ? n : x)) ?? null)} />
        ))}
      </div>
    </>
  );
}
