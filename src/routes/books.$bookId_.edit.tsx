import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { getBookByIdServerFn, updateBookServerFn } from "#/server/books";

export const Route = createFileRoute("/books/$bookId_/edit")({
	loader: ({ params }) =>
		getBookByIdServerFn({
			data: { bookId: params.bookId },
		}),
	component: EditBookPage,
});

type IdentifierEntry = { type: string; value: string };

function EditBookPage() {
	const book = Route.useLoaderData();
	const { bookId } = Route.useParams();
	const navigate = useNavigate();

	const [title, setTitle] = useState(book.title);
	// Multiple authors joined by ", " for display.
	// TODO: add individual author profile pages in the future
	const [authorsStr, setAuthorsStr] = useState(
		book.authors.map((a) => a.author.name).join(", "),
	);
	const [description, setDescription] = useState(book.comments[0]?.text ?? "");
	const [publisher, setPublisher] = useState(book.publishers[0]?.name ?? "");
	const [tagsStr, setTagsStr] = useState(
		book.tags.map((t) => t.name).join(", "),
	);
	const [language, setLanguage] = useState(book.languages[0]?.langCode ?? "");
	const [pubdate, setPubdate] = useState(
		book.pubdate ? new Date(book.pubdate).toISOString().split("T")[0] : "",
	);
	const [series, setSeries] = useState(book.series[0]?.name ?? "");
	const [seriesIndex, setSeriesIndex] = useState(
		book.seriesIndex !== null && book.seriesIndex !== undefined
			? String(book.seriesIndex)
			: "",
	);
	const [identifiers, setIdentifiers] = useState<IdentifierEntry[]>(
		book.identifiers.map((i) => ({ type: i.type, value: i.value })),
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSaving(true);
		setError(null);
		try {
			await updateBookServerFn({
				data: {
					bookId,
					title: title.trim() || book.title,
					authors: authorsStr
						.split(",")
						.map((a) => a.trim())
						.filter(Boolean),
					description: description.trim() || undefined,
					publisher: publisher.trim() || undefined,
					tags: tagsStr
						.split(",")
						.map((t) => t.trim())
						.filter(Boolean),
					language: language.trim() || undefined,
					pubdate: pubdate || undefined,
					series: series.trim() || undefined,
					// Clear seriesIndex when series is empty
					seriesIndex:
						seriesIndex !== "" && series.trim()
							? Number(seriesIndex)
							: undefined,
					identifiers: identifiers.filter(
						(i) => i.type.trim() && i.value.trim(),
					),
				},
			});
			navigate({ to: "/books/$bookId", params: { bookId } });
		} catch (err) {
			setError(err instanceof Error ? err.message : "儲存失敗，請稍後再試");
			setSaving(false);
		}
	};

	const addIdentifier = () =>
		setIdentifiers((prev) => [...prev, { type: "", value: "" }]);

	const removeIdentifier = (idx: number) =>
		setIdentifiers((prev) => prev.filter((_, i) => i !== idx));

	const updateIdentifier = (
		idx: number,
		field: keyof IdentifierEntry,
		val: string,
	) =>
		setIdentifiers((prev) =>
			prev.map((item, i) => (i === idx ? { ...item, [field]: val } : item)),
		);

	return (
		<main className="page-wrap px-4 py-12">
			<div className="mx-auto w-full max-w-2xl">
				<div className="mb-6 flex items-center gap-4">
					<Button variant="link" asChild className="h-auto p-0 text-sm">
						<Link to="/books/$bookId" params={{ bookId }}>
							← 返回書本詳情
						</Link>
					</Button>
					<h1 className="text-2xl font-bold text-[var(--sea-ink)]">
						編輯 Metadata
					</h1>
				</div>

				<form onSubmit={handleSubmit} className="space-y-5">
					{/* 書名 */}
					<div className="space-y-2">
						<Label htmlFor="edit-title">書名</Label>
						<Input
							id="edit-title"
							type="text"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							required
						/>
					</div>

					{/* 作者（多作者，逗號分隔） */}
					<div className="space-y-2">
						<Label htmlFor="edit-authors">
							作者
							<span className="ml-1 font-normal text-muted-foreground">
								（多位作者以逗號分隔）
							</span>
						</Label>
						{/* TODO: add individual author profile pages in the future */}
						<Input
							id="edit-authors"
							type="text"
							value={authorsStr}
							onChange={(e) => setAuthorsStr(e.target.value)}
							placeholder="例：作者一, 作者二"
						/>
					</div>

					{/* 標籤 */}
					<div className="space-y-2">
						<Label htmlFor="edit-tags">
							標籤
							<span className="ml-1 font-normal text-muted-foreground">
								（多個標籤以逗號分隔）
							</span>
						</Label>
						<Input
							id="edit-tags"
							type="text"
							value={tagsStr}
							onChange={(e) => setTagsStr(e.target.value)}
							placeholder="例：科幻, 小說"
						/>
					</div>

					{/* 叢書 + 叢書編號 */}
					<div className="flex gap-3">
						<div className="flex-1 space-y-2">
							<Label htmlFor="edit-series">叢書</Label>
							<Input
								id="edit-series"
								type="text"
								value={series}
								onChange={(e) => setSeries(e.target.value)}
							/>
						</div>
						<div className="w-28 space-y-2">
							<Label htmlFor="edit-series-index">叢書編號</Label>
							<Input
								id="edit-series-index"
								type="number"
								value={seriesIndex}
								onChange={(e) => setSeriesIndex(e.target.value)}
								min={0}
								step={0.1}
							/>
						</div>
					</div>

					{/* 出版日期 */}
					<div className="space-y-2">
						<Label htmlFor="edit-pubdate">出版日期</Label>
						<Input
							id="edit-pubdate"
							type="date"
							value={pubdate}
							onChange={(e) => setPubdate(e.target.value)}
						/>
					</div>

					{/* 出版社 */}
					<div className="space-y-2">
						<Label htmlFor="edit-publisher">出版社</Label>
						<Input
							id="edit-publisher"
							type="text"
							value={publisher}
							onChange={(e) => setPublisher(e.target.value)}
						/>
					</div>

					{/* 語言 */}
					<div className="space-y-2">
						<Label htmlFor="edit-language">語言</Label>
						<Input
							id="edit-language"
							type="text"
							value={language}
							onChange={(e) => setLanguage(e.target.value)}
							placeholder="例：zh-TW, en"
						/>
					</div>

					{/* TODO: rating（1–10，UI 顯示為 0–5 星）— 需要處理 ratings 關聯表 */}

					{/* 簡介 */}
					<div className="space-y-2">
						<Label htmlFor="edit-description">簡介</Label>
						<Textarea
							id="edit-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={6}
						/>
					</div>

					{/* 識別碼（動態列表） */}
					<div>
						<div className="mb-2 flex items-center justify-between">
							<p className="text-sm font-medium">識別碼</p>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={addIdentifier}
							>
								＋ 添加識別碼
							</Button>
						</div>
						<div className="space-y-2">
							{identifiers.map((ident, idx) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: order is stable within this form
								<div key={idx} className="flex gap-2">
									<Input
										type="text"
										value={ident.type}
										onChange={(e) =>
											updateIdentifier(idx, "type", e.target.value)
										}
										placeholder="類型（如 isbn）"
										className="w-32"
									/>
									<Input
										type="text"
										value={ident.value}
										onChange={(e) =>
											updateIdentifier(idx, "value", e.target.value)
										}
										placeholder="值"
									/>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => removeIdentifier(idx)}
										className="text-muted-foreground hover:text-destructive"
									>
										移除
									</Button>
								</div>
							))}
						</div>
					</div>

					{error ? (
						<Alert variant="destructive">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					) : null}

					<div className="flex gap-3 pt-2">
						<Button type="submit" disabled={saving}>
							{saving ? "儲存中…" : "儲存"}
						</Button>
						<Button variant="outline" asChild>
							<Link to="/books/$bookId" params={{ bookId }}>
								取消
							</Link>
						</Button>
					</div>
				</form>
			</div>
		</main>
	);
}
