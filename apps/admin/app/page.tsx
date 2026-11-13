const MODULES = ["Access", "Users", "KYC review", "Finance", "Risk & fraud", "Games & config", "World & moderation", "Levels & awards", "Compliance"];

export default function AdminHome() {
  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1>Gukirana Back-Office</h1>
      <p>Staff-only. RBAC, SSO and audit logging arrive in P0-AUTH-04 / P1-ADM-01.</p>
      <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, padding: 0, listStyle: "none" }}>
        {MODULES.map((m) => (
          <li key={m} style={{ background: "var(--surface)", borderRadius: 16, padding: 16 }}>
            {m === "Finance" ? (
              <a href="/finance" style={{ color: "inherit", fontWeight: 700 }}>Finance · economy settings + reports →</a>
            ) : m === "Access" ? (
              <a href="/access" style={{ color: "inherit", fontWeight: 700 }}>Access · roles, offices + grants →</a>
            ) : (
              m
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
