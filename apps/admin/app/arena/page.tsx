"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * Arena back office (Tournament Arena, P2-ARN-02): open / close the building, events with scopes, capacity and
 * times, status moves, invites, participants, attendance, bars and the audit trail. Auth: the admin service token
 * (x-admin-token), kept in this tab only — same as /access and /finance. Every change is audited by the API; the
 * 3D arena picks changes up within ~5 s (people inside are walked out on close / bar).
 */
type Status = "draft" | "scheduled" | "doors_open" | "live" | "ended" | "cancelled";
type Rule =
  | { kind: "public" }
  | { kind: "members" }
  | { kind: "min_level"; level: number }
  | { kind: "invite" }
  | { kind: "participants"; guests: number }
  | { kind: "role"; roles: string[] }
  | { kind: "age_verified" };
type Kind = "tournament" | "final" | "exhibition" | "watch_party" | "ceremony";
type Ev = {
  id: string;
  title: string;
  kind: Kind;
  game: "pool" | "ludo" | "igisoro" | null;
  status: Status;
  doorsOpenAt: string;
  startsAt: string;
  endsAt: string;
  rules: Rule[];
  capacity: number;
  vipCapacity: number;
  passesIssued: number;
  seatsIssued?: number;
  vipIssued?: number;
  floorIssued?: number;
  description: string;
  openSeating?: boolean;
};
type Settings = { open: boolean; buildingOpen: boolean; effectiveOpen: boolean; defaultCapacity: number; maxConcourse: number; version: number; updatedBy: string };
type Person = { id: string; username: string | null; email: string | null; phone: string | null } | undefined;
type Bar = { user: Person; reason: string; until: string | null; barredBy: string; at: string; active: boolean };
type Audit = { id: string; who: string; action: string; target: string; detail: string | null; at: string };
type Attendance = {
  occupancy: { concourse: number; seats: number };
  passes: { user: Person; zone: string; via: string; at: string; inside: boolean }[];
};

const TRANSITIONS: Record<Status, Status[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["draft", "doors_open", "cancelled"],
  doors_open: ["live", "cancelled"],
  live: ["ended", "cancelled"],
  ended: [],
  cancelled: [],
};
const RULE_KINDS: Rule["kind"][] = ["public", "members", "min_level", "invite", "participants", "role", "age_verified"];
const RULE_LABEL: Record<Rule["kind"], string> = {
  public: "Public (guests too)",
  members: "Signed-in players",
  min_level: "Min level",
  invite: "Invite list",
  participants: "Participants",
  role: "Role holders",
  age_verified: "Age verified",
};
const KINDS: Kind[] = ["tournament", "final", "exhibition", "watch_party", "ceremony"];

const C = {
  bg: "#0e0f11",
  panel: "#18191c",
  panel2: "#1e1f23",
  line: "rgba(255,255,255,0.09)",
  text: "#f2f3f5",
  muted: "#a7abb2",
  accent: "#9b6a48", // chocolate (app primary)
  green: "#22c55e",
  red: "#ef4444",
};
const card: React.CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 };
const btn: React.CSSProperties = {
  background: C.accent,
  color: "#fff",
  border: 0,
  borderRadius: 10,
  padding: "8px 14px",
  fontWeight: 700,
  cursor: "pointer",
};
const btn2: React.CSSProperties = { ...btn, background: C.panel2, border: `1px solid ${C.line}` };
const btnDanger: React.CSSProperties = { ...btn2, color: C.red };
const input: React.CSSProperties = {
  background: C.bg,
  color: C.text,
  border: `1px solid ${C.line}`,
  borderRadius: 10,
  padding: "8px 10px",
};
const chip = (on: boolean): React.CSSProperties => ({
  ...btn2,
  padding: "4px 10px",
  fontWeight: 600,
  fontSize: 13,
  background: on ? "rgba(155,106,72,0.22)" : C.panel2,
  borderColor: on ? C.accent : C.line,
  color: on ? C.text : C.muted,
});
const th: React.CSSProperties = { padding: 6, borderBottom: `1px solid ${C.line}`, textAlign: "left", color: C.muted, fontWeight: 600 };
const td: React.CSSProperties = { padding: 6, borderBottom: `1px solid ${C.line}`, verticalAlign: "top" };
const row: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" };

