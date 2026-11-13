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
  ReceiptText,
  Rotate3d,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";
import { W } from "./strings";
import "./wallet.css";

/**
 * The wallet IS the interface: an open leather bifold held up in front of you.
 *   left half:  leather currency tabs, the printed balance card (Stars big, coins ≈ money) and the gold Claim button
 *   right half: four big stitched buttons — Top up, Cash out, Activity, Play safe
 * A button brings its card out of the wallet to the centre front: a clear header (back / close) and a scrolling
 * body. Tap outside the card or press Esc to put it back; again to close the wallet. Buttons are real DOM placed on
 * the 3D leather (drei <Html transform>), so they are big, crisp, keyboard-focusable and never fight the drag —
 * turning happens only by dragging the leather / background or with the "Drag to turn" handle.
 * Matte materials only (no glare).
 */
export type Panel = "topup" | "cashout" | "activity" | "safe";
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
const cardFace = new THREE.MeshStandardMaterial({ color: "#ece6d8", roughness: 0.85 });
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

/** The gold Star tokens on the balance card; a claim drops one on the stack and "+N Stars" floats up. */
function TokenStack({ stars, burst, reduced }: { stars: number; burst: string | null; reduced: boolean }) {
  const drop = useRef<THREE.Mesh>(null);
  const float = useRef<THREE.Group>(null);
  const tb = useRef(0);
  const last = useRef<string | null>(burst);
  const n = Math.max(2, Math.min(8, Math.ceil(stars / 250)));
  useFrame((_, dt) => {
    if (burst !== last.current) {
      last.current = burst;
      tb.current = burst ? 1 : 0;
    }
    tb.current = Math.max(0, tb.current - dt * (reduced ? 0.5 : 0.7));
    const k = 1 - tb.current;
    if (drop.current) {
      drop.current.visible = tb.current > 0 && !reduced;
      drop.current.position.y = n * 0.016 + 0.3 - Math.min(1, k * 2.4) * 0.3;
    }
    if (float.current) {
      float.current.visible = tb.current > 0;
      float.current.position.y = 0.2 + (reduced ? 0 : k * 0.2);
    }
  });
  return (
    <group position={[0.31, -0.11, 0.045]}>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[(i % 2) * 0.006, i * 0.016, 0]} material={goldMat}>
          <cylinderGeometry args={[0.07, 0.07, 0.014, 28]} />
        </mesh>
      ))}
      <mesh ref={drop} material={goldMat} visible={false}>
        <cylinderGeometry args={[0.07, 0.07, 0.014, 28]} />
      </mesh>
      <group ref={float} visible={false}>
        <Text
          font={FONT}
          position={[-0.1, 0, 0.06]}
          fontSize={0.07}
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

/** The printed balance card: what you have, at a glance. */
function BalanceCard({
  stars,
  coinsText,
  moneyText,
  currency,
}: {
  stars: number;
  coinsText: string;
  moneyText: string | null;
  currency: string;
}) {
  return (
    <group position={[0, 0.07, 0.03]}>
      <RoundedBox args={[HALF_W - 0.08, 0.44, 0.008]} radius={0.025} smoothness={3} material={cardFace} />
      <Text
        font={FONT}
        position={[-0.42, 0.195, 0.006]}
        fontSize={0.036}
        color="#5b5246"
        anchorX="left"
        anchorY="top"
        letterSpacing={0.06}
      >
        {W.stars.toUpperCase()}
      </Text>
      <Text
        font={FONT}
        position={[-0.43, 0.165, 0.006]}
        fontSize={0.155}
        color="#16171a"
        anchorX="left"
        anchorY="top"
        maxWidth={0.62}
      >
        {stars.toLocaleString()}
      </Text>
      <Text
        font={FONT}
        position={[-0.42, -0.035, 0.006]}
        fontSize={0.05}
        color="#1e1f23"
        anchorX="left"
        anchorY="top"
        maxWidth={0.86}
      >
        {coinsText}
      </Text>
      <Text
        font={FONT}
        position={[-0.42, -0.095, 0.006]}
        fontSize={0.034}
        color="#5b5246"
        anchorX="left"
        anchorY="top"
        maxWidth={0.86}
      >
        {moneyText ? `≈ ${moneyText} (${currency}, ${W.estimate})` : " "}
      </Text>
      <Text
        font={FONT}
        position={[-0.42, -0.165, 0.006]}
        fontSize={0.03}
        color="#6b6153"
        anchorX="left"
        anchorY="top"
      >
        {W.practice}
      </Text>
    </group>
  );
}

