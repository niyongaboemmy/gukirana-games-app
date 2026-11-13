"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Clock, Coffee, Flame, ShieldCheck } from "lucide-react";
import { formatMinor } from "@gukirana/money";
import { api } from "@/lib/session";

export type Limits = { dailyStakeLimit: number | null; pendingStakeLimit: number | null; pendingFrom: string | null; reminderMinutes: number; selfExcludedUntil: string | null };
type Quote = { kind: "buy" | "cashout"; currency: string; economyVersion: number; payMinor?: number; receiveMinor?: number; coins: number; spreadMinor: number; feeMinor?: number; pilotEnabled: boolean };
type Cur = { code: string; exponent: number };

/** Daily streak: today's count, and what tomorrow's claim adds (honest, fixed schedule from the settings). */
export function StreakRow({ streak, next }: { streak: number; next: number | null }) {
  if (!streak) return null;
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-on-glass-muted">
      <Flame size={14} className="text-warning" /> {streak}-day streak{next ? ` · tomorrow +${next} bonus Stars` : ""}
    </div>
  );
}

/**
 * Add funds / cash out: an honest calculator — you pay, you get, the spread and the fee, at the live rate version.
 * Confirming needs the payment provider (mobile money / card), which is the remaining integration step.
 */
export function ExchangeCard({ currency, cur, pilot }: { currency: string; cur: Cur | undefined; pilot: boolean }) {
  const [kind, setKind] = useState<"buy" | "cashout">("buy");
  const [amount, setAmount] = useState("");
  const [q, setQ] = useState<Quote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const exp = cur?.exponent ?? 0;
  useEffect(() => {
    setQ(null);
    setErr(null);
    const n = Number(amount);
    if (!amount || !Number.isFinite(n) || n <= 0) return;
    // buy: amount is money (major units → minor); cash-out: amount is coins
    const value = kind === "buy" ? Math.round(n * 10 ** exp) : Math.floor(n);
    const t = setTimeout(() => {
      api<Quote>("/wallet/quote", { method: "POST", body: JSON.stringify({ kind, currency, amount: value }) })
        .then(setQ)
        .catch((e: unknown) => setErr(String((e as { code?: string }).code ?? (e as Error).message).replace(/_/g, " ").toLowerCase()));
    }, 250);
    return () => clearTimeout(t);
  }, [amount, kind, currency, exp]);
  const money = (minor: number | undefined) => (minor === undefined || !cur ? "—" : formatMinor(minor, cur));
  return (
    <section className="glass rounded-card p-3">
      <div className="flex items-center justify-between">
        <div className="label text-[11px] text-on-glass-muted">Add funds · cash out</div>
        <div className="flex gap-1" role="tablist" aria-label="Exchange direction">
          {(["buy", "cashout"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`tile rounded-control flex items-center gap-1 px-2 py-1 text-xs font-bold ${kind === k ? "tile-active" : ""}`}>
              {k === "buy" ? <ArrowDownToLine size={13} /> : <ArrowUpFromLine size={13} />} {k === "buy" ? "Add" : "Cash out"}
            </button>
          ))}
        </div>
      </div>
      <label className="mt-2 flex items-center gap-2 rounded-control border border-white/10 bg-black/20 px-3 py-2">
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder={kind === "buy" ? `Amount in ${currency}` : "Coins to cash out"} aria-label={kind === "buy" ? `Amount in ${currency}` : "Coins to cash out"} className="num min-w-0 flex-1 bg-transparent text-sm outline-none" />
        <span className="label text-[11px] text-on-glass-muted">{kind === "buy" ? currency : "coins"}</span>
      </label>
      {q && (
        <dl className="num mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
          {kind === "buy" ? (
            <>
              <dt className="text-on-glass-muted">You pay</dt>
              <dd className="text-right font-bold">{money(q.payMinor)}</dd>
              <dt className="text-on-glass-muted">You get</dt>
              <dd className="text-right font-bold">{q.coins.toLocaleString()} coins</dd>
            </>
          ) : (
            <>
              <dt className="text-on-glass-muted">You give</dt>
              <dd className="text-right font-bold">{q.coins.toLocaleString()} coins</dd>
              <dt className="text-on-glass-muted">You receive</dt>
              <dd className="text-right font-bold">{money(q.receiveMinor)}</dd>
              <dt className="text-on-glass-muted">Cash-out fee</dt>
              <dd className="text-right">{money(q.feeMinor)}</dd>
            </>
          )}
          <dt className="text-on-glass-muted">Exchange margin (included)</dt>
          <dd className="text-right">{money(q.spreadMinor)}</dd>
        </dl>
      )}
      {err && <p className="mt-2 text-xs text-danger-soft">{err}</p>}
      <button type="button" disabled className="btn-primary mt-3 w-full py-2 text-sm font-bold disabled:opacity-50" title="The payment provider integration is the remaining step">
        {pilot ? "Continue to payment" : "Available with the licensed pilot"}
      </button>
      <p className="mt-1 text-center text-[11px] text-on-glass-muted">Mobile money and card payments connect in the next step.</p>
    </section>
  );
}

