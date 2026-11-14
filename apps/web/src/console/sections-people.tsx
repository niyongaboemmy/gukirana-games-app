"use client";
import { useCallback, useEffect, useState } from "react";
import { Coins, Download, KeyRound, Scale, Search, ShieldCheck, SlidersHorizontal, Star, TrendingUp, UserRound, X } from "lucide-react";
import type { ConsoleUser } from "@gukirana/contracts";
import { NO_FILTER, consoleApi, download, errText, type FinanceReport, type PeopleFilter, type RoleRow } from "./console-api";
import { C } from "./strings";
import { ReasonField, StatusPill, UserDrawer, reasonError, roleName } from "./user-drawer";

const fmt = (n: number) => n.toLocaleString("en-US");
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const ago = (iso: string | null | undefined) => {
  if (!iso) return C.never;
  const d = (Date.now() - Date.parse(iso)) / 86_400_000;
  return d < 1 ? "Today" : d < 2 ? "Yesterday" : d < 30 ? `${Math.floor(d)} days ago` : date(iso);
};

/** plain-word problems with the filters (the API refuses the same with VALIDATION_ERROR) */
function filterError(f: PeopleFilter): string | null {
  if (f.minLevel && f.maxLevel && Number(f.minLevel) > Number(f.maxLevel)) return C.levelRange;
  if (f.joinedFrom && f.joinedTo && f.joinedFrom > f.joinedTo) return C.dateRange;
  return null;
}

