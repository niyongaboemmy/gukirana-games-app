import { z } from "zod";

/** Integer coin amount (SRS §6.1). */
export const CoinsSchema = z.number().int().nonnegative();

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const LocaleSchema = z.enum(["rw", "en", "fr", "sw"]);
export type Locale = z.infer<typeof LocaleSchema>;

/** World movement message (plan Appendix E). Quantised integers for determinism. */
export const WorldMoveSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
  yaw: z.number().int().min(0).max(65535),
  anim: z.number().int().min(0).max(255),
  t: z.number().int(),
});
export type WorldMove = z.infer<typeof WorldMoveSchema>;

export const ProposalSchema = z.object({
  toUserId: z.string().uuid(),
  gameId: z.enum(["pool-8ball", "ludo", "igisoro"]),
  variant: z.string().min(1),
  stake: CoinsSchema,
  currency: z.enum(["COIN", "STAR"]),
  tableId: z.string().uuid().optional(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export * from "./social.js";
export * from "./offices.js";
export * from "./arena.js";
export * from "./console.js";
