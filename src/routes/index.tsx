import { createFileRoute } from "@tanstack/react-router";
import BookCard from "#/components/BookCard";
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
			<section className="island-shell rounded-[2rem] px-6 py-10 sm:px-10 sm:py-12">
				<div>
					<p className="island-kicker mb-2">Calibre Workers</p>
					<h1 className="display-title text-4xl font-bold tracking-tight text-[var(--sea-ink)] sm:text-5xl">
						你的書庫
					</h1>
					<p className="mt-3 max-w-2xl text-sm text-[var(--sea-ink-soft)] sm:text-base">
						目前顯示 {books.total} 本書。
					</p>
				</div>
			</section>

			{books.items.length === 0 ? (
				<section className="island-shell mt-6 rounded-2xl px-6 py-10 text-center">
					<p className="text-base text-[var(--sea-ink-soft)]">
						書庫還是空的，先從第一本 EPUB 開始。
					</p>
				</section>
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
