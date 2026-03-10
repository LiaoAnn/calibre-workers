import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db";
import * as schema from "#/db/schema";

export const auth = betterAuth({
	baseURL: env.BETTER_AUTH_URL,
	database: drizzleAdapter(db, {
		provider: "sqlite",
		schema,
	}),
	emailAndPassword: {
		enabled: true,
	},
	// Better Auth docs recommend this plugin as the last plugin.
	plugins: [tanstackStartCookies()],
	trustedOrigins: ["http://localhost:8787", "http://127.0.0.1:8787"],
});
