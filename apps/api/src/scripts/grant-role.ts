/**
 * Grant (or revoke) an Administrative Block role from the command line (dev bootstrap, ops break-glass).
 *
 *   pnpm --filter @gukirana/api run grant-role <user id | username | email | phone> <role> [--revoke] [--direct]
 *
 * By default it calls the running API (API_INTERNAL_URL) with the back-office token (ADMIN_SERVICE_TOKEN), so the
 * change is audited like any other and an embedded PGlite database is never opened by two processes at once.
 * `--direct` (or an unreachable API) opens DATABASE_URL itself — only do that while the API is stopped when using PGlite.
 */
import "reflect-metadata";
import { loadEnv } from "@gukirana/config";
import { createDatabase } from "@gukirana/db";
import { AccessService } from "../modules/admin-block/access.service.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [identifier, role] = args.filter((a) => !a.startsWith("--"));
if (!identifier || !role) {
  console.error("usage: grant-role <user id | username | email | phone> <role> [--revoke] [--direct]");
  process.exit(2);
}
const revoke = flags.has("--revoke");
const env = loadEnv();

async function viaApi(): Promise<boolean> {
  try {
    const r = await fetch(`${env.API_INTERNAL_URL}/admin/access/${revoke ? "revoke" : "grant"}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-token": env.ADMIN_SERVICE_TOKEN,
        "x-admin-user": "cli",
      },
      body: JSON.stringify({ user: identifier, role }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`API refused (${r.status}):`, JSON.stringify(body));
      process.exit(1);
    }
    console.log(JSON.stringify(body));
    return true;
  } catch {
    return false; // API not running
  }
}

async function direct(): Promise<void> {
  const { db, close } = await createDatabase(env.DATABASE_URL, { migrate: true });
  try {
    const access = new AccessService(db);
    await access.seed();
    const r = revoke
      ? await access.revoke(identifier!, role!, "cli")
      : await access.grant(identifier!, role!, "cli");
    console.log(JSON.stringify(r));
  } finally {
    await close();
  }
}

if (flags.has("--direct") || !(await viaApi())) {
  if (!flags.has("--direct"))
    console.warn(
      `API at ${env.API_INTERNAL_URL} not reachable; opening ${env.DATABASE_URL.split("://")[0]} database directly`,
    );
  await direct().catch((e: unknown) => {
    console.error(
      String((e as Error).message ?? e),
      JSON.stringify((e as { response?: unknown }).response ?? ""),
    );
    process.exit(1);
  });
}
