import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { isNull, sql } from "drizzle-orm";
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
	user: {
		additionalFields: {
			role: {
				type: ["admin", "user"],
				required: false,
				defaultValue: "user",
				input: false,
			},
			status: {
				type: ["pending", "active"],
				required: false,
				defaultValue: "pending",
				input: false,
			},
			deletedAt: {
				type: "number",
				required: false,
				input: false,
			},
		},
	},
	databaseHooks: {
		user: {
			create: {
				before: async (user) => {
					const [{ count }] = await db
						.select({ count: sql<number>`count(*)` })
						.from(schema.user)
						.where(isNull(schema.user.deletedAt));

					const isFirstActiveUser = count === 0;

					return {
						data: {
							...user,
							role: isFirstActiveUser ? "admin" : "user",
							status: isFirstActiveUser ? "active" : "pending",
							deletedAt: null,
						},
					};
				},
			},
		},
	},
	// Better Auth docs recommend this plugin as the last plugin.
	plugins: [tanstackStartCookies()],
	trustedOrigins: ["http://localhost:8787", "http://127.0.0.1:8787"],
});
