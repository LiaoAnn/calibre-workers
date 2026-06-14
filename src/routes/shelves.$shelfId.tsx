import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { ArrowLeft, Check } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import BookCard from "#/features/books/components/BookCard";
import { BatchDeleteConfirmDialog } from "#/features/shelves/components/BatchDeleteConfirmDialog";
import { DeleteShelfDialog } from "#/features/shelves/components/DeleteShelfDialog";
import { RenameShelfDialog } from "#/features/shelves/components/RenameShelfDialog";
import { shelvesQueryKeys } from "#/features/shelves/hooks/useShelves";
import {
	deleteShelfServerFn,
	getShelfBooksServerFn,
	removeBookFromShelfServerFn,
	updateShelfServerFn,
} from "#/features/shelves/server/shelves";
import { getSessionFromMiddlewareFn } from "#/shared/auth/middleware";
import { getPageTitle } from "#/shared/lib/utils";

export const Route = createFileRoute("/shelves/$shelfId")({
	loader: ({ params }) =>
		getShelfBooksServerFn({
			data: {
				shelfId: params.shelfId,
				page: 1,
				limit: 100,
			},
		}),
	head: ({ loaderData }) => ({
		meta: [{ title: getPageTitle(loaderData?.shelf.name ?? "書架") }],
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
	component: ShelfDetailPage,
});

function ShelfDetailPage() {
	const data = Route.useLoaderData();
	const router = useRouter();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [isBatchDeleteMode, setIsBatchDeleteMode] = useState(false);
	const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(
		new Set(),
	);
	const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
	const [renameValue, setRenameValue] = useState(data.shelf.name);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [isBatchDeleteConfirmOpen, setIsBatchDeleteConfirmOpen] =
		useState(false);

	const renameShelfMutation = useMutation({
		mutationFn: ({
			shelfId,
			nextName,
		}: {
			shelfId: string;
			nextName: string;
		}) =>
			updateShelfServerFn({
				data: { shelfId, name: nextName },
			}),
		onSuccess: async () => {
			setIsRenameDialogOpen(false);
			toast.success("書架名稱已更新");
			await queryClient.invalidateQueries({ queryKey: shelvesQueryKeys.all });
			await router.invalidate();
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : "更新書架失敗");
		},
	});

	const deleteShelfMutation = useMutation({
		mutationFn: (shelfId: string) =>
			deleteShelfServerFn({
				data: { shelfId },
			}),
		onSuccess: async () => {
			setIsDeleteDialogOpen(false);
			toast.success("書架已刪除");
			await queryClient.invalidateQueries({ queryKey: shelvesQueryKeys.all });
			await navigate({ to: "/shelves" });
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : "刪除書架失敗");
		},
	});

	const batchRemoveBooksMutation = useMutation({
		mutationFn: async ({
			shelfId,
			bookIds,
		}: {
			shelfId: string;
			bookIds: string[];
		}) => {
			await Promise.all(
				bookIds.map((bookId) =>
					removeBookFromShelfServerFn({
						data: { shelfId, bookId },
					}),
				),
			);

			return { removedCount: bookIds.length };
		},
		onSuccess: async ({ removedCount }) => {
			toast.success(`已從書架移除 ${removedCount} 本書`);
			setIsBatchDeleteConfirmOpen(false);
			setSelectedBookIds(new Set());
			setIsBatchDeleteMode(false);
			await queryClient.invalidateQueries({ queryKey: shelvesQueryKeys.all });
			await router.invalidate();
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : "批次移除書籍失敗");
		},
	});

	const isManagingShelf =
		renameShelfMutation.isPending || deleteShelfMutation.isPending;
	const isBatchDeleting = batchRemoveBooksMutation.isPending;
	const selectedCount = selectedBookIds.size;
	const isRenamingShelf = renameShelfMutation.isPending;
	const isDeletingShelf = deleteShelfMutation.isPending;

	function handleOpenRenameDialog() {
		setRenameValue(data.shelf.name);
		setIsRenameDialogOpen(true);
	}

	function handleRenameShelf(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmed = renameValue.trim();
		if (!trimmed) {
			return;
		}

		if (trimmed === data.shelf.name) {
			setIsRenameDialogOpen(false);
			return;
		}

		renameShelfMutation.mutate({
			shelfId: data.shelf.id,
			nextName: trimmed,
		});
	}

	function handleOpenDeleteDialog() {
		setIsDeleteDialogOpen(true);
	}

	function handleDeleteShelf() {
		if (isDeletingShelf) {
			return;
		}

		deleteShelfMutation.mutate(data.shelf.id);
	}

	function handleToggleBatchDeleteMode() {
		if (isBatchDeleting) {
			return;
		}

		if (isBatchDeleteMode) {
			setIsBatchDeleteMode(false);
			setSelectedBookIds(new Set());
			return;
		}

		setIsBatchDeleteMode(true);
	}

	function handleToggleBookSelection(bookId: string) {
		if (!isBatchDeleteMode || isBatchDeleting) {
			return;
		}

		setSelectedBookIds((current) => {
			const next = new Set(current);
			if (next.has(bookId)) {
				next.delete(bookId);
			} else {
				next.add(bookId);
			}
			return next;
		});
	}

	function handleBatchDeleteBooks() {
		if (selectedCount === 0 || isBatchDeleting) {
			return;
		}

		setIsBatchDeleteConfirmOpen(true);
	}

	function handleConfirmBatchDeleteBooks() {
		if (selectedCount === 0 || isBatchDeleting) {
			return;
		}

		batchRemoveBooksMutation.mutate({
			shelfId: data.shelf.id,
			bookIds: Array.from(selectedBookIds),
		});
	}

	return (
		<main className="page-wrap px-4 pb-10 pt-12">
			<div className="mb-4">
				<Button asChild variant="ghost" size="sm" className="gap-2 pl-0">
					<Link to="/shelves">
						<ArrowLeft size={14} />
						返回書架列表
					</Link>
				</Button>
			</div>

			<Card className="rounded-4xl">
				<CardHeader className="px-6 py-10 sm:px-10 sm:py-12">
					<p className="island-kicker mb-2">Shelf</p>
					<CardTitle className="display-title text-4xl font-bold tracking-tight sm:text-5xl">
						{data.shelf.name}
					</CardTitle>
					<CardDescription className="mt-3 max-w-2xl text-sm sm:text-base">
						共 {data.total} 本書。
					</CardDescription>
					<div className="mt-5 flex flex-wrap gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={isManagingShelf}
							onClick={handleOpenRenameDialog}
						>
							重新命名
						</Button>
						<Button
							variant="destructive"
							size="sm"
							disabled={isManagingShelf}
							onClick={handleOpenDeleteDialog}
						>
							刪除書架
						</Button>
						<Button
							variant={isBatchDeleteMode ? "secondary" : "outline"}
							size="sm"
							disabled={isManagingShelf || isBatchDeleting}
							onClick={handleToggleBatchDeleteMode}
						>
							{isBatchDeleteMode ? "取消批次刪除" : "進入批次刪除"}
						</Button>
					</div>
					{isBatchDeleteMode ? (
						<div className="mt-3 flex flex-wrap items-center gap-2">
							<p className="text-sm text-muted-foreground">
								已勾選 {selectedCount} 本書
							</p>
							<Button
								variant="destructive"
								size="sm"
								disabled={selectedCount === 0 || isBatchDeleting}
								onClick={handleBatchDeleteBooks}
							>
								批次移除
							</Button>
						</div>
					) : null}
				</CardHeader>
			</Card>

			<RenameShelfDialog
				open={isRenameDialogOpen}
				onOpenChange={setIsRenameDialogOpen}
				value={renameValue}
				onValueChange={setRenameValue}
				onSubmit={handleRenameShelf}
				isSubmitting={isRenamingShelf}
			/>

			<DeleteShelfDialog
				open={isDeleteDialogOpen}
				onOpenChange={setIsDeleteDialogOpen}
				shelfName={data.shelf.name}
				onConfirm={handleDeleteShelf}
				isSubmitting={isDeletingShelf}
			/>

			<BatchDeleteConfirmDialog
				open={isBatchDeleteConfirmOpen}
				onOpenChange={setIsBatchDeleteConfirmOpen}
				selectedCount={selectedCount}
				onConfirm={handleConfirmBatchDeleteBooks}
				isSubmitting={isBatchDeleting}
			/>

			{data.items.length === 0 ? (
				<Card className="mt-6">
					<CardContent className="px-6 py-10 text-center">
						<p className="text-base text-muted-foreground">
							書架目前是空的，可以回到書庫並用「加入書架」功能來整理。
						</p>
					</CardContent>
				</Card>
			) : (
				<section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{data.items.map((item) => (
						<div
							key={item.book.id}
							className={`relative ${isBatchDeleteMode ? "cursor-pointer" : ""}`}
						>
							<BookCard book={item.book} />
							{isBatchDeleteMode ? (
								<button
									type="button"
									className={`absolute inset-0 z-20 cursor-pointer rounded-xl border-2 transition ${
										selectedBookIds.has(item.book.id)
											? "border-(--sea) bg-black/10"
											: "border-transparent bg-transparent hover:bg-black/5"
									}`}
									onClick={() => handleToggleBookSelection(item.book.id)}
									aria-pressed={selectedBookIds.has(item.book.id)}
								>
									<span className="sr-only">
										{selectedBookIds.has(item.book.id)
											? "取消勾選書籍"
											: "勾選書籍"}
									</span>
									<span
										className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border ${
											selectedBookIds.has(item.book.id)
												? "border-(--sea) bg-(--sea) text-white"
												: "border-white/80 bg-black/35 text-white"
										}`}
									>
										{selectedBookIds.has(item.book.id) ? (
											<Check size={14} />
										) : null}
									</span>
								</button>
							) : null}
						</div>
					))}
				</section>
			)}
		</main>
	);
}
