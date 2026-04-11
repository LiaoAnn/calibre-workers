export const BOOK_MAX_UPLOAD_SIZE_BYTES = 256 * 1024 * 1024; // 256MB

export type BookUploadValidationIssue =
	| "unsupported-type"
	| "empty-file"
	| "too-large";

interface BookUploadValidationInput {
	name: string;
	type?: string;
	size: number;
}

const SUPPORTED_BOOK_UPLOAD_EXTENSIONS = [".epub"] as const;
const SUPPORTED_BOOK_UPLOAD_MIME_TYPES = ["application/epub+zip"] as const;

const supportedBookUploadMimeTypeSet = new Set<string>(
	SUPPORTED_BOOK_UPLOAD_MIME_TYPES,
);

const normalizeMimeType = (value?: string): string =>
	value?.split(";")[0]?.trim().toLowerCase() ?? "";

export const isSupportedBookUploadFileType = (
	input: Pick<BookUploadValidationInput, "name" | "type">,
): boolean => {
	const lowerName = input.name.toLowerCase();
	const mimeType = normalizeMimeType(input.type);

	if (mimeType && supportedBookUploadMimeTypeSet.has(mimeType)) {
		return true;
	}

	return SUPPORTED_BOOK_UPLOAD_EXTENSIONS.some((ext) =>
		lowerName.endsWith(ext),
	);
};

export const validateBookUploadFile = (
	input: BookUploadValidationInput,
): BookUploadValidationIssue | null => {
	if (!isSupportedBookUploadFileType(input)) {
		return "unsupported-type";
	}

	if (input.size <= 0) {
		return "empty-file";
	}

	if (input.size > BOOK_MAX_UPLOAD_SIZE_BYTES) {
		return "too-large";
	}

	return null;
};
