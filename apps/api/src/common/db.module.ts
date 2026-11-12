import { Global, Module } from "@nestjs/common";
import { createDatabase, type Database } from "@gukirana/db";
import { env } from "./env.js";

export const DB = Symbol("DB");
export type Db = Database;

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: async () => (await createDatabase(env().DATABASE_URL, { migrate: true })).db,
    },
  ],
  exports: [DB],
})
export class DbModule {}
