import { createFileRoute } from "@tanstack/react-router";
import { getBookByIdServerFn } from "#/server/books";

export const Route = createFileRoute("/books/$bookId")({
	loader: ({ params }) =>
		getBookByIdServerFn({
			data: {
				bookId: params.bookId,
			},
		}),
	component: BookDetailPage,
});

function BookDetailPage() {
	const book = Route.useLoaderData();

	const authors = book.authors.map((a) => a.author.name).join("、");
	const pubYear = book.pubdate ? new Date(book.pubdate).getFullYear() : null;

	return (
		<main className="page-wrap px-4 py-12">
			<div className="mx-auto w-full max-w-4xl">
				<div className="flex flex-col gap-8 md:flex-row md:items-start">
					{/* Left column: cover + download */}
					<div className="flex-shrink-0 md:w-56">
						<div className="aspect-[3/4] overflow-hidden rounded-2xl border border-[var(--line)] bg-[rgba(79,184,178,0.08)]">
							{book.hasCover ? (
								<img
									src={`/api/books/${book.id}/cover`}
									alt={book.title}
									className="h-full w-full object-cover"
								/>
							) : null}
						</div>

						{book.files.length > 0 ? (
							<div className="mt-4 space-y-2">
								<p className="text-xs font-semibold uppercase tracking-wider text-[var(--sea-ink-soft)]">
									下載
								</p>
								{book.files.map((file) => (
									<a
										key={file.id}
										href={`/api/books/${book.id}/files/${file.id}`}
										className="flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--lagoon-deep)] no-underline transition hover:bg-[rgba(79,184,178,0.08)]"
									>
										<svg
											viewBox="0 0 16 16"
											fill="currentColor"
											className="h-4 w-4 flex-shrink-0"
											aria-hidden="true"
										>
											<path d="M8 12l-4.5-4.5 1.06-1.06L7 8.88V1h2v7.88l2.44-2.44L12.5 7.5 8 12zM2 13h12v2H2v-2z" />
										</svg>
										{file.format.toUpperCase()}
									</a>
								))}
							</div>
						) : null}
					</div>

					{/* Right column: metadata */}
					<div className="min-w-0 flex-1">
						<h1 className="text-3xl font-bold leading-tight text-[var(--sea-ink)]">
							{book.title}
						</h1>

						{authors ? (
							<p className="mt-2 text-base text-[var(--sea-ink-soft)]">
								{authors}
							</p>
						) : null}

						<dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
							<dt className="font-medium text-[var(--sea-ink)]">出版年份</dt>
							<dd className="text-[var(--sea-ink-soft)]">
								{pubYear ?? <span className="italic opacity-50">未設定</span>}
							</dd>

							<dt className="font-medium text-[var(--sea-ink)]">出版社</dt>
							<dd className="text-[var(--sea-ink-soft)]">
								{book.publishers.length > 0 ? (
									book.publishers.map((p) => p.name).join("、")
								) : (
									<span className="italic opacity-50">未設定</span>
								)}
							</dd>

							<dt className="font-medium text-[var(--sea-ink)]">識別碼</dt>
							<dd className="space-y-0.5 text-[var(--sea-ink-soft)]">
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
							<p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--sea-ink-soft)]">
								標籤
							</p>
							<div className="flex flex-wrap gap-1.5">
								{book.tags.length > 0 ? (
									book.tags.map((tag) => (
										<span
											key={tag.id}
											className="rounded-full border border-[rgba(50,143,151,0.25)] bg-[rgba(79,184,178,0.1)] px-2.5 py-0.5 text-xs font-medium text-[var(--lagoon-deep)]"
										>
											{tag.name}
										</span>
									))
								) : (
									<span className="text-xs italic text-[var(--sea-ink-soft)] opacity-50">
										未設定
									</span>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</main>
	);
}
