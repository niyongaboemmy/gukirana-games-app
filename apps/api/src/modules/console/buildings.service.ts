import { Inject, Injectable, NotFoundException, type OnModuleInit } from "@nestjs/common";
import { asc, buildings, eq } from "@gukirana/db";
import { SEED_BUILDINGS, type Building, type BuildingId } from "@gukirana/contracts";
import { DB, type Db } from "../../common/db.module.js";

/** Plaza buildings staff can open / close (P2-CON-01). Seeded on start (only what is missing). */
@Injectable()
export class BuildingsService implements OnModuleInit {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  async seed(): Promise<void> {
    await this.db
      .insert(buildings)
      .values(SEED_BUILDINGS.map((b) => ({ id: b.id, name: b.name })))
      .onConflictDoNothing();
  }

  async list(): Promise<Building[]> {
    const rows = await this.db.select().from(buildings).orderBy(asc(buildings.id));
    const order = SEED_BUILDINGS.map((b) => b.id as string);
    return rows
      .map((r) => ({ id: r.id as BuildingId, name: r.name, open: r.open, message: r.message, updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedBy }))
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }

  async isOpen(id: string): Promise<boolean> {
    const [r] = await this.db.select({ open: buildings.open }).from(buildings).where(eq(buildings.id, id));
    return r ? r.open : true;
  }

  async set(id: BuildingId, open: boolean, message: string, who: string): Promise<Building> {
    const [r] = await this.db
      .update(buildings)
      .set({ open, message: open ? "" : message, updatedBy: who.slice(0, 120), updatedAt: new Date() })
      .where(eq(buildings.id, id))
      .returning();
    if (!r) throw new NotFoundException({ code: "UNKNOWN_BUILDING" });
    return { id: r.id as BuildingId, name: r.name, open: r.open, message: r.message, updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedBy };
  }
}
