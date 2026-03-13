import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Combobox } from "#/components/ui/combobox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import {
	searchAuthorsServerFn,
	searchIdentifierTypesServerFn,
	searchLanguagesServerFn,
	searchPublishersServerFn,
	searchSeriesServerFn,
	searchTagsServerFn,
} from "#/server/autocomplete";
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
	// Authors stored as comma-separated string in the database
	const [authorsStr, setAuthorsStr] = useState(book.authors ?? "");
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

	// Autocomplete queries with TanStack Query caching
	const { data: authorOptions = [] } = useQuery({
		queryKey: ["autocomplete", "authors"],
		queryFn: () =>
			searchAuthorsServerFn({ data: { query: "" } }).then((results) =>
				results.map((name) => ({ value: name, label: name })),
			),
		staleTime: 60_000,
	});

	const { data: tagOptions = [] } = useQuery({
		queryKey: ["autocomplete", "tags"],
		queryFn: () =>
			searchTagsServerFn({ data: { query: "" } }).then((results) =>
				results.map((name) => ({ value: name, label: name })),
			),
		staleTime: 60_000,
	});

	const { data: seriesOptions = [] } = useQuery({
		queryKey: ["autocomplete", "series"],
		queryFn: () =>
			searchSeriesServerFn({ data: { query: "" } }).then((results) =>
				results.map((name) => ({ value: name, label: name })),
			),
		staleTime: 60_000,
	});

	const { data: publisherOptions = [] } = useQuery({
		queryKey: ["autocomplete", "publishers"],
		queryFn: () =>
			searchPublishersServerFn({ data: { query: "" } }).then((results) =>
				results.map((name) => ({ value: name, label: name })),
			),
		staleTime: 60_000,
	});

	const { data: languageOptions = [] } = useQuery({
		queryKey: ["autocomplete", "languages"],
		queryFn: () =>
			searchLanguagesServerFn({ data: { query: "" } }).then((results) =>
				results.map((code) => ({ value: code, label: code })),
			),
		staleTime: 60_000,
	});

	const { data: identifierTypeOptions = [] } = useQuery({
		queryKey: ["autocomplete", "identifierTypes"],
		queryFn: () =>
			searchIdentifierTypesServerFn({
				data: { query: "" },
			}).then((results) =>
				results.map((type) => ({ value: type, label: type })),
			),
		staleTime: 60_000,
	});

	// Parse authors string to array for multi-select
	const authorsArray = authorsStr
		.split(",")
		.map((a) => a.trim())
		.filter(Boolean);
	const setAuthorsFromArray = (arr: string[]) => setAuthorsStr(arr.join(", "));

	// Parse tags string to array for multi-select
	const tagsArray = tagsStr
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	const setTagsFromArray = (arr: string[]) => setTagsStr(arr.join(", "));

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
						<Label>作者</Label>
						<Combobox
							options={authorOptions}
							value={authorsArray}
							onChange={(val) => setAuthorsFromArray(val as string[])}
							placeholder="選擇或輸入作者..."
							emptyText="沒有找到作者"
							multi
						/>
						<p className="text-xs text-muted-foreground">
							可輸入新作者名稱後按 Enter 新增
						</p>
					</div>

					{/* 標籤 */}
					<div className="space-y-2">
						<Label>標籤</Label>
						<Combobox
							options={tagOptions}
							value={tagsArray}
							onChange={(val) => setTagsFromArray(val as string[])}
							placeholder="選擇或輸入標籤..."
							emptyText="沒有找到標籤"
							multi
						/>
						<p className="text-xs text-muted-foreground">
							可輸入新標籤名稱後按 Enter 新增
						</p>
					</div>

					{/* 叢書 + 叢書編號 */}
					<div className="flex gap-3">
						<div className="flex-1 space-y-2">
							<Label>叢書</Label>
							<Combobox
								options={seriesOptions}
								value={series}
								onChange={(val) => setSeries(val as string)}
								placeholder="選擇或輸入叢書..."
								emptyText="沒有找到叢書"
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
						<Label>出版社</Label>
						<Combobox
							options={publisherOptions}
							value={publisher}
							onChange={(val) => setPublisher(val as string)}
							placeholder="選擇或輸入出版社..."
							emptyText="沒有找到出版社"
						/>
					</div>

					{/* 語言 */}
					<div className="space-y-2">
						<Label>語言</Label>
						<Combobox
							options={languageOptions}
							value={language}
							onChange={(val) => setLanguage(val as string)}
							placeholder="選擇或輸入語言代碼..."
							emptyText="沒有找到語言"
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
									<div className="w-32">
										<Combobox
											options={identifierTypeOptions}
											value={ident.type}
											onChange={(val) =>
												updateIdentifier(idx, "type", val as string)
											}
											placeholder="類型"
											emptyText="沒有找到類型"
										/>
									</div>
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