export function People({ canStatus, canRoles, canExport, isSuper, toast, me }: { canStatus: boolean; canRoles: boolean; canExport: boolean; isSuper: boolean; toast: (t: string) => void; me: string | null }) {
  const [f, setF] = useState<PeopleFilter>(NO_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const [items, setItems] = useState<ConsoleUser[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [exporting, setExporting] = useState(false);
  const bad = filterError(f);
  const set = (p: Partial<PeopleFilter>) => setF((cur) => ({ ...cur, ...p }));
  const active = Object.entries(f).filter(([k, v]) => k !== "q" && k !== "status" && v !== "").length;

  const load = useCallback(
    async (p: number) => {
      if (filterError(f)) return;
      try {
        const r = await consoleApi.users(f, p);
        setItems((cur) => (p === 0 ? r.items : [...(cur ?? []), ...r.items]));
        setMore(r.more);
        setPage(p);
        setFailed(null);
      } catch (e) {
        setFailed(errText(e));
        setItems((cur) => cur ?? []);
      }
    },
    [f],
  );
  // search as you type (debounced)
  useEffect(() => {
    const t = setTimeout(() => void load(0), 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    void consoleApi.roles().then(setRoles).catch(() => undefined);
  }, []);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const r = await consoleApi.exportUsers(f);
      download(r.filename, r.csv);
      toast(C.exported(r.rows, r.truncated));
    } catch (e) {
      toast(errText(e));
    } finally {
      setExporting(false);
    }
  };

  const updated = (u: Partial<ConsoleUser> & { id: string }) => setItems((l) => l?.map((x) => (x.id === u.id ? { ...x, ...u } : x)) ?? null);
  const mutedPill = (u: ConsoleUser) => (u.mutedUntil ? <span className="gkc-pill warn">{C.mutedShort}</span> : null);

  return (
    <>
      <div className="gkc-toolbar">
        <div className="gkc-input min-w-[220px] flex-1">
          <Search size={16} />
          <input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder={C.search} aria-label={C.search} maxLength={60} />
          {f.q && (
            <button type="button" aria-label="Clear" onClick={() => set({ q: "" })}>
              <X size={16} />
            </button>
          )}
        </div>
        <div className="gkc-seg" role="group" aria-label="Status">
          {(["", "active", "suspended", "deleted"] as const).map((s) => (
            <button key={s || "all"} type="button" aria-pressed={f.status === s} onClick={() => set({ status: s })}>
              {s === "" ? C.all : s === "active" ? C.active : s === "suspended" ? C.suspended : C.deleted}
            </button>
          ))}
        </div>
        <button type="button" className="gkc-btn secondary" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
          <SlidersHorizontal size={16} /> {C.filters}
          {active > 0 && <span className="gkc-count">{active}</span>}
        </button>
        {canExport && (
          <button type="button" className="gkc-btn secondary" disabled={exporting || !!bad} onClick={() => void exportCsv()}>
            <Download size={16} /> <span className="gkc-hide-sm">{C.export}</span>
          </button>
        )}
      </div>
      {showFilters && (
        <section className="gkc-card gkc-filters mb-4" aria-label={C.filters}>
          <label>
            <span>{C.rolesL}</span>
            <span className="gkc-input">
              <select value={f.role} onChange={(e) => set({ role: e.target.value })}>
                <option value="">{C.anyRole}</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label>
            <span>{C.seen}</span>
            <span className="gkc-input">
              <select value={f.seen} onChange={(e) => set({ seen: e.target.value })}>
                <option value="">{C.seenAny}</option>
                <option value="7">{C.seen7}</option>
                <option value="30">{C.seen30}</option>
                <option value="-30">{C.notSeen30}</option>
              </select>
            </span>
          </label>
          <label>
            <span>
              {C.levelFrom} / {C.levelTo}
            </span>
            <span className="flex gap-2">
              <span className="gkc-input flex-1">
                <input type="number" inputMode="numeric" min={1} max={999} value={f.minLevel} onChange={(e) => set({ minLevel: e.target.value.replace(/\D/g, "").slice(0, 3) })} aria-label={C.levelFrom} placeholder="1" />
              </span>
              <span className="gkc-input flex-1">
                <input type="number" inputMode="numeric" min={1} max={999} value={f.maxLevel} onChange={(e) => set({ maxLevel: e.target.value.replace(/\D/g, "").slice(0, 3) })} aria-label={`Level ${C.levelTo}`} placeholder="99" />
              </span>
            </span>
          </label>
          <label>
            <span>
              {C.joinedFrom} / {C.joinedTo}
            </span>
            <span className="flex gap-2">
              <span className="gkc-input flex-1">
                <input type="date" value={f.joinedFrom} onChange={(e) => set({ joinedFrom: e.target.value })} aria-label={C.joinedFrom} />
              </span>
              <span className="gkc-input flex-1">
                <input type="date" value={f.joinedTo} onChange={(e) => set({ joinedTo: e.target.value })} aria-label={`Joined ${C.joinedTo}`} />
              </span>
            </span>
          </label>
          {bad && (
            <p className="gkc-field-err col-span-full" role="alert">
              {bad}
            </p>
          )}
          <div className="gkc-foot col-span-full">
            <button type="button" className="gkc-btn secondary sm" onClick={() => setF({ ...NO_FILTER, q: f.q, status: f.status })}>
              {C.clearFilters}
            </button>
          </div>
        </section>
      )}
      <section className="gkc-card">
        {!items ? (
          <div className="grid gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="gkc-skel h-11" />
            ))}
          </div>
        ) : failed && items.length === 0 ? (
          <p className="gkc-empty">
            <UserRound size={22} />
            {failed}
          </p>
        ) : items.length === 0 ? (
          <p className="gkc-empty">
            <UserRound size={22} />
            {C.noUsers}
          </p>
        ) : (
          <>
            <table className="gkc-table gkc-hide-sm">
              <thead>
                <tr>
                  <th>{C.colPlayer}</th>
                  <th>{C.colContact}</th>
                  <th>{C.level}</th>
                  <th>{C.rolesL}</th>
                  <th>{C.colStatus}</th>
                  <th>{C.colSeen}</th>
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
                      <span className="flex flex-wrap gap-1">
                        {u.roles.length ? (
                          u.roles.map((r) => (
                            <span key={r} className="gkc-pill role">
                              {roleName(r)}
                            </span>
                          ))
                        ) : (
                          <span className="gkc-muted">—</span>
                        )}
                      </span>
                    </td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        <StatusPill s={u.status} />
                        {mutedPill(u)}
                      </span>
                    </td>
                    <td className="gkc-muted">{ago(u.lastSeenAt)}</td>
                    <td className="gkc-muted">{date(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="gkc-list gkc-show-sm">
              {items.map((u) => (
                <button key={u.id} type="button" className="gkc-row" onClick={() => setOpen(u.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="gkc-row-title block truncate">
                      {u.username ?? "—"} <span className="gkc-muted">· Lv {u.level}</span>
                    </span>
                    <span className="gkc-row-sub block truncate">
                      {u.email ?? u.phone ?? "—"}
                      {u.roles.length ? ` · ${u.roles.map(roleName).join(", ")}` : ""}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <StatusPill s={u.status} />
                    {mutedPill(u)}
                  </span>
                </button>
              ))}
            </div>
            {more && (
              <div className="mt-3 text-center">
                <button type="button" className="gkc-btn secondary" onClick={() => void load(page + 1)}>
                  {C.more}
                </button>
              </div>
            )}
          </>
        )}
      </section>
      {open && <UserDrawer id={open} me={me} canStatus={canStatus} canRoles={canRoles} isSuper={isSuper} toast={toast} onClose={() => setOpen(null)} onChanged={updated} />}
    </>
  );
}

export function Roles({ toast, me }: { toast: (t: string) => void; me: string | null }) {
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [holders, setHolders] = useState<ConsoleUser[]>([]);
  const [who, setWho] = useState("");
  const [role, setRole] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ user: string; label: string; role: string; add: boolean } | null>(null);
  const load = useCallback(() => {
    void consoleApi
      .roles()
      .then(async (rs) => {
        setRoles(rs);
        // every holder of every role (one filtered page per role, not just the newest accounts)
        const lists = await Promise.all(rs.map((r) => consoleApi.users({ role: r.id }, 0).then((x) => x.items).catch(() => [])));
        const byId = new Map<string, ConsoleUser>();
        for (const u of lists.flat()) byId.set(u.id, u);
        setHolders([...byId.values()]);
      })
      .catch((e) => toast(errText(e)));
  }, [toast]);
  useEffect(load, [load]);
  const ask = () => {
    const needReason = role === "super_admin";
    const e = reason.trim() || needReason ? reasonError(reason) : null;
    if (e) return setErr(needReason && !reason.trim() ? C.superReason : e);
    setErr(null);
    setConfirm({ user: who.trim(), label: who.trim(), role, add: true });
  };
  const run = async () => {
    if (!confirm) return;
    if (!confirm.add) {
      const e = reason.trim() || confirm.role === "super_admin" ? reasonError(reason) : null;
      if (e) return setErr(confirm.role === "super_admin" && !reason.trim() ? C.superReason : e);
    }
    try {
      const r = reason.trim() || undefined;
      const res = await (confirm.add ? consoleApi.grant(confirm.user, confirm.role, r) : consoleApi.revoke(confirm.user, confirm.role, r));
      toast(res.changed === false ? "No change" : confirm.add ? `${roleName(confirm.role)} granted` : `${roleName(confirm.role)} removed`);
      setWho("");
      setReason("");
      setConfirm(null);
      load();
    } catch (e) {
      setErr(errText(e));
      if (confirm.add) setConfirm(null);
    }
  };
  return (
    <div className="gkc-cols">
      <section className="gkc-card">
        <h2>
          <KeyRound size={16} /> {C.grant}
        </h2>
        {confirm ? (
          <div className="grid gap-3">
            <div className={`gkc-confirm ${confirm.add ? "" : "danger"}`}>
              <b>{confirm.add ? C.grantConfirm(roleName(confirm.role), confirm.label) : C.revokeConfirm(roleName(confirm.role), confirm.label)}</b>
              {confirm.add && reason.trim() && <span>{reason.trim()}</span>}
            </div>
            {!confirm.add && (
              <ReasonField id="revoke-reason" value={reason} onChange={(v) => (setReason(v), setErr(null))} error={err} placeholder={C.roleReasonPh} label={confirm.role === "super_admin" ? C.reasonFor : `${C.reasonFor} — optional`} />
            )}
            <div className="gkc-foot">
              <button type="button" className="gkc-btn secondary" onClick={() => setConfirm(null)}>
                {C.back}
              </button>
              <button type="button" className={`gkc-btn ${confirm.add ? "primary" : "danger"}`} onClick={() => void run()}>
                {C.confirm}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            <div className="gkc-input">
              <UserRound size={16} />
              <input value={who} onChange={(e) => (setWho(e.target.value), setErr(null))} placeholder={C.who} aria-label={C.who} maxLength={254} />
            </div>
            <div className="gkc-input">
              <select value={role} onChange={(e) => (setRole(e.target.value), setErr(null))} aria-label={C.role}>
                <option value="">{C.role}…</option>
                {roles?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <ReasonField id="grant-reason" value={reason} onChange={(v) => (setReason(v), setErr(null))} error={err} placeholder={C.roleReasonPh} label={role === "super_admin" ? C.reasonFor : `${C.reasonFor} — optional`} />
            <button type="button" className="gkc-btn primary" disabled={who.trim().length < 3 || !role} onClick={ask}>
              {C.continue}
            </button>
          </div>
        )}
      </section>
      <section className="gkc-card">
        <h2>
          <ShieldCheck size={16} /> {C.sections.roles}
        </h2>
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
                          <span key={p.id} className="gkc-pill role">
                            {p.username ?? p.id.slice(0, 6)}
                            {p.id !== me && (
                              <button
                                type="button"
                                aria-label={`${C.removeRole} ${roleName(r.id)} — ${p.username ?? ""}`}
                                onClick={() => (setReason(""), setErr(null), setConfirm({ user: p.id, label: p.username ?? p.id.slice(0, 8), role: r.id, add: false }))}
                              >
                                <X size={12} />
                              </button>
                            )}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="gkc-row-sub">{r.holders ?? people.length}</span>
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
              <p className="gkc-row-sub">{C.noLedger}</p>
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
