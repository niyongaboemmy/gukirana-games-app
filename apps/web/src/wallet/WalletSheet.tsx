"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { create } from "zustand";
import { ArrowDownLeft, ArrowUpRight, Gift, Info, Star, Wallet, X } from "lucide-react";
import { ACT } from "@gukirana/contracts";
import { coins, coinsToMinor, formatMinor, type CurrencyRate } from "@gukirana/money";
import { api, claimDailyStars } from "@/lib/session";
import { useProfile } from "@/lib/profile-store";
import { doAction } from "@/social/people";
import { ExchangeCard, PlaySafeCard, StreakRow, type Limits } from "./WalletExtras";

const Wallet3D = dynamic(() => import("./Wallet3D").then((m) => m.Wallet3D), { ssr: false });

/** Open / close from anywhere (Stars chip, B key, person menu). */
export const useWalletSheet = create<{ open: boolean; set: (open: boolean) => void }>()((set) => ({ open: false, set: (open) => set({ open }) }));

type Tx = { type: string; amount: number; at: string; refType: string | null };
type WalletData = { stars: number; history: Tx[]; dailyStars: number; pilotEnabled: boolean; economyVersion: number; coins?: number; streak?: number; limits?: Limits; stakedToday?: number };
type Economy = { version: number; currencies: Pick<CurrencyRate, "code" | "exponent" | "minorPerCoinMicro">[]; pilotEnabled: boolean };

/** Plain-language labels; amounts are always shown signed (+ won / − paid), never disguised. */
const TX_LABEL: Record<string, string> = {
  stars_daily: "Daily Stars",
  stars_grant: "Welcome Stars",
  stake_lock: "Stake locked for a match",
  settle: "Match result",
  refund: "Stake refunded",
  level_up: "Level-up gift",
  stars_streak: "Streak bonus",
};

