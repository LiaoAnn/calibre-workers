import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import {
	ArrowDownToLine,
	BookmarkPlus,
	Loader2,
	Menu,
	Pencil,
	RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import type { BookFileFormat, MetadataSyncStatus } from "#/db/schema";
import { useConversionTasks } from "#/hooks/useConversionTasks";
import { shelvesQueryKeys, useShelves } from "#/hooks/useShelves";
import { getPageTitle } from "#/lib/utils";
import { getSessionFromMiddlewareFn } from "#/middleware/auth";
import { getBookByIdServerFn } from "#/server/books";
import {
	addBooksToShelfServerFn,
	listBookShelfIdsServerFn,
} from "#/server/shelves";

const isMetadataSyncing = (status: MetadataSyncStatus) =>
	status === "pending" || status === "processing";

export const Route = createFileRoute("/books/$bookId")({
	loader: async ({ params }) => ({
		book: await getBookByIdServerFn({
			data: {
				bookId: params.bookId,
			},
		}),
		session: await getSessionFromMiddlewareFn(),
	}),
	head: ({ loaderData }) => ({
		meta: [{ title: getPageTitle(loaderData?.book?.title) }],
	}),
	beforeLoad: async () => {
		const session = await getSessionFromMiddlewareFn();

		if (!session?.user || session.user.deletedAt) {
			throw redirect({ to: "/login" });
		}

		if (session.user.status !== "active") {
			throw redirect({ to: "/pending-approval" });
		}
	},
	component: BookDetailPage,
});

function BookDetailPage() {
	const { book, session } = Route.useLoaderData();
	const router = useRouter();
	const queryClient = useQueryClient();
	const conversionTargets = ["kepub", "azw3", "mobi"] as BookFileFormat[];
	const { data: shelves = [] } = useShelves();
	const bookShelfIdsQueryKey = [
		...shelvesQueryKeys.all,
		"book-membership",
		book.id,
	] as const;
	const { data: bookShelfIds = [], isPending: isBookShelfIdsPending } =
		useQuery({
			queryKey: bookShelfIdsQueryKey,
			queryFn: () =>
				listBookShelfIdsServerFn({
					data: {
						bookId: book.id,
					},
				}),
		});

	const authors =
		book.authors
			?.split(",")
			.map((a) => a.trim())
			.filter(Boolean) ?? [];
	const coverVersion = book.lastModified.getTime();
	const pubYear = book.pubdate ? new Date(book.pubdate).getFullYear() : null;
	const description = book.comments[0]?.text;

	const existingFormats = new Set(
		book.files.map((f) => f.format.toLowerCase()),
	);
	const epubFiles = book.files.filter((f) => f.format.toLowerCase() === "epub");
	const canConvert = epubFiles.length > 0;
	const hasActiveMetadataSync = book.files.some((file) =>
		isMetadataSyncing(file.metadataStatus),
	);
	const availableShelves = useMemo(() => {
		const shelfIdSet = new Set(bookShelfIds);
		return shelves.filter((shelf) => !shelfIdSet.has(shelf.id));
	}, [bookShelfIds, shelves]);

	const addBookToShelfMutation = useMutation({
		mutationFn: ({
			shelfId,
			shelfName,
		}: {
			shelfId: string;
			shelfName: string;
		}) =>
			addBooksToShelfServerFn({
				data: {
					shelfId,
					bookIds: [book.id],
				},
			}).then((result) => ({ ...result, shelfId, shelfName })),
		onSuccess: ({ addedCount, shelfId, shelfName }) => {
			if (addedCount > 0) {
				toast.success(`已將書籍加入「${shelfName}」`);
				queryClient.setQueryData<string[]>(bookShelfIdsQueryKey, (previous) => {
					const current = previous ?? [];
					return current.includes(shelfId) ? current : [...current, shelfId];
				});
			} else {
				toast.message(`「${shelfName}」已包含這本書`);
			}

			void queryClient.invalidateQueries({ queryKey: shelvesQueryKeys.all });
			void queryClient.invalidateQueries({ queryKey: bookShelfIdsQueryKey });
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : "加入書架失敗");
		},
	});

	const { activeTasks: activeConversionTasks, triggerConversion } =
		useConversionTasks({ bookId: book.id, limit: 10 });
	const prevActiveCountRef = useRef(0);

	const activeConversionBySourceAndTarget = new Map(
		activeConversionTasks
			.filter(
				(task) =>
					task.bookId === book.id &&
					task.sourceFileId &&
					(task.status === "pending" || task.status === "processing"),
			)
			.map((task) => {
				const sourceFileId = task.sourceFileId as string;
				const targetFormatMatch = task.fileName.match(/→\s*([A-Z0-9]+)$/);
				const targetFormat = targetFormatMatch?.[1]?.toLowerCase() ?? "unknown";
				return [`${sourceFileId}:${targetFormat}`, task] as const;
			}),
	);

	async function handleConvert(fileId: string, targetFormat: string) {
		await triggerConversion({
			bookId: book.id,
			fileId,
			targetFormat,
		});
	}

	useEffect(() => {
		const currentActiveCount = activeConversionTasks.filter(
			(task) => task.bookId === book.id,
		).length;

		// When transitioning from active tasks to no active tasks, refresh the page
		if (prevActiveCountRef.current > 0 && currentActiveCount === 0) {
			// Refresh the book page once all conversions for this book have settled
			router.invalidate();
		}

		prevActiveCountRef.current = currentActiveCount;
	}, [activeConversionTasks, book.id, router]);

	useEffect(() => {
		if (!hasActiveMetadataSync) {
			return;
		}

		const timer = setInterval(() => {
			router.invalidate();
		}, 3000);

		return () => clearInterval(timer);
	}, [hasActiveMetadataSync, router]);

	return (
		<main className="page-wrap px-4 py-12">
			<div className="mx-auto w-full max-w-4xl">
				<div className="flex flex-col gap-8 md:flex-row md:items-start">
					{/* Left column: cover + download + edit */}
					<div className="shrink-0 md:w-56">
						<div className="aspect-3/4 overflow-hidden rounded-2xl border border-(--line) bg-[rgba(79,184,178,0.08)]">
							{book.hasCover ? (
								<img
									src={`/api/books/${book.id}/cover?v=${coverVersion}`}
									alt={book.title}
									className="h-full w-full object-cover"
								/>
							) : null}
						</div>

						<div className="mt-5 md:hidden">
							<h1 className="text-3xl font-bold leading-tight text-(--sea-ink)">
								{book.title}
							</h1>

							{authors.length > 0 ? (
								<p className="mt-2 text-base text-(--sea-ink-soft)">
									{authors.map((author, index) => (
										<span key={`${book.id}-author-mobile-${author}`}>
											{index > 0 ? ", " : null}
											<Link
												to="/author/$name"
												params={{ name: author }}
												className="hover:underline"
											>
												{author}
											</Link>
										</span>
									))}
								</p>
							) : null}
						</div>

						<div className="mt-4 md:hidden">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="outline" size="sm" className="w-full gap-2">
										<Menu size={14} />
										書籍操作
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="start"
									className="w-[min(20rem,calc(100vw-3rem))] max-h-[70vh] overflow-y-auto"
								>
									{session?.user ? (
										<>
											<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
												管理
											</DropdownMenuLabel>
											<DropdownMenuItem
												asChild
												className="cursor-pointer gap-2"
											>
												<Link
													to="/books/$bookId/edit"
													params={{ bookId: book.id }}
												>
													<Pencil size={14} />
													編輯 Metadata
												</Link>
											</DropdownMenuItem>
											<DropdownMenuSeparator />
											<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
												加入書架
											</DropdownMenuLabel>
											{isBookShelfIdsPending ? (
												<DropdownMenuItem disabled>
													讀取書架中...
												</DropdownMenuItem>
											) : shelves.length === 0 ? (
												<>
													<DropdownMenuItem disabled>
														尚未建立書架
													</DropdownMenuItem>
													<DropdownMenuItem asChild>
														<Link to="/shelves">前往建立書架</Link>
													</DropdownMenuItem>
												</>
											) : availableShelves.length > 0 ? (
												availableShelves.map((shelf) => (
													<DropdownMenuItem
														key={`${book.id}-mobile-${shelf.id}`}
														className="cursor-pointer"
														onSelect={(event) => {
															event.preventDefault();
															if (addBookToShelfMutation.isPending) {
																return;
															}
															addBookToShelfMutation.mutate({
																shelfId: shelf.id,
																shelfName: shelf.name,
															});
														}}
													>
														{shelf.name}
													</DropdownMenuItem>
												))
											) : (
												<DropdownMenuItem disabled>
													已加入所有書架
												</DropdownMenuItem>
											)}
										</>
									) : null}

									{book.files.length > 0 ? (
										<>
											<DropdownMenuSeparator />
											<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
												下載
											</DropdownMenuLabel>
											{hasActiveMetadataSync ? (
												<DropdownMenuItem disabled>
													Metadata 同步中，下載暫時鎖定
												</DropdownMenuItem>
											) : null}
											{book.files.map((file) =>
												isMetadataSyncing(file.metadataStatus) ? (
													<DropdownMenuItem
														key={file.id}
														disabled
														className="gap-2"
													>
														<Loader2 size={14} className="animate-spin" />
														{file.format.toUpperCase()} (同步中...)
													</DropdownMenuItem>
												) : (
													<DropdownMenuItem
														key={file.id}
														asChild
														className="cursor-pointer gap-2"
													>
														<a href={`/api/books/${book.id}/files/${file.id}`}>
															<ArrowDownToLine size={14} />
															{file.format.toUpperCase()}
															{file.metadataStatus === "failed"
																? " (同步失敗)"
																: ""}
														</a>
													</DropdownMenuItem>
												),
											)}
										</>
									) : null}

									{session?.user && canConvert ? (
										<>
											<DropdownMenuSeparator />
											<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
												格式轉換
											</DropdownMenuLabel>
											{epubFiles.flatMap((file) =>
												conversionTargets
													.filter(
														(targetFormat) =>
															!existingFormats.has(targetFormat),
													)
													.map((targetFormat) => {
														const activeTask =
															activeConversionBySourceAndTarget.get(
																`${file.id}:${targetFormat}`,
															);

														return activeTask ? (
															<DropdownMenuItem
																key={`${file.id}:${targetFormat}:mobile-active`}
																disabled
																className="gap-2"
															>
																<Loader2 size={14} className="animate-spin" />
																轉換至 {targetFormat.toUpperCase()}
																{activeTask.status === "processing"
																	? " (轉換中...)"
																	: " (排隊中...)"}
															</DropdownMenuItem>
														) : (
															<DropdownMenuItem
																key={`${file.id}:${targetFormat}:mobile`}
																className="cursor-pointer gap-2"
																onSelect={() => {
																	void handleConvert(file.id, targetFormat);
																}}
															>
																<RefreshCw size={14} />
																轉換至 {targetFormat.toUpperCase()}
															</DropdownMenuItem>
														);
													}),
											)}
										</>
									) : null}
								</DropdownMenuContent>
							</DropdownMenu>
						</div>

						{session?.user ? (
							<div className="mt-4 hidden space-y-2 md:block">
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="outline"
											size="sm"
											className="w-full justify-start gap-2"
											disabled={addBookToShelfMutation.isPending}
										>
											<BookmarkPlus size={14} />
											加入書架
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start" className="min-w-56">
										{isBookShelfIdsPending ? (
											<DropdownMenuItem disabled>
												讀取書架中...
											</DropdownMenuItem>
										) : shelves.length === 0 ? (
											<>
												<DropdownMenuItem disabled>
													尚未建立書架
												</DropdownMenuItem>
												<DropdownMenuItem asChild>
													<Link to="/shelves">前往建立書架</Link>
												</DropdownMenuItem>
											</>
										) : availableShelves.length > 0 ? (
											availableShelves.map((shelf) => (
												<DropdownMenuItem
													key={`${book.id}-${shelf.id}`}
													className="cursor-pointer"
													onSelect={(event) => {
														event.preventDefault();
														if (addBookToShelfMutation.isPending) {
															return;
														}
														addBookToShelfMutation.mutate({
															shelfId: shelf.id,
															shelfName: shelf.name,
														});
													}}
												>
													{shelf.name}
												</DropdownMenuItem>
											))
										) : (
											<DropdownMenuItem disabled>
												已加入所有書架
											</DropdownMenuItem>
										)}
									</DropdownMenuContent>
								</DropdownMenu>

								<Button
									variant="outline"
									size="sm"
									asChild
									className="w-full justify-start gap-2"
								>
									<Link to="/books/$bookId/edit" params={{ bookId: book.id }}>
										<Pencil />
										編輯 Metadata
									</Link>
								</Button>
							</div>
						) : null}

						{book.files.length > 0 ? (
							<div className="mt-4 hidden space-y-2 md:block">
								<p className="text-xs font-semibold uppercase tracking-wider text-(--sea-ink-soft)">
									下載
								</p>
								{hasActiveMetadataSync ? (
									<p className="text-xs text-(--sea-ink-soft)">
										Metadata 同步中，下載暫時鎖定
									</p>
								) : null}
								{book.files.map((file) =>
									isMetadataSyncing(file.metadataStatus) ? (
										<Button
											key={file.id}
											variant="outline"
											size="sm"
											className="w-full justify-start gap-2 opacity-70"
											disabled
										>
											<Loader2 size={14} className="animate-spin" />
											{file.format.toUpperCase()} (同步中...)
										</Button>
									) : (
										<Button
											key={file.id}
											variant="outline"
											size="sm"
											asChild
											className="w-full justify-start gap-2"
										>
											<a href={`/api/books/${book.id}/files/${file.id}`}>
												<ArrowDownToLine />
												{file.format.toUpperCase()}
												{file.metadataStatus === "failed" ? " (同步失敗)" : ""}
											</a>
										</Button>
									),
								)}
							</div>
						) : null}

						{session?.user && canConvert ? (
							<div className="mt-4 hidden space-y-2 md:block">
								<p className="text-xs font-semibold uppercase tracking-wider text-(--sea-ink-soft)">
									格式轉換
								</p>
								{epubFiles.map((file) => {
									return conversionTargets
										.filter(
											(targetFormat) => !existingFormats.has(targetFormat),
										)
										.map((targetFormat) => {
											const activeTask = activeConversionBySourceAndTarget.get(
												`${file.id}:${targetFormat}`,
											);
											return activeTask ? (
												<ConversionJobTracker
													key={`${file.id}:${targetFormat}`}
													status={
														activeTask.status === "processing"
															? "processing"
															: "pending"
													}
													label={`轉換至 ${targetFormat.toUpperCase()}`}
												/>
											) : (
												<Button
													key={`${file.id}:${targetFormat}`}
													variant="outline"
													size="sm"
													className="w-full justify-start gap-2"
													onClick={() => handleConvert(file.id, targetFormat)}
												>
													<RefreshCw size={14} />
													轉換至 {targetFormat.toUpperCase()}
												</Button>
											);
										});
								})}
							</div>
						) : null}
					</div>

					{/* Right column: metadata */}
					<div className="min-w-0 flex-1">
						<h1 className="hidden text-3xl font-bold leading-tight text-(--sea-ink) md:block">
							{book.title}
						</h1>

						{authors.length > 0 ? (
							<p className="mt-2 hidden text-base text-(--sea-ink-soft) md:block">
								{authors.map((author, index) => (
									<span key={`${book.id}-author-${author}`}>
										{index > 0 ? ", " : null}
										<Link
											to="/author/$name"
											params={{ name: author }}
											className="hover:underline"
										>
											{author}
										</Link>
									</span>
								))}
							</p>
						) : null}

						<dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm md:mt-6">
							<dt className="font-medium text-(--sea-ink)">出版年份</dt>
							<dd className="text-(--sea-ink-soft)">
								{pubYear ?? <span className="italic opacity-50">未設定</span>}
							</dd>

							<dt className="font-medium text-(--sea-ink)">出版社</dt>
							<dd className="text-(--sea-ink-soft)">
								{book.publisher ? (
									book.publisher.name
								) : (
									<span className="italic opacity-50">未設定</span>
								)}
							</dd>

							{book.series ? (
								<>
									<dt className="font-medium text-(--sea-ink)">叢書</dt>
									<dd className="text-(--sea-ink-soft)">
										{book.series.name}
										{book.seriesIndex !== null &&
										book.seriesIndex !== undefined ? (
											<span className="ml-1 opacity-70">
												#{book.seriesIndex}
											</span>
										) : null}
									</dd>
								</>
							) : null}

							{book.language ? (
								<>
									<dt className="font-medium text-(--sea-ink)">語言</dt>
									<dd className="text-(--sea-ink-soft)">{book.language}</dd>
								</>
							) : null}

							<dt className="font-medium text-(--sea-ink)">識別碼</dt>
							<dd className="space-y-0.5 text-(--sea-ink-soft)">
								{book.identifiers.length > 0 ? (
									book.identifiers.map((id) => (
										<div key={id.id}>
											<span className="font-mono text-xs uppercase">
												{id.type}
											</span>
											：{id.value}
										</div>
									))
								) : (
									<span className="italic opacity-50">未設定</span>
								)}
							</dd>
						</dl>

						<div className="mt-5">
							<p className="mb-2 text-xs font-semibold uppercase tracking-wider text-(--sea-ink-soft)">
								標籤
							</p>
							<div className="flex flex-wrap gap-1.5">
								{book.tags.length > 0 ? (
									book.tags.map((tag) => (
										<Badge key={tag.id} variant="secondary">
											{tag.name}
										</Badge>
									))
								) : (
									<span className="text-xs italic text-(--sea-ink-soft) opacity-50">
										未設定
									</span>
								)}
							</div>
						</div>
					</div>
				</div>

				{description ? (
					<div className="mt-8 border-t border-(--line) pt-6">
						<p className="mb-2 text-xs font-semibold uppercase tracking-wider text-(--sea-ink-soft)">
							簡介
						</p>
						<p className="whitespace-pre-line text-sm leading-relaxed text-(--sea-ink-soft)">
							{description}
						</p>
					</div>
				) : null}
			</div>
		</main>
	);
}

interface ConversionJobTrackerProps {
	status: "pending" | "processing";
	label: string;
}

function ConversionJobTracker({ status, label }: ConversionJobTrackerProps) {
	const statusLabel = status === "processing" ? "轉換中..." : "排隊中...";

	return (
		<Button
			variant="outline"
			size="sm"
			className="w-full justify-start gap-2 opacity-70"
			disabled
		>
			<Loader2 size={14} className="animate-spin" />
			{label} ({statusLabel})
		</Button>
	);
}
