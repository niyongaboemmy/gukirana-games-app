import { BadRequestException } from "@nestjs/common";
import type { z } from "zod";

/** Every external input is parsed with zod (plan §4.1). */
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new BadRequestException({ code: "VALIDATION_ERROR", issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  return r.data;
}
