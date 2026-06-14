import { createFileRoute } from "@tanstack/react-router";
import { auth } from "#/shared/auth/auth";

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: async ({ request }: { request: Request }) => {
				return auth.handler(request);
			},
			POST: async ({ request }: { request: Request }) => {
				return auth.handler(request);
			},
		},
	},
});
