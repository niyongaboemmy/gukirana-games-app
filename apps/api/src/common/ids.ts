import { randomUUID } from "node:crypto";

/** UUIDs for entities. (Plan wants UUIDv7; switch when a v7 generator is added.) */
export const newId = (): string => randomUUID();

/** Business day in Kigali time (SRS: day boundaries use Africa/Kigali). */
export const kigaliDay = (d = new Date()): string => d.toLocaleDateString("en-CA", { timeZone: "Africa/Kigali" });
