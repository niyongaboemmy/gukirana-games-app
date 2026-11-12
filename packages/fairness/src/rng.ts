import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Provably fair commit-reveal RNG (SRS §7.2). Runs identically on the server and in the browser.
 * 1. Server creates a seed and publishes commit = SHA-256(seed).
 * 2. Every player contributes a client seed.
 * 3. Roll n = HMAC-SHA256(serverSeed, clientSeeds ‖ matchId ‖ n), mapped with rejection sampling.
 * 4. After the match the server reveals the seed; anyone can recompute every roll.
 */
export function newSeed(): string {
  return bytesToHex(randomBytes(32));
}

/** @deprecated use newSeed */
export const newServerSeed = newSeed;

export function commitSeed(serverSeed: string): string {
  return bytesToHex(sha256(utf8ToBytes(serverSeed)));
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
  const key = utf8ToBytes(serverSeed);
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
        const block = hmac(sha256, key, utf8ToBytes(`${material}:${counter++}`));
        const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
        for (let i = 0; i + 4 <= block.length; i += 4) {
          const v = view.getUint32(i, false);
          if (v < limit) return min + (v % range);
        }
      }
    },
  };
}
