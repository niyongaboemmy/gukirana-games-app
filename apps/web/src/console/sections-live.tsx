"use client";
import { useEffect, useMemo, useState } from "react";
import { Activity, BellRing, Building2, Coins, DoorClosed, DoorOpen, History, Inbox, Search, Star, Users, Wifi } from "lucide-react";
import type { Building, ConsoleOverview, PresenceTotals } from "@gukirana/contracts";
import { answerKnock, useOffices } from "@/admin-block/office-client";
import { consoleApi, errText, type AuditRow } from "./console-api";
import { C } from "./strings";

const fmt = (n: number) => n.toLocaleString("en-US");
const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};
const ACTIONS: Record<string, string> = {
  "user.suspend": "suspended an account",
  "user.reactivate": "reactivated an account",
  "building.open": "opened a building",
  "building.close": "closed a building",
  grant: "granted a role",
  revoke: "removed a role",
  "user.grant": "granted a role",
  "user.revoke": "removed a role",
  "role.create": "created a role",
  "role.update": "edited a role",
  "role.delete": "deleted a role",
  "role.assign": "assigned a role to an office",
  "role.unassign": "unassigned a role from an office",
  "office.create": "created an office",
  "office.update": "edited an office",
  "office.delete": "deleted an office",
};
export const actionText = (a: string) => ACTIONS[a] ?? ACTIONS[a.split(".").pop() ?? ""] ?? a.replace(/[._]/g, " ");
const shortWho = (w: string) => (w.startsWith("admin-token:") ? "Back office" : `${w.slice(0, 8)}…`);

function Bars({ online }: { online: PresenceTotals }) {
  const areas = ["plaza", "hall:pool", "hall:ludo", "hall:igisoro", "hall:arena", "hall:admin"];
  const max = Math.max(1, ...areas.map((a) => online.byArea[a] ?? 0));
  return (
    <div className="gkc-bars">
      {areas.map((a) => {
        const n = online.byArea[a] ?? 0;
        return (
          <div key={a} className="gkc-bar">
            <span className="truncate">{C.area(a)}</span>
            <i>
              <em style={{ width: `${(n / max) * 100}%` }} />
            </i>
            <b>{n}</b>
          </div>
        );
      })}
    </div>
  );
}

export function AuditList({ rows, empty = C.noAudit }: { rows: AuditRow[] | null; empty?: string }) {
  if (!rows) return <div className="gkc-skel h-40" />;
  if (!rows.length) return <p className="gkc-empty"><History size={22} />{empty}</p>;
  return (
    <div className="gkc-list">
      {rows.map((a) => (
        <div key={a.id} className="gkc-row">
          <span className="gkc-dot" style={{ background: a.action.includes("suspend") || a.action.includes("close") ? "var(--c-bad)" : "var(--c-choc-hi)" }} />
          <span className="min-w-0 flex-1">
            <span className="gkc-row-title block truncate">
              {shortWho(a.who)} {actionText(a.action)} <span className="gkc-muted">· {a.target.length > 20 ? `${a.target.slice(0, 8)}…` : a.target}</span>
            </span>
            {a.detail && <span className="gkc-row-sub block truncate">{a.detail}</span>}
          </span>
          <span className="gkc-row-sub whitespace-nowrap">{ago(a.at)}</span>
        </div>
      ))}
    </div>
  );
}

