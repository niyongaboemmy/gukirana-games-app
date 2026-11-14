import { HttpException, HttpStatus, Injectable, Logger, Optional } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import type { ReceptionReply, ReceptionRequest } from "@gukirana/contracts";
import { env } from "../../common/env.js";
import { AccessService } from "./access.service.js";
import { OccupancyStore } from "./occupancy.js";
import { buildReceptionContext, cleanModelReply, contextText, REPLY_SCHEMA, ruleReply, SYSTEM_PROMPT, type ReceptionOffice } from "./reception.js";

/** the model must answer within this, or the rule-based receptionist does */
export const RECEPTION_TIMEOUT_MS = 4000;
/** per user: at most this many questions per minute, and one per second */
export const RECEPTION_PER_MIN = 12;
const MIN_GAP_MS = 1000;

/** The part of the Anthropic client this service uses (tests pass a stub). */
export type ReceptionModel = Pick<Anthropic["messages"], "create">;

/**
 * POST /admin-block/reception. The model (Claude, server-side only; the key never leaves the API) gets the strict
 * system prompt, the availability context (reception.ts buildReceptionContext: office directory + counts) and the
 * visitor's message wrapped as untrusted data; no tools. Without ANTHROPIC_API_KEY, or when the call fails or takes
 * longer than 4 s, the built-in rule-based receptionist answers. Nothing is stored: no chat log, no message in the
 * logs (only the failure kind).
 */
@Injectable()
export class ReceptionService {
  private readonly log = new Logger("Reception");
  private readonly model: ReceptionModel | null;
  private readonly modelId: string;
  private hits = new Map<string, number[]>();

  constructor(
    private readonly access: AccessService,
    private readonly occupancy: OccupancyStore,
    @Optional() model?: ReceptionModel | null,
  ) {
    const e = env();
    this.modelId = e.RECEPTION_MODEL;
    this.model = model !== undefined ? model : e.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, maxRetries: 0, timeout: RECEPTION_TIMEOUT_MS }).messages : null;
  }

  /** sliding one-minute window per user */
  private limit(userId: string, now: number): void {
    const list = (this.hits.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (list.length >= RECEPTION_PER_MIN || (list.length && now - list[list.length - 1]! < MIN_GAP_MS))
      throw new HttpException({ code: "RATE_LIMITED", message: "One moment, please." }, HttpStatus.TOO_MANY_REQUESTS);
    list.push(now);
    this.hits.set(userId, list);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < 60_000)) this.hits.delete(k);
  }

  async context(): Promise<ReceptionOffice[]> {
    const offices = await this.access.listOffices();
    return buildReceptionContext(offices, this.occupancy.totals(), this.occupancy.visitors());
  }

  async answer(userId: string, req: ReceptionRequest, now = Date.now()): Promise<ReceptionReply> {
    this.limit(userId, now);
    const ctx = await this.context();
    if (!this.model) return ruleReply(req, ctx);
    try {
      return (await this.ask(req, ctx)) ?? ruleReply(req, ctx);
    } catch (e) {
      this.log.warn(`model unavailable (${e instanceof Anthropic.APIError ? `HTTP ${e.status}` : e instanceof Error ? e.name : "error"}): rule-based reply`);
      return ruleReply(req, ctx);
    }
  }

  private async ask(req: ReceptionRequest, ctx: ReceptionOffice[]): Promise<ReceptionReply | null> {
    // previous turns (client-held, bounded by the contract); the first message must be the visitor's
    const turns: Anthropic.MessageParam[] = req.history.map((h) => ({ role: h.role === "visitor" ? "user" : "assistant", content: h.role === "visitor" ? wrap(h.text) : h.text }));
    while (turns.length && turns[0]!.role !== "user") turns.shift();
    const messages: Anthropic.MessageParam[] = [...turns, { role: "user", content: wrap(req.message) }];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const call = this.model!.create(
      {
        model: this.modelId,
        max_tokens: 400,
        thinking: { type: "disabled" },
        output_config: { effort: "low", format: { type: "json_schema", schema: REPLY_SCHEMA as unknown as Record<string, unknown> } },
        system: `${SYSTEM_PROMPT}\n\n<block>\n${contextText(ctx)}\n</block>`,
        messages,
      },
      { timeout: RECEPTION_TIMEOUT_MS, maxRetries: 0 },
    );
    const res = await Promise.race([
      call,
      new Promise<null>((r) => {
        timer = setTimeout(() => r(null), RECEPTION_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (!res || res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    try {
      return cleanModelReply(JSON.parse(text), ctx);
    } catch {
      return null;
    }
  }
}

/** the visitor's words are data: wrapped, with the closing tag neutralised */
const wrap = (t: string) => `<visitor_message>${t.replace(/<\/?visitor_message>/gi, "")}</visitor_message>`;
