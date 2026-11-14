/**
 * Back-office API errors in plain words (GAP-015). The pages throw `Error(JSON.stringify(body))`; this reads the code
 * (or the HTTP status) back out. Unknown codes are shown as-is so nothing is hidden from the operator.
 */
const WORDS: Record<string, string> = {
  LAST_SUPER_ADMIN: "This is the last active Super Admin. Make someone else Super Admin first.",
  CANNOT_REVOKE_OWN_SUPER_ADMIN: "Nobody can remove their own Super Admin role.",
  SUPER_ADMIN_PROTECTED: "The Super Admin role can't be deleted.",
  SUPER_ADMIN_OPENS_ALL: "The Super Admin role always opens every office.",
  USER_NOT_FOUND: "No account matches that username, email, phone or id.",
  ROLE_NOT_FOUND: "That role doesn't exist.",
  ROLE_EXISTS: "A role with that id already exists.",
  OFFICE_EXISTS: "An office with that id already exists.",
  UNKNOWN_OFFICE: "That office doesn't exist.",
  VALIDATION_ERROR: "Please check the fields.",
  BAD_ID: "That id doesn't look right.",
};

type Body = { code?: string; status?: number; statusCode?: number; message?: unknown };
const parseBody = (raw: string): Body | null => {
  try {
    const b: unknown = JSON.parse(raw);
    return b && typeof b === "object" ? (b as Body) : null;
  } catch {
    return null;
  }
};

export function plainError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const body = parseBody(raw);
  if (!body) return raw;
  const nested = body.message && typeof body.message === "object" ? (body.message as { code?: string }).code : undefined;
  const code = body.code ?? nested;
  if (code && WORDS[code]) return WORDS[code];
  const status = body.statusCode ?? body.status;
  if (status === 401) return "Wrong or missing admin token.";
  if (status === 403) return "This token may not do that.";
  if (code) return code;
  return typeof body.message === "string" ? body.message : raw;
}