/**
 * The opened card: flat, front-facing and centred, fitted to the screen; it grows out of the wallet's right half
 * (and back in on close). A clear header (back, title, close), big controls, and a body that scrolls if long.
 * The dim layer behind it is the "outside": one tap there puts the card back.
 */
function CardOverlay({
  panel,
  cards,
  onClose,
  reduced,
}: {
  panel: Panel | null;
  cards: Record<Panel, { title: string; icon: ReactNode; body: ReactNode }>;
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
    }, 200);
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
      >
        <header className="wcard-head">
          <button type="button" className="wcard-close" onClick={onClose} aria-label={W.back}>
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
  coinsText: string;
  moneyText: string | null;
  currency: string;
  currencies: string[];
  onCurrency: (c: string) => void;
  claim: ClaimState;
  onClaim: () => void;
  burst: string | null;
  activityCount: number;
  panel: Panel | null;
  openPanel: (p: Panel) => void;
  closePanel: () => void;
  onBackdrop: () => void;
  cards: Record<Panel, { title: string; icon: ReactNode; body: ReactNode }>;
  reduced: boolean;
};

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
  const hinge = useRef(p.reduced ? OPEN : 1.25); // opens like a real bifold
  useFrame((_, dt) => {
    hinge.current = p.reduced ? OPEN : hinge.current + (OPEN - hinge.current) * Math.min(1, dt * 5);
    if (left.current) left.current.rotation.y = hinge.current;
    if (right.current) right.current.rotation.y = -hinge.current;
    if (root.current) {
      const k = p.reduced ? 1 : Math.min(1, dt * 8);
      root.current.rotation.y += (p.turn.current.yaw - root.current.rotation.y) * k;
      root.current.rotation.x += (-0.12 + p.turn.current.pitch - root.current.rotation.x) * k;
    }
  });
  const inert = p.panel !== null;
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
        {/* left half: tabs, balance, claim */}
        <group ref={left}>
          <group position={[-HX, 0, 0]}>
            <RoundedBox args={[HALF_W, HALF_H, 0.05]} radius={0.045} smoothness={4} material={leatherMat} />
            <mesh position={[0, 0, 0.026]} material={innerMat}>
              <boxGeometry args={[HALF_W - 0.06, HALF_H - 0.06, 0.002]} />
            </mesh>
            <Surface w={HALF_W - 0.14} h={0.1} position={[0, 0.345, 0.03]} inert={inert}>
              <div className="wtabs" role="radiogroup" aria-label={W.currency}>
                {p.currencies.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={c === p.currency}
                    className="wtab"
                    onClick={() => p.onCurrency(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </Surface>
            <BalanceCard
              stars={p.stars}
              coinsText={p.coinsText}
              moneyText={p.moneyText}
              currency={p.currency}
            />
            <TokenStack stars={p.stars} burst={p.burst} reduced={p.reduced} />
            <Surface w={HALF_W - 0.08} h={0.22} position={[0, -0.31, 0.03]} inert={inert}>
              <button
                type="button"
                data-wallet-btn="claim"
                className={`wbtn wbtn-row ${p.claim.available ? "wbtn-gold" : ""}`}
                disabled={!p.claim.available || p.claim.busy}
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
                    ["topup", <ArrowDownToLine key="i" />, W.topUp, W.topUpSub],
                    ["cashout", <ArrowUpFromLine key="i" />, W.cashOut, W.cashOutSub],
                    ["activity", <ReceiptText key="i" />, W.activity, W.activitySub(p.activityCount)],
                    ["safe", <ShieldCheck key="i" />, W.safe, W.safeSub],
                  ] as const
                ).map(([id, icon, label, sub]) => (
                  <button
                    key={id}
                    type="button"
                    data-wallet-btn={id}
                    className="wbtn"
                    onClick={() => p.openPanel(id)}
                  >
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
      {props.hint && !props.panel && (
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
