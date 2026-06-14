import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import { CreateShelfDialog } from "#/features/shelves/components/CreateShelfDialog";
import {
	shelvesQueryKeys,
	useShelves,
} from "#/features/shelves/hooks/useShelves";
import {
	createShelfServerFn,
	listShelvesServerFn,
} from "#/features/shelves/server/shelves";
import { getPageTitle } from "#/shared/lib/utils";

export const Route = createFileRoute("/shelves/")({
	loader: () => listShelvesServerFn(),
	head: () => ({
		meta: [{ title: getPageTitle("書架") }],
	}),
	component: ShelvesIndexPage,
});

const previewFanLayout = [
	{ slot: "left", left: "0%", top: "10px", rotate: "-11deg", zIndex: 10 },
	{ slot: "middle", left: "29%", top: "0px", rotate: "-2deg", zIndex: 20 },
	{ slot: "right", left: "58%", top: "12px", rotate: "9deg", zIndex: 30 },
] as const;

function ShelvesIndexPage() {
	const initialShelves = Route.useLoaderData();
	const queryClient = useQueryClient();
	const { data: shelves = [] } = useShelves(initialShelves);
	const [name, setName] = useState("");
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

	const createShelfMutation = useMutation({
		mutationFn: (shelfName: string) =>
			createShelfServerFn({
				data: { name: shelfName },
			}),
		onSuccess: () => {
			setName("");
			setIsCreateDialogOpen(false);
			queryClient.invalidateQueries({ queryKey: shelvesQueryKeys.all });
			toast.success("已建立新書架");
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : "建立書架失敗");
		},
	});

	const isSubmitting = createShelfMutation.isPending;
	const totalBooks = useMemo(
		() => shelves.reduce((sum, shelf) => sum + shelf.bookCount, 0),
		[shelves],
	);

	function handleCreateShelf(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) {
			return;
		}

		createShelfMutation.mutate(trimmed);
	}

	function handleCreateDialogOpenChange(open: boolean) {
		setIsCreateDialogOpen(open);
		if (!open) {
			setName("");
		}
	}

	return (
		<main className="page-wrap px-4 pb-10 pt-12">
			<Card className="rounded-4xl">
				<CardHeader className="px-6 py-10 sm:px-10 sm:py-12">
					<div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
						<div>
							<p className="island-kicker mb-2">Book Lists</p>
							<CardTitle className="display-title text-4xl font-bold tracking-tight sm:text-5xl">
								我的書架
							</CardTitle>
							<CardDescription className="mt-3 max-w-2xl text-sm sm:text-base">
								共 {shelves.length} 個書架，收錄 {totalBooks}{" "}
								本書。書架目前為私有，僅自己可見。
							</CardDescription>
						</div>
						<CreateShelfDialog
							open={isCreateDialogOpen}
							onOpenChange={handleCreateDialogOpenChange}
							name={name}
							onNameChange={setName}
							onSubmit={handleCreateShelf}
							isSubmitting={isSubmitting}
						/>
					</div>
				</CardHeader>
			</Card>

			{shelves.length === 0 ? (
				<Card className="mt-6">
					<CardContent className="px-6 py-10 text-center">
						<p className="text-base text-muted-foreground">
							還沒有任何書架，先建立一個書架開始整理書庫。
						</p>
					</CardContent>
				</Card>
			) : (
				<section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{shelves.map((shelf) => (
						<Link
							key={shelf.id}
							to="/shelves/$shelfId"
							params={{ shelfId: shelf.id }}
							className="group block"
						>
							<Card className="overflow-hidden transition group-hover:shadow-md">
								<CardContent className="p-4">
									<div className="relative mb-4 h-48">
										{previewFanLayout.map((layout, index) => {
											const previewBook = shelf.previewBooks[index];
											return (
												<div
													key={`${shelf.id}-${layout.slot}`}
													className="absolute w-5/12 overflow-hidden rounded-lg border border-(--line) bg-[rgba(79,184,178,0.08)] shadow-sm"
													style={{
														left: layout.left,
														top: layout.top,
														transform: `rotate(${layout.rotate})`,
														zIndex: layout.zIndex,
													}}
												>
													<div className="aspect-3/4">
														{previewBook ? (
															previewBook.hasCover ? (
																<img
																	src={`/api/books/${previewBook.id}/cover?v=${previewBook.lastModified.getTime()}`}
																	alt={previewBook.title}
																	className="h-full w-full object-cover"
																	loading="lazy"
																/>
															) : (
																<div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-muted-foreground">
																	無封面
																</div>
															)
														) : (
															<div className="h-full w-full border border-dashed border-(--line) bg-muted/40" />
														)}
													</div>
												</div>
											);
										})}
									</div>
									<CardTitle className="line-clamp-2 text-base font-semibold text-(--sea-ink) group-hover:underline">
										{shelf.name}
									</CardTitle>
								</CardContent>
							</Card>
						</Link>
					))}
				</section>
			)}
		</main>
	);
}
