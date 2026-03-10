import { createMiddleware, createServerFn } from "@tanstack/react-start";

async function readSessionFromRequest() {
	const [{ getRequestHeaders }, { auth }] = await Promise.all([
		import("@tanstack/react-start/server"),
		import("#/lib/auth"),
	]);

	const headers = getRequestHeaders();
	return auth.api.getSession({ headers });
}

const sessionMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		const session = await readSessionFromRequest();
		return next({ context: { session } });
	},
);

export const requiredSessionMiddleware = createMiddleware({
	type: "function",
}).server(async ({ next }) => {
	const session = await readSessionFromRequest();

	if (!session?.user) {
		throw new Error("Unauthorized");
	}

	return next({ context: { session } });
});

export const getSessionFromMiddlewareFn = createServerFn({ method: "GET" })
	.middleware([sessionMiddleware])
	.handler(({ context }) => context.session);
