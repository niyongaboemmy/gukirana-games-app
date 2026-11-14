import { sql, type AnyColumn, type SQL } from "@gukirana/db";

/** Escape LIKE wildcards so a search term matches literally ("qa_lv30" finds "qa_lv30", "50%" finds "50%"). */
export const escapeLike = (term: string): string => term.replace(/[\\%_]/g, (c) => `\\${c}`);

/** case-insensitive "contains" with the term taken literally (explicit ESCAPE clause, GAP-006) */
export const ilikeContains = (col: AnyColumn, term: string): SQL => sql`${col} ILIKE ${`%${escapeLike(term)}%`} ESCAPE '\\'`;
