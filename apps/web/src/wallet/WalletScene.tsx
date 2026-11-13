"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as RKeyboardEvent,
  type PointerEvent as RPointerEvent,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, RoundedBox, Text } from "@react-three/drei";
import * as THREE from "three";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  CircleCheck,
  Info,
  Lock,
  ReceiptText,
  Rotate3d,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";
import { wsound } from "./sound";
import { W } from "./strings";
import "./wallet.css";

/**
 * The wallet IS the interface: an open leather bifold held up in front of you.
 *   left half:  "Show coins in" + leather currency tabs, the printed balance card (two rows: Stars · practice, then
 *               Coins · real money ≈ money; an "i" strip explains both) and the gold Claim button
 *   right half: four big stitched buttons — Top up, Cash out, Activity, Play safe
 * A button brings its card out of the wallet to the centre front: a clear header (back / close) and a scrolling
 * body. Tap outside the card or press Esc to put it back; again to close the wallet. Buttons are real DOM placed on
 * the 3D leather (drei <Html transform>), so they are big, crisp, keyboard-focusable and never fight the drag —
 * turning happens only by dragging the leather / background or with the "Drag to turn" handle.
 * Matte materials only (no glare).
 */
export type Panel = "topup" | "cashout" | "activity" | "safe" | "info";
export type ClaimState = {
  available: boolean;
  amount: number;
  bonus: number;
  next: string;
  streak: number;
  busy: boolean;
};

/** CSS px per world unit for <Html transform distanceFactor={1}> (drei: 1 px = distanceFactor / 400 units). */
const PX = 400;
const HALF_W = 1.0;
const HALF_H = 0.92;
const HX = HALF_W / 2 + 0.02; // centre of each half from the spine
const OPEN = 0.12; // the halves' hinge angle when held open (a slight V towards you)
/** keep the wallet from growing huge on big screens (screen px per world unit at the wallet plane) */
const MAX_PPU = 560;

const FONT = "/fonts/Baloo2.ttf";
const leatherMat = new THREE.MeshStandardMaterial({ color: "#5a3b26", roughness: 0.93, metalness: 0 });
const innerMat = new THREE.MeshStandardMaterial({ color: "#3d281b", roughness: 0.96 });
const goldMat = new THREE.MeshStandardMaterial({ color: "#d9ab3c", roughness: 0.55, metalness: 0.3 });
const silverMat = new THREE.MeshStandardMaterial({ color: "#c3c7cd", roughness: 0.6, metalness: 0.25 });
const cardFace = new THREE.MeshStandardMaterial({ color: "#ece6d8", roughness: 0.85 });
const ruleMat = new THREE.MeshBasicMaterial({ color: "#cbbfa6" });
const clearMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

/** DOM on the leather must not also reach the 3D event system (no backdrop "outside tap", no drag). */
const stop = (e: SyntheticEvent) => e.stopPropagation();
const stopAll = {
  onPointerDown: stop,
  onPointerUp: stop,
  onClick: stop,
  onDoubleClick: stop,
  onPointerMove: stop,
};

type Turn = { yaw: number; pitch: number };

/** DOM placed on a 3D surface: w × h world units. */
const HtmlHost = createContext<RefObject<HTMLDivElement | null> | null>(null);

function Surface({
  w,
  h,
  position,
  z = [120, 60],
  inert,
  children,
}: {
  w: number;
  h: number;
  position: [number, number, number];
  z?: [number, number];
  inert?: boolean;
  children: ReactNode;
}) {
  // a fixed host element: drei <Html> otherwise re-creates its DOM root when R3F's event target connects and can
  // lose the content; it also keeps DOM clicks out of the 3D event system entirely
  const host = useContext(HtmlHost);
  return (
    <Html
      portal={(host as RefObject<HTMLElement> | null) ?? undefined}
      transform
      distanceFactor={1}
      position={position}
      zIndexRange={z}
      pointerEvents={inert ? "none" : "auto"}
    >
      <div
        style={{ width: w * PX, height: h * PX }}
        inert={inert}
        aria-hidden={inert || undefined}
        {...stopAll}
      >
        {children}
      </div>
    </Html>
  );
}

