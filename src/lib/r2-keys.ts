const sanitizePathSegment = (value: string) =>
	value
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, "_")
		.replace(/^_+|_+$/g, "") || "file";

export const r2Keys = {
	bookFile: (input: { bookId: string; fileName: string }) =>
		`books/${input.bookId}/${input.fileName}`,
	bookCover: (input: { bookId: string }) => `covers/${input.bookId}/cover`,
	bookCoverTemp: (input: { bookId: string; tempId: string }) =>
		`temp/covers/${input.bookId}/${input.tempId}`,
	bookUploadStaging: (input: {
		userId: string;
		taskId: string;
		fileName: string;
	}) =>
		`temp/uploads/${sanitizePathSegment(input.userId)}/${sanitizePathSegment(input.taskId)}/${sanitizePathSegment(input.fileName)}`,
} as const;
