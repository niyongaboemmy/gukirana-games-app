"use client";
import { useCallback, useEffect, useState } from "react";
import { Ban, CheckCircle2, Coins, KeyRound, Scale, Search, ShieldCheck, Star, TrendingUp, UserRound, X } from "lucide-react";
import type { ConsoleUser, UserStatus } from "@gukirana/contracts";
import { consoleApi, errText, type FinanceReport, type RoleRow, type UserDetail } from "./console-api";
import { actionText } from "./sections-live";
import { C } from "./strings";

const fmt = (n: number) => n.toLocaleString("en-US");
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const ROLE_NAMES: Record<string, string> = { super_admin: "Super Admin", it_admin: "IT Administrator", accountant: "Accountant", support_agent: "Support Agent", event_manager: "Event Manager" };
const roleName = (r: string) => ROLE_NAMES[r] ?? r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function StatusPill({ s }: { s: string }) {
  return <span className={`gkc-pill ${s === "active" ? "ok" : "bad"}`}>{s === "active" ? C.active : C.suspended}</span>;
}

export function People({ canStatus, canRoles, toast, me }: { canStatus: boolean; canRoles: boolean; toast: (t: string) => void; me: string | null }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | UserStatus>("");
  const [items, setItems] = useState<ConsoleUser[] | null>(null);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(
    async (p: number) => {
      try {
        const r = await consoleApi.users(q, status, p);
        setItems((cur) => (p === 0 ? r.items : [...(cur ?? []), ...r.items]));
        setMore(r.more);
        setPage(p);
      } catch (e) {
        toast(errText(e));
        setItems((cur) => cur ?? []);
      }
    },
    [q, status, toast],
  );
  // search as you type (debounced)
  useEffect(() => {
    const t = setTimeout(() => void load(0), 250);
    return () => clearTimeout(t);
  }, [load]);

  const updated = (u: Partial<ConsoleUser> & { id: string }) => setItems((l) => l?.map((x) => (x.id === u.id ? { ...x, ...u } : x)) ?? null);

  return (
    <>
      <div className="gkc-toolbar">
        <div className="gkc-input min-w-[220px] flex-1">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={C.search} aria-label={C.search} />
          {q && (
            <button type="button" aria-label="Clear" onClick={() => setQ("")}>
              <X size={16} />
            </button>
          )}
        </div>
        <div className="gkc-seg" role="group" aria-label="Status">
          {(["", "active", "suspended"] as const).map((s) => (
            <button key={s || "all"} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s === "" ? C.all : s === "active" ? C.active : C.suspended}
            </button>
          ))}
        </div>
      </div>
      <section className="gkc-card">
        {!items ? (
          <div className="grid gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="gkc-skel h-11" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="gkc-empty"><UserRound size={22} />{C.noUsers}</p>
        ) : (
          <>
            <table className="gkc-table gkc-hide-sm">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Contact</th>
                  <th>{C.level}</th>
                  <th>{C.rolesL}</th>
                  <th>Status</th>
                  <th>{C.joined}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id} onClick={() => setOpen(u.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(u.id)}>
                    <td className="font-bold">{u.username ?? "—"}</td>
                    <td className="gkc-muted">{u.email ?? u.phone ?? "—"}</td>
                    <td>{u.level}</td>
                    <td>
                      <span className="flex flex-wrap gap-1">{u.roles.length ? u.roles.map((r) => <span key={r} className="gkc-pill role">{roleName(r)}</span>) : <span className="gkc-muted">—</span>}</span>
                    </td>
                    <td><StatusPill s={u.status} /></td>
                    <td className="gkc-muted">{date(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="gkc-list gkc-show-sm">
              {items.map((u) => (
                <button key={u.id} type="button" className="gkc-row" onClick={() => setOpen(u.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="gkc-row-title block truncate">{u.username ?? "—"} <span className="gkc-muted">· Lv {u.level}</span></span>
                    <span className="gkc-row-sub block truncate">{u.email ?? u.phone ?? "—"}{u.roles.length ? ` · ${u.roles.map(roleName).join(", ")}` : ""}</span>
                  </span>
                  <StatusPill s={u.status} />
                </button>
              ))}
            </div>
            {more && (
              <div className="mt-3 text-center">
                <button type="button" className="gkc-btn secondary" onClick={() => void load(page + 1)}>{C.more}</button>
              </div>
            )}
          </>
        )}
      </section>
      {open && <UserDrawer id={open} me={me} canStatus={canStatus} canRoles={canRoles} toast={toast} onClose={() => setOpen(null)} onChanged={updated} />}
    </>
  );
}

function UserDrawer({ id, me, canStatus, canRoles, toast, onClose, onChanged }: { id: string; me: string | null; canStatus: boolean; canRoles: boolean; toast: (t: string) => void; onClose: () => void; onChanged: (u: Partial<ConsoleUser> & { id: string }) => void }) {
  const [u, setU] = useState<UserDetail | null>(null);
  const [acting, setActing] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [grantRole, setGrantRole] = useState("");
  const load = useCallback(() => void consoleApi.user(id).then(setU).catch((e) => toast(errText(e))), [id, toast]);
  useEffect(load, [load]);
  useEffect(() => {
    if (canRoles) void consoleApi.roles().then(setRoles).catch(() => undefined);
  }, [canRoles]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("keydown", k, { capture: true });
    return () => window.removeEventListener("keydown", k, { capture: true });
  }, [onClose]);

  const next: UserStatus = u?.status === "active" ? "suspended" : "active";
  const apply = async () => {
    if (reason.trim().length < 3) return setErr(C.reasonShort);
    try {
      const r = await consoleApi.setStatus(id, next, reason.trim());
      toast(r.status === "suspended" ? "Account suspended" : "Account reactivated");
      onChanged({ id, status: r.status });
      setActing(false);
      setReason("");
      setErr(null);
      load();
    } catch (e) {
      setErr(errText(e));
    }
  };
  const roleChange = async (role: string, add: boolean) => {
    try {
      await (add ? consoleApi.grant(id, role) : consoleApi.revoke(id, role));
      toast(add ? `${roleName(role)} granted` : `${roleName(role)} removed`);
      load();
      const fresh = await consoleApi.user(id);
      onChanged({ id, roles: fresh.roles.map((r) => r.role) });
    } catch (e) {
      toast(errText(e));
    }
  };

  return (
    <>
      <div className="gkc-scrim" onClick={onClose} />
      <aside className="gkc-drawer" role="dialog" aria-modal="true" aria-label="Account">
        <div className="gkc-drawer-head">
          <span className="gkc-avatar" style={{ background: "var(--c-choc)", width: 40, height: 40 }}>{(u?.username ?? "?").slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <span className="gkc-row-title block truncate text-lg">{u?.username ?? "…"}</span>
            <span className="gkc-row-sub block truncate">{u ? (u.email ?? u.phone ?? "—") : ""}</span>
          </span>
          <button type="button" className="gkc-icon-btn" onClick={onClose} aria-label={C.cancel}>
            <X size={18} />
          </button>
        </div>
        <div className="gkc-drawer-body">
          {!u ? (
            <div className="gkc-skel h-64" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill s={u.status} />
                {u.roles.map((r) => (
                  <span key={r.role} className="gkc-pill role">
                    {roleName(r.role)}
                    {canRoles && (
                      <button type="button" aria-label={`${C.revoke} ${roleName(r.role)}`} onClick={() => void roleChange(r.role, false)}>
                        <X size={12} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <div className="gkc-stats">
                <div>
                  <small>{C.level}</small>
                  <b>{u.level}</b>
                </div>
                <div>
                  <small>{C.stars}</small>
                  <b>{fmt(u.stars)}</b>
                </div>
                <div>
                  <small>{C.coins}</small>
                  <b>{fmt(u.coins)}</b>
                </div>
              </div>
              <p className="gkc-row-sub mb-4">{C.joined} {date(u.createdAt)} · ID {u.id.slice(0, 8)}…</p>

              {canStatus && u.id !== me && (
                <section className="gkc-card mb-4">
                  <h2>{u.status === "active" ? <Ban size={16} /> : <CheckCircle2 size={16} />} {u.status === "active" ? C.suspend : C.reactivate}</h2>
                  {!acting ? (
                    <button type="button" className={`gkc-btn ${u.status === "active" ? "danger" : "success"} w-full`} onClick={() => setActing(true)}>
                      {u.status === "active" ? C.suspend : C.reactivate}
                    </button>
                  ) : (
                    <div className="grid gap-2">
                      <label className="gkc-row-sub" htmlFor="reason">{C.reason}</label>
                      <div className="gkc-input">
                        <input id="reason" value={reason} maxLength={200} placeholder={C.reasonPh} onChange={(e) => (setReason(e.target.value), setErr(null))} autoFocus />
                      </div>
                      {err && <p className="text-sm font-bold text-[var(--c-bad)]">{err}</p>}
                      <div className="flex gap-2">
                        <button type="button" className="gkc-btn secondary flex-1" onClick={() => (setActing(false), setErr(null))}>{C.cancel}</button>
                        <button type="button" className={`gkc-btn ${next === "suspended" ? "danger" : "success"} flex-1`} onClick={() => void apply()}>{C.confirm}</button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {canRoles && (
                <section className="gkc-card mb-4">
                  <h2><KeyRound size={16} /> {C.grant}</h2>
                  <div className="flex gap-2">
                    <div className="gkc-input flex-1">
                      <select value={grantRole} onChange={(e) => setGrantRole(e.target.value)} aria-label={C.role}>
                        <option value="">{C.role}…</option>
                        {roles.filter((r) => !u.roles.some((x) => x.role === r.id)).map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                    <button type="button" className="gkc-btn primary" disabled={!grantRole} onClick={() => (void roleChange(grantRole, true), setGrantRole(""))}>{C.grant}</button>
                  </div>
                </section>
              )}

              <section className="gkc-card">
                <h2>{C.history}</h2>
                {u.history.length === 0 ? (
                  <p className="gkc-row-sub">{C.noHistory}</p>
                ) : (
                  <div className="gkc-list">
                    {u.history.map((h) => (
                      <div key={h.id} className="gkc-row">
                        <span className="min-w-0 flex-1">
                          <span className="gkc-row-title block">{actionText(h.action)}</span>
                          {h.detail && <span className="gkc-row-sub block">{h.detail}</span>}
                        </span>
                        <span className="gkc-row-sub whitespace-nowrap">{date(h.at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

export function Roles({ toast }: { toast: (t: string) => void }) {
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [holders, setHolders] = useState<ConsoleUser[]>([]);
  const [who, setWho] = useState("");
  const [role, setRole] = useState("");
  const load = useCallback(() => {
    void consoleApi.roles().then(setRoles).catch((e) => toast(errText(e)));
    // staff = accounts holding any role (the users list filtered client-side from the first pages)
    void consoleApi.users("", "", 0).then((r) => setHolders(r.items.filter((u) => u.roles.length))).catch(() => undefined);
  }, [toast]);
  useEffect(load, [load]);
  const grant = async () => {
    try {
      await consoleApi.grant(who.trim(), role);
      toast(`${roleName(role)} granted`);
      setWho("");
      load();
    } catch (e) {
      toast(errText(e));
    }
  };
  return (
    <div className="gkc-cols">
      <section className="gkc-card">
        <h2><KeyRound size={16} /> {C.grant}</h2>
        <div className="grid gap-2">
          <div className="gkc-input">
            <UserRound size={16} />
            <input value={who} onChange={(e) => setWho(e.target.value)} placeholder={C.who} aria-label={C.who} />
          </div>
          <div className="gkc-input">
            <select value={role} onChange={(e) => setRole(e.target.value)} aria-label={C.role}>
              <option value="">{C.role}…</option>
              {roles?.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <button type="button" className="gkc-btn primary" disabled={who.trim().length < 3 || !role} onClick={() => void grant()}>{C.grant}</button>
        </div>
      </section>
      <section className="gkc-card">
        <h2><ShieldCheck size={16} /> {C.sections.roles}</h2>
        {!roles ? (
          <div className="gkc-skel h-40" />
        ) : (
          <div className="gkc-list">
            {roles.map((r) => {
              const people = holders.filter((u) => u.roles.includes(r.id));
              return (
                <div key={r.id} className="gkc-row items-start">
                  <span className="min-w-0 flex-1">
                    <span className="gkc-row-title block">{r.name}</span>
                    <span className="gkc-row-sub block">{r.allOffices ? "Every office" : r.offices.length ? `Office: ${r.offices.join(", ")}` : "No office"}</span>
                    {people.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {people.map((p) => (
                          <span key={p.id} className="gkc-pill role">{p.username ?? p.id.slice(0, 6)}</span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="gkc-row-sub">{people.length}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export function Finance({ toast }: { toast: (t: string) => void }) {
  const [days, setDays] = useState(7);
  const [r, setR] = useState<FinanceReport | null>(null);
  useEffect(() => {
    setR(null);
    void consoleApi.finance(days).then(setR).catch((e) => toast(errText(e)));
  }, [days, toast]);
  const star = r?.summary.byCurrency.STAR;
  const coin = r?.summary.byCurrency.COIN;
  const ok = (r?.reconciliation as { ok?: boolean } | undefined)?.ok;
  const byDay = r ? [...new Set(r.daily.map((d) => d.day))].map((day) => ({ day, revenue: r.daily.filter((d) => d.day === day).reduce((a, d) => a + d.revenue, 0), entries: r.daily.filter((d) => d.day === day).reduce((a, d) => a + d.entries, 0) })) : [];
  const max = Math.max(1, ...byDay.map((d) => d.revenue));
  return (
    <>
      <div className="gkc-toolbar">
        <div className="gkc-seg" role="group" aria-label="Period">
          {[1, 7, 30].map((n) => (
            <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>{n === 1 ? "Today" : C.days(n)}</button>
          ))}
        </div>
        {r && <span className={`gkc-pill ${ok ? "ok" : "bad"}`}><Scale size={12} /> {ok ? C.ledgerOk : C.ledgerBad}</span>}
      </div>
      {!r ? (
        <div className="gkc-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="gkc-skel h-24" />)}</div>
      ) : (
        <>
          <div className="gkc-kpis">
            <div className="gkc-kpi"><span><TrendingUp size={14} /> {C.revenue}</span><b>{fmt(star?.revenue ?? 0)} <Star size={16} className="inline fill-current align-[-1px] text-[#d9ab3c]" /></b><small>{fmt(coin?.revenue ?? 0)} coins</small></div>
            <div className="gkc-kpi"><span><Star size={14} /> {C.issued}</span><b>{fmt(star?.starsIssued ?? 0)}</b><small>{fmt(star?.dailyClaims ?? 0)} {C.claims.toLowerCase()}</small></div>
            <div className="gkc-kpi"><span><Coins size={14} /> {C.balances}</span><b>{fmt(star?.playerBalances ?? 0)}</b><small>{fmt(coin?.playerBalances ?? 0)} coins</small></div>
            <div className="gkc-kpi"><span><Scale size={14} /> {C.escrow}</span><b>{fmt((star?.escrowOutstanding ?? 0) + (coin?.escrowOutstanding ?? 0))}</b><small>{fmt((star?.matchesSettled ?? 0) + (coin?.matchesSettled ?? 0))} {C.matches.toLowerCase()}</small></div>
          </div>
          <section className="gkc-card">
            <h2><TrendingUp size={16} /> {C.daily}</h2>
            {byDay.length === 0 ? (
              <p className="gkc-row-sub">No ledger activity in this period.</p>
            ) : (
              <div className="gkc-bars">
                {byDay.map((d) => (
                  <div key={d.day} className="gkc-bar">
                    <span>{d.day}</span>
                    <i><em style={{ width: `${(d.revenue / max) * 100}%` }} /></i>
                    <b>{fmt(d.revenue)}</b>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
