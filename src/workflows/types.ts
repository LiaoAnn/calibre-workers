export interface SyncBookMetadataParams {
	bookId: string;
	triggeredByUserId?: string;
	reason?: "book-metadata-updated" | "manual";
}
