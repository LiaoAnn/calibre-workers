import { Link } from "@tanstack/react-router";
import { ArrowUpFromLine, LogOut } from "lucide-react";
import { useRef } from "react";
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
import { useUploadQueue } from "#/hooks/useUploadQueue";
import { authClient, useSession } from "#/lib/auth-client";
import { TaskNotification } from "./TaskNotification";
import ThemeToggle from "./ThemeToggle";

export default function Header() {
	const { data: session } = useSession();
	const user = session?.user ?? null;
	const fileInputRef = useRef<HTMLInputElement>(null);

	const { addFilesToQueue } = useUploadQueue();

	async function handleLogout() {
		await authClient.signOut();
		window.location.assign("/login");
	}

	function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
		const files = event.target.files;
		if (!files || files.length === 0) return;

		const fileArray = Array.from(files);
		addFilesToQueue(fileArray);

		// Reset input so same files can be selected again
		if (fileInputRef.current) fileInputRef.current.value = "";
	}

	return (
		<header className="sticky top-0 z-50 border-b -(--) -(--) px-4 backdrop-blur-lg">
			<nav className="page-wrap flex items-center gap-3 py-3 sm:py-4">
				{/* Site logo/name */}
				<h2 className="m-0 shrink-0 text-base font-semibold tracking-tight">
					<Link
						to="/"
						className="inline-flex items-center gap-2 rounded-full border -(--) -(--) px-3 py-1.5 text-sm -(--) no-underline shadow-[0_8px_24px_rgba(30,90,72,0.08)] sm:px-4 sm:py-2"
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
				<div className="ml-auto flex items-center gap-4">
					{user ? (
						<>
							{/* Hidden file input */}
							<input
								ref={fileInputRef}
								type="file"
								accept=".epub,application/epub+zip"
								className="hidden"
								multiple
								onChange={handleFileChange}
							/>

							{/* Upload button */}
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => fileInputRef.current?.click()}
								className="rounded-full border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] -(--) hover:bg-[rgba(79,184,178,0.24)] hover:-(--) cursor-pointer"
							>
								<ArrowUpFromLine />
								上傳書籍
							</Button>

							{/* Task Notification Center */}
							<TaskNotification />

							{/* User avatar with dropdown */}
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Avatar className="h-7 w-7 cursor-pointer" title={user.email}>
										<AvatarFallback className="bg-[rgba(79,184,178,0.2)] text-xs font-bold -(--) hover:bg-[rgba(79,184,178,0.35)]">
											{user.email[0]?.toUpperCase()}
										</AvatarFallback>
									</Avatar>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="min-w-40">
									<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
										{user.email}
									</DropdownMenuLabel>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										onClick={handleLogout}
										className="cursor-pointer gap-4"
									>
										<LogOut />
										登出
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</>
					) : (
						<div className="flex items-center gap-4 text-sm font-semibold">
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
