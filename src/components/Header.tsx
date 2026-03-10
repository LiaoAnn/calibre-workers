import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { authClient, useSession } from "#/lib/auth-client";
import { uploadBookServerFn } from "#/server/files";
import ThemeToggle from "./ThemeToggle";

export default function Header() {
	const { data: session } = useSession();
	const user = session?.user ?? null;
	const navigate = useNavigate();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);

	async function handleLogout() {
		setMenuOpen(false);
		await authClient.signOut();
		window.location.assign("/login");
	}

	async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) return;

		setUploadError(null);
		setIsUploading(true);

		try {
			const formData = new FormData();
			formData.set("file", file);
			const result = await uploadBookServerFn({ data: formData });
			await navigate({
				to: "/books/$bookId",
				params: { bookId: result.bookId },
			});
		} catch (err) {
			setUploadError(
				err instanceof Error ? err.message : "上傳失敗，請稍後再試",
			);
		} finally {
			setIsUploading(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	}

	return (
		<header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 backdrop-blur-lg">
			<nav className="page-wrap flex items-center gap-3 py-3 sm:py-4">
				{/* Site logo/name */}
				<h2 className="m-0 flex-shrink-0 text-base font-semibold tracking-tight">
					<Link
						to="/"
						className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm text-[var(--sea-ink)] no-underline shadow-[0_8px_24px_rgba(30,90,72,0.08)] sm:px-4 sm:py-2"
					>
						<span className="h-2 w-2 rounded-full bg-[linear-gradient(90deg,#56c6be,#7ed3bf)]" />
						Calibre Workers
					</Link>
				</h2>

				{/* Nav links */}
				<div className="flex items-center gap-4 text-sm font-semibold">
					<Link
						to="/"
						className="nav-link"
						activeProps={{ className: "nav-link is-active" }}
					>
						Home
					</Link>
				</div>

				{/* Right-side actions */}
				<div className="ml-auto flex items-center gap-2">
					{uploadError ? (
						<span className="max-w-[200px] truncate rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
							{uploadError}
						</span>
					) : null}

					{user ? (
						<>
							{/* Hidden file input */}
							<input
								ref={fileInputRef}
								type="file"
								accept=".epub,application/epub+zip"
								className="hidden"
								onChange={handleFileChange}
							/>

							{/* Upload button */}
							<button
								type="button"
								disabled={isUploading}
								onClick={() => fileInputRef.current?.click()}
								className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-3 py-1.5 text-xs font-semibold text-[var(--lagoon-deep)] transition hover:bg-[rgba(79,184,178,0.24)] disabled:cursor-not-allowed disabled:opacity-50"
							>
								{isUploading ? (
									<>
										<svg
											className="h-3.5 w-3.5 animate-spin"
											viewBox="0 0 24 24"
											fill="none"
											aria-hidden="true"
										>
											<circle
												className="opacity-25"
												cx="12"
												cy="12"
												r="10"
												stroke="currentColor"
												strokeWidth="4"
											/>
											<path
												className="opacity-75"
												fill="currentColor"
												d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
											/>
										</svg>
										上傳中…
									</>
								) : (
									<>
										<svg
											viewBox="0 0 16 16"
											fill="currentColor"
											className="h-3.5 w-3.5"
											aria-hidden="true"
										>
											<path d="M7.293 1.293a1 1 0 0 1 1.414 0l3 3a1 1 0 0 1-1.414 1.414L9 4.414V11a1 1 0 1 1-2 0V4.414L5.707 5.707A1 1 0 0 1 4.293 4.293l3-3zM2 13a1 1 0 1 1 0 2h12a1 1 0 1 1 0-2H2z" />
										</svg>
										上傳書籍
									</>
								)}
							</button>

							{/* User avatar with dropdown */}
							<div className="relative">
								<button
									type="button"
									onClick={() => setMenuOpen((o) => !o)}
									className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-[rgba(79,184,178,0.2)] text-xs font-bold text-[var(--lagoon-deep)] transition hover:bg-[rgba(79,184,178,0.35)]"
									title={user.email}
									aria-haspopup="menu"
									aria-expanded={menuOpen}
								>
									{user.email[0]?.toUpperCase()}
								</button>

								{menuOpen ? (
									<>
										{/* Backdrop to close on outside click */}
										<div
											className="fixed inset-0 z-10"
											onClick={() => setMenuOpen(false)}
											aria-hidden="true"
										/>
										<div
											role="menu"
											className="absolute right-0 top-9 z-20 min-w-[160px] rounded-xl border border-[var(--line)] bg-[var(--header-bg)] py-1 shadow-lg backdrop-blur-lg"
										>
											<p className="border-b border-[var(--line)] px-3 py-2 text-xs text-[var(--sea-ink-soft)]">
												{user.email}
											</p>
											<button
												type="button"
												role="menuitem"
												onClick={handleLogout}
												className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm text-[var(--sea-ink)] transition hover:bg-[var(--link-bg-hover)]"
											>
												<svg
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													className="h-4 w-4 flex-shrink-0"
													aria-hidden="true"
												>
													<path
														strokeLinecap="round"
														strokeLinejoin="round"
														d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
													/>
												</svg>
												登出
											</button>
										</div>
									</>
								) : null}
							</div>
						</>
					) : (
						<div className="flex items-center gap-1.5 text-sm font-semibold">
							<Link
								to="/login"
								className="nav-link"
								activeProps={{ className: "nav-link is-active" }}
							>
								登入
							</Link>
							<Link
								to="/register"
								className="nav-link"
								activeProps={{ className: "nav-link is-active" }}
							>
								註冊
							</Link>
						</div>
					)}

					<ThemeToggle />
				</div>
			</nav>
		</header>
	);
}
