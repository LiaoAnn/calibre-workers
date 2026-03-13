import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowDownToLine, Loader2, Pencil, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { getBookByIdServerFn } from "#/server/books";
import {
	getConversionJobServerFn,
	triggerConversionServerFn,
} from "#/server/conversions";

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
	const router = useRouter();

	// fileId → jobId for in-progress conversions
	const [pendingJobs, setPendingJobs] = useState<Map<string, string>>(
		new Map(),
	);

	const authors = book.authors.map((a) => a.author.name).join("、");
	const pubYear = book.pubdate ? new Date(book.pubdate).getFullYear() : null;
	const description = book.comments[0]?.text;

	const existingFormats = new Set(
		book.files.map((f) => f.format.toLowerCase()),
	);
	const epubFiles = book.files.filter((f) => f.format.toLowerCase() === "epub");
	const canConvertToKepub =
		epubFiles.length > 0 && !existingFormats.has("kepub");

	async function handleConvertToKepub(fileId: string) {
		const { jobId } = await triggerConversionServerFn({
			data: { bookId: book.id, fileId, targetFormat: "kepub" },
		});
		setPendingJobs((prev) => new Map(prev).set(fileId, jobId));
	}

	function handleJobDone(fileId: string) {
		setPendingJobs((prev) => {
			const next = new Map(prev);
			next.delete(fileId);
			return next;
		});
		router.invalidate();
	}

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

						{canConvertToKepub ? (
							<div className="mt-4 space-y-2">
								<p className="text-xs font-semibold uppercase tracking-wider text-[var(--sea-ink-soft)]">
									格式轉換
								</p>
								{epubFiles.map((file) => {
									const jobId = pendingJobs.get(file.id);
									return jobId ? (
										<ConversionJobTracker
											key={file.id}
											jobId={jobId}
											fileId={file.id}
											onDone={() => handleJobDone(file.id)}
											onFailed={(msg) => {
												setPendingJobs((prev) => {
													const next = new Map(prev);
													next.delete(file.id);
													return next;
												});
												console.error("Conversion failed:", msg);
											}}
										/>
									) : (
										<Button
											key={file.id}
											variant="outline"
											size="sm"
											className="w-full justify-start gap-2"
											onClick={() => handleConvertToKepub(file.id)}
										>
											<RefreshCw size={14} />
											轉換至 KEPUB
										</Button>
									);
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
						</div>

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

							{book.series.length > 0 ? (
								<>
									<dt className="font-medium text-[var(--sea-ink)]">叢書</dt>
									<dd className="text-[var(--sea-ink-soft)]">
										{book.series.map((s) => s.name).join("、")}
										{book.seriesIndex !== null &&
										book.seriesIndex !== undefined ? (
											<span className="ml-1 opacity-70">
												#{book.seriesIndex}
											</span>
										) : null}
									</dd>
								</>
							) : null}

							{book.languages.length > 0 ? (
								<>
									<dt className="font-medium text-[var(--sea-ink)]">語言</dt>
									<dd className="text-[var(--sea-ink-soft)]">
										{book.languages.map((l) => l.langCode).join("、")}
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
	jobId: string;
	fileId: string;
	onDone: () => void;
	onFailed: (errorMessage: string) => void;
}

function ConversionJobTracker({
	jobId,
	onDone,
	onFailed,
}: ConversionJobTrackerProps) {
	const { data } = useQuery({
		queryKey: ["conversion-job", jobId],
		queryFn: () => getConversionJobServerFn({ data: { jobId } }),
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			if (status === "done" || status === "failed") return false;
			return 3000;
		},
	});

	useEffect(() => {
		if (data?.status === "done") onDone();
		if (data?.status === "failed") onFailed(data.errorMessage ?? "轉換失敗");
	}, [data, onDone, onFailed]);

	const label = data?.status === "processing" ? "轉換中..." : "排隊中...";

	return (
		<Button
			variant="outline"
			size="sm"
			className="w-full justify-start gap-2 opacity-70"
			disabled
		>
			<Loader2 size={14} className="animate-spin" />
			{label}
		</Button>
	);
}
