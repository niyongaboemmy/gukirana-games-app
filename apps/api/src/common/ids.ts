import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

/** UUIDs for entities. (Plan wants UUIDv7; switch when a v7 generator is added.) */
export const newId = (): string => randomUUID();

/** Business day in Kigali time (SRS: day boundaries use Africa/Kigali). */
export const kigaliDay = (d = new Date()): string => d.toLocaleDateString("en-CA", { timeZone: "Africa/Kigali" });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A path id that must be a UUID: anything else is a 400 BAD_ID (never a database error / 500, GAP-009). */
export function uuidParam(id: string): string {
  if (!UUID.test(id)) throw new BadRequestException({ code: "BAD_ID" });
  return id;
}
