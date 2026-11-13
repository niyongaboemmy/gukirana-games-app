"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * Finance back office: ledger-derived reports (revenue, Stars issued, escrow, liabilities, reconciliation, CSV) and
 * the versioned economy settings editor (validated, never retroactive). Auth: the admin service token (x-admin-token),
 * kept in this tab only. RBAC / SSO replace it in P1-ADM-01.
 */
type Summary = { from: string; to: string; byCurrency: Record<string, { revenue: number; starsIssued: number; dailyClaims: number; escrowOutstanding: number; playerBalances: number; matchesSettled: number }> };
type Daily = { day: string; currency: string; type: string; entries: number; revenue: number; volume: number }[];
type Rec = { ok: boolean; currencyNets: { currency: string; net: number }[]; mismatchedAccounts: number };
type Version = { version: number; effectiveFrom: string; note: string | null; createdBy: string; createdAt: string };

const C = { bg: "#0e0f11", panel: "#18191c", panel2: "#1e1f23", line: "rgba(255,255,255,0.09)", text: "#f2f3f5", muted: "#a7abb2", blue: "#3b82f6", green: "#22c55e", red: "#ef4444" };
const card: React.CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 };
const btn: React.CSSProperties = { background: C.blue, color: "#fff", border: 0, borderRadius: 10, padding: "8px 14px", fontWeight: 700, cursor: "pointer" };
const btn2: React.CSSProperties = { ...btn, background: C.panel2, border: `1px solid ${C.line}` };
const input: React.CSSProperties = { background: C.bg, color: C.text, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 10px" };

export default function Finance() {
  const [token, setToken] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<Daily>([]);
  const [rec, setRec] = useState<Rec | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [settings, setSettings] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      setToken(sessionStorage.getItem("gk-admin-token") ?? "");
    } catch {
      /* private mode */
    }
  }, []);

  const call = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const r = await fetch(`/api/v1${path}`, { ...init, headers: { "x-admin-token": token, "x-admin-user": "back-office", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
      if (!r.ok) throw new Error(JSON.stringify(await r.json().catch(() => ({ status: r.status }))));
      return (r.headers.get("content-type") ?? "").includes("json") ? r.json() : (r.text() as unknown as T);
    },
    [token],
  );

  const load = useCallback(async () => {
    setMsg(null);
    try {
      sessionStorage.setItem("gk-admin-token", token);
    } catch {
      /* private mode */
    }
    try {
      const q = `?from=${from}&to=${to}`;
      const [s, d, r, v, cur] = await Promise.all([
        call<Summary>(`/admin/reports/summary${q}`),
        call<Daily>(`/admin/reports/daily${q}`),
        call<Rec>("/admin/reports/reconciliation"),
        call<Version[]>("/admin/economy/versions"),
        call<Record<string, unknown>>("/admin/economy"),
      ]);
      setSummary(s);
      setDaily(d);
      setRec(r);
      setVersions(v);
      const { version: _v, effectiveFrom: _e, ...editable } = cur;
      void _v;
      void _e;
      setSettings(JSON.stringify(editable, null, 2));
    } catch (e) {
      setMsg(`Could not load: ${(e as Error).message}`);
    }
  }, [call, from, to, token]);

  const exportCsv = async () => {
    const text = await call<string>(`/admin/reports/daily.csv?from=${from}&to=${to}`);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = `gukirana-daily-${from}-${to}.csv`;
    a.click();
  };

  const publish = async () => {
    setMsg(null);
    try {
      const body = { ...JSON.parse(settings), note: note || undefined };
      const v = await call<{ version: number }>("/admin/economy", { method: "POST", body: JSON.stringify(body) });
      await load();
      setMsg(`Published version ${v.version}. It applies from now; history is unchanged.`);
    } catch (e) {
      setMsg(`Not published: ${(e as Error).message}`);
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: C.bg, color: C.text, padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>Finance · economy</h1>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input type="password" placeholder="Admin token" value={token} onChange={(e) => setToken(e.target.value)} style={input} aria-label="Admin token" />
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={input} aria-label="From" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={input} aria-label="To" />
            <button type="button" onClick={() => void load()} style={btn}>
              Load
            </button>
            <button type="button" onClick={() => void exportCsv()} style={btn2} disabled={!summary}>
              Export CSV
            </button>
          </div>
        </header>
        {msg && <div style={{ ...card, borderColor: msg.startsWith("Published") ? C.green : C.red }}>{msg}</div>}

        {rec && (
          <div style={{ ...card, display: "flex", gap: 12, alignItems: "center", borderColor: rec.ok ? C.green : C.red }}>
            <strong style={{ color: rec.ok ? C.green : C.red }}>{rec.ok ? "Books reconcile" : "Reconciliation FAILED"}</strong>
            <span style={{ color: C.muted }}>
              {rec.currencyNets.map((n) => `${n.currency} net ${n.net}`).join(" · ")} · mismatched accounts: {rec.mismatchedAccounts}
            </span>
          </div>
        )}

        {summary && (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {Object.entries(summary.byCurrency).map(([cur, s]) => (
              <section key={cur} style={card}>
                <div style={{ color: C.muted, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" }}>{cur}</div>
                {[
                  ["Platform revenue", s.revenue],
                  ["Stars issued (marketing)", s.starsIssued],
                  ["Daily claims", s.dailyClaims],
                  ["Matches settled", s.matchesSettled],
                  ["Held in matches (escrow)", s.escrowOutstanding],
                  ["Player balances (liability)", s.playerBalances],
                ].map(([k, v]) => (
                  <div key={k as string} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
                    <span style={{ color: C.muted }}>{k}</span>
                    <strong style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</strong>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}

        {daily.length > 0 && (
          <section style={{ ...card, overflowX: "auto" }}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Daily activity (Kigali days)</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr style={{ color: C.muted, textAlign: "left" }}>
                  {["Day", "Currency", "Type", "Entries", "Revenue", "Volume"].map((h) => (
                    <th key={h} style={{ padding: 6, borderBottom: `1px solid ${C.line}` }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {daily.map((d, i) => (
                  <tr key={i}>
                    {[d.day, d.currency, d.type, d.entries, d.revenue, d.volume].map((v, j) => (
                      <td key={j} style={{ padding: 6, borderBottom: `1px solid ${C.line}` }}>
                        {typeof v === "number" ? v.toLocaleString() : v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {settings && (
          <section style={{ ...card, display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Economy settings (publishing creates a new version; never retroactive)</h2>
            <textarea value={settings} onChange={(e) => setSettings(e.target.value)} spellCheck={false} rows={22} style={{ ...input, fontFamily: "ui-monospace, monospace", fontSize: 12 }} aria-label="Economy settings JSON" />
            <div style={{ display: "flex", gap: 8 }}>
              <input placeholder="Change note (why)" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...input, flex: 1 }} aria-label="Change note" />
              <button type="button" onClick={() => void publish()} style={btn}>
                Publish new version
              </button>
            </div>
            <div style={{ color: C.muted, fontSize: 13 }}>
              History: {versions.map((v) => `v${v.version} (${new Date(v.effectiveFrom).toLocaleString()}, ${v.createdBy}${v.note ? `: ${v.note}` : ""})`).join(" · ")}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
