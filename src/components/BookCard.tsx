import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "#/components/ui/card";
import type { books } from "#/db/schema";

interface BookCardProps {
	book: typeof books.$inferSelect;
}

export default function BookCard({ book }: BookCardProps) {
	const authors =
		book.authors
			?.split(",")
			.map((a) => a.trim())
			.filter(Boolean) ?? [];

	return (
		<Card className="group transition hover:shadow-md py-0">
			<CardContent className="p-4">
				<Link
					to="/books/$bookId"
					params={{ bookId: book.id }}
					className="block no-underline"
				>
					<div className="aspect-[3/4] overflow-hidden rounded-xl border border-[var(--line)] bg-[rgba(79,184,178,0.08)]">
						{book.hasCover ? (
							<img
								src={`/api/books/${book.id}/cover`}
								alt={book.title}
								className="h-full w-full object-cover"
								loading="lazy"
							/>
						) : null}
					</div>
				</Link>
				<div className="mt-3">
					<Link
						to="/books/$bookId"
						params={{ bookId: book.id }}
						className="no-underline"
					>
						<h2 className="line-clamp-2 text-sm font-semibold text-[var(--sea-ink)] hover:underline">
							{book.title}
						</h2>
					</Link>
					{authors.length > 0 ? (
						<p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
							{authors.map((author, index) => (
								<span key={`${book.id}-${author}`}>
									{index > 0 ? "、" : null}
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
					) : (
						<p className="mt-1 text-xs text-muted-foreground">未知作者</p>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
