import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import BookCard from "#/components/BookCard";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import { getPageTitle } from "#/lib/utils";
import { getSessionFromMiddlewareFn } from "#/middleware/auth";
import { listBooksServerFn } from "#/server/books";

const PAGE_SIZE = 24;

export const Route = createFileRoute("/")({
	head: () => ({
		meta: [{ title: getPageTitle("書庫") }],
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
	loader: () =>
		listBooksServerFn({
			data: {
				page: 1,
				limit: PAGE_SIZE,
			},
		}),
	component: App,
});

function App() {
	const initialPage = Route.useLoaderData();
	const loadMoreRef = useRef<HTMLDivElement | null>(null);

	const { data, fetchNextPage, hasNextPage, isError, isFetchingNextPage } =
		useInfiniteQuery({
			queryKey: ["books", PAGE_SIZE],
			queryFn: ({ pageParam = 1 }) =>
				listBooksServerFn({
					data: {
						page: pageParam as number,
						limit: PAGE_SIZE,
					},
				}),
			initialPageParam: 1,
			initialData: {
				pages: [initialPage],
				pageParams: [1],
			},
			getNextPageParam: (lastPage, allPages) => {
				const loadedCount = allPages.reduce(
					(total, page) => total + page.items.length,
					0,
				);

				if (loadedCount >= lastPage.total) {
					return undefined;
				}

				return lastPage.page + 1;
			},
		});

	const pages = data.pages ?? [initialPage];
	const books = pages.flatMap((page) => page.items);
	const total = pages[0].total ?? 0;

	useEffect(() => {
		const target = loadMoreRef.current;
		if (!target || !hasNextPage) {
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting && !isFetchingNextPage) {
					void fetchNextPage();
				}
			},
			{ rootMargin: "240px 0px" },
		);

		observer.observe(target);

		return () => observer.disconnect();
	}, [fetchNextPage, hasNextPage, isFetchingNextPage]);

	return (
		<main className="page-wrap px-4 pb-10 pt-12">
			<Card className="rounded-[2rem]">
				<CardHeader className="px-6 py-10 sm:px-10 sm:py-12">
					<p className="island-kicker mb-2">Calibre Workers</p>
					<CardTitle className="display-title text-4xl font-bold tracking-tight sm:text-5xl">
						你的書庫
					</CardTitle>
					<CardDescription className="mt-3 max-w-2xl text-sm sm:text-base">
						目前顯示 {books.length} / {total} 本書。
					</CardDescription>
				</CardHeader>
			</Card>

			{isError ? (
				<Card className="mt-6">
					<CardContent className="px-6 py-10 text-center">
						<p className="text-base text-destructive">
							讀取書庫失敗，請重新整理頁面再試。
						</p>
					</CardContent>
				</Card>
			) : null}

			{books.length === 0 ? (
				<Card className="mt-6">
					<CardContent className="px-6 py-10 text-center">
						<p className="text-base text-muted-foreground">
							書庫還是空的，先從第一本 EPUB 開始。
						</p>
					</CardContent>
				</Card>
			) : (
				<>
					<section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						{books.map((book) => (
							<BookCard key={book.id} book={book} />
						))}
					</section>
					<div ref={loadMoreRef} className="mt-6 text-center text-sm">
						{hasNextPage ? (
							isFetchingNextPage ? (
								<span className="text-muted-foreground">
									正在載入更多書本...
								</span>
							) : (
								<span className="text-muted-foreground">
									下滑以載入更多書本
								</span>
							)
						) : (
							<span className="text-muted-foreground">已載入全部書本</span>
						)}
					</div>
				</>
			)}
		</main>
	);
}
