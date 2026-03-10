export const r2Keys = {
	bookFile: (input: { bookId: string; fileName: string }) =>
		`books/${input.bookId}/${input.fileName}`,
	bookCover: (input: { bookId: string }) => `covers/${input.bookId}/cover`,
} as const;
