"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * Access back office (Administrative Block): roles, offices, role → office assignments and user grants, plus the
 * audit trail. Auth: the admin service token (x-admin-token), kept in this tab only — same as /finance.
 * Every change is audited by the API; doors in the 3D block pick changes up within ~15 s (no re-login).
 */
type Role = {
  id: string;
  name: string;
  description: string;
  allOffices: boolean;
  offices: string[];
  holders: number;
};
type Office = { id: string; name: string; description: string; sort: number };
type User = {
  id: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  roles: { role: string; grantedBy: string; grantedAt: string }[];
};
type Audit = { id: string; who: string; action: string; target: string; detail: string | null; at: string };

const C = {
  bg: "#0e0f11",
  panel: "#18191c",
  panel2: "#1e1f23",
  line: "rgba(255,255,255,0.09)",
  text: "#f2f3f5",
  muted: "#a7abb2",
  blue: "#3b82f6",
  green: "#22c55e",
  red: "#ef4444",
};
const card: React.CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.line}`,
  borderRadius: 14,
  padding: 16,
};
const btn: React.CSSProperties = {
  background: C.blue,
  color: "#fff",
  border: 0,
  borderRadius: 10,
  padding: "8px 14px",
  fontWeight: 700,
  cursor: "pointer",
};
const btn2: React.CSSProperties = { ...btn, background: C.panel2, border: `1px solid ${C.line}` };
const btnDanger: React.CSSProperties = { ...btn2, color: C.red };
const input: React.CSSProperties = {
  background: C.bg,
  color: C.text,
  border: `1px solid ${C.line}`,
  borderRadius: 10,
  padding: "8px 10px",
};
const chip = (on: boolean): React.CSSProperties => ({
  ...btn2,
  padding: "4px 10px",
  fontWeight: 600,
  fontSize: 13,
  background: on ? "rgba(59,130,246,0.18)" : C.panel2,
  borderColor: on ? C.blue : C.line,
  color: on ? C.text : C.muted,
});
const th: React.CSSProperties = {
  padding: 6,
  borderBottom: `1px solid ${C.line}`,
  textAlign: "left",
  color: C.muted,
  fontWeight: 600,
};
const td: React.CSSProperties = { padding: 6, borderBottom: `1px solid ${C.line}`, verticalAlign: "top" };
const SLUG = /^[a-z0-9][a-z0-9_-]{1,40}$/;

export default function Access() {
  const [token, setToken] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState("");
  const [newRole, setNewRole] = useState({
    id: "",
    name: "",
    description: "",
    allOffices: false,
    offices: [] as string[],
  });
  const [newOffice, setNewOffice] = useState({ id: "", name: "", description: "", sort: 100 });
  const [grant, setGrant] = useState({ user: "", role: "" });

  useEffect(() => {
    try {
      setToken(sessionStorage.getItem("gk-admin-token") ?? "");
    } catch {
      /* private mode */
    }
  }, []);

  const call = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const r = await fetch(`/api/v1/admin/access${path}`, {
        ...init,
        headers: {
          "x-admin-token": token,
          "x-admin-user": "back-office",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
      if (!r.ok) throw new Error(JSON.stringify(await r.json().catch(() => ({ status: r.status }))));
      return r.json() as Promise<T>;
    },
    [token],
  );

  const load = useCallback(
    async (search = q) => {
      try {
        sessionStorage.setItem("gk-admin-token", token);
      } catch {
        /* private mode */
      }
      try {
        const [r, o, u, a] = await Promise.all([
          call<Role[]>("/roles"),
          call<Office[]>("/offices"),
          call<User[]>(`/users${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ""}`),
          call<Audit[]>("/audit?limit=50"),
        ]);
        setRoles(r);
        setOffices(o);
        setUsers(u);
        setAudit(a);
        setLoaded(true);
      } catch (e) {
        setMsg({ ok: false, text: `Could not load: ${(e as Error).message}` });
      }
    },
    [call, q, token],
  );

  /** run a change, then reload everything (so the audit trail and counts stay true) */
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      await load();
      setMsg({ ok: true, text: label });
    } catch (e) {
      setMsg({ ok: false, text: `${label} failed: ${(e as Error).message}` });
    }
  };

  const toggleAssign = (r: Role, office: string) =>
    act(
      `${r.offices.includes(office) ? "Unassigned" : "Assigned"} ${r.id} ${r.offices.includes(office) ? "from" : "to"} ${office}`,
      () =>
        call(`/roles/${r.id}/offices/${office}`, { method: r.offices.includes(office) ? "DELETE" : "PUT" }),
    );

  const officeName = (id: string) => offices.find((o) => o.id === id)?.name ?? id;

  return (
    <main style={{ minHeight: "100vh", background: C.bg, color: C.text, padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 16 }}>
        <header
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 24 }}>Access · Administrative Block</h1>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="password"
              placeholder="Admin token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              style={input}
              aria-label="Admin token"
            />
            <button type="button" onClick={() => void load()} style={btn}>
              Load
            </button>
          </div>
        </header>
        {msg && <div style={{ ...card, borderColor: msg.ok ? C.green : C.red }}>{msg.text}</div>}

        {loaded && (
          <>
            <section style={{ ...card, overflowX: "auto" }}>
              <h2 style={{ marginTop: 0, fontSize: 16 }}>Roles and the offices they open</h2>
              <p style={{ color: C.muted, marginTop: 0, fontSize: 13 }}>
                Click an office to assign or unassign it. A role marked “all offices” opens every door,
                including new ones.
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Role", "Offices", "Holders", ""].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.id}>
                      <td style={td}>
                        <strong>{r.name}</strong>
                        <div style={{ color: C.muted, fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                          {r.id}
                        </div>
                        {r.description && <div style={{ color: C.muted, fontSize: 13 }}>{r.description}</div>}
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          {r.allOffices && (
                            <span style={{ ...chip(true), cursor: "default", borderColor: C.green }}>
                              All offices
                            </span>
                          )}
                          {offices.map((o) => (
                            <button
                              key={o.id}
                              type="button"
                              style={chip(r.offices.includes(o.id))}
                              onClick={() => void toggleAssign(r, o.id)}
                              aria-pressed={r.offices.includes(o.id)}
                            >
                              {o.name}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{r.holders}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {r.id !== "super_admin" && (
                          <button
                            type="button"
                            style={btnDanger}
                            onClick={() =>
                              confirm(`Delete role ${r.id}? Its holders lose it.`) &&
                              void act(`Deleted role ${r.id}`, () =>
                                call(`/roles/${r.id}`, { method: "DELETE" }),
                              )
                            }
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
                <strong style={{ fontSize: 14 }}>New role</strong>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    placeholder="id (e.g. moderator)"
                    value={newRole.id}
                    onChange={(e) => setNewRole({ ...newRole, id: e.target.value.toLowerCase() })}
                    style={input}
                    aria-label="Role id"
                  />
                  <input
                    placeholder="Name"
                    value={newRole.name}
                    onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                    style={input}
                    aria-label="Role name"
                  />
                  <input
                    placeholder="Description"
                    value={newRole.description}
                    onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                    style={{ ...input, flex: 1, minWidth: 200 }}
                    aria-label="Role description"
                  />
                  <label style={{ display: "flex", gap: 6, alignItems: "center", color: C.muted }}>
                    <input
                      type="checkbox"
                      checked={newRole.allOffices}
                      onChange={(e) => setNewRole({ ...newRole, allOffices: e.target.checked })}
                    />{" "}
                    all offices
                  </label>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ color: C.muted, fontSize: 13 }}>Assign to:</span>
                  {offices.map((o) => {
                    const on = newRole.offices.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        style={chip(on)}
                        aria-pressed={on}
                        onClick={() =>
                          setNewRole({
                            ...newRole,
                            offices: on
                              ? newRole.offices.filter((x) => x !== o.id)
                              : [...newRole.offices, o.id],
                          })
                        }
                      >
                        {o.name}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    style={{ ...btn, marginLeft: "auto" }}
                    disabled={!SLUG.test(newRole.id) || !newRole.name.trim()}
                    onClick={() =>
                      void act(`Created role ${newRole.id}`, async () => {
                        await call("/roles", {
                          method: "POST",
                          body: JSON.stringify({ ...newRole, description: newRole.description || undefined }),
                        });
                        setNewRole({ id: "", name: "", description: "", allOffices: false, offices: [] });
                      })
                    }
                  >
                    Create role
                  </button>
                </div>
              </div>
            </section>

            <section style={{ ...card, overflowX: "auto" }}>
              <h2 style={{ marginTop: 0, fontSize: 16 }}>Offices</h2>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Office", "Description", "Order", "Opened by", ""].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {offices.map((o) => (
                    <OfficeRow
                      key={o.id}
                      office={o}
                      openedBy={roles
                        .filter((r) => r.allOffices || r.offices.includes(o.id))
                        .map((r) => r.name)}
                      onSave={(patch) =>
                        act(`Saved office ${o.id}`, () =>
                          call(`/offices/${o.id}`, { method: "PATCH", body: JSON.stringify(patch) }),
                        )
                      }
                      onDelete={() =>
                        confirm(`Delete office ${o.id}? Its role assignments are removed.`) &&
                        void act(`Deleted office ${o.id}`, () =>
                          call(`/offices/${o.id}`, { method: "DELETE" }),
                        )
                      }
                    />
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 14 }}>
                <strong style={{ fontSize: 14 }}>New office</strong>
                <input
                  placeholder="id (e.g. legal)"
                  value={newOffice.id}
                  onChange={(e) => setNewOffice({ ...newOffice, id: e.target.value.toLowerCase() })}
                  style={input}
                  aria-label="Office id"
                />
                <input
                  placeholder="Name"
                  value={newOffice.name}
                  onChange={(e) => setNewOffice({ ...newOffice, name: e.target.value })}
                  style={input}
                  aria-label="Office name"
                />
                <input
                  placeholder="Description"
                  value={newOffice.description}
                  onChange={(e) => setNewOffice({ ...newOffice, description: e.target.value })}
                  style={{ ...input, flex: 1, minWidth: 200 }}
                  aria-label="Office description"
                />
                <input
                  type="number"
                  value={newOffice.sort}
                  onChange={(e) => setNewOffice({ ...newOffice, sort: Number(e.target.value) || 0 })}
                  style={{ ...input, width: 80 }}
                  aria-label="Office order"
                />
                <button
                  type="button"
                  style={btn}
                  disabled={!SLUG.test(newOffice.id) || !newOffice.name.trim()}
                  onClick={() =>
                    void act(`Created office ${newOffice.id}`, async () => {
                      await call("/offices", {
                        method: "POST",
                        body: JSON.stringify({
                          ...newOffice,
                          description: newOffice.description || undefined,
                        }),
                      });
                      setNewOffice({ id: "", name: "", description: "", sort: 100 });
                    })
                  }
                >
                  Create office
                </button>
              </div>
            </section>

            <section style={{ ...card, overflowX: "auto" }}>
              <h2 style={{ marginTop: 0, fontSize: 16 }}>People with roles</h2>
              <div
                style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}
              >
                <input
                  placeholder="User id, username, email or phone"
                  value={grant.user}
                  onChange={(e) => setGrant({ ...grant, user: e.target.value })}
                  style={{ ...input, flex: 1, minWidth: 240 }}
                  aria-label="User to grant"
                />
                <select
                  value={grant.role}
                  onChange={(e) => setGrant({ ...grant, role: e.target.value })}
                  style={input}
                  aria-label="Role to grant"
                >
                  <option value="">Role…</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  style={btn}
                  disabled={!grant.user.trim() || !grant.role}
                  onClick={() =>
                    void act(`Granted ${grant.role} to ${grant.user}`, () =>
                      call("/grant", { method: "POST", body: JSON.stringify(grant) }),
                    )
                  }
                >
                  Grant
                </button>
                <span style={{ flex: "0 0 16px" }} />
                <input
                  placeholder="Search users"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void load(q)}
                  style={input}
                  aria-label="Search users"
                />
                <button type="button" style={btn2} onClick={() => void load(q)}>
                  Search
                </button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["User", "Contact", "Roles"].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 && (
                    <tr>
                      <td style={{ ...td, color: C.muted }} colSpan={3}>
                        {q.trim() ? "No users match." : "Nobody holds a role yet."}
                      </td>
                    </tr>
                  )}
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td style={td}>
                        <strong>{u.username ?? "(no name yet)"}</strong>
                        <div style={{ color: C.muted, fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                          {u.id}
                        </div>
                      </td>
                      <td style={{ ...td, color: C.muted }}>
                        {[u.email, u.phone].filter(Boolean).join(" · ")}
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {u.roles.length === 0 && <span style={{ color: C.muted }}>none</span>}
                          {u.roles.map((g) => (
                            <span
                              key={g.role}
                              style={{
                                ...chip(true),
                                cursor: "default",
                                display: "inline-flex",
                                gap: 6,
                                alignItems: "center",
                              }}
                              title={`granted by ${g.grantedBy}, ${new Date(g.grantedAt).toLocaleString()}`}
                            >
                              {roles.find((r) => r.id === g.role)?.name ?? g.role}
                              <button
                                type="button"
                                aria-label={`Revoke ${g.role}`}
                                style={{
                                  background: "none",
                                  border: 0,
                                  color: C.red,
                                  cursor: "pointer",
                                  fontWeight: 700,
                                  padding: 0,
                                }}
                                onClick={() =>
                                  void act(`Revoked ${g.role} from ${u.username ?? u.id}`, () =>
                                    call("/revoke", {
                                      method: "POST",
                                      body: JSON.stringify({ user: u.id, role: g.role }),
                                    }),
                                  )
                                }
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          {u.roles.length > 0 && (
                            <span style={{ color: C.muted, fontSize: 12, alignSelf: "center" }}>
                              opens:{" "}
                              {[
                                ...new Set(
                                  u.roles.flatMap((g) => {
                                    const r = roles.find((x) => x.id === g.role);
                                    return r?.allOffices ? offices.map((o) => o.id) : (r?.offices ?? []);
                                  }),
                                ),
                              ]
                                .map(officeName)
                                .join(", ") || "no office"}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section style={{ ...card, overflowX: "auto" }}>
              <h2 style={{ marginTop: 0, fontSize: 16 }}>Audit trail (latest 50)</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["When", "Who", "Action", "Target", "Detail"].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td style={{ ...td, whiteSpace: "nowrap", color: C.muted }}>
                        {new Date(a.at).toLocaleString()}
                      </td>
                      <td style={td}>{a.who}</td>
                      <td style={td}>{a.action}</td>
                      <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>{a.target}</td>
                      <td style={{ ...td, color: C.muted, wordBreak: "break-word" }}>{a.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function OfficeRow({
  office,
  openedBy,
  onSave,
  onDelete,
}: {
  office: Office;
  openedBy: string[];
  onSave: (p: Partial<Office>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(office.name);
  const [description, setDescription] = useState(office.description);
  const [sort, setSort] = useState(office.sort);
  useEffect(() => {
    setName(office.name);
    setDescription(office.description);
    setSort(office.sort);
  }, [office]);
  const dirty = name !== office.name || description !== office.description || sort !== office.sort;
  return (
    <tr>
      <td style={td}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ ...input, width: 160 }}
          aria-label={`${office.id} name`}
        />
        <div style={{ color: C.muted, fontSize: 12, fontFamily: "ui-monospace, monospace", marginTop: 4 }}>
          {office.id}
        </div>
      </td>
      <td style={td}>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ ...input, width: "100%", minWidth: 200, boxSizing: "border-box" }}
          aria-label={`${office.id} description`}
        />
      </td>
      <td style={td}>
        <input
          type="number"
          value={sort}
          onChange={(e) => setSort(Number(e.target.value) || 0)}
          style={{ ...input, width: 70 }}
          aria-label={`${office.id} order`}
        />
      </td>
      <td style={{ ...td, color: C.muted, fontSize: 13 }}>{openedBy.join(", ") || "nobody"}</td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            style={btn2}
            disabled={!dirty}
            onClick={() => onSave({ name, description, sort })}
          >
            Save
          </button>
          <button type="button" style={btnDanger} onClick={onDelete}>
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
