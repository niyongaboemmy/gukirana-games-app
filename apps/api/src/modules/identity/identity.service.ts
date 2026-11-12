import { ConflictException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, desc, eq, gte, otpCodes, ratings, refreshTokens, users } from "@gukirana/db";
import { createLogger } from "@gukirana/observability";
import { DB, type Db } from "../../common/db.module.js";
import { env } from "../../common/env.js";
import { newId } from "../../common/ids.js";
import { signAccessToken } from "../../common/auth.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { starsBudget, userStars } from "../ledger/accounts.js";
import { levelForXp } from "../levels/xp.js";
import { maskEmail, maskLoginId, maskPhone, type LoginId } from "./phone.js";

const log = createLogger("identity");
const OTP_TTL_MS = 5 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 3600_000;
export const WELCOME_STARS = 500;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  refreshExpires: Date;
  isNew: boolean;
}

@Injectable()
export class IdentityService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
  ) {}

  /** FR-ACC-01: phone OTP. Rate limited (3 per 10 min). Dev returns the code to the client. */
  async requestOtp(id: LoginId): Promise<{ devCode?: string }> {
    const phone = id.value; // otp_codes.phone stores the canonical identifier
    const since = new Date(Date.now() - 10 * 60_000);
    const recent = await this.db.select({ id: otpCodes.id }).from(otpCodes).where(and(eq(otpCodes.phone, phone), gte(otpCodes.createdAt, since)));
    if (recent.length >= 3) throw new HttpException({ code: "OTP_RATE_LIMITED" }, HttpStatus.TOO_MANY_REQUESTS);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.db.insert(otpCodes).values({ id: newId(), phone, codeHash: sha(`${phone}:${code}:${env().JWT_SECRET}`), expiresAt: new Date(Date.now() + OTP_TTL_MS) });
    // TODO(P0-AUTH-01): send via SMS gateway (X7) or email provider. Dev: log masked + return code.
    log.info({ to: maskLoginId(id), channel: id.kind }, "otp issued");
    return env().NODE_ENV === "production" ? {} : { devCode: code };
  }

  async verifyOtp(id: LoginId, code: string, device?: string): Promise<Tokens> {
    const phone = id.value;
    const [otp] = await this.db.select().from(otpCodes).where(eq(otpCodes.phone, phone)).orderBy(desc(otpCodes.createdAt)).limit(1);
    if (!otp || otp.usedAt || otp.expiresAt < new Date() || otp.attempts >= 5) throw new UnauthorizedException({ code: "OTP_INVALID" });
    if (otp.codeHash !== sha(`${phone}:${code}:${env().JWT_SECRET}`)) {
      await this.db.update(otpCodes).set({ attempts: otp.attempts + 1 }).where(eq(otpCodes.id, otp.id));
      throw new UnauthorizedException({ code: "OTP_INVALID" });
    }
    await this.db.update(otpCodes).set({ usedAt: new Date() }).where(eq(otpCodes.id, otp.id));

    const byId = id.kind === "email" ? eq(users.email, id.value) : eq(users.phone, id.value);
    let [user] = await this.db.select().from(users).where(byId);
    let isNew = false;
    if (!user) {
      isNew = true;
      const userId = newId();
      await this.db.insert(users).values(id.kind === "email" ? { id: userId, email: id.value } : { id: userId, phone: id.value });
      [user] = await this.db.select().from(users).where(eq(users.id, userId));
      // welcome Stars (practice currency, no cash value)
      await this.ledger.post({
        type: "stars_grant",
        idempotencyKey: `welcome:${userId}`,
        ref: { type: "user", id: userId },
        createdBy: "identity",
        lines: [
          { account: starsBudget(), amount: WELCOME_STARS, direction: "D" },
          { account: userStars(userId), amount: WELCOME_STARS, direction: "C" },
        ],
      });
    }
    return { ...(await this.issue(user!.id, device)), isNew };
  }

  async refresh(token: string, device?: string): Promise<Tokens> {
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha(token)));
    if (!row || row.revoked || row.expiresAt < new Date()) throw new UnauthorizedException({ code: "REFRESH_INVALID" });
    await this.db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, row.id)); // rotation
    return { ...(await this.issue(row.userId, device)), isNew: false };
  }

  async logout(token: string): Promise<void> {
    await this.db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.tokenHash, sha(token)));
  }

  async issue(userId: string, device?: string): Promise<Omit<Tokens, "isNew">> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u || u.status !== "active") throw new UnauthorizedException({ code: "ACCOUNT_INACTIVE" });
    const refreshToken = randomBytes(32).toString("base64url");
    const refreshExpires = new Date(Date.now() + REFRESH_TTL_MS);
    await this.db.insert(refreshTokens).values({ id: newId(), userId, tokenHash: sha(refreshToken), device: device?.slice(0, 120), expiresAt: refreshExpires });
    const accessToken = await signAccessToken({ sub: u.id, name: u.username ?? "", color: u.color, lvl: levelForXp(u.xp), look: u.look ?? undefined, bt: u.bodyType });
    return { accessToken, refreshToken, refreshExpires };
  }

  async me(userId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw new UnauthorizedException();
    const r = await this.db.select().from(ratings).where(eq(ratings.userId, userId));
    return {
      id: u.id,
      phone: u.phone ? maskPhone(u.phone) : null,
      email: u.email ? maskEmail(u.email) : null,
      username: u.username,
      color: u.color,
      bodyType: u.bodyType,
      look: u.look,
      xp: u.xp,
      level: levelForXp(u.xp),
      stars: await this.ledger.balance(userStars(u.id)),
      ratings: Object.fromEntries(r.map((x) => [x.game, { rating: x.rating, games: x.games, wins: x.wins }])),
    };
  }

  async updateProfile(userId: string, p: { username?: string; color?: string; bodyType?: string; look?: string }) {
    if (p.username) {
      const [taken] = await this.db.select({ id: users.id }).from(users).where(eq(users.username, p.username));
      if (taken && taken.id !== userId) throw new ConflictException({ code: "USERNAME_TAKEN" });
    }
    await this.db.update(users).set(p).where(eq(users.id, userId));
    return this.me(userId);
  }
}
