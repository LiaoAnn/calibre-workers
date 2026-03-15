import { createFileRoute, redirect } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { authClient } from "#/lib/auth-client";
import { getSessionFromMiddlewareFn } from "#/middleware/auth";

export const Route = createFileRoute("/pending-approval")({
	beforeLoad: async () => {
		const session = await getSessionFromMiddlewareFn();

		if (!session?.user || session.user.deletedAt) {
			throw redirect({ to: "/login" });
		}

		if (session.user.status === "active") {
			throw redirect({ to: "/" });
		}
	},
	component: PendingApprovalPage,
});

function PendingApprovalPage() {
	async function handleLogout() {
		await authClient.signOut();
		window.location.assign("/login");
	}

	return (
		<main className="page-wrap px-4 py-12">
			<Card className="mx-auto w-full max-w-xl">
				<CardHeader>
					<CardTitle className="text-2xl">帳號等待管理員審核</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<Alert>
						<AlertTitle>尚未開通</AlertTitle>
						<AlertDescription>
							你的帳號已建立，但目前還在待審核狀態。請聯繫管理員開通後再重新登入。
						</AlertDescription>
					</Alert>
					<Button type="button" variant="outline" onClick={handleLogout}>
						登出
					</Button>
				</CardContent>
			</Card>
		</main>
	);
}
