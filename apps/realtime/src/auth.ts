import { jwtVerify } from "jose";
import { loadEnv } from "@gukirana/config";

export interface UserClaims {
  sub: string;
  name: string;
  color: string;
  lvl: number;
  look?: string;
  bt?: string;
}

const key = () => new TextEncoder().encode(loadEnv().JWT_SECRET);

/** Access tokens are issued by the API; realtime only verifies them. */
export async function verifyToken(token: unknown): Promise<UserClaims | null> {
  if (typeof token !== "string" || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: "gukirana-api", audience: "gukirana" });
    return payload as unknown as UserClaims;
  } catch {
    return null;
  }
}
