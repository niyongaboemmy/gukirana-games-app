"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, BellRing, Building2, Coins, KeyRound, LayoutDashboard, LogOut, MonitorSmartphone, Users, type LucideIcon } from "lucide-react";
import type { ConsoleOverview, ConsoleSection } from "@gukirana/contracts";
import { useSession } from "@/lib/session";
import { useOffices } from "@/admin-block/office-client";
import { consoleApi } from "./console-api";
import { Buildings, Monitor, Overview, Visitors } from "./sections-live";
import { Finance, People, Roles } from "./sections-people";
import { C } from "./strings";
import "./console.css";

const ICONS: Record<ConsoleSection, LucideIcon> = {
  overview: LayoutDashboard,
  visitors: BellRing,
  users: Users,
  buildings: Building2,
  monitor: Activity,
  roles: KeyRound,
  finance: Coins,
};
const ROLE_NAMES: Record<string, string> = { super_admin: "Super Admin", it_admin: "IT Administrator", accountant: "Accountant", support_agent: "Support Agent", event_manager: "Event Manager" };
const roleName = (r: string) => ROLE_NAMES[r] ?? r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function Clock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return <span className="gkc-clock">{t.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · {t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>;
}

/**
 * Gukirana Control — the staff console UI (sections by role). Rendered inside ConsoleLayer (office computer / HUD)
 * or full page at /console. Keys typed here never reach the 3D world behind it.
 */
export function AdminConsole({ office, roles, sections, onLogOff, standalone = false }: { office: string | null; roles: string[]; sections: ConsoleSection[]; onLogOff: () => void; standalone?: boolean }) {
  const me = useSession((s) => s.me);
  const incoming = useOffices((s) => s.incoming);
  const officeName = useOffices((s) => (office ? s.offices.find((o) => o.id === office)?.name : null));
  const myKnocks = incoming.filter((k) => !office || k.office === office).length;
  const [section, setSection] = useState<ConsoleSection>(office && myKnocks ? "visitors" : "overview");
  const [overview, setOverview] = useState<ConsoleOverview | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);
  const can = useCallback((s: string) => sections.includes(s as ConsoleSection), [sections]);

  const toast = useCallback((t: string) => {
    setToastText(t);
    window.setTimeout(() => setToastText((cur) => (cur === t ? null : cur)), 2600);
  }, []);

  // live overview (every 10 s while open)
  useEffect(() => {
    let on = true;
    const pull = () => void consoleApi.overview().then((o) => on && setOverview(o)).catch(() => undefined);
    pull();
    const t = setInterval(pull, 10_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, []);

  // keyboard stays in the console (the world's WASD / E listeners are on window); Esc logs off
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const stop = (e: KeyboardEvent) => {
      if (e.type === "keydown" && e.key === "Escape") {
        e.preventDefault();
        onLogOff();
      }
      e.stopPropagation();
    };
    el.addEventListener("keydown", stop);
    el.addEventListener("keyup", stop);
    return () => {
      el.removeEventListener("keydown", stop);
      el.removeEventListener("keyup", stop);
    };
  }, [onLogOff]);

  // a new knock while elsewhere in the console: a gentle nudge
  const prevKnocks = useRef(myKnocks);
  useEffect(() => {
    if (myKnocks > prevKnocks.current && section !== "visitors") toast(`${myKnocks} ${myKnocks === 1 ? "person is" : "people are"} knocking`);
    prevKnocks.current = myKnocks;
  }, [myKnocks, section, toast]);

  const go = (s: ConsoleSection) => {
    setSection(s);
    main.current?.scrollTo({ top: 0 });
  };
  const top = roles.includes("super_admin") ? "super_admin" : roles[0];

  return (
    <div ref={root} className="gkc gkc-fadein" tabIndex={-1} role="application" aria-label={C.brand}>
      <header className="gkc-top">
        <span className="gkc-logo" aria-hidden>
          <MonitorSmartphone size={20} />
        </span>
        <span className="gkc-brand">
          <b>{C.brand}</b>
          <small>{officeName ?? C.brandSub}</small>
        </span>
        <span className="gkc-grow" />
        <Clock />
        <span className="gkc-who">
          <span className="gkc-avatar" style={{ background: me?.color ?? "var(--c-choc)" }}>{(me?.username ?? "?").slice(0, 1).toUpperCase()}</span>
          <span>
            <span>{me?.username ?? "Staff"}</span>
            {top && <small>{roleName(top)}</small>}
          </span>
        </span>
        <button type="button" className="gkc-btn secondary" onClick={onLogOff}>
          <LogOut size={16} /> <span className="gkc-hide-sm">{standalone ? C.backToPlay : C.logOff}</span>
        </button>
      </header>
      <div className="gkc-body">
        <nav className="gkc-nav" aria-label="Sections">
          {sections.map((s) => {
            const Icon = ICONS[s];
            return (
              <button key={s} type="button" aria-current={section === s ? "page" : undefined} onClick={() => go(s)} title={C.sections[s]}>
                <Icon size={19} />
                <span className="gkc-nav-label">{C.sections[s]}</span>
                {s === "visitors" && myKnocks > 0 && <span className="gkc-badge">{myKnocks}</span>}
              </button>
            );
          })}
          <span className="gkc-nav-foot">Every action is recorded with your name.</span>
        </nav>
        <main ref={main} className="gkc-main">
          <div className="gkc-h1">
            <h1>{C.sections[section]}</h1>
            <p>{C.sectionsSub[section]}</p>
          </div>
          {section === "overview" && <Overview data={overview} myKnocks={myKnocks} can={can} />}
          {section === "visitors" && <Visitors office={office} />}
          {section === "users" && <People canStatus={can("users")} canRoles={can("roles")} toast={toast} me={me?.id ?? null} />}
          {section === "buildings" && <Buildings canEdit={can("buildings")} toast={toast} />}
          {section === "monitor" && <Monitor toast={toast} />}
          {section === "roles" && <Roles toast={toast} />}
          {section === "finance" && <Finance toast={toast} />}
        </main>
      </div>
      {toastText && (
        <div className="gkc-toast" role="status">
          {toastText}
        </div>
      )}
    </div>
  );
}
