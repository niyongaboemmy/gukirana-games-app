"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Flag, UserRound, XCircle } from "lucide-react";
import type { ConsoleReport, ReportStatus } from "@gukirana/contracts";
import { consoleApi, errText } from "./console-api";
import { C } from "./strings";
import { ReasonField, StatusPill, UserDrawer, reasonError } from "./user-drawer";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** the chat lines / place a reporter's client attached (shape not guaranteed: shown defensively) */
function Evidence({ context }: { context: unknown }) {
  if (!context || typeof context !== "object") return null;
  const c = context as { place?: unknown; area?: unknown; lines?: unknown; chat?: unknown };
  const place = typeof c.place === "string" ? c.place : typeof c.area === "string" ? c.area : null;
  const raw = Array.isArray(c.lines) ? c.lines : Array.isArray(c.chat) ? c.chat : [];
  const lines = raw
    .slice(-8)
    .map((l) => (typeof l === "string" ? l : l && typeof l === "object" && "text" in l ? `${String((l as { name?: unknown }).name ?? "")}: ${String((l as { text: unknown }).text)}` : ""))
    .filter(Boolean);
  if (!place && !lines.length) return null;
  return (
    <div className="gkc-evidence">
      <small>
        {C.evidence}
        {place ? ` · ${C.area(place)}` : ""}
      </small>
      {lines.map((l, i) => (
        <span key={i}>{l.slice(0, 400)}</span>
      ))}
    </div>
  );
}

function ReportCard({ r, onOpen, onClosed, toast }: { r: ConsoleReport; onOpen: (id: string) => void; onClosed: () => void; toast: (t: string) => void }) {
  const [closing, setClosing] = useState<"resolved" | "dismissed" | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!closing) return;
    const e = reasonError(note);
    if (e) return setErr(e);
    setBusy(true);
    try {
      await consoleApi.resolveReport(r.id, closing, note.trim());
      toast(C.reportDone(closing));
      onClosed();
    } catch (x) {
      setErr(errText(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="gkc-card gkc-report">
      <header className="flex flex-wrap items-center gap-2">
        <span className="gkc-pill bad">
          <Flag size={12} /> {C.reportReason[r.reason] ?? r.reason}
        </span>
        <span className="gkc-row-title">
          {C.reportAbout} {r.target.username ?? "—"}
        </span>
        <StatusPill s={r.target.status} />
        {r.openAgainstTarget > 1 && <span className="gkc-pill warn">{C.openReports(r.openAgainstTarget)}</span>}
        <span className="gkc-grow" />
        <span className="gkc-row-sub whitespace-nowrap">{when(r.createdAt)}</span>
      </header>
      <p className="gkc-row-sub mt-1">{C.reportBy(r.reporter.username ?? "—")}</p>
      {r.details && <p className="mt-2 whitespace-pre-wrap break-words">{r.details}</p>}
      <Evidence context={r.context} />
      {r.status !== "open" ? (
        <p className="gkc-row-sub mt-2">
          {C.closedBy(r.resolvedByName ?? "—", r.resolvedAt ? when(r.resolvedAt) : "")}
          {r.resolution ? ` — ${r.resolution}` : ""}
        </p>
      ) : closing ? (
        <div className="mt-3 grid gap-2">
          <ReasonField id={`note-${r.id}`} value={note} onChange={(v) => (setNote(v), setErr(null))} error={err} placeholder={C.notePlaceholder} label={closing === "resolved" ? C.resolve : C.dismiss} />
          <div className="gkc-foot">
            <button type="button" className="gkc-btn secondary" onClick={() => setClosing(null)} disabled={busy}>
              {C.cancel}
            </button>
            <button type="button" className={`gkc-btn ${closing === "resolved" ? "success" : "primary"}`} onClick={() => void submit()} disabled={busy}>
              {C.confirm}
            </button>
          </div>
        </div>
      ) : (
        <div className="gkc-foot mt-3">
          <button type="button" className="gkc-btn secondary" onClick={() => onOpen(r.target.id)}>
            <UserRound size={16} /> {C.openAccount}
          </button>
          <button type="button" className="gkc-btn secondary" onClick={() => setClosing("dismissed")}>
            <XCircle size={16} /> {C.dismiss}
          </button>
          <button type="button" className="gkc-btn success" onClick={() => setClosing("resolved")}>
            <CheckCircle2 size={16} /> {C.resolve}
          </button>
        </div>
      )}
    </article>
  );
}

/** Player reports queue (P2-CON-02) */
export function Reports({ toast, me, canStatus, isSuper, onCount }: { toast: (t: string) => void; me: string | null; canStatus: boolean; isSuper: boolean; onCount?: (n: number) => void }) {
  const [status, setStatus] = useState<ReportStatus>("open");
  const [items, setItems] = useState<ConsoleReport[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(
    async (p: number) => {
      try {
        const r = await consoleApi.reports(status, p);
        setItems((cur) => (p === 0 ? r.items : [...(cur ?? []), ...r.items]));
        setMore(r.more);
        setPage(p);
        setFailed(null);
        onCount?.(r.open);
      } catch (e) {
        setFailed(errText(e));
        setItems((cur) => cur ?? []);
      }
    },
    [status, onCount],
  );
  useEffect(() => {
    setItems(null);
    void load(0);
  }, [load]);
  return (
    <>
      <div className="gkc-toolbar">
        <div className="gkc-seg" role="group" aria-label="Report status">
          {(["open", "resolved", "dismissed"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s === "open" ? C.reportsOpen : s === "resolved" ? C.reportsResolved : C.reportsDismissed}
            </button>
          ))}
        </div>
        <span className="gkc-row-sub">{status === "open" ? C.resolveHelp : ""}</span>
      </div>
      {!items ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="gkc-skel h-28" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <section className="gkc-card">
          <p className="gkc-empty">
            <Flag size={22} />
            {failed ?? C.noReports}
          </p>
        </section>
      ) : (
        <div className="grid gap-3">
          {items.map((r) => (
            <ReportCard key={r.id} r={r} toast={toast} onOpen={setOpen} onClosed={() => void load(0)} />
          ))}
          {more && (
            <div className="text-center">
              <button type="button" className="gkc-btn secondary" onClick={() => void load(page + 1)}>
                {C.more}
              </button>
            </div>
          )}
        </div>
      )}
      {open && (
        <UserDrawer
          id={open}
          me={me}
          canStatus={canStatus}
          canRoles={false}
          isSuper={isSuper}
          toast={toast}
          onClose={() => setOpen(null)}
          onChanged={() => undefined}
        />
      )}
    </>
  );
}
