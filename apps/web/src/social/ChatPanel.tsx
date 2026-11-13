"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Ban, Check, ChevronDown, MessageSquareText, Send, ShieldAlert, X } from "lucide-react";
import { useWorld } from "@/lib/world-store";
import { acceptDm, blockPerson, sendChat, sendDm } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { openThread, totalUnread, useSocial, type ChatTab } from "./social-store";

/**
 * Chat sheet (DESIGN-SPEC §12.2, SRS FR-COM-04/05): Nearby (≈12 m, also shown as speech bubbles), Room (the whole
 * plaza / hall) and Private (1:1 threads with unread badges and chat requests). Quick phrases for one-tap replies.
 * UI strings to move to @gukirana/i18n keys `chat.*` (quick phrases are translated per language there).
 */
const QUICK = ["Hi!", "Want to play?", "Good game", "Thanks", "One moment", "Nice shot", "See you later", "Join my table?"];
const TABS: { id: ChatTab; label: string }[] = [
  { id: "nearby", label: "Nearby" },
  { id: "room", label: "Room" },
  { id: "private", label: "Private" },
];

export function ChatPanel() {
  const { chatOpen, tab, thread, threads } = useSocial();
  const chat = useWorld((s) => s.chat);
  const connected = useWorld((s) => s.connected);
  const you = useWorld((s) => s.you);
  const authed = useSession((s) => s.status === "authenticated");
  const [msg, setMsg] = useState("");
  const [quick, setQuick] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const t = thread ? threads[thread] : undefined;
  const unread = totalUnread(threads);
  const lines = useMemo(
    () => (tab === "nearby" ? chat.filter((c) => c.scope === "nearby") : tab === "room" ? chat.filter((c) => c.scope !== "nearby") : []),
    [chat, tab],
  );
  const set = useSocial.getState().set;

  // braces matter: newer browsers return a Promise from scrollIntoView, and an effect may only return a cleanup
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines.length, t?.lines.length, chatOpen, tab, thread]);
  // reading a thread clears its badge
  useEffect(() => {
    if (chatOpen && tab === "private" && t && t.unread) useSocial.setState((s) => ({ threads: { ...s.threads, [t.peer]: { ...t, unread: 0 } } }));
  }, [chatOpen, tab, t]);

  const send = (text: string) => {
    const v = text.trim();
    if (!v) return;
    if (tab === "private") {
      if (t && !t.gone) sendDm(t.peer, v);
    } else sendChat(v, tab);
    setMsg("");
    setQuick(false);
  };

  if (!chatOpen) {
    // collapsed: the last two public lines (DMs only as a badge on the chat button)
    return (
      <div>
        {chat.slice(-2).map((c, i) => (
          <p key={i} className="mb-1 w-fit max-w-full truncate rounded-lg bg-ink-900/60 px-2 py-1 text-xs shadow-sm ring-1 ring-white/10 scene-text">
            {c.system ? <span className="italic text-gold">{c.text}</span> : <><b style={{ color: c.color }}>{c.name}:</b> {c.text}</>}
          </p>
        ))}
      </div>
    );
  }

  if (typeof document === "undefined") return null;
  const canSend = connected && (tab !== "private" || (!!t && !t.gone && t.request !== "outgoing"));
  const placeholder = !connected
    ? "Offline: start the realtime server"
    : tab === "nearby"
      ? "Say something to people near you…"
      : tab === "room"
        ? "Message everyone here…"
        : t?.request === "outgoing"
          ? "Waiting for them to accept…"
          : t
            ? `Message ${t.name}…`
            : "";

  // open: a sheet above the HUD layers (portal) — bottom-left above the joystick on tall screens, a full-height
  // side sheet on phones in landscape (typing replaces walking for a moment)
  return createPortal(
    <div className="pointer-events-auto fixed bottom-[150px] left-[max(12px,env(safe-area-inset-left))] z-30 flex max-h-[46vh] w-[min(380px,46vw)] flex-col rounded-card glass-elevated sm:bottom-40 [@media(max-height:430px)]:bottom-2 [@media(max-height:430px)]:top-2 [@media(max-height:430px)]:max-h-none [@media(max-height:430px)]:w-[min(360px,46vw)]">
      {/* tabs */}
      <div role="tablist" aria-label="Chat channels" className="flex items-center gap-1 border-b border-white/10 p-1.5">
        {TABS.map((x) => (
          <button
            key={x.id}
            role="tab"
            type="button"
            aria-selected={tab === x.id}
            onClick={() => set({ tab: x.id, thread: x.id === "private" ? thread : null })}
            className={`press relative flex-1 rounded-lg px-2 py-1.5 text-xs font-bold transition ${tab === x.id ? "bg-primary text-white shadow-[inset_0_1px_0_rgb(255_255_255/.25),var(--shadow-glow)]" : "text-on-glass-muted hover:bg-white/8 hover:text-white"}`}
          >
            {x.label}
            {x.id === "private" && unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-black leading-4 text-white">{unread}</span>
            )}
          </button>
        ))}
        <button type="button" onClick={() => set({ chatOpen: false })} aria-label="Close chat" className="press grid size-7 place-items-center rounded-lg text-on-glass-muted hover:bg-white/10 hover:text-white">
          <X size={16} strokeWidth={1.85} />
        </button>
      </div>

      {/* body */}
      <div className="min-h-[96px] flex-1 space-y-1 overflow-y-auto p-3 text-sm">
        {tab !== "private" && lines.length === 0 && (
          <p className="text-on-glass-muted">{tab === "nearby" ? "Nobody has said anything near you yet. Walk up to people and say hi." : "Say hi to everyone here."}</p>
        )}
        {tab !== "private" &&
          lines.map((c, i) =>
            c.system ? (
              <p key={i} className="text-xs italic text-gold/90">
                {c.text}
              </p>
            ) : (
              <p key={i} className="break-words">
                <button type="button" className="font-bold hover:underline" style={{ color: c.color }} onClick={() => c.id !== you && useSocial.setState({ menu: c.id })}>
                  {c.id === you ? "You" : c.name}:
                </button>{" "}
                {c.text}
              </p>
            ),
          )}

        {tab === "private" && !t && (
          <>
            {!authed && <p className="text-white/60">Sign in at the gate to send private messages.</p>}
            {authed && Object.keys(threads).length === 0 && <p className="text-white/50">No private chats yet. Tap a person and choose Chat.</p>}
            {Object.values(threads)
              .sort((a, b) => (b.lines.at(-1)?.t ?? 0) - (a.lines.at(-1)?.t ?? 0))
              .map((th) => (
                <button key={th.peer} type="button" onClick={() => openThread({ id: th.peer, name: th.name, color: th.color, uid: th.uid })} className="menu-item flex w-full items-center gap-2 px-2 py-1.5 text-left">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full text-xs font-black" style={{ background: th.color }}>
                    {th.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-semibold">{th.name}{th.gone ? " · left" : ""}</span>
                    <span className="block truncate text-xs text-white/55">{th.request === "incoming" ? "Wants to chat with you" : (th.lines.at(-1)?.text ?? "")}</span>
                  </span>
                  {th.unread > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-black leading-5">{th.unread}</span>}
                </button>
              ))}
          </>
        )}
        {tab === "private" && t && (
          <>
            <div className="-mx-1 -mt-1 mb-1 flex items-center gap-2">
              <button type="button" onClick={() => set({ thread: null })} aria-label="All private chats" className="press grid size-7 place-items-center rounded-lg hover:bg-white/10">
                <ArrowLeft size={16} />
              </button>
              <button type="button" className="truncate font-bold" style={{ color: t.color }} onClick={() => !t.gone && useSocial.setState({ menu: t.peer })}>
                {t.name}
              </button>
            </div>
            {t.request === "incoming" && (
              <div className="mb-2 rounded-xl bg-white/6 p-2 text-xs ring-1 ring-white/12">
                <p className="mb-2 text-white/80">{t.name} wants to chat. Accept to reply; never share phone numbers or pay anyone outside Gukirana.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => acceptDm(t.peer)} className="btn-success flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 font-bold">
                    <Check size={14} /> Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      blockPerson(t.peer);
                      set({ thread: null });
                    }}
                    className="btn-secondary flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 font-semibold"
                  >
                    <Ban size={14} /> Block
                  </button>
                </div>
              </div>
            )}
            {t.lines.map((l) => (
              <div key={l.mid} className={`flex ${l.mine ? "justify-end" : "justify-start"}`}>
                <p className={`max-w-[85%] break-words rounded-2xl px-3 py-1.5 ${l.mine ? "rounded-br-md bg-gradient-to-b from-primary-500 to-primary-600 shadow-[inset_0_1px_0_rgb(255_255_255/.2)]" : "rounded-bl-md bg-white/10 ring-1 ring-white/8"}`}>{l.text}</p>
              </div>
            ))}
            {t.request === "outgoing" && <p className="text-center text-xs text-white/50">Chat request sent. You can write again once {t.name} accepts.</p>}
            {t.gone && <p className="text-center text-xs text-white/50">{t.name} left this room.</p>}
          </>
        )}
        <div ref={end} />
      </div>

      {/* quick phrases */}
      {quick && canSend && (
        <div className="flex flex-wrap gap-1.5 border-t border-white/10 p-2">
          {QUICK.map((q) => (
            <button key={q} type="button" onClick={() => send(q)} className="btn-secondary rounded-full px-3 py-1 text-xs font-semibold">
              {q}
            </button>
          ))}
        </div>
      )}

      {/* composer */}
      {(tab !== "private" || t) && (
        <form
          className="flex items-center gap-1.5 border-t border-white/10 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(msg);
          }}
        >
          <button type="button" onClick={() => setQuick((v) => !v)} aria-label="Quick phrases" aria-expanded={quick} disabled={!canSend} className={`btn-secondary grid size-9 shrink-0 place-items-center rounded-lg disabled:opacity-40 ${quick ? "bg-white/20!" : ""}`}>
            {quick ? <ChevronDown size={18} /> : <MessageSquareText size={18} />}
          </button>
          <input
            ref={input}
            autoFocus
            value={msg}
            maxLength={200}
            disabled={!canSend}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && set({ chatOpen: false })}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-w-0 flex-1 rounded-lg bg-white/8 px-3 py-2 text-sm outline-none ring-1 ring-white/10 transition placeholder:text-white/45 focus-visible:bg-white/12 focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-60"
          />
          <button type="submit" aria-label="Send" disabled={!canSend || !msg.trim()} className="btn-primary grid size-9 shrink-0 place-items-center rounded-lg">
            <Send size={17} />
          </button>
        </form>
      )}
      {tab !== "private" && (
        <p className="flex items-center gap-1 px-3 pb-2 text-[10px] text-on-glass-muted/70">
          <ShieldAlert size={11} /> Phone numbers, links and payment requests are blocked. All games go through escrow.
        </p>
      )}
    </div>,
    document.body,
  );
}
