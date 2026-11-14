import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, desc, eq, inArray, reports, users } from "@gukirana/db";
import type { ConsoleReport, ReportStatus } from "@gukirana/contracts";
import { DB, type Db } from "../../common/db.module.js";
import { AccessService } from "../admin-block/access.service.js";
import { describeAudit } from "./audit-text.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 25;

/**
 * Player reports queue for support staff (P2-CON-02). Players file reports from the person menu (social module,
 * POST /reports); staff read them here, act on the account in the People section, and close the report as resolved
 * or dismissed with an internal note. Closing is audited on the reported account's history.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AccessService,
  ) {}

  async list(status: ReportStatus, page = 0, targetId?: string): Promise<{ items: ConsoleReport[]; page: number; more: boolean; open: number }> {
    const p = Math.max(0, Math.min(400, Math.floor(page) || 0));
    const where = and(eq(reports.status, status), targetId && UUID.test(targetId) ? eq(reports.targetId, targetId) : undefined);
    const rows = await this.db.select().from(reports).where(where).orderBy(desc(reports.createdAt)).limit(PAGE + 1).offset(p * PAGE);
    const slice = rows.slice(0, PAGE);
    const ids = [...new Set(slice.flatMap((r) => [r.reporterId, r.targetId, ...(r.resolvedBy && UUID.test(r.resolvedBy) ? [r.resolvedBy] : [])]))];
    const people = ids.length ? await this.db.select({ id: users.id, username: users.username, status: users.status }).from(users).where(inArray(users.id, ids)) : [];
    const byId = new Map(people.map((u) => [u.id, u]));
    const targets = [...new Set(slice.map((r) => r.targetId))];
    const openCounts = targets.length
      ? await this.db
          .select({ t: reports.targetId, n: count() })
          .from(reports)
          .where(and(eq(reports.status, "open"), inArray(reports.targetId, targets)))
          .groupBy(reports.targetId)
      : [];
    const openBy = new Map(openCounts.map((c) => [c.t, Number(c.n)]));
    const [open] = await this.db.select({ n: count() }).from(reports).where(eq(reports.status, "open"));
    const names = { users: new Map(people.map((u) => [u.id, u.username])), buildings: new Map(), offices: new Map(), roles: new Map() };
    return {
      page: p,
      more: rows.length > PAGE,
      open: Number(open?.n ?? 0),
      items: slice.map((r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status as ReportStatus,
        createdAt: r.createdAt.toISOString(),
        reporter: { id: r.reporterId, username: byId.get(r.reporterId)?.username ?? null },
        target: { id: r.targetId, username: byId.get(r.targetId)?.username ?? null, status: byId.get(r.targetId)?.status ?? "active" },
        context: r.context,
        resolvedByName: r.resolvedBy ? describeAudit({ who: r.resolvedBy, target: "", detail: null }, names).whoName : null,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolution: r.resolution,
        openAgainstTarget: openBy.get(r.targetId) ?? 0,
      })),
    };
  }

  /** close an open report (resolved = action taken, dismissed = nothing to act on), with an internal note */
  async resolve(actor: string, id: string, outcome: "resolved" | "dismissed", note: string) {
    if (!UUID.test(id)) throw new BadRequestException({ code: "BAD_ID" });
    const [r] = await this.db.select().from(reports).where(eq(reports.id, id));
    if (!r) throw new NotFoundException({ code: "UNKNOWN_REPORT" });
    if (r.status !== "open") throw new BadRequestException({ code: "REPORT_CLOSED" });
    if (r.targetId === actor) throw new BadRequestException({ code: "CANNOT_CHANGE_SELF" });
    await this.db
      .update(reports)
      .set({ status: outcome, resolvedBy: actor.slice(0, 120), resolvedAt: new Date(), resolution: note.trim() })
      .where(and(eq(reports.id, id), eq(reports.status, "open")));
    await this.access.record(actor, outcome === "resolved" ? "report.resolve" : "report.dismiss", `user:${r.targetId}`, `${r.reason}: ${note.trim()}`);
    return { id, status: outcome };
  }
}
