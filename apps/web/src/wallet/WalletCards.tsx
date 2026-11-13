"use client";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as RKeyboardEvent,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  CalendarCheck,
  Check,
  ChevronLeft,
  ChevronsRight,
  CircleDot,
  Clock,
  Coffee,
  CreditCard,
  Delete,
  Flame,
  Gift,
  Info,
  Landmark,
  Lock,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Swords,
  TrendingUp,
  Trophy,
  Undo2,
} from "lucide-react";
import { coins, coinsToMinor, formatMinor, type CurrencyRate } from "@gukirana/money";
import { api } from "@/lib/session";
import type { Limits } from "./WalletExtras";
import { wsound } from "./sound";
import { W } from "./strings";

export type Cur = Pick<CurrencyRate, "code" | "exponent" | "minorPerCoinMicro">;
export type TxRow = { type: string; amount: number; at: string; unit: "star" | "coin" };
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

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString()}`;
const coinsText = (n: number) => `${n.toLocaleString()} ${W.coinWord(n)}`;

/* ------------------------------------------------------------------ info ------------------------------------------ */

/** "What are Stars and Coins?": the two balances side by side, and what the currency tabs really do. */
export function InfoBody({ pilot }: { pilot: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="winfo">
        <section className="winfo-col">
          <header>
            <span className="wtoken wtoken-gold" aria-hidden>
              <Star size={18} fill="currentColor" />
            </span>
            <span>
              <b>{W.stars}</b>
              <small>{W.starsTag}</small>
            </span>
          </header>
          <ul>
            {W.infoStars.map((t, i) => (
              <li key={t} className={i === 3 ? "is-key" : ""}>
                <Check size={16} aria-hidden /> {t}
              </li>
            ))}
          </ul>
        </section>
        <section className="winfo-col">
          <header>
            <span className="wtoken wtoken-silver" aria-hidden>
              <CircleDot size={18} />
            </span>
            <span>
              <b>{W.coins}</b>
              <small>{W.coinsTag}</small>
            </span>
          </header>
          <ul>
            {W.infoCoins.map((t, i) => (
              <li key={t} className={i === 0 ? "is-key" : ""}>
                <Check size={16} aria-hidden /> {t}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="wnote">
        <Info size={18} aria-hidden /> <span>{W.infoTabs}</span>
      </p>
      {!pilot && (
        <p className="wnote">
          <Lock size={18} aria-hidden /> <span>{W.infoCoinsPilot}</span>
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ activity -------------------------------------- */

const TX_ICON: Record<string, ReactNode> = {
  stars_daily: <CalendarCheck size={20} />,
  stars_streak: <Flame size={20} />,
  level_up: <TrendingUp size={20} />,
  stars_grant: <Gift size={20} />,
  stake_lock: <Lock size={20} />,
  refund: <Undo2 size={20} />,
  buy: <ArrowDownToLine size={20} />,
  cashout: <ArrowUpFromLine size={20} />,
};
const txIcon = (r: TxRow) =>
  r.type === "settle" ? (
    r.amount > 0 ? (
      <Trophy size={20} />
    ) : (
      <Swords size={20} />
    )
  ) : (
    (TX_ICON[r.type] ?? <Sparkles size={20} />)
  );
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
const dayLabel = (key: string) => {
  const today = new Date();
  const yest = new Date(today.getTime() - 86_400_000);
  if (key === today.toLocaleDateString("en-CA")) return W.today;
  if (key === yest.toLocaleDateString("en-CA")) return W.yesterday;
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Recent ledger lines, grouped by day, signed and coloured, each with its unit. Nothing is netted or hidden. */
export function ActivityBody({ rows }: { rows: TxRow[] }) {
  const [filter, setFilter] = useState<"all" | "star" | "coin">("all");
  const shown = rows.filter((r) => filter === "all" || r.unit === filter);
  const groups: { key: string; rows: TxRow[] }[] = [];
  for (const r of shown) {
    const key = dayKey(r.at);
    const g = groups.at(-1);
    if (g && g.key === key) g.rows.push(r);
    else groups.push({ key, rows: [r] });
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="wseg" role="radiogroup" aria-label={W.filter}>
        {(
          [
            ["all", W.filterAll],
            ["star", W.stars],
            ["coin", W.coins],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={filter === id}
            onClick={() => {
              wsound.click();
              setFilter(id);
            }}
          >
            {id === "star" && <Star size={16} fill="currentColor" className="text-[#a8801f]" aria-hidden />}
            {id === "coin" && <CircleDot size={16} className="text-[#6b7280]" aria-hidden />}
            {label}
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <p className="wmuted py-6 text-center">{filter === "coin" ? W.noCoinActivity : W.noActivity}</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-label={dayLabel(g.key)}>
            <h3 className="wday">{dayLabel(g.key)}</h3>
            <ul className="wlist">
              {g.rows.map((tx, i) => (
                <li key={i} className="wrow">
                  <span className={`wrow-icon ${tx.amount >= 0 ? "is-plus" : "is-minus"}`} aria-hidden>
                    {txIcon(tx)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">
                      {W.tx[tx.type] ?? tx.type.replace(/_/g, " ")}
                    </span>
                    <span className="wmuted block text-[15px]">{timeOf(tx.at)}</span>
                  </span>
                  <span className={`wamt ${tx.amount >= 0 ? "is-plus" : "is-minus"}`}>
                    {signed(tx.amount)}
                    <small>{tx.unit === "coin" ? W.coinWord(Math.abs(tx.amount)) : W.stars}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <p className="wnote">
        <Info size={18} aria-hidden /> <span>{W.activityNote}</span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ top up / cash out ----------------------------- */

const QUICK: Record<string, number[]> = { RWF: [1000, 5000, 10000], USD: [5, 10, 20], EUR: [5, 10, 20] };
const QUICK_COINS = [500, 1000, 5000];
const NOTE_TINT = ["#d9e7d2", "#e9dcc4", "#d6dfea"];

const errText = (e: unknown) => {
  const code = String((e as { code?: string }).code ?? (e as Error).message ?? "");
  if (code.includes("OUT_OF_RANGE")) return W.outOfRange;
  if (code.includes("DISABLED")) return W.disabled;
  return W.quoteFail;
};

/** Press feedback for any on-card control: a soft click on press (sound only after a gesture). */
const press = { onPointerDown: () => wsound.click() };

/** A payment-terminal keypad (also takes keyboard digits through the flow's key handler). */
function Keypad({ decimals, onKey }: { decimals: boolean; onKey: (k: string) => void }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", decimals ? "." : "00", "0", "del"];
  return (
    <div className="wkeys" role="group" aria-label={W.keypad}>
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          className={k === "del" ? "is-fn" : ""}
          aria-label={k === "del" ? W.del : k}
          onPointerDown={() => wsound.key()}
          onClick={() => onKey(k)}
        >
          {k === "del" ? <Delete size={24} /> : k}
        </button>
      ))}
    </div>
  );
}

/** Slide-to-confirm track. Locked (with the honest reason) unless enabled; a slide only ever starts the handover. */
function SlideConfirm({
  label,
  locked,
  lockedLabel,
  onDone,
}: {
  label: string;
  locked: boolean;
  lockedLabel: string;
  onDone: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const drag = useRef<{ start: number; max: number } | null>(null);
  const down = (e: RPointerEvent<HTMLButtonElement>) => {
    if (locked || !track.current) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const max = track.current.clientWidth - 64;
    drag.current = { start: e.clientX - x, max };
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setX(Math.min(d.max, Math.max(0, e.clientX - d.start)));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d && x >= d.max * 0.92) onDone();
    setX(0);
  };
  const key = (e: RKeyboardEvent) => {
    if (locked) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onDone();
    }
  };
  return (
    <div ref={track} className={`wslide ${locked ? "is-locked" : ""}`}>
      <span className="wslide-label" style={{ opacity: locked ? 1 : Math.max(0, 1 - x / 160) }}>
        {locked ? lockedLabel : label}
      </span>
      <button
        type="button"
        className="wslide-thumb"
        style={{ transform: `translateX(${x}px)`, transition: drag.current ? "none" : undefined }}
        aria-disabled={locked}
        aria-label={locked ? lockedLabel : label}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        {locked ? <Lock size={24} /> : <ChevronsRight size={28} />}
      </button>
    </div>
  );
}

type Method = "momo" | "airtel" | "card" | "bank";

/**
 * Top up / cash out as a three-step payment flow: Amount (notes + keypad, live "you get") → Review (a receipt slip
 * with every fee and the margin, plus the method tiles) → Pay (slide to pay). The confirm is locked with the honest
 * reason until the licensed pilot is on; when it is on, the slide hands over to the payment provider. Nothing here
 * ever shows a payment as done.
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
  const buy = kind === "buy";
  const [step, setStep] = useState(0);
  const [amount, setAmount] = useState("");
  const [q, setQ] = useState<Quote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [dir, setDir] = useState<1 | -1>(1);
  const exp = cur?.exponent ?? 0;
  const decimals = buy && exp > 0;
  const n = Number(amount);
  const value = buy ? Math.round(n * 10 ** exp) : Math.floor(n);
  useEffect(() => {
    setQ(null);
    setErr(null);
    setNote(null);
    if (!amount || !Number.isFinite(n) || n <= 0) return;
    // top up: the amount is money (major units → integer minor units); cash out: whole coins
    const t = setTimeout(() => {
      api<Quote>("/wallet/quote", { method: "POST", body: JSON.stringify({ kind, currency, amount: value }) })
        .then(setQ)
        .catch((e: unknown) => setErr(errText(e)));
    }, 200);
    return () => clearTimeout(t);
  }, [amount, kind, currency, exp]);
  // a different currency changes the decimals: start the amount again rather than reinterpret it
  useEffect(() => {
    if (buy) setAmount("");
  }, [currency, buy]);

  const money = (minor: number | undefined) => (minor === undefined || !cur ? "—" : formatMinor(minor, cur));
  const over = !buy && n > coinBalance;
  const ready = !!q && !err && !over;
  const steps = buy ? W.steps : W.stepsOut;
  const go = (s: number) => {
    setDir(s > step ? 1 : -1);
    setStep(s);
  };

  const onKey = (k: string) => {
    setAmount((a) => {
      if (k === "del") return a.slice(0, -1);
      if (k === "clear") return "";
      if (k === ".") return !decimals || a.includes(".") ? a : (a || "0") + ".";
      const next = (a === "0" ? "" : a) + k;
      const [, dec] = next.split(".");
      if (dec && dec.length > exp) return a;
      if (next.replace(".", "").length > 9) return a;
      return next;
    });
  };
  const onKeyDown = (e: RKeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT") return;
    if (step !== 0) return;
    if (/^\d$/.test(e.key)) onKey(e.key);
    else if (e.key === "Backspace") onKey("del");
    else if (e.key === "." || e.key === ",") onKey(".");
    else if (e.key === "Enter" && ready) go(1);
    else return;
    e.preventDefault();
  };

  const amountText = buy
    ? cur
      ? formatMinor(Number.isFinite(value) ? value : 0, cur)
      : `${currency} ${amount || 0}`
    : coinsText(Number.isFinite(value) ? value : 0);
  const gets = q ? (buy ? coinsText(q.coins) : money(q.receiveMinor)) : null;
  const methods: [Method, ReactNode, string, string][] = buy
    ? [
        ["momo", <Smartphone key="i" />, W.momo, W.mobileMoney],
        ["airtel", <Smartphone key="i" />, W.airtel, W.mobileMoney],
        ["card", <CreditCard key="i" />, W.card, W.cardSub],
      ]
    : [
        ["momo", <Smartphone key="i" />, W.momo, W.mobileMoney],
        ["airtel", <Smartphone key="i" />, W.airtel, W.mobileMoney],
        ["bank", <Landmark key="i" />, W.bank, W.bankSub],
      ];

  const currencySeg = (
    <div className="flex items-center gap-3">
      <span className="wlabel shrink-0">{buy ? W.payIn : W.receiveIn}</span>
      <div className="wseg flex-1" role="radiogroup" aria-label={buy ? W.payIn : W.receiveIn}>
        {currencies.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === currency}
            {...press}
            onClick={() => onCurrency(c)}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="wflow" onKeyDown={onKeyDown}>
      <div key={step} className={`wflow-body ${dir > 0 ? "is-fwd" : "is-back"}`}>
        {step === 0 && (
          <div className="wcols">
            <div className="flex min-w-0 flex-col gap-3">
              {currencySeg}
              <div className="wamount" aria-live="polite">
                <span className="wlabel">{buy ? W.amount : W.coinsToCash}</span>
                <output className={amount ? "" : "is-empty"}>{amountText}</output>
                <span className={`wamount-sub ${err || over ? "is-warn" : ""}`}>
                  {err ??
                    (over
                      ? W.overBalance
                      : gets
                        ? buy
                          ? W.willGet(gets)
                          : W.willReceive(gets)
                        : !buy
                          ? W.have(coinBalance)
                          : W.quoteHint)}
                </span>
              </div>
              <div className="wchips" aria-label={W.quick}>
                {(buy ? (QUICK[currency] ?? [10, 50, 100]) : QUICK_COINS).map((v, i) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={n === v}
                    className={buy ? "is-note" : "is-coin"}
                    style={buy ? { ["--tint" as string]: NOTE_TINT[i % 3] } : undefined}
                    {...press}
                    onClick={() => setAmount(String(v))}
                  >
                    {buy && cur ? formatMinor(v * 10 ** exp, cur).replace(/[.,]00$/, "") : v.toLocaleString()}
                  </button>
                ))}
                {!buy && (
                  <button
                    type="button"
                    className="is-coin"
                    aria-pressed={amount !== "" && n === coinBalance}
                    {...press}
                    onClick={() => setAmount(String(coinBalance))}
                  >
                    {W.all}
                  </button>
                )}
              </div>
            </div>
            <Keypad decimals={decimals} onKey={onKey} />
          </div>
        )}
        {step === 1 && q && (
          <div className="wcols">
            <div className="wslip" aria-label={W.receipt}>
              <div className="wslip-head">
                <span>{W.receipt}</span>
                <span>{currency}</span>
              </div>
              <div className="wslip-swap">
                <span>
                  <small>{buy ? W.pay : W.give}</small>
                  <b>{buy ? money(q.payMinor) : coinsText(q.coins)}</b>
                </span>
                <ArrowRight size={22} aria-hidden />
                <span>
                  <small>{buy ? W.get : W.receive}</small>
                  <b>{buy ? coinsText(q.coins) : money(q.receiveMinor)}</b>
                </span>
              </div>
              <dl>
                <dt>{W.margin}</dt>
                <dd>{money(q.spreadMinor)}</dd>
                <dt>{buy ? W.noFee : W.fee}</dt>
                <dd>{buy ? (q.feeMinor ? money(q.feeMinor) : "none") : money(q.feeMinor)}</dd>
                {cur && (
                  <>
                    <dt>{W.rate}</dt>
                    <dd>{`100 coins = ${formatMinor(coinsToMinor(coins(100), cur as CurrencyRate), cur)}`}</dd>
                  </>
                )}
              </dl>
              <div className="wslip-foot">{W.rateVersion(q.economyVersion)}</div>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <span className="wlabel">{buy ? W.method : W.methodOut}</span>
              <div className="wmethods" role="radiogroup" aria-label={buy ? W.method : W.methodOut}>
                {methods.map(([id, icon, name, sub]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={method === id}
                    disabled={!pilot}
                    {...press}
                    onClick={() => setMethod(id)}
                  >
                    <span className="wmethod-icon" aria-hidden>
                      {icon}
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                      <b>{name}</b>
                      <small>{pilot ? sub : W.methodSoon}</small>
                    </span>
                    {!pilot ? <Lock size={18} aria-hidden /> : method === id ? <Check size={20} /> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {step === 2 && q && (
          <div className="wpay">
            <div className="wpay-sum">
              <span className="wlabel">{steps[2]}</span>
              <b>
                {buy
                  ? W.summary(money(q.payMinor), coinsText(q.coins))
                  : W.summary(coinsText(q.coins), money(q.receiveMinor))}
              </b>
              <small className="wmuted">
                {method ? methods.find((m) => m[0] === method)?.[2] : W.methodSoon} · {W.margin.toLowerCase()}{" "}
                {money(q.spreadMinor)}
                {!buy ? ` · ${W.fee.toLowerCase()} ${money(q.feeMinor)}` : ""}
              </small>
            </div>
            <SlideConfirm
              locked={!pilot || !method}
              lockedLabel={pilot ? W.method : W.pilotOff}
              label={buy ? W.slidePay(money(q.payMinor)) : W.slideOut(money(q.receiveMinor))}
              onDone={() => setNote(W.providerNote)}
            />
            <p role="status" className="wmuted text-center text-[15px]">
              {note ?? (pilot ? "" : W.pilotOffNote)}
            </p>
          </div>
        )}
      </div>
      <footer className="wflow-foot">
        <ol className="wsteps" aria-label={W.stepOf(step + 1, 3, steps[step]!)}>
          {steps.map((s, i) => (
            <li key={s} className={i === step ? "is-now" : i < step ? "is-done" : ""}>
              <span aria-hidden>{i < step ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
              <em>{s}</em>
            </li>
          ))}
        </ol>
        {step > 0 && (
          <button type="button" className="wbtn-ghost" {...press} onClick={() => go(step - 1)}>
            <ChevronLeft size={22} /> {W.back}
          </button>
        )}
        {step < 2 && (
          <button
            type="button"
            data-step-next
            className="wbtn-primary"
            disabled={step === 0 ? !ready : pilot && !method}
            {...press}
            onClick={() => go(step + 1)}
          >
            {step === 0 ? W.review : W.continue} <ArrowRight size={22} />
          </button>
        )}
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ play safe ------------------------------------- */

/** Play safe: a daily stake limit, a play-time reminder and "take a break", each explained. Enforced by the server. */
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
        setNote(l.pendingStakeLimit !== null ? W.savedLater : W.saved);
      })
      .catch(() => setNote(W.saveFail));
  const brk = (hours: number) =>
    api<Limits>("/wallet/break", { method: "POST", body: JSON.stringify({ hours }) })
      .then((l) => {
        onChange(l);
        setNote(W.breakStarted);
      })
      .catch(() => setNote(W.breakFail));
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
      <p className="wnote">
        <Coffee size={18} aria-hidden /> <span>{W.onBreak(until)}</span>
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="wnote">
        <ShieldCheck size={18} aria-hidden /> <span>{W.safeIntro}</span>
      </p>
      <section className="wsafe">
        <div>
          <h3>
            <Lock size={18} aria-hidden /> {W.limitTitle}
          </h3>
          <p>{W.limitWhat}</p>
          <p className="wmuted">{W.limitRule}</p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <label className="winput flex-1">
              <input
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))}
                placeholder={W.limitNone}
                aria-label={W.limitTitle}
              />
            </label>
            <button
              type="button"
              {...press}
              onClick={() => void put({ dailyStakeLimit: limit ? Number(limit) : null })}
              className="wbtn-primary min-w-[96px]"
            >
              {W.limitSet}
            </button>
          </div>
          <p className="wmuted text-[15px]">
            {W.stakedToday(
              stakedToday.toLocaleString(),
              limits?.dailyStakeLimit ? limits.dailyStakeLimit.toLocaleString() : null,
            )}
          </p>
        </div>
      </section>
      <section className="wsafe">
        <div>
          <h3>
            <Clock size={18} aria-hidden /> {W.reminderTitle}
          </h3>
          <p>{W.reminderWhat}</p>
        </div>
        <div className="wseg" role="radiogroup" aria-label={W.reminderTitle}>
          {[0, 30, 60, 120].map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={(limits?.reminderMinutes ?? 60) === m}
              {...press}
              onClick={() => void put({ reminderMinutes: m })}
            >
              {m ? `${m} min` : W.off}
            </button>
          ))}
        </div>
      </section>
      <section className="wsafe">
        <div>
          <h3>
            <Coffee size={18} aria-hidden /> {W.breakTitle}
          </h3>
          <p>{W.breakWhat}</p>
        </div>
        <div className="wseg">
          {[
            [24, "1 day"],
            [168, "7 days"],
            [720, "30 days"],
          ].map(([h, label]) => (
            <button key={h} type="button" {...press} onClick={() => void brk(h as number)}>
              {label}
            </button>
          ))}
        </div>
      </section>
      {note && (
        <p role="status" className="wnote">
          <Check size={18} aria-hidden /> <span>{note}</span>
        </p>
      )}
    </div>
  );
}
