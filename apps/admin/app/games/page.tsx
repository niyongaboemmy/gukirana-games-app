"use client";
import { useCallback, useEffect, useState } from "react";
import { Dices, History, KeyRound, RefreshCw, Save, Undo2 } from "lucide-react";
import { DEFAULT_FIGHT_RULES, FIGHT_RULE_BOUNDS, GAME_SETTING_BOUNDS, GameSettingsSchema, isFightGame, type FightRules, type GameSettings, type GameSettingsRow } from "@gukirana/contracts";
import { plainError } from "../errors";

/**
 * Games back office (P1-GAME-06): per-game live-match rules — open / paused, friendly games per player per Kigali
 * day, the stakes players may choose, turn / reconnect / join timers, timeouts before forfeit, longest match. Same API
 * as the staff console's Games section (/console/games, x-admin-token). Every save is a new version with a reason,
 * audited; new matches use it at once, running matches keep their rules. docs/GAME-EXIT-RULES.md explains each value.
 */
const C = {
  bg: "#0b0b0d",
  panel: "rgba(28,29,32,0.72)",
  panel2: "rgba(255,255,255,0.06)",
  line: "rgba(255,255,255,0.09)",
  text: "#ffffff",
  muted: "rgba(255,255,255,0.62)",
  chocHi: "#8f603f",
  chocLo: "#53331f",
  chocTint: "rgba(150,100,68,0.24)",
  green: "#4ade80",
  red: "#f87171",
};
const card: React.CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, backdropFilter: "blur(14px)" };
const btn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, background: `linear-gradient(180deg, ${C.chocHi}, ${C.chocLo})`, color: "#fff", border: 0, borderRadius: 10, padding: "8px 14px", fontWeight: 700, cursor: "pointer" };
const btn2: React.CSSProperties = { ...btn, background: C.chocTint, boxShadow: `inset 0 0 0 1px rgba(150,100,68,0.4)` };
const input: React.CSSProperties = { background: "rgba(0,0,0,0.35)", color: C.text, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 10px", width: "100%", boxSizing: "border-box" };

const FIELDS: { key: "friendlyPerDay" | "turnSeconds" | "reconnectSeconds" | "joinSeconds" | "maxTimeouts" | "maxMatchMinutes"; label: string; unit: string }[] = [
  { key: "friendlyPerDay", label: "Friendly games per player per day", unit: "games" },
  { key: "turnSeconds", label: "Time per turn", unit: "s" },
  { key: "reconnectSeconds", label: "Time to reconnect", unit: "s" },
  { key: "joinSeconds", label: "Time to join", unit: "s" },
  { key: "maxTimeouts", label: "Timeouts in a row before forfeit", unit: "turns" },
  { key: "maxMatchMinutes", label: "Longest match", unit: "min" },
];

/** fight games (boxing, P3-FGT-01): the round block (bounds FIGHT_RULE_BOUNDS); `turnSeconds` is unused there */
const FIGHT_FIELDS: { key: keyof FightRules; label: string; unit: string }[] = [
  { key: "rounds", label: "Rounds", unit: "rounds" },
  { key: "roundSeconds", label: "Round length", unit: "s" },
  { key: "restSeconds", label: "Rest between rounds", unit: "s" },
  { key: "idleSeconds", label: "No input before an idle strike", unit: "s" },
];

function problems(s: GameSettings): string[] {
  const r = GameSettingsSchema.safeParse(s);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const f = String(i.path[0] ?? "");
    if (f === "fight") {
      const ff = FIGHT_FIELDS.find((x) => x.key === i.path[1]);
      return ff ? `${ff.label}: a whole number from ${FIGHT_RULE_BOUNDS[ff.key].min} to ${FIGHT_RULE_BOUNDS[ff.key].max}.` : `Fight rules: ${i.message}`;
    }
    const b = GAME_SETTING_BOUNDS[(f === "stakes" ? "stake" : f) as keyof typeof GAME_SETTING_BOUNDS];
    if (i.message === "DUPLICATE_STAKE") return "Each stake can be listed only once.";
    if (i.message === "RECONNECT_TOO_LONG") return "Time to reconnect must be shorter than the longest match.";
    if (i.message === "TOO_MANY_STAKES") return `At most ${GAME_SETTING_BOUNDS.stakesCount.max} stakes.`;
    const label = FIELDS.find((x) => x.key === f)?.label ?? (f === "stakes" ? "Stakes" : f);
    return b ? `${label}: a whole number from ${b.min} to ${b.max}.` : `${label}: ${i.message}`;
  });
}

