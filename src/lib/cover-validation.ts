export const COVER_MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export const SUPPORTED_COVER_MIME_TYPES = [
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
	"image/gif",
] as const;

export const SUPPORTED_COVER_EXTENSIONS = [
	".jpg",
	".jpeg",
	".png",
	".webp",
	".gif",
] as const;

export const COVER_ACCEPT_MIME_TYPES = SUPPORTED_COVER_MIME_TYPES.join(",");

const supportedCoverMimeTypeSet = new Set<string>(SUPPORTED_COVER_MIME_TYPES);

interface CoverValidationInput {
	name: string;
	type?: string;
	size: number;
}

export type CoverValidationIssue =
	| "unsupported-type"
	| "empty-file"
	| "too-large";

const normalizeMimeType = (value?: string): string =>
	value?.split(";")[0]?.trim().toLowerCase() ?? "";

const isSupportedCoverFileType = (
	input: Pick<CoverValidationInput, "name" | "type">,
): boolean => {
	const lowerName = input.name.toLowerCase();
	const mimeType = normalizeMimeType(input.type);

	if (mimeType && supportedCoverMimeTypeSet.has(mimeType)) {
		return true;
	}

	return SUPPORTED_COVER_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
};

export const validateCoverFile = (
	input: CoverValidationInput,
): CoverValidationIssue | null => {
	if (!isSupportedCoverFileType(input)) {
		return "unsupported-type";
	}

	if (input.size <= 0) {
		return "empty-file";
	}

	if (input.size > COVER_MAX_UPLOAD_SIZE_BYTES) {
		return "too-large";
	}

	return null;
};
