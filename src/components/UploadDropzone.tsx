import { useState } from "react";
import { uploadBookServerFn } from "#/server/files";

interface UploadDropzoneProps {
	onUploaded: (bookId: string) => Promise<void>;
}

export default function UploadDropzone({ onUploaded }: UploadDropzoneProps) {
	const [file, setFile] = useState<File | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!file) {
			setError("請先選擇 EPUB 檔案");
			return;
		}

		setError(null);
		setIsSubmitting(true);

		try {
			const formData = new FormData();
			formData.set("file", file);

			const result = await uploadBookServerFn({ data: formData });

			await onUploaded(result.bookId);
		} catch (caughtError) {
			setError(
				caughtError instanceof Error
					? caughtError.message
					: "上傳失敗，請稍後再試",
			);
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<form className="mt-6 space-y-4" onSubmit={handleSubmit}>
			<label className="block text-sm font-medium text-[var(--sea-ink)]">
				EPUB 檔案
				<input
					type="file"
					accept=".epub,application/epub+zip"
					required
					onChange={(event) => setFile(event.target.files?.[0] ?? null)}
					className="mt-1.5 block w-full text-sm"
				/>
			</label>

			{error ? (
				<p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
					{error}
				</p>
			) : null}

			<button
				type="submit"
				disabled={isSubmitting}
				className="rounded-xl bg-[var(--lagoon-deep)] px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
			>
				{isSubmitting ? "上傳中..." : "上傳並建立書籍"}
			</button>
		</form>
	);
}
