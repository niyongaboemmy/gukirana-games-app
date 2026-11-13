"use client";
import { useEffect, useState } from "react";
import { Clock, Coffee, Info, Minus, Plus } from "lucide-react";
import { coins, coinsToMinor, formatMinor, type CurrencyRate } from "@gukirana/money";
import { api } from "@/lib/session";
import type { Limits } from "./WalletExtras";
import { W } from "./strings";

export type Cur = Pick<CurrencyRate, "code" | "exponent" | "minorPerCoinMicro">;
export type TxRow = { label: string; amount: number; when: string };
type Quote = {
  kind: "buy" | "cashout";
  currency: string;
  economyVersion: number;
  payMinor?: number;
  receiveMinor?: number;
  coins: number;
  spreadMinor: number;
  feeMinor?: number;
  pilotEnabled: boolean;
};

/** Recent ledger lines, signed and coloured: + added, − taken. Nothing is netted or hidden. */
export function ActivityBody({ rows }: { rows: TxRow[] }) {
  return (
    <div>
      {rows.length === 0 ? (
        <p className="wmuted py-6 text-center">{W.noActivity}</p>
      ) : (
        <ul>
          {rows.map((tx, i) => (
            <li key={i} className="wrow">
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-full ${tx.amount >= 0 ? "bg-success/15 text-success-soft" : "bg-danger/15 text-danger-soft"}`}
                aria-hidden
              >
                {tx.amount >= 0 ? <Plus size={18} /> : <Minus size={18} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{tx.label}</span>
                <span className="wmuted block text-[15px]">{tx.when}</span>
              </span>
              <span
                className={`num shrink-0 text-[20px] font-extrabold ${tx.amount >= 0 ? "text-success-soft" : "text-danger-soft"}`}
              >
                {`${tx.amount >= 0 ? "+" : "−"}${Math.abs(tx.amount).toLocaleString()}`}
                <span className="wmuted ml-1 text-[14px] font-semibold">{W.stars}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="wmuted mt-3 flex gap-2 text-[15px]">
        <Info size={16} className="mt-0.5 shrink-0" /> {W.activityNote}
      </p>
    </div>
  );
}

const QUICK: Record<string, number[]> = { RWF: [1000, 5000, 10000], USD: [5, 10, 20], EUR: [5, 10, 20] };
const QUICK_COINS = [500, 1000, 5000];

const errText = (e: unknown) => {
  const code = String((e as { code?: string }).code ?? (e as Error).message ?? "");
  if (code.includes("OUT_OF_RANGE")) return W.outOfRange;
  if (code.includes("DISABLED")) return W.disabled;
  return W.quoteFail;
};

/**
 * Top up / cash out: pick a currency, type or tap an amount, read the live honest quote (you pay, you get, the
 * margin and the fee at the current rate version). Confirming needs the payment provider — never faked.
 */
export function FundsBody({
  kind,
  currency,
  currencies,
  onCurrency,
  cur,
  pilot,
  coinBalance,
}: {
  kind: "buy" | "cashout";
  currency: string;
  currencies: string[];
  onCurrency: (c: string) => void;
  cur: Cur | undefined;
  pilot: boolean;
  coinBalance: number;
}) {
  const [amount, setAmount] = useState("");
  const [q, setQ] = useState<Quote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const exp = cur?.exponent ?? 0;
  useEffect(() => {
    setQ(null);
    setErr(null);
    setNote(null);
    const n = Number(amount);
    if (!amount || !Number.isFinite(n) || n <= 0) return;
    // top up: the amount is money (major units → integer minor units); cash out: whole coins
    const value = kind === "buy" ? Math.round(n * 10 ** exp) : Math.floor(n);
    const t = setTimeout(() => {
      api<Quote>("/wallet/quote", { method: "POST", body: JSON.stringify({ kind, currency, amount: value }) })
        .then(setQ)
        .catch((e: unknown) => setErr(errText(e)));
    }, 220);
    return () => clearTimeout(t);
  }, [amount, kind, currency, exp]);
  const money = (minor: number | undefined) => (minor === undefined || !cur ? "—" : formatMinor(minor, cur));
  const quick = kind === "buy" ? (QUICK[currency] ?? [10, 50, 100]) : QUICK_COINS;
  const over = kind === "cashout" && Number(amount) > coinBalance;
  return (
    <div className="wfunds">
      <div className="flex flex-col gap-3">
        <div className="wseg" role="radiogroup" aria-label={W.currency}>
          {currencies.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === currency}
              onClick={() => onCurrency(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <label className="winput">
          <input
            inputMode={kind === "buy" && exp ? "decimal" : "numeric"}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(kind === "buy" && exp ? /[^\d.]/g : /\D/g, ""))}
            placeholder="0"
            aria-label={kind === "buy" ? W.amountIn(currency) : W.coinsToCash}
          />
          <span className="wmuted font-bold">{kind === "buy" ? currency : W.coins.toLowerCase()}</span>
        </label>
        <div className="wseg" aria-label="Quick amounts">
          {quick.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={Number(amount) === v}
              onClick={() => setAmount(String(v))}
              className="num"
            >
              {kind === "buy" && cur
                ? formatMinor(v * 10 ** exp, cur).replace(/[.,]00$/, "")
                : v.toLocaleString()}
            </button>
          ))}
          {kind === "cashout" && (
            <button
              type="button"
              aria-pressed={amount !== "" && Number(amount) === coinBalance}
              onClick={() => setAmount(String(coinBalance))}
            >
              {W.all}
            </button>
          )}
        </div>
        {kind === "cashout" && (
          <p className={`text-[15px] ${over ? "text-warning-soft" : "wmuted"}`}>
            {over ? W.overBalance : W.have(coinBalance)}
          </p>
        )}
        {cur && (
          <p className="wmuted text-[14px]">
            {W.midRate(
              `100 ${W.coins.toLowerCase()} ≈ ${formatMinor(coinsToMinor(coins(100), cur as CurrencyRate), cur)}`,
            )}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {!q && !err && <p className="wquote wmuted">{W.quoteHint}</p>}
        {q && (
          <dl className="wquote" aria-live="polite">
            {kind === "buy" ? (
              <>
                <dt className="wmuted">{W.pay}</dt>
                <dd>{money(q.payMinor)}</dd>
                <dt className="wmuted">{W.get}</dt>
                <dd>{`${q.coins.toLocaleString()} ${W.coins.toLowerCase()}`}</dd>
              </>
            ) : (
              <>
                <dt className="wmuted">{W.give}</dt>
                <dd>{`${q.coins.toLocaleString()} ${W.coins.toLowerCase()}`}</dd>
                <dt className="wmuted">{W.fee}</dt>
                <dd>{money(q.feeMinor)}</dd>
                <dt className="wmuted">{W.receive}</dt>
                <dd>{money(q.receiveMinor)}</dd>
              </>
            )}
            <dt className="wmuted">{W.margin}</dt>
            <dd>{money(q.spreadMinor)}</dd>
          </dl>
        )}
        {err && (
          <p role="alert" className="text-danger-soft">
            {err}
          </p>
        )}
        <button
          type="button"
          disabled={!pilot || !q || over}
          onClick={() => setNote(W.providerNote)}
          className={`${pilot ? "btn-primary" : "btn-secondary"} min-h-[56px] w-full rounded-[14px] text-[20px] font-extrabold disabled:cursor-not-allowed`}
        >
          {pilot ? W.continuePay : W.pilotOff}
        </button>
        <p role="status" className="wmuted text-center text-[14px]">
          {note ?? (pilot ? "" : W.pilotOffNote)}
        </p>
      </div>
    </div>
  );
}

/** Play safe: a daily stake limit, a play-time reminder and "take a break". Enforced by the server. */
export function PlaySafeBody({
  limits,
  stakedToday,
  onChange,
}: {
  limits: Limits | null;
  stakedToday: number;
  onChange: (l: Limits) => void;
}) {
  const [limit, setLimit] = useState(limits?.dailyStakeLimit?.toString() ?? "");
  const [note, setNote] = useState<string | null>(null);
  const put = (body: object) =>
    api<Limits>("/wallet/limits", { method: "PUT", body: JSON.stringify(body) })
      .then((l) => {
        onChange(l);
        setNote(
          l.pendingStakeLimit !== null ? "A higher limit applies after 24 hours (cooling-off)" : "Saved",
        );
      })
      .catch(() => setNote("Could not save"));
  const brk = (hours: number) =>
    api<Limits>("/wallet/break", { method: "POST", body: JSON.stringify({ hours }) })
      .then((l) => {
        onChange(l);
        setNote("Break started");
      })
      .catch(() => setNote("Could not start the break"));
  const until = limits?.selfExcludedUntil
    ? new Date(limits.selfExcludedUntil).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  if (until)
    return (
      <p>
        You are on a break until <b>{until}</b>. Staked games are paused; practice stays open.
      </p>
    );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="font-bold">Daily stake limit</div>
        <div className="mt-2 flex gap-2">
          <label className="winput flex-1">
            <input
              inputMode="numeric"
              value={limit}
              onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))}
              placeholder="No limit"
              aria-label="Daily stake limit"
            />
          </label>
          <button
            type="button"
            onClick={() => void put({ dailyStakeLimit: limit ? Number(limit) : null })}
            className="btn-secondary min-w-[88px] rounded-[14px] text-[18px] font-extrabold"
          >
            Set
          </button>
        </div>
        <p className="wmuted mt-1 text-[15px]">
          Staked today: <span className="num">{stakedToday.toLocaleString()}</span>
          {limits?.dailyStakeLimit ? ` of ${limits.dailyStakeLimit.toLocaleString()}` : ""}. Lowering is
          immediate; raising waits 24 hours.
        </p>
      </div>
      <div>
        <div className="flex items-center gap-2 font-bold">
          <Clock size={18} className="wmuted" /> Play-time reminder
        </div>
        <div className="wseg mt-2" role="radiogroup" aria-label="Play-time reminder">
          {[0, 30, 60, 120].map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={(limits?.reminderMinutes ?? 60) === m}
              onClick={() => void put({ reminderMinutes: m })}
            >
              {m ? `${m} min` : "Off"}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2 font-bold">
          <Coffee size={18} className="wmuted" /> Take a break
        </div>
        <div className="wseg mt-2">
          {[
            [24, "1 day"],
            [168, "7 days"],
            [720, "30 days"],
          ].map(([h, label]) => (
            <button key={h} type="button" onClick={() => void brk(h as number)}>
              {label}
            </button>
          ))}
        </div>
        <p className="wmuted mt-1 text-[15px]">
          Staked games pause for the whole break; practice stays open.
        </p>
      </div>
      {note && (
        <p role="status" className="wmuted">
          {note}
        </p>
      )}
    </div>
  );
}
