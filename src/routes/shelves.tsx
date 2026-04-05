import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getSessionFromMiddlewareFn } from "#/middleware/auth";

export const Route = createFileRoute("/shelves")({
	beforeLoad: async () => {
		const session = await getSessionFromMiddlewareFn();

		if (!session?.user || session.user.deletedAt) {
			throw redirect({ to: "/login" });
		}

		if (session.user.status !== "active") {
			throw redirect({ to: "/pending-approval" });
		}
	},
	component: ShelvesLayout,
});

function ShelvesLayout() {
	return <Outlet />;
}
