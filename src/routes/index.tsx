import { createFileRoute } from "@tanstack/react-router";
import BookCard from "#/components/BookCard";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import { listBooksServerFn } from "#/server/books";

export const Route = createFileRoute("/")({
	loader: () =>
		listBooksServerFn({
			data: {
				page: 1,
				limit: 24,
			},
		}),
	component: App,
});

function App() {
	const books = Route.useLoaderData();

	return (
		<main className="page-wrap px-4 pb-10 pt-12">
			<Card className="rounded-[2rem]">
				<CardHeader className="px-6 py-10 sm:px-10 sm:py-12">
					<p className="island-kicker mb-2">Calibre Workers</p>
					<CardTitle className="display-title text-4xl font-bold tracking-tight sm:text-5xl">
						你的書庫
					</CardTitle>
					<CardDescription className="mt-3 max-w-2xl text-sm sm:text-base">
						目前顯示 {books.total} 本書。
					</CardDescription>
				</CardHeader>
			</Card>

			{books.items.length === 0 ? (
				<Card className="mt-6">
					<CardContent className="px-6 py-10 text-center">
						<p className="text-base text-muted-foreground">
							書庫還是空的，先從第一本 EPUB 開始。
						</p>
					</CardContent>
				</Card>
			) : (
				<section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{books.items.map((book) => (
						<BookCard key={book.id} book={book} />
					))}
				</section>
			)}
		</main>
	);
}
