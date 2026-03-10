import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";
import { D1Client } from "@effect/sql-d1";
import * as Sqlite from "@effect/sql-drizzle/Sqlite";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { Context, Layer } from "effect";
import * as schema from "#/db/schema";

type DB = SqliteRemoteDatabase<typeof schema>;

export class DatabaseContext extends Context.Tag("DatabaseContext")<
	DatabaseContext,
	DB
>() {}

const DrizzleContextLive = Layer.effect(
	DatabaseContext,
	Sqlite.make<typeof schema>({ schema }),
).pipe(Layer.provide(D1Client.layer({ db: env.DB })));

// Provides DatabaseContext
export const DatabaseLive = DrizzleContextLive;
