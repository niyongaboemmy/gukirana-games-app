"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { create } from "zustand";
import { X } from "lucide-react";
import { ACT } from "@gukirana/contracts";
import { coins, coinsToMinor, formatMinor, type CurrencyRate } from "@gukirana/money";
import { api, claimDailyStars } from "@/lib/session";
import { useProfile } from "@/lib/profile-store";
import { doAction } from "@/social/people";
import { ExchangeCard, PlaySafeCard, type Limits } from "./WalletExtras";
import type { Panel } from "./WalletScene";

const WalletScene = dynamic(() => import("./WalletScene").then((m) => m.WalletScene), { ssr: false });

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
  const [tab, setTab] = useState<Panel>(null);
  const [burst, setBurst] = useState<string | null>(null);
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
    if (busy) return; // a double tap on the tokens claims once
    setBusy(true);
    try {
      const r = (await claimDailyStars()) as { granted: number; stars: number; streak?: number; streakBonus?: number; nextStreakBonus?: number };
      setMsg(r.granted ? `+${r.granted} Stars added${r.streakBonus ? ` · +${r.streakBonus} streak bonus` : ""}` : "Already claimed today — come back tomorrow");
      setNextBonus(r.nextStreakBonus ?? null);
      if (r.granted) setBurst(`+${r.granted + (r.streakBonus ?? 0)} Stars`); // a token drops in, "+N Stars" floats up
      setData((d) => (d ? { ...d, stars: r.stars } : d));
      void api<WalletData>("/wallet").then(setData).catch(() => undefined); // refresh the activity list
    } catch {
      setMsg("Could not claim right now");
    } finally {
      setBusy(false);
    }
  };

  const total = data?.stars ?? stars;
  const money = rate ? formatMinor(coinsToMinor(coins(coinBalance), rate as CurrencyRate), rate) : null;
  const codes = (eco?.currencies ?? [{ code: "RWF" }]).map((c) => c.code);
  const history = (data?.history ?? []).map((tx) => ({ label: TX_LABEL[tx.type] ?? tx.type.replace(/_/g, " "), amount: tx.amount, when: fmtTime(tx.at) }));

  // The wallet IS the interface (WalletScene): a 3D leather wallet you operate by touching its parts. Rendered into
  // <body>, above the persistent 3D canvas; non-blocking (the game stays visible); B / Esc / outside tap closes it.
  return createPortal(
    <>
      {/* light dimming so the wallet reads clearly; tap outside to put it away */}
      <div className="fixed inset-0 z-[89] bg-black/35" aria-hidden onClick={() => setOpen(false)} />
      <section
        role="dialog"
        aria-label="Your wallet"
        className="fixed left-1/2 top-1/2 z-[90] h-[min(560px,84dvh)] w-[min(780px,94vw)] -translate-x-1/2 -translate-y-1/2"
      >
        <WalletScene
          stars={total}
          coinsLine={`${coinBalance.toLocaleString()} coins${money ? ` ≈ ${money}` : ""}`}
          currency={currency}
          onCycleCurrency={() => setCurrency(codes[(codes.indexOf(currency) + 1) % codes.length] ?? "RWF")}
          onClaim={() => void claim()}
          burst={burst}
          streak={data?.streak ? `${data.streak}-day streak${nextBonus ? ` · +${nextBonus} tomorrow` : ""}` : null}
          history={history}
          panel={tab}
          setPanel={setTab}
          funds={<ExchangeCard currency={currency} cur={rate} pilot={pilot} />}
          safe={<PlaySafeCard limits={data?.limits ?? null} stakedToday={data?.stakedToday ?? 0} onChange={(l) => setData((d) => (d ? { ...d, limits: l } : d))} />}
        />
        <button type="button" onClick={() => setOpen(false)} aria-label="Close wallet" className="icon-button absolute right-2 top-2 size-8 rounded-full">
          <X size={15} />
        </button>
        {msg && (
          <div role="status" className="toast pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1.5 text-xs">
            {msg}
          </div>
        )}
        {/* text summary for screen readers (the 3D wallet carries the same information visually) */}
        <p className="sr-only">
          {total} practice Stars, no cash value. {coinBalance} coins{money ? `, about ${money}` : ""}. Tap the Stars tokens to claim daily Stars, the cards for activity, funds and play-safe settings.
        </p>
      </section>
    </>,
    document.body,
  );
}
