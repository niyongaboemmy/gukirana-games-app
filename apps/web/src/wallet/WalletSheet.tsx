"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { create } from "zustand";
import { ArrowDownToLine, ArrowUpFromLine, ReceiptText, ShieldCheck } from "lucide-react";
import { ACT } from "@gukirana/contracts";
import { coins, coinsToMinor, formatMinor, streakBonus, type CurrencyRate } from "@gukirana/money";
import { api, claimDailyStars } from "@/lib/session";
import { useProfile } from "@/lib/profile-store";
import { doAction } from "@/social/people";
import type { Limits } from "./WalletExtras";
import { ActivityBody, FundsBody, PlaySafeBody, type Cur } from "./WalletCards";
import type { ClaimState, Panel } from "./WalletScene";
import { W } from "./strings";

const WalletScene = dynamic(() => import("./WalletScene").then((m) => m.WalletScene), { ssr: false });

/** Open / close from anywhere (Stars chip, B key, person menu). */
export const useWalletSheet = create<{ open: boolean; set: (open: boolean) => void }>()((set) => ({
  open: false,
  set: (open) => set({ open }),
}));

type Tx = { type: string; amount: number; at: string; refType: string | null };
type WalletData = {
  stars: number;
  history: Tx[];
  dailyStars: number;
  pilotEnabled: boolean;
  economyVersion: number;
  coins?: number;
  streak?: number;
  limits?: Limits;
  stakedToday?: number;
  claimedToday?: boolean;
  nextClaimAt?: string;
};
type Economy = { version: number; currencies: Cur[]; pilotEnabled: boolean; streakStars?: number[] };

