import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { stableStringify } from "@gukirana/game-kit";

/**
 * Ed25519 keys for signing match results. Production: the private key lives in KMS / a secret
 * (RESULT_SIGNING_SEED, 32 bytes hex) and only the realtime fleet holds it. The API only gets the public key.
 * Dev: a fixed seed derived from a dev phrase so api and realtime agree without setup.
 */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function keyFromSeed(seedHex?: string): { privateKey: KeyObject; publicKey: KeyObject } {
  const seed = seedHex
    ? Buffer.from(seedHex, "hex")
    : createHash("sha256").update("gukirana-dev-only-result-signing").digest();
  if (seed.length !== 32) throw new Error("RESULT_SIGNING_SEED must be 32 bytes (64 hex chars)");
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

export interface SignedMatchResult {
  matchId: string;
  game: string;
  /** userId → rank (1 = winner; equal ranks = draw) */
  ranks: Record<string, number>;
  reason: "normal" | "forfeit" | "timeout" | "void";
  stateHash: string;
  seedCommit?: string;
  seedReveal?: string;
  finishedAt: string;
  signature: string;
}

export function signResult(result: Omit<SignedMatchResult, "signature">, privateKey: KeyObject): SignedMatchResult {
  const signature = sign(null, Buffer.from(stableStringify(result)), privateKey).toString("base64");
  return { ...result, signature };
}

export function verifyResult(result: SignedMatchResult, publicKey: KeyObject): boolean {
  const { signature, ...payload } = result;
  try {
    return verify(null, Buffer.from(stableStringify(payload)), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