/** Play safe: a daily stake limit, a play-time reminder and "take a break". Enforced by the server. */
export function PlaySafeCard({ limits, stakedToday, onChange }: { limits: Limits | null; stakedToday: number; onChange: (l: Limits) => void }) {
  const [limit, setLimit] = useState(limits?.dailyStakeLimit?.toString() ?? "");
  const [note, setNote] = useState<string | null>(null);
  const put = (body: object) =>
    api<Limits>("/wallet/limits", { method: "PUT", body: JSON.stringify(body) })
      .then((l) => {
        onChange(l);
        setNote(l.pendingStakeLimit !== null ? "A higher limit applies after 24 hours (cooling-off)" : "Saved");
      })
      .catch(() => setNote("Could not save"));
  const brk = (hours: number) =>
    api<Limits>("/wallet/break", { method: "POST", body: JSON.stringify({ hours }) })
      .then((l) => {
        onChange(l);
        setNote("Break started");
      })
      .catch(() => setNote("Could not start the break"));
  const until = limits?.selfExcludedUntil ? new Date(limits.selfExcludedUntil).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <section className="glass rounded-card p-3">
      <div className="label flex items-center gap-1.5 text-[11px] text-on-glass-muted">
        <ShieldCheck size={13} /> Play safe
      </div>
      {until ? (
        <p className="mt-2 text-sm">
          You are on a break until <b>{until}</b>. Staked games are paused; practice stays open.
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="flex-1">Daily stake limit</span>
            <input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} placeholder="No limit" aria-label="Daily stake limit" className="num w-24 rounded-control border border-white/10 bg-black/20 px-2 py-1 text-right text-sm outline-none" />
            <button type="button" onClick={() => void put({ dailyStakeLimit: limit ? Number(limit) : null })} className="btn-secondary press px-2.5 py-1 text-xs font-bold">
              Set
            </button>
          </div>
          <p className="mt-1 text-[11px] text-on-glass-muted">
            Staked today: <span className="num">{stakedToday.toLocaleString()}</span>
            {limits?.dailyStakeLimit ? ` of ${limits.dailyStakeLimit.toLocaleString()}` : ""}
          </p>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <Clock size={14} className="text-on-glass-muted" />
            <span className="flex-1">Play-time reminder</span>
            <select value={limits?.reminderMinutes ?? 60} onChange={(e) => void put({ reminderMinutes: Number(e.target.value) })} aria-label="Play-time reminder" className="rounded-control border border-white/10 bg-ink-800 px-2 py-1 text-xs">
              {[0, 30, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m ? `every ${m} min` : "off"}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <Coffee size={14} className="text-on-glass-muted" />
            <span className="flex-1 text-sm">Take a break</span>
            {[
              [24, "1 day"],
              [168, "7 days"],
              [720, "30 days"],
            ].map(([h, label]) => (
              <button key={h} type="button" onClick={() => void brk(h as number)} className="tile rounded-control px-2 py-1 text-xs font-bold">
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      {note && <p role="status" className="mt-2 text-[11px] text-on-glass-muted">{note}</p>}
    </section>
  );
}

/** Gentle play-time reminder (setting from the wallet). Mounted once in the HUD; counts time with the tab visible. */
export function PlayReminder() {
  const [shown, setShown] = useState<number | null>(null);
  const minutes = useRef(60);
  useEffect(() => {
    void api<Limits>("/wallet/limits")
      .then((l) => (minutes.current = l.reminderMinutes))
      .catch(() => undefined);
    let played = 0;
    let next = 1;
    const t = setInterval(() => {
      if (document.hidden || !minutes.current) return;
      played += 1;
      if (played >= minutes.current * next) {
        setShown(played);
        next++;
      }
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  if (shown === null) return null;
  return (
    <div role="status" className="toast pointer-events-auto fixed left-1/2 top-20 z-[60] flex -translate-x-1/2 items-center gap-3 px-4 py-2.5 text-sm">
      <Clock size={16} /> You have been playing for {shown} minutes. Time for a stretch?
      <button type="button" onClick={() => setShown(null)} className="btn-secondary press px-2.5 py-1 text-xs font-bold">
        OK
      </button>
    </div>
  );
}
