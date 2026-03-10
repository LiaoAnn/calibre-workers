import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";
import { getSessionFromMiddlewareFn } from "#/middleware/auth";

export const Route = createFileRoute("/login")({
	beforeLoad: async () => {
		const session = await getSessionFromMiddlewareFn();

		if (session?.user) {
			throw redirect({ to: "/" });
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

			await navigate({ to: "/" });
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
			<section className="island-shell mx-auto w-full max-w-md rounded-2xl p-6 sm:p-8">
				<h1 className="mb-2 text-3xl font-bold text-[var(--sea-ink)]">登入</h1>

				<form className="space-y-4" onSubmit={handleSubmit}>
					<label className="block text-sm font-medium text-[var(--sea-ink)]">
						Email
						<input
							type="email"
							required
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
						/>
					</label>

					<label className="block text-sm font-medium text-[var(--sea-ink)]">
						密碼
						<input
							type="password"
							required
							minLength={8}
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
						/>
					</label>

					{error ? (
						<p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
							{error}
						</p>
					) : null}

					<button
						type="submit"
						disabled={isSubmitting}
						className="w-full rounded-xl bg-[var(--lagoon-deep)] px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
					>
						{isSubmitting ? "登入中..." : "登入"}
					</button>
				</form>

				<p className="mt-5 text-sm text-[var(--sea-ink-soft)]">
					還沒有帳號？{" "}
					<Link to="/register" className="underline">
						註冊
					</Link>
				</p>
			</section>
		</main>
	);
}