/** Fits the open wallet to the screen (phone landscape up to desktop) whenever the canvas resizes. */
function Fit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const aspect = size.width / size.height;
    const fitW = 2 * HALF_W + 0.25;
    const fitH = HALF_H + 0.33; // room for the hint above and the turn handle below
    const d = Math.max(fitH / (2 * t), fitW / (2 * t * aspect), size.height / (2 * t * MAX_PPU));
    cam.position.set(0, 0, d);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

/** A number that counts up (or down) to its new value over ~0.7 s; instant with reduced motion. */
function useCountUp(target: number, reduced: boolean) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced || from.current === target) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const e = 1 - (1 - k) ** 3;
      setShown(Math.round(a + (target - a) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target, reduced]);
  return shown;
}

/** where the gold Star tokens stand on the left half (right side of the Stars row) */
const STACK: [number, number, number] = [0.33, 0.115, 0.045];
/** where the Claim button sits on the left half */
const CLAIM_AT: [number, number, number] = [-0.12, -0.31, 0.08];

/**
 * The gold Star tokens in the Stars pocket. A claim sends three tokens from the Claim button along an arc into the
 * stack, one after another, and "+N Stars" rises once. With reduced motion only the text shows, briefly.
 */
function TokenStack({ stars, burst, reduced }: { stars: number; burst: string | null; reduced: boolean }) {
  const fly = useRef<(THREE.Mesh | null)[]>([]);
  const float = useRef<THREE.Group>(null);
  const t = useRef(-1);
  const last = useRef<string | null>(burst);
  const n = Math.max(2, Math.min(7, Math.ceil(stars / 250)));
  useFrame((_, dt) => {
    if (burst !== last.current) {
      last.current = burst;
      t.current = burst ? 0 : -1;
      if (burst) wsound.tokens();
    }
    if (t.current < 0) return;
    t.current += dt;
    const T = t.current;
    fly.current.forEach((m, i) => {
      if (!m) return;
      const k = Math.min(1, Math.max(0, (T - i * 0.12) / 0.55));
      m.visible = !reduced && k > 0 && k < 1;
      const e = 1 - (1 - k) ** 2;
      const top = STACK[1] + (n + i) * 0.016;
      m.position.set(
        CLAIM_AT[0] + (STACK[0] - CLAIM_AT[0]) * e,
        CLAIM_AT[1] + (top - CLAIM_AT[1]) * e + Math.sin(Math.PI * k) * 0.16,
        CLAIM_AT[2] + (STACK[2] - CLAIM_AT[2]) * e + Math.sin(Math.PI * k) * 0.08,
      );
      m.rotation.z = (1 - k) * 2.4;
    });
    if (float.current) {
      const k = Math.min(1, T / 1.6);
      float.current.visible = k < 1;
      float.current.position.y = STACK[1] + 0.04 + (reduced ? 0 : k * 0.08);
    }
    if (T > 1.7) t.current = -1;
  });
  return (
    <group>
      <group position={STACK}>
        {Array.from({ length: n }, (_, i) => (
          <mesh key={i} position={[(i % 2) * 0.006, i * 0.016, 0]} material={goldMat}>
            <cylinderGeometry args={[0.065, 0.065, 0.014, 28]} />
          </mesh>
        ))}
      </group>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(m) => {
            fly.current[i] = m;
          }}
          material={goldMat}
          visible={false}
        >
          <cylinderGeometry args={[0.065, 0.065, 0.014, 28]} />
        </mesh>
      ))}
      <group ref={float} visible={false} position={[STACK[0] - 0.3, 0, 0.1]}>
        <Text
          font={FONT}
          fontSize={0.064}
          color="#facc15"
          anchorX="center"
          outlineWidth={0.004}
          outlineColor="#1a1208"
        >
          {burst ?? ""}
        </Text>
      </group>
    </group>
  );
}

/**
 * The printed balance card: two clearly separated rows.
 *   STARS · PRACTICE    920              (gold tokens)
 *   No cash value
 *   ─────────────────
 *   COINS · REAL MONEY  0 coins                ≈ RWF 0  (shown in RWF · estimate)
 *   (i) What are Stars and Coins?   (a DOM strip along the bottom edge)
 */