export function Overview({ data, myKnocks, can }: { data: ConsoleOverview | null; myKnocks: number; can: (s: string) => boolean }) {
  if (!data)
    return (
      <div className="gkc-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="gkc-skel h-24" />
        ))}
      </div>
    );
  const offices = useOffices.getState().offices;
  return (
    <>
      <div className="gkc-kpis">
        <div className="gkc-kpi">
          <span><Wifi size={14} /> {C.kpi.online}</span>
          <b>{fmt(data.online.total)}</b>
          <small>{fmt(data.online.signedIn)} {C.kpi.signedIn}</small>
        </div>
        {data.users && (
          <div className="gkc-kpi">
            <span><Users size={14} /> {C.kpi.players}</span>
            <b>{fmt(data.users.total)}</b>
            <small>{C.kpi.newToday(data.users.newToday)} · {C.kpi.suspended(data.users.suspended)}</small>
          </div>
        )}
        <div className="gkc-kpi">
          <span><BellRing size={14} /> {C.kpi.knocks}</span>
          <b>{myKnocks}</b>
          <small>{C.kpi.knocksSub}</small>
        </div>
        {data.finance && (
          <div className="gkc-kpi">
            <span><Coins size={14} /> {C.kpi.fees}</span>
            <b>{fmt(data.finance.feesStars)} <Star size={16} className="inline fill-current align-[-1px] text-[#d9ab3c]" /></b>
            <small>{fmt(data.finance.feesCoins)} coins · {data.finance.matchesSettled} matches</small>
          </div>
        )}
      </div>
      <div className="gkc-cols">
        <section className="gkc-card">
          <h2><Activity size={16} /> {C.kpi.online} <small className="gkc-live">live</small></h2>
          {data.online.total ? <Bars online={data.online} /> : <p className="gkc-empty"><Wifi size={22} />{C.noOne}</p>}
        </section>
        <section className="gkc-card">
          <h2><Building2 size={16} /> {C.sections.buildings}</h2>
          <div className="gkc-list">
            {data.buildings.map((b) => (
              <div key={b.id} className="gkc-row">
                {b.open ? <DoorOpen size={18} className="text-[var(--c-ok)]" /> : <DoorClosed size={18} className="text-[var(--c-bad)]" />}
                <span className="min-w-0 flex-1">
                  <span className="gkc-row-title block">{b.name}</span>
                  {!b.open && b.message && <span className="gkc-row-sub block truncate">{b.message}</span>}
                </span>
                <span className={`gkc-pill ${b.open ? "ok" : "bad"}`}>{b.open ? C.open : C.closed}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="gkc-card">
          <h2><Inbox size={16} /> {C.offices}</h2>
          <div className="gkc-list">
            {offices.map((o) => {
              const n = data.offices[o.id] ?? 0;
              return (
                <div key={o.id} className="gkc-row">
                  <span className="gkc-dot" style={{ background: n === 0 ? "var(--c-muted)" : n === 1 ? "var(--c-ok)" : "var(--c-warn)" }} />
                  <span className="gkc-row-title flex-1">{o.name}</span>
                  <span className="gkc-row-sub">{n ? C.inside(n) : C.vacant}</span>
                </div>
              );
            })}
          </div>
        </section>
        {can("monitor") && data.audit && (
          <section className="gkc-card">
            <h2><History size={16} /> {C.recent}</h2>
            <AuditList rows={data.audit} />
          </section>
        )}
      </div>
    </>
  );
}

/** People knocking at the office this console was opened from (realtime, the same protocol as the door). */
export function Visitors({ office }: { office: string | null }) {
  const incoming = useOffices((s) => s.incoming);
  const occupancy = useOffices((s) => s.occupancy);
  const offices = useOffices((s) => s.offices);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const mine = incoming.filter((k) => !office || k.office === office);
  const name = (id: string) => offices.find((o) => o.id === id)?.name ?? id;
  return (
    <div className="gkc-cols">
      <section className="gkc-card">
        <h2><BellRing size={16} /> {office ? `${name(office)} · ${C.kpi.knocks}` : C.kpi.knocks} {mine.length > 0 && <small className="gkc-live">{mine.length} waiting</small>}</h2>
        {!office && <p className="gkc-note mb-3">{C.notInOffice}</p>}
        {mine.length === 0 ? (
          <p className="gkc-empty"><DoorClosed size={22} />{C.noKnocks}</p>
        ) : (
          mine.map((k) => {
            const left = Math.max(0, Math.ceil((k.expiresAt - Date.now()) / 1000));
            return (
              <div key={k.knockId} className="gkc-knock">
                <span className="gkc-avatar" style={{ background: "var(--c-choc)" }}>{k.from.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="gkc-row-title block truncate">{k.from.name}</span>
                  <span className="gkc-row-sub block">
                    {k.from.level ? `Level ${k.from.level} · ` : ""}at {name(k.office)} · <span className="gkc-timer">{left}s</span>
                  </span>
                </span>
                <button type="button" className="gkc-btn sm secondary" onClick={() => answerKnock(k.knockId, false)}>{C.decline}</button>
                <button type="button" className="gkc-btn sm success" onClick={() => answerKnock(k.knockId, true)}>{C.letIn}</button>
              </div>
            );
          })
        )}
      </section>
      <section className="gkc-card">
        <h2><Inbox size={16} /> {C.offices}</h2>
        <div className="gkc-list">
          {offices.map((o) => {
            const n = occupancy[o.id] ?? 0;
            return (
              <div key={o.id} className="gkc-row">
                <span className="gkc-dot" style={{ background: n === 0 ? "var(--c-muted)" : n === 1 ? "var(--c-ok)" : "var(--c-warn)" }} />
                <span className="min-w-0 flex-1">
                  <span className="gkc-row-title block">{o.name}{o.id === office ? " · you" : ""}</span>
                  <span className="gkc-row-sub block truncate">{o.description}</span>
                </span>
                <span className="gkc-row-sub whitespace-nowrap">{n ? C.inside(n) : C.vacant}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function Buildings({ canEdit, toast }: { canEdit: boolean; toast: (t: string) => void }) {
  const [list, setList] = useState<Building[] | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => void consoleApi.buildings().then(setList).catch((e) => toast(errText(e)));
  useEffect(load, []);
  const set = async (b: Building, open: boolean) => {
    setBusy(true);
    try {
      const r = await consoleApi.setBuilding(b.id, open, open ? "" : msg.trim());
      setList((l) => l?.map((x) => (x.id === r.id ? r : x)) ?? null);
      toast(open ? `${b.name} is open` : `${b.name} is closed`);
      setClosing(null);
      setMsg("");
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!list) return <div className="gkc-skel h-60" />;
  return (
    <div className="gkc-cols">
      {list.map((b) => (
        <section key={b.id} className="gkc-card">
          <h2>
            {b.open ? <DoorOpen size={16} /> : <DoorClosed size={16} />} {b.name}
            <small><span className={`gkc-pill ${b.open ? "ok" : "bad"}`}>{b.open ? C.open : C.closed}</span></small>
          </h2>
          {!b.open && b.message && <p className="gkc-note mb-3">{b.message}</p>}
          <p className="gkc-row-sub mb-3">Changed {ago(b.updatedAt)}{b.updatedBy ? ` by ${shortWho(b.updatedBy)}` : ""}</p>
          {closing === b.id ? (
            <div className="grid gap-2">
              <label className="gkc-row-sub" htmlFor={`msg-${b.id}`}>{C.closeMsg}</label>
              <div className="gkc-input">
                <input id={`msg-${b.id}`} value={msg} maxLength={120} placeholder={C.closeMsgPh} onChange={(e) => setMsg(e.target.value)} autoFocus />
              </div>
              <div className="flex gap-2">
                <button type="button" className="gkc-btn secondary flex-1" onClick={() => setClosing(null)}>{C.cancel}</button>
                <button type="button" className="gkc-btn danger flex-1" disabled={busy} onClick={() => void set(b, false)}>{C.closeBuilding}</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="flex-1 font-bold">{b.open ? "Players can walk in" : "Doors shut for players"}</span>
              <button
                type="button"
                role="switch"
                aria-checked={b.open}
                aria-label={`${b.name} open`}
                disabled={!canEdit || busy}
                className="gkc-switch disabled:opacity-50"
                onClick={() => (b.open ? setClosing(b.id) : void set(b, true))}
              />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export function Monitor({ toast }: { toast: (t: string) => void }) {
  const [online, setOnline] = useState<PresenceTotals | null>(null);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    let on = true;
    const pull = () => {
      void consoleApi.presence().then((p) => on && setOnline(p)).catch(() => undefined);
      void consoleApi.audit("").then((r) => on && setRows(r)).catch((e) => on && toast(errText(e)));
    };
    pull();
    const t = setInterval(pull, 5000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [toast]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows && (t ? rows.filter((a) => `${a.who} ${actionText(a.action)} ${a.target} ${a.detail ?? ""}`.toLowerCase().includes(t)) : rows);
  }, [rows, q]);
  return (
    <div className="gkc-cols">
      <section className="gkc-card">
        <h2><Activity size={16} /> {C.kpi.online} <small className="gkc-live">{online ? `${online.total} · ${online.signedIn} ${C.kpi.signedIn}` : "…"}</small></h2>
        {online ? online.total ? <Bars online={online} /> : <p className="gkc-empty"><Wifi size={22} />{C.noOne}</p> : <div className="gkc-skel h-40" />}
      </section>
      <section className="gkc-card">
        <h2><History size={16} /> {C.recent} <small className="gkc-live">live</small></h2>
        <div className="gkc-input mb-3">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={C.auditSearch} aria-label={C.auditSearch} />
        </div>
        <div className="max-h-[52vh] overflow-y-auto">
          <AuditList rows={shown} />
        </div>
      </section>
    </div>
  );
}
