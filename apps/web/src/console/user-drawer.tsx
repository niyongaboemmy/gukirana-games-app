"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, Eye, History, KeyRound, LogOut, MessageSquareOff, MessageSquare, MonitorSmartphone, NotebookPen, PenLine, ShieldAlert, Trash2, X } from "lucide-react";
import { MUTE_CHOICES, NOTE_MAX, REASON_MAX, REASON_MIN, SUSPEND_CHOICES, type ConsoleUser, type Sanction } from "@gukirana/contracts";
import { consoleApi, errText, type RoleRow, type UserDetail } from "./console-api";
import { actionText } from "./sections-live";
import { C } from "./strings";

const fmt = (n: number) => n.toLocaleString("en-US");
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ROLE_NAMES: Record<string, string> = { super_admin: "Super Admin", it_admin: "IT Administrator", accountant: "Accountant", support_agent: "Support Agent", event_manager: "Event Manager" };
export const roleName = (r: string) => ROLE_NAMES[r] ?? r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** plain-word reason check, the same bounds as the API (3–200 characters) */
export function reasonError(r: string, max = REASON_MAX): string | null {
  const t = r.trim();
  if (t.length < REASON_MIN) return C.reasonShort;
  if (t.length > max) return C.reasonLong(max);
  return null;
}

export function StatusPill({ s }: { s: string }) {
  return <span className={`gkc-pill ${s === "active" ? "ok" : s === "deleted" ? "muted" : "bad"}`}>{s === "active" ? C.active : s === "deleted" ? C.deleted : C.suspended}</span>;
}

