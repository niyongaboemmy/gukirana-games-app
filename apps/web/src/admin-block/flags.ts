/**
 * Feature flag for the Administrative Block (P2-ADM-02). On by default; NEXT_PUBLIC_FF_ADMIN_BLOCK=0 keeps the
 * building on the plaza but its door locked (like the Tournament Arena) until the flag service (OpenFeature /
 * Unleash, plan §4) takes over.
 */
export const ADMIN_BLOCK_ON = process.env.NEXT_PUBLIC_FF_ADMIN_BLOCK !== "0";
