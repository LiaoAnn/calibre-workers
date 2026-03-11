import { useState } from "react";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
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
			<div className="space-y-2">
				<Label htmlFor="epub-upload">EPUB 檔案</Label>
				<Input
					id="epub-upload"
					type="file"
					accept=".epub,application/epub+zip"
					required
					onChange={(event) => setFile(event.target.files?.[0] ?? null)}
				/>
			</div>

			{error ? (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}

			<Button type="submit" disabled={isSubmitting}>
				{isSubmitting ? "上傳中..." : "上傳並建立書籍"}
			</Button>
		</form>
	);
}
