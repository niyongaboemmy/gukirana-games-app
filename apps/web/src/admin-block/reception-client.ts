"use client";
import { create } from "zustand";
import { ReceptionReplySchema, type ReceptionReply } from "@gukirana/contracts";
import { api, ApiError } from "@/lib/session";
import { S } from "./strings";

/**
 * Reception chat (P2-ADM-04): the visitor talks to the receptionist through the API (POST /admin-block/reception;
 * the model, its key and the availability context stay on the server). The conversation lives only here, in memory
 * for this visit; the last few turns are sent along so follow-ups make sense.
 */
export interface ReceptionLine {
  role: "visitor" | "reception";
  text: string;
  officeHint?: string;
}
interface ReceptionState {
  open: boolean;
  lines: ReceptionLine[];
  suggestions: string[];
  pending: boolean;
  set: (p: Partial<Omit<ReceptionState, "set">>) => void;
}

export const useReception = create<ReceptionState>()((set) => ({
  open: false,
  lines: [],
  suggestions: [...S.receptionChips],
  pending: false,
  set,
}));

const HISTORY = 6;

export function openReception(): void {
  const s = useReception.getState();
  s.set({ open: true, ...(s.lines.length ? {} : { lines: [{ role: "reception", text: S.receptionHello }] }) });
}
export const closeReception = () => useReception.getState().set({ open: false });

export async function askReception(text: string): Promise<void> {
  const message = text.trim().slice(0, 300);
  const s = useReception.getState();
  if (!message || s.pending) return;
  // the greeting is ours, not a server turn
  const history = s.lines.slice(1).slice(-HISTORY).map(({ role, text: t }) => ({ role, text: t.slice(0, 800) }));
  s.set({ lines: [...s.lines, { role: "visitor", text: message }], pending: true });
  let reply: ReceptionReply | null = null;
  let fail: string = S.receptionOffline;
  try {
    reply = ReceptionReplySchema.parse(await api<unknown>("/admin-block/reception", { method: "POST", body: JSON.stringify({ message, history }) }));
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) fail = S.receptionBusy;
    if (e instanceof ApiError && e.status === 401) fail = S.receptionSignIn;
  }
  const now = useReception.getState();
  now.set({
    pending: false,
    lines: [...now.lines, reply ? { role: "reception", text: reply.reply, officeHint: reply.officeHint } : { role: "reception", text: fail }],
    suggestions: reply?.suggestions?.length ? reply.suggestions : now.suggestions,
  });
}
