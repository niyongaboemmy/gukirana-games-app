"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MonitorSmartphone, ShieldAlert } from "lucide-react";
import type { ConsoleSection } from "@gukirana/contracts";
import { useSession } from "@/lib/session";
import { AdminConsole } from "./AdminConsole";
import { consoleApi } from "./console-api";
import { closeConsole, useConsole, type ScreenRect } from "./console-store";
import { C } from "./strings";
import "./console.css";

type Phase = "off" | "zoom-in" | "boot" | "ready" | "denied" | "zoom-out";
const ZOOM_MS = 520;
const MIN_BOOT_MS = 1100;

/** where the console grows out of: the monitor rect, or a small screen in the middle */
function startRect(from: ScreenRect | null): ScreenRect {
  if (from && from.width > 8 && from.height > 8) return from;
  const w = Math.min(320, window.innerWidth * 0.4);
  return { x: (window.innerWidth - w) / 2, y: window.innerHeight * 0.42, width: w, height: w * 0.6 };
}
const full = (): ScreenRect => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });

/**
 * The staff console as a full-screen layer over the 3D world. Opening from the office computer: the monitor's screen
 * zooms up to fill the display, the console boots (checks your staff role), then the console appears. Log off: it
 * shrinks back into the monitor. Mounted once in the root layout.
 */
export function ConsoleLayer() {
  const { open, office, from } = useConsole();
  const name = useSession((s) => s.me?.username ?? null);
  const status = useSession((s) => s.status);
  const [phase, setPhase] = useState<Phase>("off");
  const [rect, setRect] = useState<ScreenRect | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [access, setAccess] = useState<{ roles: string[]; sections: ConsoleSection[] } | null>(null);
  const [mounted, setMounted] = useState(false);
  const fromRef = useRef<ScreenRect | null>(null);
  useEffect(() => setMounted(true), []);

  // open: zoom the monitor up, then boot
  useEffect(() => {
    if (!open) return;
    fromRef.current = startRect(from);
    setAccess(null);
    setLines([C.boot.starting]);
    setProgress(8);
    setRect(fromRef.current);
    setPhase("zoom-in");
    const r1 = requestAnimationFrame(() => requestAnimationFrame(() => setRect(full())));
    const t = setTimeout(() => setPhase("boot"), ZOOM_MS);
    return () => {
      cancelAnimationFrame(r1);
      clearTimeout(t);
    };
  }, [open, from]);

  // boot: sign-in + role check against the API (the server decides), with a short, readable sequence
  useEffect(() => {
    if (phase !== "boot" || status === "loading") return;
    let alive = true;
    const t0 = performance.now();
    const step = (txt: string, p: number) => alive && (setLines((l) => [...l.slice(-2), txt]), setProgress(p));
    const finish = (ok: boolean) => {
      const wait = Math.max(0, MIN_BOOT_MS - (performance.now() - t0));
      setTimeout(() => alive && setPhase(ok ? "ready" : "denied"), wait);
    };
    if (status !== "authenticated") {
      step(C.boot.signIn, 100);
      finish(false);
      return () => void (alive = false);
    }
    setTimeout(() => step(C.boot.signing(name ?? "staff"), 35), 200);
    setTimeout(() => step(C.boot.checking, 65), 520);
    consoleApi
      .me()
      .then((m) => {
        if (!alive) return;
        if (!m.sections.length) return finish(false);
        setAccess(m);
        setTimeout(() => step(C.boot.ready, 100), 760);
        finish(true);
      })
      .catch(() => finish(false));
    return () => void (alive = false);
  }, [phase, status, name]);

  // log off: content away, screen shrinks back into the monitor
  useEffect(() => {
    if (open || phase === "off") return;
    setPhase("zoom-out");
    requestAnimationFrame(() => setRect(fromRef.current ?? startRect(null)));
    const t = setTimeout(() => setPhase("off"), ZOOM_MS);
    return () => clearTimeout(t);
  }, [open]);

  if (!mounted || phase === "off") return null;
  const isFull = phase === "boot" || phase === "denied" || phase === "ready";
  return createPortal(
    <>
      {phase !== "ready" && rect && (
        <div
          className={`gkc-zoom ${isFull ? "is-full" : ""}`}
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, opacity: phase === "zoom-out" ? 0.2 : 1 }}
          aria-hidden={phase === "zoom-in" || phase === "zoom-out"}
        >
          {(phase === "boot" || phase === "denied") && (
            <div className="gkc-boot" role="status">
              <span className="gkc-logo" aria-hidden>
                {phase === "denied" ? <ShieldAlert size={30} /> : <MonitorSmartphone size={30} />}
              </span>
              <b>{C.brand}</b>
              {phase === "denied" ? (
                <>
                  <ul>
                    <li>{status === "authenticated" ? C.boot.denied : C.boot.signIn}</li>
                    {status === "authenticated" && <li>{C.boot.deniedSub}</li>}
                  </ul>
                  <button type="button" className="gkc-btn primary" onClick={closeConsole} autoFocus>
                    {C.logOff}
                  </button>
                </>
              ) : (
                <>
                  <ul>
                    {lines.map((l, i) => (
                      <li key={`${i}-${l}`}>{l}</li>
                    ))}
                  </ul>
                  <span className="gkc-progress">
                    <i style={{ width: `${progress}%` }} />
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {phase === "ready" && access && <AdminConsole office={office} roles={access.roles} sections={access.sections} onLogOff={closeConsole} />}
    </>,
    document.body,
  );
}
