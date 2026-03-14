import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "#/components/ui/card";
import type { books } from "#/db/schema";

interface BookCardProps {
	book: typeof books.$inferSelect;
}

export default function BookCard({ book }: BookCardProps) {
	return (
		<Link
			to="/books/$bookId"
			params={{ bookId: book.id }}
			className="no-underline"
		>
			<Card className="group cursor-pointer transition hover:shadow-md py-0">
				<CardContent className="p-4">
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
					<div className="mt-3">
						<h2 className="line-clamp-2 text-sm font-semibold text-[var(--sea-ink)]">
							{book.title}
						</h2>
						<p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
							{book.authors ?? "未知作者"}
						</p>
					</div>
				</CardContent>
			</Card>
		</Link>
	);
}
