import {
	createFileRoute,
	Link,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { ArrowDownToLine, Loader2, Pencil, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import type { BookFileFormat } from "#/db/schema";
import { useConversionTasks } from "#/hooks/useConversionTasks";
import { getSessionFromMiddlewareFn } from "#/middleware/auth";
import { getBookByIdServerFn } from "#/server/books";

export const Route = createFileRoute("/books/$bookId")({
	beforeLoad: async () => {
		const session = await getSessionFromMiddlewareFn();

		if (!session?.user || session.user.deletedAt) {
			throw redirect({ to: "/login" });
		}

		if (session.user.status !== "active") {
			throw redirect({ to: "/pending-approval" });
		}
	},
	loader: async ({ params }) => ({
		book: await getBookByIdServerFn({
			data: {
				bookId: params.bookId,
			},
		}),
		session: await getSessionFromMiddlewareFn(),
	}),
	component: BookDetailPage,
});

function BookDetailPage() {
	const { book, session } = Route.useLoaderData();
	const router = useRouter();
	const conversionTargets = ["kepub", "azw3", "mobi"] as BookFileFormat[];

	const authors =
		book.authors
			?.split(",")
			.map((a) => a.trim())
			.filter(Boolean) ?? [];
	const pubYear = book.pubdate ? new Date(book.pubdate).getFullYear() : null;
	const description = book.comments[0]?.text;

	const existingFormats = new Set(
		book.files.map((f) => f.format.toLowerCase()),
	);
	const epubFiles = book.files.filter((f) => f.format.toLowerCase() === "epub");
	const canConvert = epubFiles.length > 0;

	const { activeTasks: activeConversionTasks, triggerConversion } =
		useConversionTasks({ bookId: book.id, limit: 200 });
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

	return (
		<main className="page-wrap px-4 py-12">
			<div className="mx-auto w-full max-w-4xl">
				<div className="flex flex-col gap-8 md:flex-row md:items-start">
					{/* Left column: cover + download + edit */}
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
										</a>
									</Button>
								))}
							</div>
						) : null}

						{session?.user && canConvert ? (
							<div className="mt-4 space-y-2">
								<p className="text-xs font-semibold uppercase tracking-wider text-[var(--sea-ink-soft)]">
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
						<div className="flex items-center justify-between gap-4">
							<h1 className="text-3xl font-bold leading-tight text-[var(--sea-ink)]">
								{book.title}
							</h1>
							{session?.user ? (
								<Button
									variant="outline"
									size="sm"
									asChild
									className="justify-start gap-2"
								>
									<Link to="/books/$bookId/edit" params={{ bookId: book.id }}>
										<Pencil />
										編輯 Metadata
									</Link>
								</Button>
							) : null}
						</div>

						{authors.length > 0 ? (
							<p className="mt-2 text-base text-[var(--sea-ink-soft)]">
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

						<dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
							<dt className="font-medium text-[var(--sea-ink)]">出版年份</dt>
							<dd className="text-[var(--sea-ink-soft)]">
								{pubYear ?? <span className="italic opacity-50">未設定</span>}
							</dd>

							<dt className="font-medium text-[var(--sea-ink)]">出版社</dt>
							<dd className="text-[var(--sea-ink-soft)]">
								{book.publisher ? (
									book.publisher.name
								) : (
									<span className="italic opacity-50">未設定</span>
								)}
							</dd>

							{book.series ? (
								<>
									<dt className="font-medium text-[var(--sea-ink)]">叢書</dt>
									<dd className="text-[var(--sea-ink-soft)]">
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
									<dt className="font-medium text-[var(--sea-ink)]">語言</dt>
									<dd className="text-[var(--sea-ink-soft)]">
										{book.language}
									</dd>
								</>
							) : null}

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
										<Badge key={tag.id} variant="secondary">
											{tag.name}
										</Badge>
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

				{description ? (
					<div className="mt-8 border-t border-[var(--line)] pt-6">
						<p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--sea-ink-soft)]">
							簡介
						</p>
						<p className="whitespace-pre-line text-sm leading-relaxed text-[var(--sea-ink-soft)]">
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