/** a reason box with a counter and the error in plain words */
export function ReasonField({ id, value, onChange, error, placeholder = C.reasonPh, label = C.reasonFor, max = REASON_MAX, rows = 2 }: { id: string; value: string; onChange: (v: string) => void; error: string | null; placeholder?: string; label?: string; max?: number; rows?: number }) {
  return (
    <div className="grid gap-1">
      <label className="gkc-row-sub flex justify-between" htmlFor={id}>
        <span>{label}</span>
        <span className={value.trim().length > max ? "text-[var(--c-bad)]" : ""}>{C.reasonCount(value.trim().length, max)}</span>
      </label>
      <div className="gkc-input">
        <textarea id={id} rows={rows} value={value} maxLength={max + 20} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} />
      </div>
      {error && (
        <p id={`${id}-err`} className="gkc-field-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type ActKey = "warn" | "mute" | "unmute" | "suspend" | "reactivate" | "signOut" | "rename" | "delete";
const ACT_ICONS: Record<ActKey, typeof Ban> = { warn: AlertTriangle, mute: MessageSquareOff, unmute: MessageSquare, suspend: Ban, reactivate: CheckCircle2, signOut: LogOut, rename: PenLine, delete: Trash2 };
const DANGER: ActKey[] = ["mute", "suspend", "signOut", "rename", "delete"];

/** one account action: choose (duration), give a reason, then confirm a plain summary */
function ActionForm({ act, u, onDone, onCancel, toast }: { act: ActKey; u: UserDetail; onDone: () => void; onCancel: () => void; toast: (t: string) => void }) {
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState<number | null>(act === "mute" ? 24 : 72);
  const [typed, setTyped] = useState("");
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = u.username ?? "this player";
  const confirmWord = u.username ?? "DELETE";
  const choices = act === "mute" ? MUTE_CHOICES : act === "suspend" ? SUSPEND_CHOICES : null;
  const summary =
    act === "mute" ? C.summary.mute(name, C.hours(hours)) : act === "suspend" ? C.summary.suspend(name, C.hours(hours)) : (C.summary[act] as (n: string) => string)(name);

  const next = () => {
    const e = reasonError(reason);
    if (e) return setErr(e);
    if (act === "delete" && typed.trim() !== confirmWord) return setErr(C.typeToConfirm(confirmWord));
    setErr(null);
    setStep("confirm");
  };
  const run = async () => {
    setBusy(true);
    const r = reason.trim();
    try {
      if (act === "warn") await consoleApi.sanction(u.id, { kind: "warn", reason: r });
      else if (act === "mute") await consoleApi.sanction(u.id, { kind: "mute", reason: r, hours: hours ?? 24 });
      else if (act === "suspend") await consoleApi.sanction(u.id, { kind: "suspend", reason: r, hours });
      else if (act === "unmute") await consoleApi.lift(u.id, "mute", r);
      else if (act === "reactivate") await consoleApi.lift(u.id, "suspend", r);
      else if (act === "signOut") {
        const s = await consoleApi.signOut(u.id, r);
        toast(C.done.signOut(s.signedOut));
      } else if (act === "rename") {
        const s = await consoleApi.resetUsername(u.id, r);
        toast(C.done.rename(s.username));
      } else await consoleApi.deleteAccount(u.id, typed.trim(), r);
      const done = C.done[act];
      if (typeof done === "string") toast(done);
      onDone();
    } catch (e) {
      setErr(errText(e));
      setStep("form");
    } finally {
      setBusy(false);
    }
  };
  const Icon = ACT_ICONS[act];
  const danger = DANGER.includes(act);
  return (
    <section className="gkc-card mb-4" aria-label={C.act[act]}>
      <h2>
        <Icon size={16} /> {C.act[act]}
      </h2>
      <p className="gkc-row-sub mb-3">{C.actHelp[act]}</p>
      {step === "form" ? (
        <div className="grid gap-3">
          {choices && (
            <div className="grid gap-1">
              <span className="gkc-row-sub">{C.duration}</span>
              <div className="gkc-seg flex-wrap" role="group" aria-label={C.duration}>
                {choices.map((h) => (
                  <button key={String(h)} type="button" aria-pressed={hours === h} onClick={() => setHours(h)}>
                    {C.hours(h)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <ReasonField id={`reason-${act}`} value={reason} onChange={(v) => (setReason(v), setErr(null))} error={act === "delete" ? null : err} />
          {act === "delete" && (
            <div className="grid gap-1">
              <label className="gkc-row-sub" htmlFor="confirm-delete">
                {C.typeToConfirm(confirmWord)}
              </label>
              <div className="gkc-input">
                <input id="confirm-delete" value={typed} autoComplete="off" onChange={(e) => (setTyped(e.target.value), setErr(null))} />
              </div>
              {err && (
                <p className="gkc-field-err" role="alert">
                  {err}
                </p>
              )}
            </div>
          )}
          <div className="gkc-foot">
            <button type="button" className="gkc-btn secondary" onClick={onCancel}>
              {C.cancel}
            </button>
            <button type="button" className="gkc-btn primary" onClick={next}>
              {C.continue}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className={`gkc-confirm ${danger ? "danger" : ""}`} role="alertdialog" aria-label={C.confirmTitle}>
            <b>{summary}</b>
            <span>
              {C.reason.replace(" (shown in the record)", "")}: {reason.trim()}
            </span>
          </div>
          <div className="gkc-foot">
            <button type="button" className="gkc-btn secondary" onClick={() => setStep("form")} disabled={busy}>
              {C.back}
            </button>
            <button type="button" className={`gkc-btn ${danger ? "danger" : act === "reactivate" || act === "unmute" ? "success" : "primary"}`} onClick={() => void run()} disabled={busy}>
              {C.confirm}
            </button>
          </div>
          {err && (
            <p className="gkc-field-err" role="alert">
              {err}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function SanctionRow({ s }: { s: Sanction }) {
  return (
    <div className="gkc-row items-start">
      <span className="min-w-0 flex-1">
        <span className="gkc-row-title block">
          {C.sanctionKind[s.kind]} {s.active && <span className="gkc-pill bad ml-1">{C.inForce}</span>}
          <span className="gkc-muted"> · {s.createdByName}</span>
        </span>
        <span className="gkc-row-sub block">{s.reason}</span>
        {s.kind !== "warn" && (
          <span className="gkc-row-sub block">
            {s.liftedAt ? C.liftedBy(s.liftedByName ?? "", s.liftReason) : s.endsAt ? C.endsAt(when(s.endsAt)) : C.untilLifted}
          </span>
        )}
      </span>
      <span className="gkc-row-sub whitespace-nowrap">{date(s.createdAt)}</span>
    </div>
  );
}

/** The account drawer: summary, actions with reasons + confirmation, history, internal notes, devices. */
export function UserDrawer({
  id,
  me,
  canStatus,
  canRoles,
  isSuper,
  toast,
  onClose,
  onChanged,
}: {
  id: string;
  me: string | null;
  canStatus: boolean;
  canRoles: boolean;
  isSuper: boolean;
  toast: (t: string) => void;
  onClose: () => void;
  onChanged: (u: Partial<ConsoleUser> & { id: string }) => void;
}) {
  const [u, setU] = useState<UserDetail | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const [failed, setFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<"actions" | "history" | "notes" | "sessions">("actions");
  const [act, setAct] = useState<ActKey | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [roleOp, setRoleOp] = useState<{ role: string; add: boolean } | null>(null);
  const [grantRole, setGrantRole] = useState("");
  const [roleReason, setRoleReason] = useState("");
  const [roleErr, setRoleErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ field: "email" | "phone"; reason: string; err: string | null; value?: string | null } | null>(null);

  const load = useCallback(
    () =>
      void consoleApi
        .user(id)
        .then((d) => {
          setU(d);
          setFailed(null);
          changed.current({ id, status: d.status, username: d.username, roles: d.roles.map((r) => r.role), mutedUntil: d.mutedUntil ?? null });
        })
        .catch((e) => setFailed(errText(e))),
    [id],
  );
  useEffect(load, [load]);
  useEffect(() => {
    if (canRoles) void consoleApi.roles().then(setRoles).catch(() => undefined);
  }, [canRoles]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("keydown", k, { capture: true });
    return () => window.removeEventListener("keydown", k, { capture: true });
  }, [onClose]);

  const staff = (u?.roles.length ?? 0) > 0;
  const deleted = u?.status === "deleted";
  const mayAct = canStatus && !!u && u.id !== me && !deleted && (!staff || isSuper);
  const muted = !!u?.mutedUntil;
  const acts: ActKey[] = u
    ? ([
        "warn",
        muted ? "unmute" : "mute",
        u.status === "suspended" ? "reactivate" : "suspend",
        "signOut",
        "rename",
        ...(isSuper ? (["delete"] as const) : []),
      ] as ActKey[])
    : [];

  const roleChange = async () => {
    if (!roleOp || !u) return;
    const needReason = roleOp.role === "super_admin";
    const e = roleReason.trim() || needReason ? reasonError(roleReason) : null;
    if (e) return setRoleErr(needReason && !roleReason.trim() ? C.superReason : e);
    try {
      const r = roleReason.trim() || undefined;
      await (roleOp.add ? consoleApi.grant(u.id, roleOp.role, r) : consoleApi.revoke(u.id, roleOp.role, r));
      toast(roleOp.add ? `${roleName(roleOp.role)} granted` : `${roleName(roleOp.role)} removed`);
      setRoleOp(null);
      setRoleReason("");
      setGrantRole("");
      setRoleErr(null);
      load();
    } catch (err) {
      setRoleErr(errText(err));
    }
  };
  const addNote = async () => {
    const e = reasonError(note, NOTE_MAX);
    if (e) return setNoteErr(e === C.reasonShort ? "Please write a note (3 characters or more)." : e);
    try {
      await consoleApi.note(id, note.trim());
      setNote("");
      setNoteErr(null);
      toast(C.noteSaved);
      load();
    } catch (err) {
      setNoteErr(errText(err));
    }
  };
  const doReveal = async () => {
    if (!reveal) return;
    const e = reasonError(reveal.reason);
    if (e) return setReveal({ ...reveal, err: e });
    try {
      const r = await consoleApi.reveal(id, reveal.field, reveal.reason.trim());
      setReveal({ ...reveal, err: null, value: r.value });
    } catch (err) {
      setReveal({ ...reveal, err: errText(err) });
    }
  };

  return (
    <>
      <div className="gkc-scrim" onClick={onClose} />
      <aside className="gkc-drawer" role="dialog" aria-modal="true" aria-label="Account">
        <div className="gkc-drawer-head">
          <span className="gkc-avatar" style={{ background: "var(--c-choc)", width: 40, height: 40 }}>
            {(u?.username ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="gkc-row-title block truncate text-lg">{u ? (u.username ?? "—") : "…"}</span>
            <span className="gkc-row-sub flex items-center gap-2 truncate">
              <span className="truncate">{u ? (u.email ?? u.phone ?? "—") : ""}</span>
              {isSuper && u && !deleted && (u.email || u.phone) && !reveal && (
                <button type="button" className="gkc-link" onClick={() => setReveal({ field: u.email ? "email" : "phone", reason: "", err: null })}>
                  <Eye size={13} /> {C.reveal}
                </button>
              )}
            </span>
          </span>
          <button type="button" className="gkc-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="gkc-drawer-body">
          {failed ? (
            <p className="gkc-empty">
              <ShieldAlert size={22} />
              {failed}
            </p>
          ) : !u ? (
            <div className="gkc-skel h-64" />
          ) : (
            <>
              {reveal && (
                <section className="gkc-card mb-4">
                  <h2>
                    <Eye size={16} /> {C.revealTitle}
                  </h2>
                  {reveal.value !== undefined ? (
                    <p className="gkc-row-title select-all break-all">{reveal.value ?? "—"}</p>
                  ) : (
                    <div className="grid gap-2">
                      <p className="gkc-row-sub">{C.revealHelp}</p>
                      {u.hasEmail && u.hasPhone && (
                        <div className="gkc-seg" role="group" aria-label="Contact">
                          {(["email", "phone"] as const).map((f) => (
                            <button key={f} type="button" aria-pressed={reveal.field === f} onClick={() => setReveal({ ...reveal, field: f })}>
                              {f === "email" ? "Email" : "Phone"}
                            </button>
                          ))}
                        </div>
                      )}
                      <ReasonField id="reveal-reason" value={reveal.reason} onChange={(v) => setReveal({ ...reveal, reason: v, err: null })} error={reveal.err} placeholder="e.g. Player called support and asked" />
                      <div className="gkc-foot">
                        <button type="button" className="gkc-btn secondary" onClick={() => setReveal(null)}>
                          {C.cancel}
                        </button>
                        <button type="button" className="gkc-btn primary" onClick={() => void doReveal()}>
                          {C.reveal}
                        </button>
                      </div>
                    </div>
                  )}
                  {reveal.value !== undefined && (
                    <div className="gkc-foot mt-2">
                      <button type="button" className="gkc-btn secondary" onClick={() => setReveal(null)}>
                        {C.cancel}
                      </button>
                    </div>
                  )}
                </section>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <StatusPill s={u.status} />
                {u.mutedUntil && <span className="gkc-pill warn">{C.mutedPill(when(u.mutedUntil))}</span>}
                {(u.openReports ?? 0) > 0 && <span className="gkc-pill warn">{C.openReports(u.openReports ?? 0)}</span>}
                {u.roles.map((r) => (
                  <span key={r.role} className="gkc-pill role">
                    {roleName(r.role)}
                    {canRoles && u.id !== me && !deleted && (
                      <button type="button" aria-label={`${C.removeRole} ${roleName(r.role)}`} onClick={() => (setRoleOp({ role: r.role, add: false }), setRoleReason(""), setRoleErr(null))}>
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
              <p className="gkc-row-sub mb-4">
                {C.joined} {date(u.createdAt)} · {C.lastSeen} {u.lastSeenAt ? when(u.lastSeenAt) : C.never} · ID {u.id.slice(0, 8)}…
              </p>
              {deleted && <p className="gkc-note mb-4">{C.deletedNote}</p>}

              {roleOp && (
                <section className="gkc-card mb-4">
                  <h2>
                    <KeyRound size={16} /> {C.confirmTitle}
                  </h2>
                  <div className={`gkc-confirm ${roleOp.add ? "" : "danger"} mb-3`}>
                    <b>{roleOp.add ? C.grantConfirm(roleName(roleOp.role), u.username ?? "this person") : C.revokeConfirm(roleName(roleOp.role), u.username ?? "this person")}</b>
                  </div>
                  <ReasonField
                    id="role-reason"
                    value={roleReason}
                    onChange={(v) => (setRoleReason(v), setRoleErr(null))}
                    error={roleErr}
                    placeholder={C.roleReasonPh}
                    label={roleOp.role === "super_admin" ? C.reasonFor : `${C.reasonFor} — optional`}
                  />
                  <div className="gkc-foot mt-3">
                    <button type="button" className="gkc-btn secondary" onClick={() => setRoleOp(null)}>
                      {C.cancel}
                    </button>
                    <button type="button" className={`gkc-btn ${roleOp.add ? "primary" : "danger"}`} onClick={() => void roleChange()}>
                      {C.confirm}
                    </button>
                  </div>
                </section>
              )}

              <div className="gkc-seg mb-4 w-full" role="tablist" aria-label="Account sections">
                {(["actions", "history", "notes", "sessions"] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} aria-pressed={tab === t} className="flex-1" onClick={() => setTab(t)}>
                    {C.tabs[t]}
                    {t === "notes" && (u.notes?.length ?? 0) > 0 ? ` (${u.notes!.length})` : ""}
                  </button>
                ))}
              </div>

              {tab === "actions" && (
                <>
                  {canStatus && staff && !isSuper && <p className="gkc-note mb-4">{C.staffOnly}</p>}
                  {mayAct &&
                    (act ? (
                      <ActionForm
                        key={act}
                        act={act}
                        u={u}
                        toast={toast}
                        onCancel={() => setAct(null)}
                        onDone={() => {
                          setAct(null);
                          load();
                        }}
                      />
                    ) : (
                      <div className="gkc-acts mb-4">
                        {acts.map((a) => {
                          const Icon = ACT_ICONS[a];
                          return (
                            <button key={a} type="button" className={`gkc-btn ${a === "delete" || a === "suspend" ? "danger" : a === "reactivate" || a === "unmute" ? "success" : "secondary"}`} onClick={() => setAct(a)}>
                              <Icon size={16} /> {C.act[a]}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  {canRoles && !deleted && u.id !== me && u.status === "active" && !roleOp && (
                    <section className="gkc-card mb-4">
                      <h2>
                        <KeyRound size={16} /> {C.grant}
                      </h2>
                      <div className="flex gap-2">
                        <div className="gkc-input flex-1">
                          <select value={grantRole} onChange={(e) => setGrantRole(e.target.value)} aria-label={C.role}>
                            <option value="">{C.role}…</option>
                            {roles
                              .filter((r) => !u.roles.some((x) => x.role === r.id))
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                          </select>
                        </div>
                        <button type="button" className="gkc-btn primary" disabled={!grantRole} onClick={() => (setRoleOp({ role: grantRole, add: true }), setRoleReason(""), setRoleErr(null))}>
                          {C.grant}
                        </button>
                      </div>
                    </section>
                  )}
                  {!mayAct && !canRoles && !(canStatus && staff && !isSuper) && <p className="gkc-row-sub">{deleted ? C.deletedNote : C.recorded}</p>}
                </>
              )}

              {tab === "history" && (
                <>
                  <section className="gkc-card mb-4">
                    <h2>
                      <ShieldAlert size={16} /> {C.sanctions}
                    </h2>
                    {(u.sanctions?.length ?? 0) === 0 ? (
                      <p className="gkc-row-sub">{C.noSanctions}</p>
                    ) : (
                      <div className="gkc-list">
                        {u.sanctions!.map((s) => (
                          <SanctionRow key={s.id} s={s} />
                        ))}
                      </div>
                    )}
                  </section>
                  <section className="gkc-card">
                    <h2>
                      <History size={16} /> {C.history}
                    </h2>
                    {u.history.length === 0 ? (
                      <p className="gkc-row-sub">{C.noHistory}</p>
                    ) : (
                      <div className="gkc-list">
                        {u.history.map((h) => (
                          <div key={h.id} className="gkc-row">
                            <span className="min-w-0 flex-1">
                              <span className="gkc-row-title block">
                                {actionText(h.action)}
                                {h.whoName && <span className="gkc-muted"> · {h.whoName}</span>}
                              </span>
                              {(h.detailText ?? h.detail) && <span className="gkc-row-sub block break-words">{h.detailText ?? h.detail}</span>}
                            </span>
                            <span className="gkc-row-sub whitespace-nowrap">{date(h.at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}

              {tab === "notes" && (
                <section className="gkc-card">
                  <h2>
                    <NotebookPen size={16} /> {C.notes}
                  </h2>
                  <p className="gkc-row-sub mb-3">{C.notesHelp}</p>
                  {canStatus && (
                    <div className="mb-4 grid gap-2">
                      <ReasonField id="note" value={note} onChange={(v) => (setNote(v), setNoteErr(null))} error={noteErr} placeholder={C.notePh} label={C.notes} max={NOTE_MAX} rows={3} />
                      <div className="gkc-foot">
                        <button type="button" className="gkc-btn primary" onClick={() => void addNote()}>
                          {C.addNote}
                        </button>
                      </div>
                    </div>
                  )}
                  {(u.notes?.length ?? 0) === 0 ? (
                    <p className="gkc-row-sub">{C.noNotes}</p>
                  ) : (
                    <div className="gkc-list">
                      {u.notes!.map((n) => (
                        <div key={n.id} className="gkc-row items-start">
                          <span className="min-w-0 flex-1">
                            <span className="gkc-row-sub block">
                              {n.createdByName} · {when(n.createdAt)}
                            </span>
                            <span className="block whitespace-pre-wrap break-words">{n.body}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {tab === "sessions" && (
                <section className="gkc-card">
                  <h2>
                    <MonitorSmartphone size={16} /> {C.sessions}
                  </h2>
                  <p className="gkc-row-sub mb-3">{C.sessionsHelp}</p>
                  {(u.sessions?.length ?? 0) === 0 ? (
                    <p className="gkc-row-sub">{C.noSessions}</p>
                  ) : (
                    <div className="gkc-list mb-3">
                      {u.sessions!.map((s) => (
                        <div key={s.id} className="gkc-row">
                          <span className="min-w-0 flex-1">
                            <span className="gkc-row-title block">{s.device}</span>
                            <span className="gkc-row-sub block">{C.since(when(s.createdAt))}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {mayAct && (u.sessions?.length ?? 0) > 0 && (
                    <button type="button" className="gkc-btn danger w-full" onClick={() => (setTab("actions"), setAct("signOut"))}>
                      <LogOut size={16} /> {C.act.signOut}
                    </button>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