function Editor({ row, call, onSaved }: { row: GameSettingsRow; call: <T>(path: string, init?: RequestInit) => Promise<T>; onSaved: (r: GameSettingsRow, msg: string) => void }) {
  const [d, setD] = useState<GameSettings>(row.settings);
  const [stakes, setStakes] = useState(row.settings.stakes.join(", "));
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<GameSettingsRow[] | null>(null);
  useEffect(() => {
    setD(row.settings);
    setStakes(row.settings.stakes.join(", "));
  }, [row]);
  const parsed: GameSettings = { ...d, stakes: stakes.split(/[\s,]+/).filter(Boolean).map(Number) };
  const probs = problems(parsed);
  const dirty = JSON.stringify(parsed) !== JSON.stringify(row.settings);
  const save = async () => {
    if (probs.length) return setErr(probs[0]!);
    if (reason.trim().length < 3) return setErr("Please give a reason (3 to 200 characters).");
    try {
      const r = await call<GameSettingsRow>(`/console/games/${row.game}`, { method: "PUT", body: JSON.stringify({ settings: parsed, reason: reason.trim() }) });
      setReason("");
      setErr(null);
      setHistory(null);
      onSaved(r, `${row.name}: version ${r.version} saved. New matches use it now; running matches keep their rules.`);
    } catch (e) {
      setErr(plainError(e));
    }
  };
  return (
    <section style={{ ...card, display: "grid", gap: 12 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Dices size={18} />
        <h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>{row.name}</h2>
        <span style={{ fontSize: 12, fontWeight: 700, color: d.enabled ? C.green : C.red }}>{d.enabled ? "LIVE" : "PAUSED"}</span>
      </header>
      <div style={{ color: C.muted, fontSize: 13 }}>
        Version {row.version} · {new Date(row.updatedAt).toLocaleString()} · {row.updatedBy.startsWith("admin-token:") ? "Back office" : row.updatedBy === "system" ? "System" : "Staff"}
        {row.reason ? ` · “${row.reason}”` : ""}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} />
        Live matches open (practice vs AI is always open)
      </label>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
        {FIELDS.filter((f) => !(isFightGame(row.game) && f.key === "turnSeconds")).map((f) => {
          const b = GAME_SETTING_BOUNDS[f.key];
          return (
            <label key={f.key} style={{ display: "grid", gap: 4, fontSize: 13, color: C.muted }}>
              <span>
                {f.label} ({b.min}–{b.max} {f.unit})
              </span>
              <input type="number" min={b.min} max={b.max} step={1} value={Number.isNaN(d[f.key]) ? "" : d[f.key]} onChange={(e) => setD({ ...d, [f.key]: e.target.value === "" ? Number.NaN : Number(e.target.value) })} style={input} />
            </label>
          );
        })}
      </div>
      {isFightGame(row.game) && (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
          {FIGHT_FIELDS.map((f) => {
            const b = FIGHT_RULE_BOUNDS[f.key];
            const v = (d.fight ?? DEFAULT_FIGHT_RULES)[f.key];
            return (
              <label key={f.key} style={{ display: "grid", gap: 4, fontSize: 13, color: C.muted }}>
                <span>
                  {f.label} ({b.min}–{b.max} {f.unit})
                </span>
                <input type="number" min={b.min} max={b.max} step={1} value={Number.isNaN(v) ? "" : v} onChange={(e) => setD({ ...d, fight: { ...(d.fight ?? DEFAULT_FIGHT_RULES), [f.key]: e.target.value === "" ? Number.NaN : Number(e.target.value) } })} style={input} />
              </label>
            );
          })}
        </div>
      )}
      <label style={{ display: "grid", gap: 4, fontSize: 13, color: C.muted }}>
        <span>
          Stakes players can choose, Stars each ({GAME_SETTING_BOUNDS.stake.min}–{GAME_SETTING_BOUNDS.stake.max}, up to {GAME_SETTING_BOUNDS.stakesCount.max}; empty = friendly only)
        </span>
        <input value={stakes} onChange={(e) => setStakes(e.target.value)} placeholder="25, 50, 100, 200" style={input} />
      </label>
      {dirty && (
        <>
          {probs.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, color: C.red, fontSize: 13 }}>
              {probs.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <input placeholder="Why this change (required, kept in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} style={input} aria-label="Reason" />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" style={btn2} onClick={() => (setD(row.settings), setStakes(row.settings.stakes.join(", ")), setErr(null))}>
              <Undo2 size={15} /> Undo
            </button>
            <button type="button" style={{ ...btn, opacity: probs.length ? 0.5 : 1 }} disabled={probs.length > 0} onClick={() => void save()}>
              <Save size={15} /> Save new version
            </button>
          </div>
        </>
      )}
      {err && <div style={{ color: C.red, fontSize: 13, fontWeight: 700 }}>{err}</div>}
      <div>
        {history ? (
          <ul style={{ margin: 0, paddingLeft: 18, color: C.muted, fontSize: 13, display: "grid", gap: 4 }}>
            {history.map((h) => (
              <li key={h.version}>
                v{h.version} · {new Date(h.updatedAt).toLocaleString()} · {h.reason ?? "—"} · {h.settings.enabled ? "live" : "paused"}, {h.settings.friendlyPerDay} friendly/day, stakes {h.settings.stakes.join(", ") || "none"}, turn {h.settings.turnSeconds} s, reconnect {h.settings.reconnectSeconds} s
              </li>
            ))}
          </ul>
        ) : (
          <button type="button" style={btn2} onClick={() => void call<GameSettingsRow[]>(`/console/games/${row.game}/history`).then(setHistory).catch((e) => setErr(plainError(e)))}>
            <History size={15} /> History
          </button>
        )}
      </div>
    </section>
  );
}

export default function GamesAdmin() {
  const [token, setToken] = useState("");
  const [rows, setRows] = useState<GameSettingsRow[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    try {
      setToken(sessionStorage.getItem("gk-admin-token") ?? "");
    } catch {
      /* private mode */
    }
  }, []);
  const call = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const r = await fetch(`/api/v1${path}`, { ...init, headers: { "x-admin-token": token, "x-admin-user": "back-office", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
      if (!r.ok) throw new Error(JSON.stringify(await r.json().catch(() => ({ status: r.status }))));
      return r.json() as Promise<T>;
    },
    [token],
  );
  const load = async () => {
    setMsg(null);
    try {
      sessionStorage.setItem("gk-admin-token", token);
    } catch {
      /* private mode */
    }
    try {
      setRows(await call<GameSettingsRow[]>("/console/games"));
    } catch (e) {
      setMsg({ ok: false, text: `Could not load: ${plainError(e)}` });
    }
  };
  return (
    <main style={{ minHeight: "100vh", background: `radial-gradient(1000px 500px at 10% -10%, rgba(143,96,63,0.14), transparent 60%), ${C.bg}`, color: C.text, padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24 }}>Games · live-match rules</h1>
            <p style={{ margin: "4px 0 0", color: C.muted, fontSize: 14 }}>New matches use a saved version at once. Running matches keep the rules they started with. Practice vs AI is unlimited.</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <KeyRound size={16} color={C.muted} />
            <input type="password" placeholder="Admin token" value={token} onChange={(e) => setToken(e.target.value)} style={{ ...input, width: 220 }} aria-label="Admin token" />
            <button type="button" onClick={() => void load()} style={btn}>
              <RefreshCw size={15} /> Load
            </button>
          </div>
        </header>
        {msg && <div style={{ ...card, borderColor: msg.ok ? C.green : C.red, color: msg.ok ? C.green : C.red, fontWeight: 700 }}>{msg.text}</div>}
        {rows?.map((r) => (
          <Editor key={r.game} row={r} call={call} onSaved={(n, text) => (setRows((l) => l?.map((x) => (x.game === n.game ? n : x)) ?? null), setMsg({ ok: true, text }))} />
        ))}
      </div>
    </main>
  );
}