const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function WalletSheet() {
  const open = useWalletSheet((s) => s.open);
  const setOpen = useWalletSheet((s) => s.set);
  const [data, setData] = useState<WalletData | null>(null);
  const [eco, setEco] = useState<Economy | null>(null);
  const [currency, setCurrency] = useState("RWF");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [nextBonus, setNextBonus] = useState<number | null>(null);
  const stars = useProfile((s) => s.stars);

  // B key toggles the wallet (W is walk); Escape closes it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.code === "KeyB") useWalletSheet.getState().set(!useWalletSheet.getState().open);
      if (e.code === "Escape") useWalletSheet.getState().set(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    doAction(ACT.phone); // your person takes it out and looks into it (others see the gesture, never the amounts)
    setMsg(null);
    void api<WalletData>("/wallet").then(setData).catch(() => setData(null));
    void api<Economy>("/economy").then(setEco).catch(() => setEco(null));
  }, [open]);

  const rate = useMemo(() => eco?.currencies.find((c) => c.code === currency), [eco, currency]);
  const coinBalance = data?.coins ?? 0;
  const pilot = !!(data?.pilotEnabled ?? eco?.pilotEnabled);

  if (!open) return null;
  const claim = async () => {
    setBusy(true);
    try {
      const r = (await claimDailyStars()) as { granted: number; stars: number; streak?: number; streakBonus?: number; nextStreakBonus?: number };
      setMsg(r.granted ? `+${r.granted} Stars added${r.streakBonus ? ` · +${r.streakBonus} streak bonus` : ""}` : "Already claimed today — come back tomorrow");
      setNextBonus(r.nextStreakBonus ?? null);
      setData((d) => (d ? { ...d, stars: r.stars } : d));
      void api<WalletData>("/wallet").then(setData).catch(() => undefined); // refresh the activity list
    } catch {
      setMsg("Could not claim right now");
    } finally {
      setBusy(false);
    }
  };

  // rendered into <body>, above the persistent 3D canvas and the HUD prompts (otherwise the canvas takes the clicks)
  return createPortal(
    <div className="scrim fixed inset-0 z-[90] grid place-items-center p-3" role="dialog" aria-modal="true" aria-label="Your wallet" onClick={() => setOpen(false)}>
      <div className="sheet flex w-[min(880px,96vw)] max-h-[92dvh] flex-col overflow-hidden phone:flex-row" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-3 phone:hidden">
          <h2 className="font-display flex items-center gap-2 text-lg font-bold">
            <Wallet size={20} /> Your wallet
          </h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close wallet" className="icon-button size-9 rounded-full">
            <X size={18} />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 sm:grid-cols-[1.1fr_1fr] phone:grid-cols-[1fr_1fr]">
          {/* the physical wallet, opening in your hands */}
          <div className="relative h-[260px] sm:h-auto sm:min-h-[340px] phone:h-auto">
            <Wallet3D open={open} currency={currency} stars={data?.stars ?? stars} hasMoney={pilot && coinBalance > 0} />
            <span className="kbd absolute bottom-3 left-3 phone:hidden">B</span>
          </div>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
            {/* Stars: practice currency */}
            <section className="glass rounded-card p-3">
              <div className="label text-[11px] text-on-glass-muted">Stars · practice</div>
              <div className="num mt-1 flex items-center gap-2 text-3xl font-extrabold">
                <Star size={22} className="text-gold" fill="currentColor" /> {(data?.stars ?? stars).toLocaleString()}
              </div>
              <p className="mt-1 text-xs text-on-glass-muted">Stars are for practice and fun. They have no cash value and cannot be cashed out.</p>
              <button type="button" disabled={busy} onClick={() => void claim()} className="btn-primary press mt-3 flex w-full items-center justify-center gap-2 py-2 text-sm font-bold">
                <Gift size={16} /> Claim daily Stars{data ? ` (+${data.dailyStars})` : ""}
              </button>
              {msg && <p role="status" className="mt-2 text-center text-xs text-on-glass-muted">{msg}</p>}
              <StreakRow streak={data?.streak ?? 0} next={nextBonus} />
            </section>

            {/* Coins: real money (licensed pilot only), shown in the chosen currency as an estimate */}
            <section className="glass rounded-card p-3">
              <div className="flex items-center justify-between">
                <div className="label text-[11px] text-on-glass-muted">Coins</div>
                <div className="flex gap-1" role="radiogroup" aria-label="Display currency">
                  {(eco?.currencies ?? [{ code: "RWF" }]).map((c) => (
                    <button key={c.code} type="button" role="radio" aria-checked={currency === c.code} onClick={() => setCurrency(c.code)} className={`tile num rounded-control px-2 py-1 text-xs font-bold ${currency === c.code ? "tile-active" : ""}`}>
                      {c.code}
                    </button>
                  ))}
                </div>
              </div>
              <div className="num mt-1 text-2xl font-extrabold">{coinBalance.toLocaleString()} coins</div>
              {rate && (
                <div className="text-sm text-on-glass-muted">≈ {formatMinor(coinsToMinor(coins(coinBalance), rate as CurrencyRate), rate)} (estimate at today&apos;s rate)</div>
              )}
              {!pilot && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-on-glass-muted">
                  <Info size={14} className="mt-0.5 shrink-0" /> Real-money coins, adding funds and cash-out open with the licensed pilot in your country.
                </p>
              )}
            </section>

            <ExchangeCard currency={currency} cur={rate} pilot={pilot} />
            <PlaySafeCard limits={data?.limits ?? null} stakedToday={data?.stakedToday ?? 0} onChange={(l) => setData((d) => (d ? { ...d, limits: l } : d))} />

            {/* honest history: every change shown with its sign */}
            <section className="glass rounded-card p-3">
              <div className="label mb-2 text-[11px] text-on-glass-muted">Recent activity</div>
              <ul className="flex flex-col gap-1.5">
                {(data?.history ?? []).slice(0, 8).map((t, i) => {
                  const plus = t.amount > 0;
                  return (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className={`grid size-7 shrink-0 place-items-center rounded-full ${plus ? "bg-success/15 text-success-soft" : "bg-danger/15 text-danger-soft"}`}>
                        {plus ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{TX_LABEL[t.type] ?? t.type.replace(/_/g, " ")}</span>
                      <span className={`num font-bold ${plus ? "text-success-soft" : "text-danger-soft"}`}>
                        {plus ? "+" : "−"}
                        {Math.abs(t.amount).toLocaleString()}
                      </span>
                      <span className="hidden w-24 text-right text-[11px] text-on-glass-muted sm:inline">{fmtTime(t.at)}</span>
                    </li>
                  );
                })}
                {data && !data.history.length && <li className="text-sm text-on-glass-muted">No activity yet.</li>}
              </ul>
            </section>
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary press hidden py-2 text-sm font-bold phone:block">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
