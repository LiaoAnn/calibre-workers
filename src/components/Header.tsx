import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpFromLine, LoaderCircle, LogOut } from "lucide-react";
import { useRef, useState } from "react";
import { Avatar, AvatarFallback } from "#/components/ui/avatar";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
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

	async function handleLogout() {
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
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={isUploading}
								onClick={() => fileInputRef.current?.click()}
								className="rounded-full border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.24)] hover:text-[var(--lagoon-deep)] cursor-pointer"
							>
								{isUploading ? (
									<>
										<LoaderCircle className="animate-spin" />
										上傳中…
									</>
								) : (
									<>
										<ArrowUpFromLine />
										上傳書籍
									</>
								)}
							</Button>

							{/* User avatar with dropdown */}
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Avatar className="h-7 w-7 cursor-pointer" title={user.email}>
										<AvatarFallback className="bg-[rgba(79,184,178,0.2)] text-xs font-bold text-[var(--lagoon-deep)] hover:bg-[rgba(79,184,178,0.35)]">
											{user.email[0]?.toUpperCase()}
										</AvatarFallback>
									</Avatar>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="min-w-[160px]">
									<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
										{user.email}
									</DropdownMenuLabel>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										onClick={handleLogout}
										className="cursor-pointer gap-2"
									>
										<LogOut />
										登出
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
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