function BalanceCard({
  stars,
  coinCount,
  moneyText,
  currency,
  pilot,
  reduced,
  inert,
  onInfo,
}: {
  stars: number;
  coinCount: number;
  moneyText: string | null;
  currency: string;
  pilot: boolean;
  reduced: boolean;
  inert: boolean;
  onInfo: () => void;
}) {
  const s = useCountUp(stars, reduced);
  const c = useCountUp(coinCount, reduced);
  const L = -0.42;
  return (
    <group position={[0, 0.07, 0.03]}>
      <RoundedBox args={[HALF_W - 0.08, 0.44, 0.008]} radius={0.025} smoothness={3} material={cardFace} />
      {/* Stars row */}
      <mesh position={[L + 0.012, 0.184, 0.006]} rotation={[Math.PI / 2, 0, 0]} material={goldMat}>
        <cylinderGeometry args={[0.014, 0.014, 0.004, 20]} />
      </mesh>
      <Text
        font={FONT}
        position={[L + 0.038, 0.2, 0.006]}
        fontSize={0.032}
        color="#8a6a1c"
        anchorX="left"
        anchorY="top"
        letterSpacing={0.06}
      >
        {`${W.stars.toUpperCase()} · ${W.starsTag.toUpperCase()}`}
      </Text>
      <Text
        font={FONT}
        position={[L - 0.008, 0.172, 0.006]}
        fontSize={0.112}
        color="#16171a"
        anchorX="left"
        anchorY="top"
        maxWidth={0.6}
      >
        {s.toLocaleString()}
      </Text>
      <Text
        font={FONT}
        position={[L, 0.052, 0.006]}
        fontSize={0.029}
        color="#6b6153"
        anchorX="left"
        anchorY="top"
      >
        {W.noCash}
      </Text>
      {/* the rule between the two balances */}
      <mesh position={[0, 0.012, 0.0045]} material={ruleMat}>
        <planeGeometry args={[HALF_W - 0.16, 0.004]} />
      </mesh>
      {/* Coins row */}
      <mesh position={[L + 0.012, -0.021, 0.006]} rotation={[Math.PI / 2, 0, 0]} material={silverMat}>
        <cylinderGeometry args={[0.014, 0.014, 0.004, 20]} />
      </mesh>
      <Text
        font={FONT}
        position={[L + 0.038, -0.005, 0.006]}
        fontSize={0.032}
        color="#4b5563"
        anchorX="left"
        anchorY="top"
        letterSpacing={0.06}
      >
        {`${W.coins.toUpperCase()} · ${W.coinsTag.toUpperCase()}`}
      </Text>
      <Text
        font={FONT}
        position={[L - 0.004, -0.04, 0.006]}
        fontSize={0.064}
        color="#1e1f23"
        anchorX="left"
        anchorY="top"
        maxWidth={0.4}
      >
        {`${c.toLocaleString()} ${W.coinWord(coinCount)}`}
      </Text>
      <Text
        font={FONT}
        position={[0.42, -0.036, 0.006]}
        fontSize={0.05}
        color="#1e1f23"
        anchorX="right"
        anchorY="top"
        maxWidth={0.46}
      >
        {moneyText ? `≈ ${moneyText}` : " "}
      </Text>
      <Text
        font={FONT}
        position={[0.42, -0.09, 0.006]}
        fontSize={0.025}
        color="#6b6153"
        anchorX="right"
        anchorY="top"
      >
        {pilot ? W.shownIn(currency) : `${W.shownIn(currency)} · pilot soon`}
      </Text>
      <Surface w={HALF_W - 0.08} h={0.088} position={[0, -0.176, 0.0055]} inert={inert}>
        <button
          type="button"
          data-wallet-btn="info"
          className="winfo-strip"
          onPointerDown={() => wsound.click()}
          onClick={onInfo}
        >
          <Info /> {W.whatAre}
        </button>
      </Surface>
    </group>
  );
}

/**
 * The opened card: a physical cream card, flat, front-facing and centred, fitted to the screen. It slides out of the
 * slot of the button that opened it (and back in on close). A leather header band (back, title, close) and a body
 * that scrolls if long. The dim layer behind it is the "outside": one tap there puts the card back.
 */
