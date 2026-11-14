/**
 * Staff audit rows in plain words for the console (GAP-016): who did it (username, "Back office", "System"), what it
 * was about (username, building / office / role name) and the detail as words instead of raw JSON / key=value.
 * Pure: ConsoleService loads the names, this only formats.
 */
export interface AuditNames {
  users: Map<string, string | null>;
  buildings: Map<string, string>;
  offices: Map<string, string>;
  roles: Map<string, string>;
}
export interface AuditRowIn {
  who: string;
  target: string;
  detail: string | null;
}
export interface AuditWords {
  whoName: string;
  targetName: string;
  detailText: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SYSTEM = new Set(["seed", "system", "bootstrap", "cli", "qa-seed", "test"]);

/** every account id mentioned by these rows (actor, target, detail) */
export function auditUserIds(rows: AuditRowIn[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (UUID.test(r.who)) out.add(r.who);
    if (r.target.startsWith("user:") && UUID.test(r.target.slice(5))) out.add(r.target.slice(5));
    for (const m of r.detail?.match(UUID_G) ?? []) out.add(m);
  }
  return [...out];
}

const person = (names: AuditNames, id: string) => {
  const u = names.users.get(id);
  return u ? u : names.users.has(id) ? "a player without a username" : "an unknown account";
};
const words = (key: string) => {
  const w = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};
const nameOf = (names: AuditNames, key: string, v: string): string => {
  const k = key.toLowerCase();
  if (k.startsWith("office")) return names.offices.get(v) ?? v;
  if (k.startsWith("role")) return names.roles.get(v) ?? v;
  if (k === "user" || k.endsWith("user") || UUID.test(v)) return UUID.test(v) ? person(names, v) : v;
  if (k.startsWith("building")) return names.buildings.get(v) ?? v;
  return v;
};
const value = (names: AuditNames, key: string, v: unknown): string => {
  if (v === null || v === undefined || v === "") return "none";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length ? v.map((x) => nameOf(names, key, String(x))).join(", ") : "none";
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${words(k)} ${value(names, k, x)}`).join(", ");
  return nameOf(names, key, String(v));
};

function detailWords(names: AuditNames, detail: string | null): string | null {
  if (!detail) return null;
  const t = detail.trim();
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      const parts = Object.entries(o).map(([k, v]) => `${words(k)}: ${value(names, k, v)}`);
      return parts.length ? parts.join(" · ") : null;
    } catch {
      /* not JSON after all: fall through */
    }
  }
  // "role=it_admin", "office=accountant", "user=<id> zone=floor", "offices=a,b roles=c (note)"
  if (/^[a-z][\w]*=/i.test(t)) {
    const m = /^(.*?)(\s+\(.*\))?$/.exec(t)!;
    const pairs = m[1]!.split(/\s+/).map((kv) => {
      const [k, ...rest] = kv.split("=");
      const v = rest.join("=");
      return `${words(k!)}: ${v ? v.split(",").filter(Boolean).map((x) => nameOf(names, k!, x)).join(", ") || "none" : "none"}`;
    });
    return pairs.join(" · ") + (m[2] ?? "");
  }
  return t; // a reason / door message written by staff: as typed
}

export function describeAudit(r: AuditRowIn, names: AuditNames): AuditWords {
  let whoName: string;
  if (r.who.startsWith("admin-token:")) {
    const n = r.who.slice("admin-token:".length);
    whoName = !n || n === "back-office" ? "Back office" : `Back office (${n})`;
  } else if (UUID.test(r.who)) whoName = person(names, r.who);
  else if (SYSTEM.has(r.who)) whoName = "System";
  else whoName = r.who;

  const [kind, ...rest] = r.target.split(":");
  const id = rest.join(":");
  let targetName: string;
  if (kind === "user" && id) targetName = person(names, id);
  else if (kind === "building" && id) targetName = names.buildings.get(id) ?? id;
  else if (kind === "office" && id) targetName = names.offices.get(id) ?? id;
  else if (kind === "role" && id) targetName = names.roles.get(id) ?? id;
  else if (kind === "arena") targetName = "Tournament Arena";
  else if (r.target === "admin-block") targetName = "Administrative Block";
  else targetName = r.target;

  return { whoName, targetName, detailText: detailWords(names, r.detail) };
}
