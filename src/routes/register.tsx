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

export const Route = createFileRoute("/register")({
	beforeLoad: async () => {
		const session = await getSessionFromMiddlewareFn();

		if (session?.user) {
			throw redirect({ to: "/" });
		}
	},
	component: RegisterPage,
});

function RegisterPage() {
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setIsSubmitting(true);
		setError(null);

		try {
			const result = await authClient.signUp.email({ name, email, password });
			if (result.error) {
				throw new Error(result.error.message || "註冊失敗，請稍後再試");
			}

			await navigate({ to: "/" });
		} catch (caughtError) {
			setError(
				caughtError instanceof Error
					? caughtError.message
					: "註冊失敗，請稍後再試",
			);
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<main className="page-wrap px-4 py-12">
			<Card className="mx-auto w-full max-w-md">
				<CardHeader>
					<CardTitle className="text-3xl">註冊</CardTitle>
				</CardHeader>
				<CardContent>
					<form className="space-y-4" onSubmit={handleSubmit}>
						<div className="space-y-2">
							<Label htmlFor="register-name">名稱</Label>
							<Input
								id="register-name"
								type="text"
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="register-email">Email</Label>
							<Input
								id="register-email"
								type="email"
								required
								value={email}
								onChange={(event) => setEmail(event.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="register-password">密碼</Label>
							<Input
								id="register-password"
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
							{isSubmitting ? "註冊中..." : "建立帳號"}
						</Button>
					</form>

					<p className="mt-5 text-sm text-muted-foreground">
						已有帳號？{" "}
						<Button variant="link" asChild className="h-auto p-0">
							<Link to="/login">登入</Link>
						</Button>
					</p>
				</CardContent>
			</Card>
		</main>
	);
}