const HINT_KEY = "gk.wallet.hinted";
const HOUR = 3_600_000;
const kigaliDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Kigali" });
/** Kigali has no DST: its midnight is 22:00 UTC. */
const nextKigaliMidnight = (now = Date.now()) =>
  Date.parse(`${kigaliDay(new Date(now + 24 * HOUR))}T00:00:00+02:00`);
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const fmtWait = (ms: number) => {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  if (min >= 180) return `${Math.floor(min / 60)} h`;
  if (min >= 60) return `${Math.floor(min / 60)} h ${min % 60} min`;
  return `${min} min`;
};
const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function WalletSheet() {
  const open = useWalletSheet((s) => s.open);
  const setOpen = useWalletSheet((s) => s.set);
  const [data, setData] = useState<WalletData | null>(null);
  const [eco, setEco] = useState<Economy | null>(null);
  const [currency, setCurrency] = useState("RWF");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [burst, setBurst] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const opener = useRef<string | null>(null);
  const panelRef = useRef<Panel | null>(null);
  panelRef.current = panel;
  const stars = useProfile((s) => s.stars);

  const dismissHint = () => {
    if (!hint) return;
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* private mode: the hint just shows again next time */
    }
  };
  const openPanel = (p: Panel) => {
    dismissHint();
    opener.current = p;
    setPanel(p);
  };
  const closePanel = useCallback(() => {
    setPanel(null);
    const id = opener.current;
    // focus goes back to the button that opened the card
    if (id)
      setTimeout(
        () =>
          document.querySelector<HTMLElement>(`[data-wallet-btn="${id}"]`)?.focus({ preventScroll: true }),
        80,
      );
  }, []);
  /** Esc / outside tap: closes the open card first, then the wallet. */
  const back = useCallback(() => {
    if (panelRef.current) closePanel();
    else setOpen(false);
  }, [closePanel, setOpen]);

  // B toggles the wallet (W is walk); Esc steps back. Capture phase so the world's own Esc handling doesn't also fire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.code === "Escape" && useWalletSheet.getState().open) {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (typing) (e.target as HTMLElement).blur();
        back();
        return;
      }
      if (typing) return;
      if (e.code === "KeyB" && !e.metaKey && !e.ctrlKey && !e.altKey)
        useWalletSheet.getState().set(!useWalletSheet.getState().open);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [back]);

  useEffect(() => {
    if (!open) {
      setPanel(null);
      return;
    }
    doAction(ACT.phone); // your person takes it out and looks into it (others see the gesture, never the amounts)
    setMsg(null);
    setNow(Date.now());
    try {
      setHint(!localStorage.getItem(HINT_KEY));
    } catch {
      setHint(true);
    }
    void api<WalletData>("/wallet")
      .then(setData)
      .catch(() => setData(null));
    void api<Economy>("/economy")
      .then(setEco)
      .catch(() => setEco(null));
    const t = setInterval(() => setNow(Date.now()), 60_000); // keeps "next in 7 h" fresh
    return () => clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  const rate = useMemo(() => eco?.currencies.find((c) => c.code === currency), [eco, currency]);
  const reduced = useMemo(() => reducedMotion(), [open]);

  if (!open) return null;

  const coinBalance = data?.coins ?? 0;
  const pilot = !!(data?.pilotEnabled ?? eco?.pilotEnabled);
  const total = data?.stars ?? stars;
  const money = rate ? formatMinor(coinsToMinor(coins(coinBalance), rate as CurrencyRate), rate) : null;
  const codes = (eco?.currencies ?? [{ code: "RWF" }]).map((c) => c.code);
  const history = (data?.history ?? []).map((tx) => ({
    label: W.tx[tx.type] ?? tx.type.replace(/_/g, " "),
    amount: tx.amount,
    when: fmtTime(tx.at),
  }));

  // claim state: from the API when it reports it, else derived from today's (Kigali day) ledger lines
  const today = kigaliDay(new Date(now));
  const claimedToday = data
    ? (data.claimedToday ??
      data.history.some((tx) => tx.type === "stars_daily" && kigaliDay(new Date(tx.at)) === today))
    : true;
  const nextAt = data?.nextClaimAt ? Date.parse(data.nextClaimAt) : nextKigaliMidnight(now);
  const streak = data?.streak ?? 0;
  const claim: ClaimState = {
    available: !!data && !claimedToday,
    amount: data?.dailyStars ?? 0,
    bonus: claimedToday ? 0 : streakBonus(streak + 1, { streakStars: eco?.streakStars ?? [] }),
    next: fmtWait(Math.max(0, nextAt - now)),
    streak,
    busy,
  };

  const onClaim = async () => {
    if (busy || !claim.available) return; // a double tap claims once; a claimed button is disabled, no toast
    dismissHint();
    setBusy(true);
    try {
      const r = (await claimDailyStars()) as {
        granted: number;
        stars: number;
        streak?: number;
        streakBonus?: number;
      };
      if (r.granted) setBurst(`+${(r.granted + (r.streakBonus ?? 0)).toLocaleString()} ${W.stars}`); // a token drops in, "+N Stars" floats up
      setData((d) => (d ? { ...d, stars: r.stars, claimedToday: true, streak: r.streak ?? d.streak } : d));
      void api<WalletData>("/wallet")
        .then(setData)
        .catch(() => undefined); // refresh the activity list
    } catch {
      setMsg(W.claimFail);
    } finally {
      setBusy(false);
    }
  };

  const cards = {
    topup: {
      title: W.topUp,
      icon: <ArrowDownToLine size={24} />,
      body: (
        <FundsBody
          kind="buy"
          currency={currency}
          currencies={codes}
          onCurrency={setCurrency}
          cur={rate}
          pilot={pilot}
          coinBalance={coinBalance}
        />
      ),
    },
    cashout: {
      title: W.cashOut,
      icon: <ArrowUpFromLine size={24} />,
      body: (
        <FundsBody
          kind="cashout"
          currency={currency}
          currencies={codes}
          onCurrency={setCurrency}
          cur={rate}
          pilot={pilot}
          coinBalance={coinBalance}
        />
      ),
    },
    activity: { title: W.activity, icon: <ReceiptText size={24} />, body: <ActivityBody rows={history} /> },
    safe: {
      title: W.safe,
      icon: <ShieldCheck size={24} />,
      body: (
        <PlaySafeBody
          limits={data?.limits ?? null}
          stakedToday={data?.stakedToday ?? 0}
          onChange={(l) => setData((d) => (d ? { ...d, limits: l } : d))}
        />
      ),
    },
  };

  // The wallet IS the interface (WalletScene): a 3D leather wallet with big buttons on it. Rendered into <body>,
  // above the persistent 3D canvas, with light dimming so it reads clearly; outside tap / Esc steps back.
  return createPortal(
    <section
      role="dialog"
      aria-modal="true"
      aria-label={W.title}
      className="fixed inset-0 z-[90] bg-black/50"
    >
      <WalletScene
        stars={total}
        coinsText={`${coinBalance.toLocaleString()} ${W.coins.toLowerCase()}`}
        moneyText={money}
        currency={currency}
        currencies={codes}
        onCurrency={setCurrency}
        claim={claim}
        onClaim={() => void onClaim()}
        burst={burst}
        activityCount={history.length}
        panel={panel}
        openPanel={openPanel}
        closePanel={closePanel}
        onBackdrop={() => setOpen(false)}
        onClose={() => setOpen(false)}
        cards={cards}
        reduced={reduced}
        hint={hint}
      />
      {msg && (
        <div
          role="alert"
          className="toast pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 whitespace-nowrap px-4 py-2 text-sm"
        >
          {msg}
        </div>
      )}
      {/* text summary for screen readers (the 3D wallet carries the same information visually) */}
      <p className="sr-only">
        {total} practice Stars, no cash value. {coinBalance} coins{money ? `, about ${money}` : ""}.{" "}
        {claim.available ? `Daily Stars are ready to claim.` : `Daily Stars claimed; next in ${claim.next}.`}
      </p>
    </section>,
    document.body,
  );
}