function CardOverlay({
  panel,
  cards,
  origin,
  onClose,
  reduced,
}: {
  panel: Panel | null;
  cards: Record<Panel, { title: string; icon: ReactNode; body: ReactNode }>;
  origin: { x: number; y: number } | null;
  onClose: () => void;
  reduced: boolean;
}) {
  const [shown, setShown] = useState<Panel | null>(panel);
  const [closing, setClosing] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (panel) {
      setShown(panel);
      setClosing(false);
      wsound.slide();
      const id = setTimeout(() => closeBtn.current?.focus({ preventScroll: true }), 30);
      return () => clearTimeout(id);
    }
    if (!shown) return;
    if (reduced) {
      setShown(null);
      return;
    }
    setClosing(true);
    const id = setTimeout(() => {
      setShown(null);
      setClosing(false);
    }, 220);
    return () => clearTimeout(id);
  }, [panel]);
  if (!shown) return null;
  const c = cards[shown];
  return (
    <div
      className={`wcard-layer ${closing ? "is-closing" : ""} ${reduced ? "is-still" : ""}`}
      onClick={onClose}
    >
      <section
        className="wcard"
        role="dialog"
        aria-modal="true"
        aria-label={c.title}
        onClick={(e) => e.stopPropagation()}
        style={origin ? ({ "--wx": `${origin.x}px`, "--wy": `${origin.y}px` } as CSSProperties) : undefined}
      >
        <header className="wcard-head">
          <button
            type="button"
            className="wcard-close"
            onPointerDown={() => wsound.click()}
            onClick={onClose}
            aria-label={W.backWallet}
          >
            <ArrowLeft size={24} />
          </button>
          <span className="wcard-icon" aria-hidden>
            {c.icon}
          </span>
          <h2>{c.title}</h2>
          <button
            ref={closeBtn}
            type="button"
            className="wcard-close"
            onPointerDown={() => wsound.click()}
            onClick={onClose}
            aria-label={`Close ${c.title}`}
          >
            <X size={26} />
          </button>
        </header>
        <div className="wcard-body">{c.body}</div>
      </section>
    </div>
  );
}

type BodyProps = {
  stars: number;
  coinCount: number;
  moneyText: string | null;
  currency: string;
  currencies: string[];
  onCurrency: (c: string) => void;
  pilot: boolean;
  claim: ClaimState;
  onClaim: () => void;
  burst: string | null;
  activityCount: number;
  panel: Panel | null;
  origin: { x: number; y: number } | null;
  openPanel: (p: Panel) => void;
  closePanel: () => void;
  onBackdrop: () => void;
  cards: Record<Panel, { title: string; icon: ReactNode; body: ReactNode }>;
  reduced: boolean;
  closing: boolean;
};

/** HINGE when closed (the halves fold towards each other) */
const SHUT = 1.3;

