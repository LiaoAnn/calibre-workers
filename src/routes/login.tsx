import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { authClient } from "#/lib/auth-client";
import { getSessionFromMiddlewareFn } from "#/middleware/auth";

export const Route = createFileRoute("/login")({
	beforeLoad: async () => {
		const session = await getSessionFromMiddlewareFn();

		if (session?.user && !session.user.deletedAt) {
			throw redirect({
				to: session.user.status === "active" ? "/" : "/pending-approval",
			});
		}
	},
	component: LoginPage,
});

function LoginPage() {
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setIsSubmitting(true);
		setError(null);

		try {
			const result = await authClient.signIn.email({ email, password });
			if (result.error) {
				throw new Error(result.error.message || "登入失敗，請稍後再試");
			}

			const nextSession = await getSessionFromMiddlewareFn();
			await navigate({
				to:
					nextSession?.user && nextSession.user.status !== "active"
						? "/pending-approval"
						: "/",
			});
		} catch (caughtError) {
			setError(
				caughtError instanceof Error
					? caughtError.message
					: "登入失敗，請稍後再試",
			);
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<main className="page-wrap px-4 py-12">
			<Card className="mx-auto w-full max-w-md">
				<CardHeader>
					<CardTitle className="text-3xl">登入</CardTitle>
				</CardHeader>
				<CardContent>
					<form className="space-y-4" onSubmit={handleSubmit}>
						<div className="space-y-2">
							<Label htmlFor="login-email">Email</Label>
							<Input
								id="login-email"
								type="email"
								required
								value={email}
								onChange={(event) => setEmail(event.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="login-password">密碼</Label>
							<Input
								id="login-password"
								type="password"
								required
								minLength={8}
								value={password}
								onChange={(event) => setPassword(event.target.value)}
							/>
						</div>

						{error ? (
							<Alert variant="destructive">
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						) : null}

						<Button type="submit" disabled={isSubmitting} className="w-full">
							{isSubmitting ? "登入中..." : "登入"}
						</Button>
					</form>

					<p className="mt-5 text-sm text-muted-foreground">
						還沒有帳號？{" "}
						<Button variant="link" asChild className="h-auto p-0">
							<Link to="/register">註冊</Link>
						</Button>
					</p>
				</CardContent>
			</Card>
		</main>
	);
}