/** ISO → value for <input type="datetime-local"> (local time) and back */
const toLocal = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => new Date(v).toISOString();
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const who = (p: Person) => (p ? (p.username ?? p.email ?? p.phone ?? p.id) : "?");
const ruleText = (r: Rule) =>
  r.kind === "min_level" ? `level ≥ ${r.level}` : r.kind === "role" ? `role: ${r.roles.join(", ")}` : r.kind === "participants" ? `participants${r.guests ? ` +${r.guests}` : ""}` : RULE_LABEL[r.kind];

type Draft = {
  id: string | null;
  title: string;
  kind: Kind;
  game: "" | "pool" | "ludo" | "igisoro";
  description: string;
  doorsOpenAt: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  vipCapacity: number;
  rules: Rule[];
};
const blank = (cap: number): Draft => {
  const start = new Date(Date.now() + 24 * 3600_000);
  start.setMinutes(0, 0, 0);
  return {
    id: null,
    title: "",
    kind: "tournament",
    game: "",
    description: "",
    doorsOpenAt: toLocal(new Date(start.getTime() - 30 * 60_000).toISOString()),
    startsAt: toLocal(start.toISOString()),
    endsAt: toLocal(new Date(start.getTime() + 2 * 3600_000).toISOString()),
    capacity: cap,
    vipCapacity: 0,
    rules: [{ kind: "members" }],
  };
};

