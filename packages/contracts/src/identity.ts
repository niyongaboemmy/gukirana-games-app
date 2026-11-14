import { z } from "zod";

/**
 * Username rule, one place for the gate (web) and the API (PUT /me): 3–16 letters (any script), digits, "_", "."
 * or "-" (GAP-010: the web said 3–16, the API accepted 2–16).
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
export const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,16}$/u;
export const UsernameSchema = z.string().regex(USERNAME_RE);
