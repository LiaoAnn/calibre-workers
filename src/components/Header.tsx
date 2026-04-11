import { Link } from "@tanstack/react-router";
import { ArrowUpFromLine, LogOut, Menu } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
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
import {
	BOOK_MAX_UPLOAD_SIZE_BYTES,
	validateBookUploadFile,
} from "#/lib/book-upload-validation";
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
		const validFiles: File[] = [];
		let unsupportedCount = 0;
		let tooLargeCount = 0;
		let emptyCount = 0;

		for (const file of fileArray) {
			const validationIssue = validateBookUploadFile(file);
			if (!validationIssue) {
				validFiles.push(file);
				continue;
			}

			switch (validationIssue) {
				case "unsupported-type":
					unsupportedCount += 1;
					break;
				case "too-large":
					tooLargeCount += 1;
					break;
				case "empty-file":
					emptyCount += 1;
					break;
			}
		}

		if (unsupportedCount > 0) {
			toast.error(
				`僅支援 EPUB 檔案，已忽略 ${unsupportedCount} 個不符合格式的檔案。`,
			);
		}

		if (tooLargeCount > 0) {
			toast.error(
				`已忽略 ${tooLargeCount} 個超過 ${Math.floor(BOOK_MAX_UPLOAD_SIZE_BYTES / (1024 * 1024))}MB 的檔案。`,
			);
		}

		if (emptyCount > 0) {
			toast.error(`已忽略 ${emptyCount} 個空檔案。`);
		}

		if (validFiles.length > 0) {
			addFilesToQueue(validFiles);
		}

		// Reset input so same files can be selected again
		if (fileInputRef.current) fileInputRef.current.value = "";
	}

	return (
		<header className="sticky top-0 z-50 border-b -(--) -(--) px-3 backdrop-blur-lg sm:px-4">
			<nav className="page-wrap py-3 sm:py-4">
				{user ? (
					<input
						ref={fileInputRef}
						type="file"
						accept=".epub,application/epub+zip"
						className="hidden"
						multiple
						onChange={handleFileChange}
					/>
				) : null}

				{/* Mobile */}
				<div className="flex items-center gap-2 sm:hidden">
					<h2 className="m-0 shrink-0 text-base font-semibold tracking-tight">
						<Link
							to="/"
							className="inline-flex items-center gap-2 rounded-full border -(--) -(--) px-3 py-1.5 text-sm -(--) no-underline shadow-[0_8px_24px_rgba(30,90,72,0.08)]"
						>
							<span className="h-2 w-2 rounded-full bg-[linear-gradient(90deg,#56c6be,#7ed3bf)]" />
							Calibre
						</Link>
					</h2>

					<div className="ml-auto flex items-center gap-2">
						{user ? <TaskNotification /> : null}
						<ThemeToggle />

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="outline"
									size="icon"
									className="h-9 w-9 rounded-full border-(--) bg-(--chip-bg) text-(--sea-ink) shadow-[0_8px_22px_rgba(30,90,72,0.08)]"
								>
									<Menu className="h-4 w-4" />
									<span className="sr-only">開啟選單</span>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-56">
								<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
									導覽
								</DropdownMenuLabel>
								<DropdownMenuItem asChild className="cursor-pointer">
									<Link to="/">Home</Link>
								</DropdownMenuItem>
								<DropdownMenuItem asChild className="cursor-pointer">
									<Link to="/shelves">書架</Link>
								</DropdownMenuItem>

								<DropdownMenuSeparator />

								{user ? (
									<>
										<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
											{user.email}
										</DropdownMenuLabel>
										<DropdownMenuItem
											onClick={() => fileInputRef.current?.click()}
											className="cursor-pointer gap-2"
										>
											<ArrowUpFromLine className="h-4 w-4" />
											上傳書籍
										</DropdownMenuItem>
										<DropdownMenuItem asChild className="cursor-pointer">
											<Link to="/settings/kobo">Kobo 裝置同步</Link>
										</DropdownMenuItem>
										{user.role === "admin" ? (
											<DropdownMenuItem asChild className="cursor-pointer">
												<Link to="/admin/users">使用者管理</Link>
											</DropdownMenuItem>
										) : null}
										<DropdownMenuItem
											onClick={handleLogout}
											className="cursor-pointer gap-2"
										>
											<LogOut className="h-4 w-4" />
											登出
										</DropdownMenuItem>
									</>
								) : (
									<>
										<DropdownMenuItem asChild className="cursor-pointer">
											<Link to="/login">登入</Link>
										</DropdownMenuItem>
										<DropdownMenuItem asChild className="cursor-pointer">
											<Link to="/register">註冊</Link>
										</DropdownMenuItem>
									</>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>

				{/* Desktop */}
				<div className="hidden items-center gap-3 sm:flex">
					<h2 className="m-0 shrink-0 text-base font-semibold tracking-tight">
						<Link
							to="/"
							className="inline-flex items-center gap-2 rounded-full border -(--) -(--) px-4 py-2 text-sm -(--) no-underline shadow-[0_8px_24px_rgba(30,90,72,0.08)]"
						>
							<span className="h-2 w-2 rounded-full bg-[linear-gradient(90deg,#56c6be,#7ed3bf)]" />
							Calibre Workers
						</Link>
					</h2>

					<div className="flex items-center gap-4 text-sm font-semibold">
						<Link
							to="/"
							className="nav-link"
							activeProps={{ className: "nav-link is-active" }}
						>
							Home
						</Link>
						<Link
							to="/shelves"
							className="nav-link"
							activeProps={{ className: "nav-link is-active" }}
						>
							書架
						</Link>
					</div>

					<div className="ml-auto flex items-center gap-4">
						{user ? (
							<>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => fileInputRef.current?.click()}
									className="h-9 rounded-full border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-3 -(--) hover:bg-[rgba(79,184,178,0.24)] hover:-(--) cursor-pointer"
								>
									<ArrowUpFromLine className="h-4 w-4" />
									<span>上傳書籍</span>
								</Button>

								<TaskNotification />

								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Avatar
											className="h-7 w-7 cursor-pointer"
											title={user.email}
										>
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
										<DropdownMenuItem asChild className="cursor-pointer">
											<Link to="/settings/kobo">Kobo 裝置同步</Link>
										</DropdownMenuItem>
										{user.role === "admin" ? (
											<DropdownMenuItem asChild className="cursor-pointer">
												<Link to="/admin/users">使用者管理</Link>
											</DropdownMenuItem>
										) : null}
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
							<div className="flex items-center gap-3 whitespace-nowrap text-sm font-semibold">
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
				</div>
			</nav>
		</header>
	);
}
