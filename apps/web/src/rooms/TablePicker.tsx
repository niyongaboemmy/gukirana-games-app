"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, LayoutGrid, Navigation } from "lucide-react";
import { selfPose, useWorld } from "@/lib/world-store";
import { usePhoneHud } from "@/hud/usePhoneHud";
import type { HallLayout } from "./layouts";
import { nearestTable, STATUS_COLOR, tableNo, tableStatuses, type TableStatus } from "./table-status";
import { walkToTable } from "./RoomPlayer";
import { useRoom } from "./room-store";

/** UI strings (to move to @gukirana/i18n keys `hall.tables.*`). */
const STR = {
  title: "Tables",
  free: (n: number, of: number) => `${n} of ${of} free`,
  find: "Find a free table",
  findShort: "Free table",
  none: "All tables busy · tap one to watch",
  status: { free: "Free", waiting: "Waiting for opponent", playing: "In a match" } satisfies Record<TableStatus, string>,
  statusShort: { free: "Free", waiting: "Waiting", playing: "Playing" } satisfies Record<TableStatus, string>,
  table: (n: number) => `Table ${n}`,
  near: { free: "tap a chair or the table to sit", waiting: "sit down to play them", playing: "stand here to watch" } satisfies Record<TableStatus, string>,
  show: "Show tables",
  hide: "Hide tables",
};

/**
 * Choosing a table, the core of the hall: a mini-map of the tables (numbered, coloured free / waiting / playing, the
 * same colours as the rings and light bands in the room) — tap one to walk to its nearest free chair and sit — plus
 * "Find a free table" (nearest free one) and, when you stand by a table, a label with its number and status.
 */
export function TablePicker({ layout }: { layout: HallLayout }) {
  const seats = useWorld((s) => s.seats);
  const seated = useRoom((s) => s.seated);
  const leaving = useRoom((s) => s.leaving);
  const phone = usePhoneHud();
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (phone) setOpen(false);
  }, [phone]);
  const status = useMemo(() => tableStatuses(layout, seats), [layout, seats]);
  const freeN = layout.tables.filter((t) => status[t.id] === "free").length;

  // the table you are standing by (checked a few times a second; selfPose is not reactive)
  const [near, setNear] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      let best: string | null = null;
      let bd = Infinity;
      for (const t of layout.tables) {
        const dx = Math.max(0, Math.abs(selfPose.x - t.x) - t.w / 2);
        const dz = Math.max(0, Math.abs(selfPose.z - t.z) - t.d / 2);
        const dd = Math.hypot(dx, dz);
        if (dd < 2.0 && dd < bd) {
          bd = dd;
          best = t.id;
        }
      }
      setNear(best);
    }, 250);
    return () => clearInterval(id);
  }, [layout]);

  // mini-map grid: columns / rows from the table positions (north at the top, the entrance at the bottom)
  const grid = useMemo(() => {
    const xs = [...new Set(layout.tables.map((t) => t.x))].sort((a, b) => a - b);
    const zs = [...new Set(layout.tables.map((t) => t.z))].sort((a, b) => a - b);
    return { cols: xs.length, cells: layout.tables.map((t) => ({ t, c: xs.indexOf(t.x), r: zs.indexOf(t.z) })) };
  }, [layout]);

  const findFree = () => {
    const t = nearestTable(layout, status, "free", selfPose.x, selfPose.z) ?? nearestTable(layout, status, "waiting", selfPose.x, selfPose.z);
    if (t) walkToTable(t.id);
  };

  if (seated || leaving) return null;
  const nearSt = near ? status[near] : null;
  return (
    <>
      <div className="pointer-events-auto absolute right-[max(12px,env(safe-area-inset-right))] top-[380px] w-[212px] phone:top-[96px] phone:w-auto">
        <div className="glass rounded-card p-2 phone:rounded-2xl phone:p-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={findFree}
              disabled={!freeN && !layout.tables.some((t) => status[t.id] === "waiting")}
              className="press flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-primary px-2.5 py-2 text-[13px] font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/.28)] disabled:opacity-40 phone:px-2 phone:py-1.5 phone:text-xs"
            >
              <Navigation size={phone ? 13 : 15} /> {phone ? STR.findShort : STR.find}
            </button>
            <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? STR.hide : STR.show} className="icon-button btn-secondary grid size-9 shrink-0 place-items-center rounded-xl phone:size-8">
              {open ? <ChevronUp size={15} /> : phone ? <LayoutGrid size={14} /> : <ChevronDown size={15} />}
            </button>
          </div>
          {open && (
            <>
              <p className="mb-1.5 mt-2 flex items-center justify-between px-0.5 text-xs font-semibold text-on-glass-muted phone:mt-1.5 phone:text-[10px]">
                <span className="text-on-glass">{STR.title}</span>
                <span>{freeN ? STR.free(freeN, layout.tables.length) : STR.none}</span>
              </p>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}>
                {grid.cells.map(({ t, c, r }) => {
                  const st = status[t.id]!;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => walkToTable(t.id)}
                      title={`${STR.table(tableNo(t.id))} · ${STR.status[st]}`}
                      aria-label={`${STR.table(tableNo(t.id))} · ${STR.status[st]}`}
                      className={`press grid h-8 place-items-center rounded-lg text-xs font-bold text-on-glass ring-1 ring-white/10 phone:h-6 phone:w-8 phone:text-[10px] ${near === t.id ? "ring-2 ring-white/60" : ""}`}
                      style={{ gridColumn: c + 1, gridRow: r + 1, background: `${STATUS_COLOR[st]}${st === "free" ? "55" : "44"}`, boxShadow: `inset 0 -2px 0 ${STATUS_COLOR[st]}` }}
                    >
                      {tableNo(t.id)}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap justify-between gap-x-2 gap-y-0.5 px-0.5 text-[11px] text-on-glass-muted phone:hidden">
                {(["free", "waiting", "playing"] as const).map((k) => (
                  <span key={k} className="flex items-center gap-1">
                    <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[k] }} /> {STR.statusShort[k]}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {/* standing by a table: its number and status */}
      {near && nearSt && (
        <div className="glass pointer-events-none absolute bottom-[max(164px,calc(env(safe-area-inset-bottom)+156px))] left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm phone:bottom-auto phone:top-[46px] phone:px-3 phone:py-1 phone:text-xs">
          <span className="size-2.5 rounded-full" style={{ background: STATUS_COLOR[nearSt] }} />
          <span className="font-bold">{STR.table(tableNo(near))}</span>
          <span className="text-on-glass-muted">
            {STR.status[nearSt]}
            <span className="phone:hidden"> · {STR.near[nearSt]}</span>
          </span>
        </div>
      )}
    </>
  );
}
