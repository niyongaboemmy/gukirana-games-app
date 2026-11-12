import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Provably fair commit-reveal RNG (SRS §7.2).
 * 1. Server creates a seed and publishes commit = SHA-256(seed).
 * 2. Every player contributes a client seed.
 * 3. Roll n = HMAC-SHA256(serverSeed, clientSeeds ‖ matchId ‖ n), mapped with rejection sampling.
 * 4. After the match the server reveals the seed; anyone can recompute every roll.
 */
export function newServerSeed(): string {
  return randomBytes(32).toString("hex");
}

export function commitSeed(serverSeed: string): string {
  return createHash("sha256").update(serverSeed).digest("hex");
}

export function verifyCommit(serverSeed: string, commit: string): boolean {
  return commitSeed(serverSeed) === commit;
}

export interface FairRng {
  /** Uniform integer in [min, max] (inclusive), without modulo bias. */
  int(min: number, max: number): number;
  /** Number of HMAC blocks consumed so far (for audit logs). */
  readonly counter: number;
}

const UINT32_RANGE = 0x1_0000_0000;

export function createFairRng(serverSeed: string, clientSeeds: readonly string[], matchId: string): FairRng {
  let counter = 0;
  const material = `${clientSeeds.join(":")}:${matchId}`;
  return {
    get counter() {
      return counter;
    },
    int(min: number, max: number): number {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
        throw new RangeError(`invalid range [${min}, ${max}]`);
      }
      const range = max - min + 1;
      if (range > UINT32_RANGE) throw new RangeError("range too large");
      const limit = Math.floor(UINT32_RANGE / range) * range;
      for (;;) {
        const block = createHmac("sha256", serverSeed).update(`${material}:${counter++}`).digest();
        for (let i = 0; i + 4 <= block.length; i += 4) {
          const v = block.readUInt32BE(i);
          if (v < limit) return min + (v % range);
        }
      }
    },
  };
}