export default function Arena() {
  const [token, setToken] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [bars, setBars] = useState<Bar[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(blank(200));
  const [sel, setSel] = useState<string | null>(null);
  const [invites, setInvites] = useState<{ user: Person; zone: string }[]>([]);
  const [parts, setParts] = useState<{ user: Person }[]>([]);
  const [att, setAtt] = useState<Attendance | null>(null);
  const [inv, setInv] = useState({ user: "", zone: "seats" });
  const [part, setPart] = useState("");
  const [bar, setBar] = useState({ user: "", reason: "", until: "" });
  const [roleText, setRoleText] = useState("press");

  useEffect(() => {
    try {
      setToken(sessionStorage.getItem("gk-admin-token") ?? "");
    } catch {
      /* private mode */
    }
  }, []);

  const call = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const r = await fetch(`/api/v1/admin/arena${path}`, {
        ...init,
        headers: {
          "x-admin-token": token,
          "x-admin-user": "back-office",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
      if (!r.ok) throw new Error(JSON.stringify(await r.json().catch(() => ({ status: r.status }))));
      return r.json() as Promise<T>;
    },
    [token],
  );

  const loadEvent = useCallback(
    async (id: string | null) => {
      if (!id) return;
      const [i, p, a] = await Promise.all([
        call<{ user: Person; zone: string }[]>(`/events/${id}/invites`),
        call<{ user: Person }[]>(`/events/${id}/participants`),
        call<Attendance>(`/events/${id}/attendance`),
      ]);
      setInvites(i);
      setParts(p);
      setAtt(a);
    },
    [call],
  );

  const load = useCallback(async () => {
    try {
      sessionStorage.setItem("gk-admin-token", token);
    } catch {
      /* private mode */
    }
    try {
      const [s, e, b, a] = await Promise.all([
        call<Settings>("/settings"),
        call<Ev[]>("/events"),
        call<Bar[]>("/bars"),
        call<Audit[]>("/audit?limit=50"),
      ]);
      setSettings(s);
      setEvents(e);
      setBars(b);
      setAudit(a);
      await loadEvent(sel);
    } catch (e) {
      setMsg({ ok: false, text: `Could not load: ${(e as Error).message}` });
    }
  }, [call, loadEvent, sel, token]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      const r = (await fn()) as { overbooked?: number } | undefined;
      await load();
      setMsg({ ok: true, text: r?.overbooked ? `${label} — ${r.overbooked} passes above the new capacity` : label });
    } catch (e) {
      setMsg({ ok: false, text: `${label} failed: ${(e as Error).message}` });
    }
  };

  const body = (o: unknown) => ({ body: JSON.stringify(o) });
  const selected = events.find((e) => e.id === sel) ?? null;

  const toggleRule = (k: Rule["kind"]) => {
    const has = draft.rules.some((r) => r.kind === k);
    const fresh: Rule =
      k === "min_level" ? { kind: k, level: 5 } : k === "participants" ? { kind: k, guests: 0 } : k === "role" ? { kind: k, roles: roleText.split(",").map((x) => x.trim()).filter(Boolean) } : ({ kind: k } as Rule);
    setDraft({ ...draft, rules: has ? draft.rules.filter((r) => r.kind !== k) : [...draft.rules, fresh] });
  };
  const setRule = (k: Rule["kind"], patch: Partial<Rule>) =>
    setDraft({ ...draft, rules: draft.rules.map((r) => (r.kind === k ? ({ ...r, ...patch } as Rule) : r)) });

  const saveDraft = () => {
    const payload = {
      title: draft.title.trim(),
      kind: draft.kind,
      game: draft.game || null,
      description: draft.description,
      doorsOpenAt: fromLocal(draft.doorsOpenAt),
      startsAt: fromLocal(draft.startsAt),
      endsAt: fromLocal(draft.endsAt),
      capacity: draft.capacity,
      vipCapacity: draft.vipCapacity,
      rules: draft.rules,
    };
    return draft.id
      ? act(`Saved ${payload.title}`, () => call(`/events/${draft.id}`, { method: "PATCH", ...body(payload) }))
      : act(`Created ${payload.title}`, () => call("/events", { method: "POST", ...body(payload) }));
  };

  const edit = (e: Ev) =>
    setDraft({
      id: e.id,
      title: e.title,
      kind: e.kind,
      game: e.game ?? "",
      description: e.description,
      doorsOpenAt: toLocal(e.doorsOpenAt),
      startsAt: toLocal(e.startsAt),
      endsAt: toLocal(e.endsAt),
      capacity: e.capacity,
      vipCapacity: e.vipCapacity,
      rules: e.rules,
    });

  return (
    <main style={{ minHeight: "100vh", background: C.bg, color: C.text, padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ ...row, justifyContent: "space-between" }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>Arena · Tournament Arena</h1>
          <div style={row}>
            <input type="password" placeholder="Admin token" value={token} onChange={(e) => setToken(e.target.value)} style={input} aria-label="Admin token" />
            <button type="button" onClick={() => void load()} style={btn}>
              Load
            </button>
          </div>
        </header>
        {msg && <div style={{ ...card, borderColor: msg.ok ? C.green : C.red, wordBreak: "break-word" }}>{msg.text}</div>}

        {settings && (
          <>
            <section style={card}>
              <h2 style={{ marginTop: 0, fontSize: 16 }}>Building</h2>
              <div style={row}>
                <button
                  type="button"
                  style={{ ...btn, background: settings.open ? C.green : C.red }}
                  aria-pressed={settings.open}
                  onClick={() =>
                    (settings.open ? confirm("Close the arena? Everyone inside (except staff) is walked out.") : true) &&
                    void act(settings.open ? "Arena closed" : "Arena opened", () => call("/settings", { method: "PUT", ...body({ open: !settings.open }) }))
                  }
                >
                  {settings.open ? "Open — click to close" : "Closed — click to open"}
                </button>
                <label style={{ color: C.muted }}>
                  Default capacity{" "}
                  <input type="number" min={1} max={1200} value={settings.defaultCapacity} onChange={(e) => setSettings({ ...settings, defaultCapacity: Number(e.target.value) })} style={{ ...input, width: 90 }} />
                </label>
                <label style={{ color: C.muted }}>
                  People per room{" "}
                  <input type="number" min={1} max={500} value={settings.maxConcourse} onChange={(e) => setSettings({ ...settings, maxConcourse: Number(e.target.value) })} style={{ ...input, width: 90 }} />
                </label>
                <button
                  type="button"
                  style={btn2}
                  onClick={() => void act("Settings saved", () => call("/settings", { method: "PUT", ...body({ defaultCapacity: settings.defaultCapacity, maxConcourse: settings.maxConcourse }) }))}
                >
                  Save
                </button>
                {!settings.buildingOpen && (
                  <span style={{ color: C.red, fontSize: 13 }}>The building is closed in the admin console — the arena stays shut until both switches are open.</span>
                )}
                <span style={{ color: C.muted, fontSize: 13 }}>
                  v{settings.version} · by {settings.updatedBy}
                </span>
              </div>
            </section>

            <section style={{ ...card, overflowX: "auto" }}>
              <h2 style={{ marginTop: 0, fontSize: 16 }}>Events</h2>
              <p style={{ color: C.muted, marginTop: 0, fontSize: 13 }}>
                Scheduled events open their doors, go live and end on their own by time. Two scheduled events may not overlap.
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Event", "Status", "Times", "Who may attend", "Passes", ""].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} style={{ background: e.id === sel ? "rgba(155,106,72,0.10)" : undefined }}>
                      <td style={td}>
                        <strong>{e.title}</strong>
                        <div style={{ color: C.muted, fontSize: 12 }}>
                          {e.kind}
                          {e.game ? ` · ${e.game}` : ""}
                        </div>
                      </td>
                      <td style={td}>{e.status}</td>
                      <td style={{ ...td, fontSize: 13 }}>
                        doors {when(e.doorsOpenAt)}
                        <br />
                        {when(e.startsAt)} → {when(e.endsAt)}
                      </td>
                      <td style={{ ...td, fontSize: 13 }}>{e.rules.map(ruleText).join(" AND ")}</td>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
                        seats {e.seatsIssued ?? 0}/{e.capacity}
                        <br />
                        VIP {e.vipIssued ?? 0}/{e.vipCapacity} · floor {e.floorIssued ?? 0}
                      </td>
                      <td style={td}>
                        <div style={row}>
                          <button type="button" style={chip(e.id === sel)} onClick={() => { setSel(e.id); void loadEvent(e.id); }}>
                            Lists
                          </button>
                          {!["ended", "cancelled"].includes(e.status) && (
                            <button type="button" style={chip(false)} onClick={() => edit(e)}>
                              Edit
                            </button>
                          )}
                          {TRANSITIONS[e.status].map((to) => (
                            <button
                              key={to}
                              type="button"
                              style={to === "cancelled" ? { ...chip(false), color: C.red } : chip(false)}
                              onClick={() =>
                                (to !== "cancelled" || confirm(`Cancel ${e.title}?`)) &&
                                void act(`${e.title} → ${to}`, () => call(`/events/${e.id}`, { method: "PATCH", ...body({ status: to }) }))
                              }
                            >
                              → {to}
                            </button>
                          ))}
                          {e.status === "draft" && (
                            <button type="button" style={{ ...chip(false), color: C.red }} onClick={() => void act(`Deleted ${e.title}`, () => call(`/events/${e.id}`, { method: "DELETE" }))}>
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section style={{ ...card, display: "grid", gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>{draft.id ? "Edit event" : "New event"}</h2>
              <div style={row}>
                <input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ ...input, minWidth: 240 }} aria-label="Title" />
                <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })} style={input} aria-label="Kind">
                  {KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
                <select value={draft.game} onChange={(e) => setDraft({ ...draft, game: e.target.value as Draft["game"] })} style={input} aria-label="Game">
                  <option value="">no game</option>
                  <option value="pool">pool</option>
                  <option value="ludo">ludo</option>
                  <option value="igisoro">igisoro</option>
                </select>
              </div>
              <input placeholder="Description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} style={input} aria-label="Description" />
              <div style={row}>
                {(["doorsOpenAt", "startsAt", "endsAt"] as const).map((k) => (
                  <label key={k} style={{ color: C.muted, fontSize: 13 }}>
                    {k === "doorsOpenAt" ? "Doors open" : k === "startsAt" ? "Starts" : "Ends"}{" "}
                    <input type="datetime-local" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} style={input} />
                  </label>
                ))}
              </div>
              <div style={row}>
                <label style={{ color: C.muted, fontSize: 13 }}>
                  Seats{" "}
                  <input type="number" min={1} max={1200} value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: Number(e.target.value) })} style={{ ...input, width: 90 }} />
                </label>
                <label style={{ color: C.muted, fontSize: 13 }}>
                  VIP seats{" "}
                  <input type="number" min={0} max={24} value={draft.vipCapacity} onChange={(e) => setDraft({ ...draft, vipCapacity: Number(e.target.value) })} style={{ ...input, width: 70 }} />
                </label>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ color: C.muted, fontSize: 13 }}>Who may attend (all selected rules must pass):</span>
                <div style={row}>
                  {RULE_KINDS.map((k) => (
                    <button key={k} type="button" style={chip(draft.rules.some((r) => r.kind === k))} aria-pressed={draft.rules.some((r) => r.kind === k)} onClick={() => toggleRule(k)}>
                      {RULE_LABEL[k]}
                    </button>
                  ))}
                </div>
                <div style={row}>
                  {draft.rules.map((r) =>
                    r.kind === "min_level" ? (
                      <label key={r.kind} style={{ color: C.muted, fontSize: 13 }}>
                        Level ≥ <input type="number" min={1} max={999} value={r.level} onChange={(e) => setRule("min_level", { level: Number(e.target.value) })} style={{ ...input, width: 70 }} />
                      </label>
                    ) : r.kind === "participants" ? (
                      <label key={r.kind} style={{ color: C.muted, fontSize: 13 }}>
                        Companions per participant <input type="number" min={0} max={4} value={r.guests} onChange={(e) => setRule("participants", { guests: Number(e.target.value) })} style={{ ...input, width: 60 }} />
                      </label>
                    ) : r.kind === "role" ? (
                      <label key={r.kind} style={{ color: C.muted, fontSize: 13 }}>
                        Roles (comma){" "}
                        <input
                          value={roleText}
                          onChange={(e) => {
                            setRoleText(e.target.value);
                            setRule("role", { roles: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) });
                          }}
                          style={input}
                        />
                      </label>
                    ) : null,
                  )}
                </div>
              </div>
              <div style={row}>
                <button type="button" style={btn} disabled={draft.title.trim().length < 3 || !draft.rules.length} onClick={() => void saveDraft()}>
                  {draft.id ? "Save changes" : "Create as draft"}
                </button>
                {draft.id && (
                  <button type="button" style={btn2} onClick={() => setDraft(blank(settings.defaultCapacity))}>
                    New instead
                  </button>
                )}
              </div>
            </section>

            {selected && (
              <section style={{ ...card, display: "grid", gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 16 }}>
                  {selected.title} · lists and attendance
                </h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
                  <div>
                    <strong style={{ fontSize: 14 }}>Invites</strong>
                    <div style={{ ...row, margin: "6px 0" }}>
                      <input placeholder="username, email, phone or id" value={inv.user} onChange={(e) => setInv({ ...inv, user: e.target.value })} style={{ ...input, flex: 1 }} aria-label="Invite user" />
                      <select value={inv.zone} onChange={(e) => setInv({ ...inv, zone: e.target.value })} style={input} aria-label="Invite zone">
                        <option value="seats">seats</option>
                        <option value="vip">VIP</option>
                        <option value="floor">floor</option>
                      </select>
                      <button type="button" style={btn2} disabled={!inv.user.trim()} onClick={() => void act(`Invited ${inv.user}`, () => call(`/events/${selected.id}/invites`, { method: "PUT", ...body(inv) }))}>
                        Invite
                      </button>
                    </div>
                    {invites.map((i) => (
                      <div key={i.user?.id} style={{ ...row, justifyContent: "space-between", fontSize: 13 }}>
                        <span>
                          {who(i.user)} · {i.zone}
                        </span>
                        <button type="button" style={{ ...chip(false), color: C.red }} onClick={() => void act(`Removed invite`, () => call(`/events/${selected.id}/invites?user=${encodeURIComponent(i.user?.id ?? "")}`, { method: "DELETE" }))}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <div>
                    <strong style={{ fontSize: 14 }}>Participants (competition floor)</strong>
                    <div style={{ ...row, margin: "6px 0" }}>
                      <input placeholder="username, email, phone or id" value={part} onChange={(e) => setPart(e.target.value)} style={{ ...input, flex: 1 }} aria-label="Participant" />
                      <button type="button" style={btn2} disabled={!part.trim()} onClick={() => void act(`Added ${part}`, () => call(`/events/${selected.id}/participants`, { method: "PUT", ...body({ user: part }) }))}>
                        Add
                      </button>
                    </div>
                    {parts.map((p) => (
                      <div key={p.user?.id} style={{ ...row, justifyContent: "space-between", fontSize: 13 }}>
                        <span>{who(p.user)}</span>
                        <button type="button" style={{ ...chip(false), color: C.red }} onClick={() => void act(`Removed participant`, () => call(`/events/${selected.id}/participants?user=${encodeURIComponent(p.user?.id ?? "")}`, { method: "DELETE" }))}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                {att && (
                  <div style={{ overflowX: "auto" }}>
                    <strong style={{ fontSize: 14 }}>
                      Attendance · {att.passes.length} passes · inside now {att.occupancy.concourse} (seated {att.occupancy.seats})
                    </strong>
                    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
                      <thead>
                        <tr>
                          {["Person", "Zone", "Via", "Claimed", "Inside"].map((h) => (
                            <th key={h} style={th}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {att.passes.map((p) => (
                          <tr key={p.user?.id}>
                            <td style={td}>{who(p.user)}</td>
                            <td style={td}>{p.zone}</td>
                            <td style={td}>{p.via}</td>
                            <td style={td}>{when(p.at)}</td>
                            <td style={td}>{p.inside ? "yes" : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            <section style={{ ...card, display: "grid", gap: 8, overflowX: "auto" }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>Bars</h2>
              <p style={{ color: C.muted, margin: 0, fontSize: 13 }}>
                A barred person can't enter the arena or claim passes; if inside, they are walked out within a few seconds and their passes are revoked.
              </p>
              <div style={row}>
                <input placeholder="username, email, phone or id" value={bar.user} onChange={(e) => setBar({ ...bar, user: e.target.value })} style={input} aria-label="Bar user" />
                <input placeholder="Reason (required)" value={bar.reason} onChange={(e) => setBar({ ...bar, reason: e.target.value })} style={{ ...input, flex: 1, minWidth: 200 }} aria-label="Reason" />
                <label style={{ color: C.muted, fontSize: 13 }}>
                  Until (optional) <input type="datetime-local" value={bar.until} onChange={(e) => setBar({ ...bar, until: e.target.value })} style={input} />
                </label>
                <button
                  type="button"
                  style={btnDanger}
                  disabled={!bar.user.trim() || bar.reason.trim().length < 3}
                  onClick={() => void act(`Barred ${bar.user}`, () => call("/bars", { method: "POST", ...body({ user: bar.user, reason: bar.reason, ...(bar.until ? { until: fromLocal(bar.until) } : {}) }) }))}
                >
                  Bar
                </button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Person", "Reason", "Until", "By", ""].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bars.map((b) => (
                    <tr key={b.user?.id} style={{ opacity: b.active ? 1 : 0.5 }}>
                      <td style={td}>{who(b.user)}</td>
                      <td style={td}>{b.reason}</td>
                      <td style={td}>{b.until ? when(b.until) : "no end"}</td>
                      <td style={{ ...td, fontSize: 12, color: C.muted }}>{b.barredBy}</td>
                      <td style={td}>
                        <button type="button" style={chip(false)} onClick={() => void act("Unbarred", () => call(`/bars?user=${encodeURIComponent(b.user?.id ?? "")}`, { method: "DELETE" }))}>
                          Unbar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section style={{ ...card, overflowX: "auto" }}>
              <h2 style={{ marginTop: 0, fontSize: 16 }}>Audit</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td style={{ ...td, whiteSpace: "nowrap", color: C.muted }}>{when(a.at)}</td>
                      <td style={td}>{a.who}</td>
                      <td style={td}>{a.action}</td>
                      <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{a.target}</td>
                      <td style={{ ...td, color: C.muted, wordBreak: "break-all" }}>{a.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