function WalletBody(
  p: BodyProps & {
    turn: RefObject<Turn>;
    onDragStart: (x: number, y: number) => void;
    dragged: () => boolean;
  },
) {
  const root = useRef<THREE.Group>(null);
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const hinge = useRef(p.reduced ? OPEN : SHUT); // opens like a real bifold
  const appear = useRef(p.reduced ? 1 : 0); // rises into view on open, drops away on close
  const clock = useRef(0);
  useFrame((_, dt) => {
    clock.current += dt;
    const k5 = p.reduced ? 1 : Math.min(1, dt * (p.closing ? 9 : 5));
    hinge.current += ((p.closing ? SHUT : OPEN) - hinge.current) * k5;
    appear.current += ((p.closing ? 0 : 1) - appear.current) * (p.reduced ? 1 : Math.min(1, dt * 7));
    if (left.current) left.current.rotation.y = hinge.current;
    if (right.current) right.current.rotation.y = -hinge.current;
    if (root.current) {
      const k = p.reduced ? 1 : Math.min(1, dt * 8);
      // a very small idle sway (under 1°), as if held in two hands; none with reduced motion or while a card is out
      const still = p.reduced || p.panel !== null;
      const swayY = still ? 0 : Math.sin(clock.current * 0.55) * 0.012;
      const swayX = still ? 0 : Math.sin(clock.current * 0.4 + 1) * 0.007;
      root.current.rotation.y += (p.turn.current.yaw + swayY - root.current.rotation.y) * k;
      root.current.rotation.x += (-0.12 + p.turn.current.pitch + swayX - root.current.rotation.x) * k;
      const a = appear.current;
      root.current.position.y = (1 - a) * -0.45;
      root.current.scale.setScalar(0.86 + 0.14 * a);
    }
  });
  const inert = p.panel !== null || p.closing;
  const tap = { onPointerDown: () => wsound.click() };
  return (
    <>
      {/* everything outside the wallet: a tap closes the open card, else the wallet; a drag turns it */}
      <mesh
        position={[0, 0, -1]}
        material={clearMat}
        onPointerDown={(e: ThreeEvent<PointerEvent>) =>
          p.onDragStart(e.nativeEvent.clientX, e.nativeEvent.clientY)
        }
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (p.dragged()) return;
          e.stopPropagation();
          if (p.panel) p.closePanel();
          else p.onBackdrop();
        }}
      >
        <planeGeometry args={[30, 20]} />
      </mesh>
      <group
        ref={root}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          p.onDragStart(e.nativeEvent.clientX, e.nativeEvent.clientY);
        }}
        onClick={(e: ThreeEvent<MouseEvent>) => e.stopPropagation()}
      >
        {/* spine */}
        <mesh position={[0, 0, -0.01]} material={leatherMat}>
          <boxGeometry args={[0.08, HALF_H - 0.02, 0.04]} />
        </mesh>
        {/* left half: "Show coins in" tabs, balance card, claim */}
        <group ref={left}>
          <group position={[-HX, 0, 0]}>
            <RoundedBox args={[HALF_W, HALF_H, 0.05]} radius={0.045} smoothness={4} material={leatherMat} />
            <mesh position={[0, 0, 0.026]} material={innerMat}>
              <boxGeometry args={[HALF_W - 0.06, HALF_H - 0.06, 0.002]} />
            </mesh>
            <Surface w={HALF_W - 0.1} h={0.1} position={[0, 0.345, 0.03]} inert={inert}>
              <div className="wtabs" role="radiogroup" aria-label={W.currency}>
                <span className="wtabs-cap" aria-hidden>
                  {W.showIn}
                </span>
                {p.currencies.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={c === p.currency}
                    className="wtab"
                    {...tap}
                    onClick={() => p.onCurrency(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </Surface>
            <BalanceCard
              stars={p.stars}
              coinCount={p.coinCount}
              moneyText={p.moneyText}
              currency={p.currency}
              pilot={p.pilot}
              reduced={p.reduced}
              inert={inert}
              onInfo={() => p.openPanel("info")}
            />
            <TokenStack stars={p.stars} burst={p.burst} reduced={p.reduced} />
            <Surface w={HALF_W - 0.08} h={0.22} position={[0, -0.31, 0.03]} inert={inert}>
              <button
                type="button"
                data-wallet-btn="claim"
                className={`wbtn wbtn-row ${p.claim.available ? "wbtn-gold" : ""}`}
                disabled={!p.claim.available || p.claim.busy}
                {...tap}
                onClick={p.onClaim}
              >
                {p.claim.available ? <Star fill="currentColor" /> : <CircleCheck />}
                <span>
                  {p.claim.busy
                    ? W.claiming
                    : p.claim.available
                      ? `${W.claim(p.claim.amount + p.claim.bonus)} ${W.stars}`
                      : W.claimed(p.claim.next)}
                  <small>
                    {p.claim.available
                      ? W.claimSub(p.claim.bonus, p.claim.streak)
                      : W.claimedSub(p.claim.streak)}
                  </small>
                </span>
              </button>
            </Surface>
          </group>
        </group>
        {/* right half: the four big stitched buttons */}
        <group ref={right}>
          <group position={[HX, 0, 0]}>
            <RoundedBox args={[HALF_W, HALF_H, 0.05]} radius={0.045} smoothness={4} material={leatherMat} />
            <mesh position={[0, 0, 0.026]} material={innerMat}>
              <boxGeometry args={[HALF_W - 0.06, HALF_H - 0.06, 0.002]} />
            </mesh>
            <Surface w={HALF_W - 0.08} h={HALF_H - 0.08} position={[0, 0, 0.03]} inert={inert}>
              <div className="grid h-full grid-cols-2 grid-rows-2 gap-[18px]">
                {(
                  [
                    ["topup", <ArrowDownToLine key="i" />, W.topUp, W.topUpSub, !p.pilot],
                    ["cashout", <ArrowUpFromLine key="i" />, W.cashOut, W.cashOutSub, !p.pilot],
                    ["activity", <ReceiptText key="i" />, W.activity, W.activitySub(p.activityCount), false],
                    ["safe", <ShieldCheck key="i" />, W.safe, W.safeSub, false],
                  ] as const
                ).map(([id, icon, label, sub, soon]) => (
                  <button
                    key={id}
                    type="button"
                    data-wallet-btn={id}
                    className="wbtn"
                    {...tap}
                    onClick={() => p.openPanel(id)}
                  >
                    {soon && (
                      <span className="wbtn-tag" title={W.pilotOff}>
                        <Lock /> Pilot
                      </span>
                    )}
                    {icon}
                    {label}
                    <small>{sub}</small>
                  </button>
                ))}
              </div>
            </Surface>
          </group>
        </group>
      </group>
    </>
  );
}

export function WalletScene(props: BodyProps & { onClose: () => void; hint: boolean }) {
  const turn = useRef<Turn>({ yaw: 0, pitch: 0 });
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: number } | null>(null);
  const lastMoved = useRef(0);
  const host = useRef<HTMLDivElement>(null);
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const startDrag = useMemo(
    () => (x: number, y: number) => {
      drag.current = { x, y, yaw: turn.current.yaw, pitch: turn.current.pitch, moved: 0 };
      const move = (e: PointerEvent) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        d.moved = Math.max(d.moved, Math.hypot(dx, dy));
        turn.current = {
          yaw: clamp(d.yaw + dx * 0.005, -0.6, 0.6),
          pitch: clamp(d.pitch + dy * 0.004, -0.3, 0.35),
        };
      };
      const up = () => {
        lastMoved.current = drag.current?.moved ?? 0;
        drag.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [],
  );
  const onHandleDown = (e: RPointerEvent) => {
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
  };
  const onHandleKey = (e: RKeyboardEvent) => {
    const s = 0.1;
    const t = turn.current;
    if (e.key === "ArrowLeft") turn.current = { ...t, yaw: clamp(t.yaw - s, -0.6, 0.6) };
    else if (e.key === "ArrowRight") turn.current = { ...t, yaw: clamp(t.yaw + s, -0.6, 0.6) };
    else if (e.key === "ArrowUp") turn.current = { ...t, pitch: clamp(t.pitch - s, -0.3, 0.35) };
    else if (e.key === "ArrowDown") turn.current = { ...t, pitch: clamp(t.pitch + s, -0.3, 0.35) };
    else if (e.key === "Enter" || e.key === " ") turn.current = { yaw: 0, pitch: 0 };
    else return;
    e.preventDefault();
  };
  return (
    <div className="relative size-full">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 2.6], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <Fit />
        {/* soft, even, glare-free light */}
        <hemisphereLight args={["#f2efe9", "#3a342e", 1.2]} />
        <directionalLight position={[0.8, 1.6, 3]} intensity={1.15} color="#fff4e6" />
        <HtmlHost.Provider value={host}>
          <WalletBody {...props} turn={turn} onDragStart={startDrag} dragged={() => lastMoved.current > 6} />
        </HtmlHost.Provider>
      </Canvas>
      <div ref={host} className="absolute inset-0 z-0 overflow-hidden" style={{ pointerEvents: "none" }} />
      {props.hint && !props.panel && !props.closing && (
        <div
          role="status"
          className="wfloat toast pointer-events-none absolute left-1/2 top-[4%] -translate-x-1/2 whitespace-nowrap px-4 py-2 font-bold phone:top-[2%]"
        >
          {W.hint}
        </div>
      )}
      <CardOverlay
        panel={props.panel}
        cards={props.cards}
        origin={props.origin}
        onClose={props.closePanel}
        reduced={props.reduced}
      />
      <button
        type="button"
        onClick={props.onClose}
        aria-label={W.close}
        title={`${W.close} (Esc)`}
        className="icon-button absolute right-4 top-4 grid size-12 place-items-center rounded-full phone:right-3 phone:top-3 phone:size-11"
      >
        <X size={24} />
      </button>
      <button
        type="button"
        onPointerDown={onHandleDown}
        onKeyDown={onHandleKey}
        onDoubleClick={() => (turn.current = { yaw: 0, pitch: 0 })}
        aria-label={W.rotateAria}
        className="wfloat chip absolute bottom-[3%] left-1/2 flex -translate-x-1/2 cursor-grab touch-none items-center gap-2 rounded-full px-4 py-2 font-semibold active:cursor-grabbing phone:bottom-[2%] phone:py-1.5"
      >
        <Rotate3d size={18} /> {W.rotate}
      </button>
    </div>
  );
}
