import "@tanstack/react-start/server-only";

import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { Data, Effect } from "effect";
import * as schema from "#/db/schema";
import { DatabaseContext } from "#/layers/DatabaseLayer";
import {
	type KoboAuthResponse,
	type KoboBookEntitlement,
	type KoboBookMetadata,
	KoboBookNotFound,
	type KoboDownloadUrl,
	KoboFileNotFound,
	type KoboLocalSyncItem,
	type KoboReadingStateResponse,
	KoboTagAccessDenied,
	KoboTagInvalidPayload,
	KoboTagNotFound,
	type KoboTagPayload,
	parseReadingStatePayload,
} from "#/lib/kobo.server";
import { createConversionJob } from "#/services/ConversionService";

const SYNC_TOKEN_HEADER = "x-kobo-synctoken";
const SYNC_TOKEN_VERSION = "1-1-0";
const SYNC_ITEM_LIMIT = 100;
const MAX_LOG_BODY_BYTES = 64 * 1024;
const KOBO_DEFAULT_CATEGORY_ID = "00000000-0000-0000-0000-000000000001";

// Kobo sync is a hybrid of local catalog + optional upstream store pass-through.
// This service keeps protocol-specific mapping isolated from route handlers.

class KoboAuthTokenNotFound extends Data.TaggedError("KoboAuthTokenNotFound")<{
	readonly token: string;
}> {}

export interface KoboAuthTokenContext {
	authTokenId: string;
	token: string;
	userId: string;
}

const KOBO_ENTITLEMENT_ORIGIN_CATEGORY = "Imported" as const;
const KOBO_ENTITLEMENT_STATUS = "Active" as const;
const KOBO_TAG_TYPE_USER_TAG = "UserTag" as const;
const KOBO_TAG_ITEM_TYPE_PRODUCT_REVISION = "ProductRevisionTagItem" as const;

interface KoboSyncToken {
	rawKoboStoreToken: string;
	booksLastModified: Date;
	booksLastCreated: Date;
	archiveLastModified: Date;
	readingStateLastModified: Date;
	tagsLastModified: Date;
}

interface KoboPendingConversion {
	bookId: string;
	sourceFileId: string;
}

interface KoboLocalSyncResult {
	syncResults: KoboLocalSyncItem[];
	syncToken: KoboSyncToken;
	continueSync: boolean;
	pendingConversions: KoboPendingConversion[];
}

interface KoboDownloadFileResult {
	book: typeof schema.books.$inferSelect;
	file: typeof schema.bookFiles.$inferSelect;
	fallbackToEpub: boolean;
	conversionSourceFileId: string | null;
}

interface BodySerializablePayload {
	body: ReadableStream | null;
	headers: Headers;
	formData(): Promise<FormData>;
	arrayBuffer(): Promise<ArrayBuffer>;
}

const now = () => new Date();

const toKoboTimestamp = (value: Date | number | null | undefined) => {
	const date =
		value instanceof Date
			? value
			: typeof value === "number"
				? new Date(value)
				: new Date();
	return date.toISOString().replace(/\.\d{3}Z$/, "Z");
};

const toEpochSeconds = (value: Date) => Math.floor(value.getTime() / 1000);

const fromEpochSeconds = (value: unknown) => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return new Date(0);
	}

	return new Date(value * 1000);
};

const randomToken = () => {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
};

const toBase64 = (bytes: Uint8Array) => {
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
};

const parseJsonSafe = (text: string): unknown | undefined => {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
};

const isJsonContentType = (contentType: string): boolean =>
	contentType.includes("application/json") || contentType.includes("+json");

const isFormContentType = (contentType: string): boolean =>
	contentType.includes("multipart/form-data") ||
	contentType.includes("application/x-www-form-urlencoded");

const isTextContentType = (contentType: string): boolean =>
	contentType.startsWith("text/") ||
	contentType.includes("application/xml") ||
	contentType.includes("application/xhtml+xml") ||
	contentType.includes("application/javascript") ||
	contentType.includes("application/x-javascript") ||
	contentType.includes("application/ecmascript") ||
	contentType.includes("image/svg+xml");

const appendFormValue = (
	target: Record<string, unknown>,
	key: string,
	value: unknown,
) => {
	const existing = target[key];
	if (existing === undefined) {
		target[key] = value;
		return;
	}

	if (Array.isArray(existing)) {
		existing.push(value);
		return;
	}

	target[key] = [existing, value];
};

const headersToRecord = (headers: Headers): Record<string, string> => {
	const out: Record<string, string> = {};
	headers.forEach((value, key) => {
		out[key] = value;
	});
	return out;
};

const decodeSyncTokenPayload = (raw: string): unknown => {
	const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
	const jsonText = atob(padded);
	return JSON.parse(jsonText) as unknown;
};

const clampBodyBytes = (bytes: Uint8Array) => {
	if (bytes.byteLength <= MAX_LOG_BODY_BYTES) {
		return { bytes, truncated: false };
	}

	return {
		bytes: bytes.subarray(0, MAX_LOG_BODY_BYTES),
		truncated: true,
	};
};

const getStatusOrDefault = (
	status: string | null | undefined,
): schema.KoboReadStatus => {
	if (
		status === "Reading" ||
		status === "Finished" ||
		status === "ReadyToRead"
	) {
		return status;
	}
	// default to ReadyToRead
	return "ReadyToRead";
};

const normalizeProgressValue = (value: number): number =>
	Number.isInteger(value) ? Math.trunc(value) : value;

const isEditableShelfRole = (role: schema.ShelfMemberRole): boolean =>
	role === "owner" || role === "editor";

const encodeSyncToken = (syncToken: KoboSyncToken) => {
	const payload = {
		version: SYNC_TOKEN_VERSION,
		data: {
			raw_kobo_store_token: syncToken.rawKoboStoreToken,
			books_last_modified: toEpochSeconds(syncToken.booksLastModified),
			books_last_created: toEpochSeconds(syncToken.booksLastCreated),
			archive_last_modified: toEpochSeconds(syncToken.archiveLastModified),
			reading_state_last_modified: toEpochSeconds(
				syncToken.readingStateLastModified,
			),
			tags_last_modified: toEpochSeconds(syncToken.tagsLastModified),
		},
	};

	return btoa(JSON.stringify(payload));
};

const parseSyncToken = (rawHeader: string | null): KoboSyncToken => {
	const defaults: KoboSyncToken = {
		rawKoboStoreToken: "",
		booksLastModified: new Date(0),
		booksLastCreated: new Date(0),
		archiveLastModified: new Date(0),
		readingStateLastModified: new Date(0),
		tagsLastModified: new Date(0),
	};

	if (!rawHeader) {
		return defaults;
	}

	if (rawHeader.includes(".")) {
		return {
			...defaults,
			rawKoboStoreToken: rawHeader,
		};
	}

	try {
		const decoded = decodeSyncTokenPayload(rawHeader) as {
			data?: {
				raw_kobo_store_token?: string;
				books_last_modified?: number;
				books_last_created?: number;
				archive_last_modified?: number;
				reading_state_last_modified?: number;
				tags_last_modified?: number;
			};
		};
		const data = decoded.data;
		if (!data) {
			return defaults;
		}

		return {
			rawKoboStoreToken:
				typeof data.raw_kobo_store_token === "string"
					? data.raw_kobo_store_token
					: "",
			booksLastModified: fromEpochSeconds(data.books_last_modified),
			booksLastCreated: fromEpochSeconds(data.books_last_created),
			archiveLastModified: fromEpochSeconds(data.archive_last_modified),
			readingStateLastModified: fromEpochSeconds(
				data.reading_state_last_modified,
			),
			tagsLastModified: fromEpochSeconds(data.tags_last_modified),
		};
	} catch {
		return defaults;
	}
};

// Keep Kobo download path consistent with Calibre-Web's token-scoped download URL.
const buildDownloadUrl = ({
	origin,
	token,
	bookId,
	bookFormat,
}: {
	origin: string;
	token: string;
	bookId: string;
	bookFormat: string;
}) => {
	const encodedBookId = encodeURIComponent(bookId);
	const encodedBookFormat = encodeURIComponent(bookFormat.toLowerCase());
	const encodedToken = encodeURIComponent(token);
	return `${origin}/api/kobo/${encodedToken}/download/${encodedBookId}/${encodedBookFormat}`;
};

const buildEntitlement = ({
	book,
	archived,
}: {
	book: {
		uuid: string;
		timestamp: Date;
		lastModified: Date;
	};
	archived: boolean;
}): KoboBookEntitlement => ({
	Accessibility: "Full",
	ActivePeriod: { From: toKoboTimestamp(now()) },
	Created: toKoboTimestamp(book.timestamp),
	CrossRevisionId: book.uuid,
	Id: book.uuid,
	IsRemoved: archived,
	IsHiddenFromArchive: false,
	IsLocked: false,
	LastModified: toKoboTimestamp(book.lastModified),
	OriginCategory: KOBO_ENTITLEMENT_ORIGIN_CATEGORY,
	RevisionId: book.uuid,
	Status: KOBO_ENTITLEMENT_STATUS,
});

const buildMetadata = ({
	book,
	description,
	publisher,
	series,
	downloadUrls,
}: {
	book: {
		uuid: string;
		title: string;
		authors: string | null;
		language: string | null;
		pubdate: Date | null;
		timestamp: Date;
	};
	description: string | null;
	publisher: string | null;
	series?: {
		id: string;
		name: string;
		index: number;
	};
	downloadUrls: KoboDownloadUrl[];
}): KoboBookMetadata => {
	const contributors = (book.authors || "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	const contributorRoles = contributors.map((name) => ({ Name: name }));
	const hasContributorRoles = contributorRoles.length > 0;

	return {
		Categories: [KOBO_DEFAULT_CATEGORY_ID],
		CoverImageId: book.uuid,
		CrossRevisionId: book.uuid,
		CurrentDisplayPrice: {
			CurrencyCode: "USD",
			TotalAmount: 0,
		},
		CurrentLoveDisplayPrice: {
			TotalAmount: 0,
		},
		EntitlementId: book.uuid,
		ExternalIds: [],
		Genre: KOBO_DEFAULT_CATEGORY_ID,
		IsEligibleForKoboLove: false,
		RevisionId: book.uuid,
		WorkId: book.uuid,
		Title: book.title,
		Description: description,
		Language: book.language ?? "en",
		PublicationDate: toKoboTimestamp(book.pubdate ?? book.timestamp),
		DownloadUrls: downloadUrls,
		Contributors: contributors.length > 0 ? contributors : null,
		...(hasContributorRoles ? { ContributorRoles: contributorRoles } : {}),
		PhoneticPronunciations: {},
		Publisher: {
			Imprint: "",
			Name: publisher,
		},
		...(series
			? {
					Series: {
						Name: series.name,
						Number: Number.isInteger(series.index)
							? series.index
							: Math.trunc(series.index),
						NumberFloat: series.index,
						Id: series.id,
					},
				}
			: {}),
		IsSocialEnabled: true,
		IsInternetArchive: false,
		IsPreOrder: false,
	};
};

const buildTagPayload = ({
	shelf,
	bookUuids,
}: {
	shelf: {
		id: string;
		name: string;
		createdAt: Date;
		updatedAt: Date;
	};
	bookUuids: string[];
}): KoboTagPayload => ({
	Tag: {
		Created: toKoboTimestamp(shelf.createdAt),
		Id: shelf.id,
		Items: bookUuids.map((bookUuid) => ({
			RevisionId: bookUuid,
			Type: KOBO_TAG_ITEM_TYPE_PRODUCT_REVISION,
		})),
		LastModified: toKoboTimestamp(shelf.updatedAt),
		Name: shelf.name,
		Type: KOBO_TAG_TYPE_USER_TAG,
	},
});

const getKoboReadingStateResponse = ({
	book,
	state,
	bookmark,
	statistics,
}: {
	book: {
		uuid: string;
		timestamp: Date;
	};
	state: typeof schema.koboReadingStates.$inferSelect;
	bookmark: typeof schema.koboBookmarks.$inferSelect | null;
	statistics: typeof schema.koboStatistics.$inferSelect | null;
}): KoboReadingStateResponse => {
	const currentBookmark = (() => {
		if (!bookmark) {
			return { LastModified: toKoboTimestamp(state.lastModified) };
		}

		const payload: {
			LastModified: string;
			ProgressPercent?: number;
			ContentSourceProgressPercent?: number;
			Location?: {
				Value: string;
				Type: string | null;
				Source: string | null;
			};
		} = {
			LastModified: toKoboTimestamp(bookmark.lastModified),
		};

		if (typeof bookmark.progressPercent === "number") {
			payload.ProgressPercent = normalizeProgressValue(
				bookmark.progressPercent,
			);
		}

		if (typeof bookmark.contentSourceProgressPercent === "number") {
			payload.ContentSourceProgressPercent = normalizeProgressValue(
				bookmark.contentSourceProgressPercent,
			);
		}

		if (bookmark.locationValue) {
			payload.Location = {
				Value: bookmark.locationValue,
				Type: bookmark.locationType,
				Source: bookmark.locationSource,
			};
		}

		return payload;
	})();

	const statusInfo = {
		LastModified: toKoboTimestamp(state.lastModified),
		Status: state.status,
		TimesStartedReading: state.timesStartedReading,
		LastTimeStartedReading: state.lastTimeStartedReading
			? toKoboTimestamp(state.lastTimeStartedReading)
			: undefined,
	};

	const statisticsPayload = (() => {
		if (!statistics) {
			return {
				LastModified: toKoboTimestamp(state.lastModified),
			};
		}

		const payload: {
			LastModified: string;
			SpentReadingMinutes?: number;
			RemainingTimeMinutes?: number;
		} = {
			LastModified: toKoboTimestamp(statistics.lastModified),
		};

		if (typeof statistics.spentReadingMinutes === "number") {
			payload.SpentReadingMinutes = statistics.spentReadingMinutes;
		}

		if (typeof statistics.remainingTimeMinutes === "number") {
			payload.RemainingTimeMinutes = statistics.remainingTimeMinutes;
		}

		return payload;
	})();

	return {
		EntitlementId: book.uuid,
		Created: toKoboTimestamp(book.timestamp),
		LastModified: toKoboTimestamp(state.lastModified),
		PriorityTimestamp: toKoboTimestamp(state.priorityTimestamp),
		StatusInfo: statusInfo,
		Statistics: statisticsPayload,
		CurrentBookmark: currentBookmark,
	};
};

export const serializeBody = async (
	payload: BodySerializablePayload,
): Promise<schema.KoboLoggedBody> => {
	if (!payload.body) {
		return { type: "empty" };
	}

	const contentType = (payload.headers.get("content-type") ?? "").toLowerCase();

	if (isFormContentType(contentType)) {
		const formData = await payload.formData();
		const form: Record<string, unknown> = {};

		for (const [key, value] of formData.entries()) {
			if (typeof value === "string") {
				appendFormValue(form, key, value);
				continue;
			}

			const raw = new Uint8Array(await value.arrayBuffer());
			const { bytes, truncated } = clampBodyBytes(raw);
			appendFormValue(form, key, {
				kind: "file",
				name: value.name,
				contentType: value.type || "application/octet-stream",
				size: value.size,
				encoding: "base64",
				data: toBase64(bytes),
				truncated,
			});
		}

		return { type: "form", value: form };
	}

	const raw = new Uint8Array(await payload.arrayBuffer());
	if (raw.byteLength === 0) {
		return { type: "empty" };
	}

	const { bytes, truncated } = clampBodyBytes(raw);
	const text = new TextDecoder().decode(bytes);

	if (isJsonContentType(contentType) && !truncated) {
		const parsed = parseJsonSafe(text);
		if (parsed !== undefined) {
			return { type: "json", value: parsed };
		}
	}

	if (isTextContentType(contentType)) {
		return {
			type: "text",
			contentType: contentType || "text/plain",
			value: text,
			truncated,
		};
	}

	return {
		type: "binary",
		contentType: contentType || "application/octet-stream",
		encoding: "base64",
		value: toBase64(bytes),
		truncated,
	};
};

export const persistKoboApiLog = ({
	authTokenId,
	method,
	requestUrl,
	isHandledInternally,
	requestHeaders,
	requestBody,
	response,
	responseBody,
}: {
	authTokenId: string | null;
	method: string;
	requestUrl: URL;
	isHandledInternally: boolean;
	requestHeaders: Headers;
	requestBody: schema.KoboLoggedBody;
	response: Response;
	responseBody: schema.KoboLoggedBody;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		yield* database.insert(schema.koboApiLogs).values({
			id: crypto.randomUUID(),
			authTokenId,
			method,
			path: requestUrl.pathname,
			query: requestUrl.search || null,
			isHandledInternally,
			requestHeaders: headersToRecord(requestHeaders),
			requestBody,
			responseStatus: response.status,
			responseHeaders: headersToRecord(response.headers),
			responseBody,
		});
	});

export const createKoboAuthToken = (userId: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const tokenRecord = {
			id: crypto.randomUUID(),
			token: randomToken(),
			userId,
		};

		yield* database
			.update(schema.koboAuthTokens)
			.set({ revokedAt: now() })
			.where(
				and(
					eq(schema.koboAuthTokens.userId, userId),
					isNull(schema.koboAuthTokens.revokedAt),
				),
			);

		yield* database.insert(schema.koboAuthTokens).values(tokenRecord);
		return tokenRecord;
	});

export const revokeKoboAuthToken = ({
	userId,
	tokenId,
}: {
	userId: string;
	tokenId?: string;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const whereClause = tokenId
			? and(
					eq(schema.koboAuthTokens.userId, userId),
					eq(schema.koboAuthTokens.id, tokenId),
					isNull(schema.koboAuthTokens.revokedAt),
				)
			: and(
					eq(schema.koboAuthTokens.userId, userId),
					isNull(schema.koboAuthTokens.revokedAt),
				);

		yield* database
			.update(schema.koboAuthTokens)
			.set({ revokedAt: now() })
			.where(whereClause);
		return { success: true as const };
	});

export const listKoboAuthTokensForUser = (userId: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		return yield* database
			.select({
				id: schema.koboAuthTokens.id,
				token: schema.koboAuthTokens.token,
				revokedAt: schema.koboAuthTokens.revokedAt,
				createdAt: schema.koboAuthTokens.createdAt,
				updatedAt: schema.koboAuthTokens.updatedAt,
			})
			.from(schema.koboAuthTokens)
			.where(eq(schema.koboAuthTokens.userId, userId))
			.orderBy(desc(schema.koboAuthTokens.createdAt));
	});

export const resolveKoboAuthToken = (token: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const rows = yield* database
			.select({
				authTokenId: schema.koboAuthTokens.id,
				token: schema.koboAuthTokens.token,
				userId: schema.koboAuthTokens.userId,
			})
			.from(schema.koboAuthTokens)
			.where(
				and(
					eq(schema.koboAuthTokens.token, token),
					isNull(schema.koboAuthTokens.revokedAt),
				),
			)
			.limit(1);

		const authToken = rows[0];
		if (!authToken) {
			return yield* Effect.fail(new KoboAuthTokenNotFound({ token }));
		}

		return authToken satisfies KoboAuthTokenContext;
	});

export const parseKoboSyncTokenFromHeaders = (headers: Headers) =>
	parseSyncToken(headers.get(SYNC_TOKEN_HEADER));

export const setSyncTokenHeader = (
	headers: Headers,
	syncToken: KoboSyncToken,
) => {
	headers.set(SYNC_TOKEN_HEADER, encodeSyncToken(syncToken));
};

export const buildInitializationResources = ({
	origin,
	token,
	upstreamResources,
}: {
	origin: string;
	token: string;
	upstreamResources?: Record<string, unknown>;
}) => {
	const base = `${origin}/api/kobo/${token}`;
	return {
		...(upstreamResources ?? {}),
		library_sync: `${base}/v1/library/sync`,
		library_metadata: `${base}/v1/library/{Ids}/metadata`,
		reading_state: `${base}/v1/library/{Ids}/state`,
		tags: `${base}/v1/library/tags`,
		tag_items: `${base}/v1/library/tags/{TagId}/items`,
		delete_tag_items: `${base}/v1/library/tags/{TagId}/items/delete`,
		device_auth: `${base}/v1/auth/device`,
		device_refresh: `${base}/v1/auth/refresh`,
		image_host: origin,
		image_url_template: `${base}/{ImageId}/{Width}/{Height}/false/image.jpg`,
		image_url_quality_template: `${base}/{ImageId}/{Width}/{Height}/{Quality}/{IsGreyscale}/image.jpg`,
	};
};

export const buildLocalLibrarySync = ({
	userId,
	token,
	origin,
	syncToken,
}: {
	userId: string;
	token: string;
	origin: string;
	syncToken: KoboSyncToken;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		// Only shelves explicitly enabled by this member are included in Kobo sync.
		const enabledShelves = yield* database
			.select({
				id: schema.shelves.id,
				name: schema.shelves.name,
				createdAt: schema.shelves.createdAt,
				updatedAt: schema.shelves.updatedAt,
			})
			.from(schema.shelfMembers)
			.innerJoin(
				schema.shelves,
				eq(schema.shelves.id, schema.shelfMembers.shelfId),
			)
			.where(
				and(
					eq(schema.shelfMembers.userId, userId),
					eq(schema.shelfMembers.enableKoboSync, true),
					isNull(schema.shelves.deletedAt),
				),
			);

		const shelfIds = enabledShelves.map((shelf) => shelf.id);
		const shelfBookRows =
			shelfIds.length > 0
				? yield* database
						.select({
							shelfId: schema.shelfBooks.shelfId,
							bookId: schema.shelfBooks.bookId,
							addedAt: schema.shelfBooks.addedAt,
						})
						.from(schema.shelfBooks)
						.where(inArray(schema.shelfBooks.shelfId, shelfIds))
				: [];

		const activeBookIds = [...new Set(shelfBookRows.map((row) => row.bookId))];
		const syncedBookRows = yield* database
			.select({ bookId: schema.koboSyncedBooks.bookId })
			.from(schema.koboSyncedBooks)
			.where(eq(schema.koboSyncedBooks.userId, userId));

		const syncedBookIds = [...new Set(syncedBookRows.map((row) => row.bookId))];
		const activeBookIdSet = new Set(activeBookIds);
		const orphanedSyncedBookIds = syncedBookIds.filter(
			(bookId) => !activeBookIdSet.has(bookId),
		);
		const orphanedSyncedBookIdSet = new Set(orphanedSyncedBookIds);
		const syncScopeBookIds = [
			...new Set([...activeBookIds, ...orphanedSyncedBookIds]),
		];
		const books =
			syncScopeBookIds.length > 0
				? yield* database
						.select({
							id: schema.books.id,
							uuid: schema.books.uuid,
							title: schema.books.title,
							authors: schema.books.authors,
							timestamp: schema.books.timestamp,
							lastModified: schema.books.lastModified,
							pubdate: schema.books.pubdate,
							language: schema.books.language,
							seriesId: schema.series.id,
							seriesName: schema.series.name,
							seriesIndex: schema.books.seriesIndex,
							publisherName: schema.publishers.name,
						})
						.from(schema.books)
						.leftJoin(
							schema.series,
							eq(schema.series.id, schema.books.seriesId),
						)
						.leftJoin(
							schema.publishers,
							eq(schema.publishers.id, schema.books.publisherId),
						)
						.where(inArray(schema.books.id, syncScopeBookIds))
				: [];

		const comments =
			syncScopeBookIds.length > 0
				? yield* database
						.select({
							bookId: schema.comments.bookId,
							text: schema.comments.text,
						})
						.from(schema.comments)
						.where(inArray(schema.comments.bookId, syncScopeBookIds))
				: [];

		const files =
			syncScopeBookIds.length > 0
				? yield* database
						.select({
							id: schema.bookFiles.id,
							bookId: schema.bookFiles.bookId,
							format: schema.bookFiles.format,
							size: schema.bookFiles.size,
						})
						.from(schema.bookFiles)
						.where(
							and(
								inArray(schema.bookFiles.bookId, syncScopeBookIds),
								inArray(schema.bookFiles.format, ["epub", "kepub"]),
							),
						)
				: [];

		const archivedBookRows =
			syncScopeBookIds.length > 0
				? yield* database
						.select({
							bookId: schema.archivedBooks.bookId,
							isArchived: schema.archivedBooks.isArchived,
							lastModified: schema.archivedBooks.lastModified,
						})
						.from(schema.archivedBooks)
						.where(
							and(
								eq(schema.archivedBooks.userId, userId),
								inArray(schema.archivedBooks.bookId, syncScopeBookIds),
							),
						)
				: [];

		const readingStates =
			syncScopeBookIds.length > 0
				? yield* database
						.select({
							id: schema.koboReadingStates.id,
							bookId: schema.koboReadingStates.bookId,
							status: schema.koboReadingStates.status,
							lastTimeStartedReading:
								schema.koboReadingStates.lastTimeStartedReading,
							timesStartedReading: schema.koboReadingStates.timesStartedReading,
							lastModified: schema.koboReadingStates.lastModified,
							priorityTimestamp: schema.koboReadingStates.priorityTimestamp,
							bookmarkLastModified: schema.koboBookmarks.lastModified,
							locationSource: schema.koboBookmarks.locationSource,
							locationType: schema.koboBookmarks.locationType,
							locationValue: schema.koboBookmarks.locationValue,
							progressPercent: schema.koboBookmarks.progressPercent,
							contentSourceProgressPercent:
								schema.koboBookmarks.contentSourceProgressPercent,
							statisticsLastModified: schema.koboStatistics.lastModified,
							remainingTimeMinutes: schema.koboStatistics.remainingTimeMinutes,
							spentReadingMinutes: schema.koboStatistics.spentReadingMinutes,
						})
						.from(schema.koboReadingStates)
						.leftJoin(
							schema.koboBookmarks,
							eq(
								schema.koboBookmarks.koboReadingStateId,
								schema.koboReadingStates.id,
							),
						)
						.leftJoin(
							schema.koboStatistics,
							eq(
								schema.koboStatistics.koboReadingStateId,
								schema.koboReadingStates.id,
							),
						)
						.where(
							and(
								eq(schema.koboReadingStates.userId, userId),
								inArray(schema.koboReadingStates.bookId, syncScopeBookIds),
							),
						)
				: [];

		const commentByBookId = new Map<string, string>();
		for (const comment of comments) {
			if (!commentByBookId.has(comment.bookId)) {
				commentByBookId.set(comment.bookId, comment.text);
			}
		}

		const filesByBookId = new Map<string, typeof files>();
		for (const file of files) {
			const list = filesByBookId.get(file.bookId) ?? [];
			list.push(file);
			filesByBookId.set(file.bookId, list);
		}

		const syncedBookSet = new Set(syncedBookRows.map((row) => row.bookId));
		const archivedByBookId = new Map(
			archivedBookRows.map((row) => [row.bookId, row]),
		);

		const bookById = new Map(books.map((book) => [book.id, book]));
		const shelfBookUuids = new Map<string, string[]>();
		const shelfLastActivity = new Map<string, Date>();

		for (const row of shelfBookRows) {
			const book = bookById.get(row.bookId);
			if (!book) {
				continue;
			}

			const current = shelfBookUuids.get(row.shelfId) ?? [];
			current.push(book.uuid);
			shelfBookUuids.set(row.shelfId, current);

			const previous = shelfLastActivity.get(row.shelfId);
			if (!previous || row.addedAt > previous) {
				shelfLastActivity.set(row.shelfId, row.addedAt);
			}
		}

		const pendingConversions: KoboPendingConversion[] = [];
		const pendingConversionSet = new Set<string>();
		const newSyncedBookIds: string[] = [];
		const archivedOrphanTimestamp = now();
		const archivedOrphanBookIds: string[] = [];

		const nextSyncToken: KoboSyncToken = {
			...syncToken,
			booksLastModified: new Date(syncToken.booksLastModified),
			booksLastCreated: new Date(syncToken.booksLastCreated),
			archiveLastModified: new Date(syncToken.archiveLastModified),
			readingStateLastModified: new Date(syncToken.readingStateLastModified),
			tagsLastModified: new Date(syncToken.tagsLastModified),
		};

		const syncResults: KoboLocalSyncItem[] = [];
		const candidateBooks = [...bookById.values()]
			.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime())
			.map((book) => {
				const archived = archivedByBookId.get(book.id);
				const isNew = !syncedBookSet.has(book.id);
				const isOrphaned = orphanedSyncedBookIdSet.has(book.id);
				const changed =
					isOrphaned ||
					book.lastModified > syncToken.booksLastModified ||
					book.timestamp > syncToken.booksLastCreated ||
					(archived?.lastModified ?? new Date(0)) >
						syncToken.archiveLastModified;
				return {
					book,
					isNew,
					changed,
					archived,
					isOrphaned,
				};
			})
			.filter((entry) => entry.isNew || entry.changed);

		const limitedBooks = candidateBooks.slice(0, SYNC_ITEM_LIMIT);
		const continueSync = candidateBooks.length > limitedBooks.length;

		for (const entry of limitedBooks) {
			const filesForBook = filesByBookId.get(entry.book.id) ?? [];
			const kepubFile = filesForBook.find((file) => file.format === "kepub");
			const epubFile = filesForBook.find((file) => file.format === "epub");
			const selectedFile = kepubFile ?? epubFile;
			if (!selectedFile) {
				continue;
			}

			if (!kepubFile && epubFile) {
				const key = `${entry.book.id}:${epubFile.id}`;
				if (!pendingConversionSet.has(key)) {
					pendingConversionSet.add(key);
					pendingConversions.push({
						bookId: entry.book.id,
						sourceFileId: epubFile.id,
					});
				}
			}

			const downloadUrls =
				selectedFile.format === "kepub"
					? [
							{
								Format: "KEPUB",
								Size: selectedFile.size,
								Url: buildDownloadUrl({
									origin,
									token,
									bookId: entry.book.id,
									bookFormat: selectedFile.format,
								}),
								Platform: "Generic" as const,
							},
						]
					: [
							{
								Format: "EPUB3",
								Size: selectedFile.size,
								Url: buildDownloadUrl({
									origin,
									token,
									bookId: entry.book.id,
									bookFormat: selectedFile.format,
								}),
								Platform: "Generic" as const,
							},
							{
								Format: "EPUB",
								Size: selectedFile.size,
								Url: buildDownloadUrl({
									origin,
									token,
									bookId: entry.book.id,
									bookFormat: selectedFile.format,
								}),
								Platform: "Generic" as const,
							},
						];

			const entitlement = buildEntitlement({
				book: {
					uuid: entry.book.uuid,
					timestamp: entry.book.timestamp,
					lastModified: entry.book.lastModified,
				},
				archived: entry.isOrphaned || (entry.archived?.isArchived ?? false),
			});
			const metadata = buildMetadata({
				book: {
					uuid: entry.book.uuid,
					title: entry.book.title,
					authors: entry.book.authors,
					language: entry.book.language,
					pubdate: entry.book.pubdate,
					timestamp: entry.book.timestamp,
				},
				description: commentByBookId.get(entry.book.id) ?? null,
				publisher: entry.book.publisherName ?? null,
				series:
					typeof entry.book.seriesIndex === "number" && entry.book.seriesName
						? {
								id: entry.book.seriesId ?? entry.book.seriesName,
								name: entry.book.seriesName,
								index: entry.book.seriesIndex,
							}
						: undefined,
				downloadUrls,
			});

			if (entry.isNew) {
				syncResults.push({
					NewEntitlement: {
						BookEntitlement: entitlement,
						BookMetadata: metadata,
					},
				});
				newSyncedBookIds.push(entry.book.id);
			} else {
				syncResults.push({
					ChangedEntitlement: {
						BookEntitlement: entitlement,
						BookMetadata: metadata,
					},
				});
			}

			if (entry.isOrphaned) {
				archivedOrphanBookIds.push(entry.book.id);
			}

			nextSyncToken.booksLastModified =
				entry.book.lastModified > nextSyncToken.booksLastModified
					? entry.book.lastModified
					: nextSyncToken.booksLastModified;
			nextSyncToken.booksLastCreated =
				entry.book.timestamp > nextSyncToken.booksLastCreated
					? entry.book.timestamp
					: nextSyncToken.booksLastCreated;
			const archiveLastModified = entry.isOrphaned
				? archivedOrphanTimestamp
				: (entry.archived?.lastModified ?? new Date(0));
			nextSyncToken.archiveLastModified =
				archiveLastModified > nextSyncToken.archiveLastModified
					? archiveLastModified
					: nextSyncToken.archiveLastModified;
		}

		for (const shelf of enabledShelves) {
			const shelfActivity = shelfLastActivity.get(shelf.id);
			const latestShelfActivity =
				shelfActivity && shelfActivity > shelf.updatedAt
					? shelfActivity
					: shelf.updatedAt;

			const isNewTag = shelf.createdAt > syncToken.tagsLastModified;
			const isChangedTag = latestShelfActivity > syncToken.tagsLastModified;
			if (!isNewTag && !isChangedTag) {
				continue;
			}

			if (isNewTag) {
				syncResults.push({
					NewTag: buildTagPayload({
						shelf,
						bookUuids: shelfBookUuids.get(shelf.id) ?? [],
					}),
				});
			} else {
				syncResults.push({
					ChangedTag: buildTagPayload({
						shelf,
						bookUuids: shelfBookUuids.get(shelf.id) ?? [],
					}),
				});
			}

			nextSyncToken.tagsLastModified =
				latestShelfActivity > nextSyncToken.tagsLastModified
					? latestShelfActivity
					: nextSyncToken.tagsLastModified;
		}

		const deletedShelfRows = yield* database
			.select({
				shelfId: schema.shelves.id,
				lastModified: schema.shelves.deletedAt,
			})
			.from(schema.shelfMembers)
			.innerJoin(
				schema.shelves,
				eq(schema.shelves.id, schema.shelfMembers.shelfId),
			)
			.where(
				and(
					eq(schema.shelfMembers.userId, userId),
					gt(schema.shelves.deletedAt, syncToken.tagsLastModified),
				),
			);

		const disabledSyncRows = yield* database
			.select({
				shelfId: schema.shelfMembers.shelfId,
				lastModified: schema.shelfMembers.koboSyncDisabledAt,
			})
			.from(schema.shelfMembers)
			.where(
				and(
					eq(schema.shelfMembers.userId, userId),
					eq(schema.shelfMembers.enableKoboSync, false),
					gt(
						schema.shelfMembers.koboSyncDisabledAt,
						syncToken.tagsLastModified,
					),
				),
			);

		const deletedTagByShelfId = new Map<string, Date>();
		for (const row of deletedShelfRows) {
			if (!row.lastModified) {
				continue;
			}

			const previous = deletedTagByShelfId.get(row.shelfId);
			if (!previous || row.lastModified > previous) {
				deletedTagByShelfId.set(row.shelfId, row.lastModified);
			}
		}

		for (const row of disabledSyncRows) {
			if (!row.lastModified) {
				continue;
			}

			const previous = deletedTagByShelfId.get(row.shelfId);
			if (!previous || row.lastModified > previous) {
				deletedTagByShelfId.set(row.shelfId, row.lastModified);
			}
		}

		const deletedTags = [...deletedTagByShelfId.entries()]
			.map(([shelfId, lastModified]) => ({ shelfId, lastModified }))
			.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());

		for (const deletedTag of deletedTags) {
			syncResults.push({
				DeletedTag: {
					Tag: {
						Id: deletedTag.shelfId,
						LastModified: toKoboTimestamp(deletedTag.lastModified),
					},
				},
			});

			nextSyncToken.tagsLastModified =
				deletedTag.lastModified > nextSyncToken.tagsLastModified
					? deletedTag.lastModified
					: nextSyncToken.tagsLastModified;
		}

		const readingByBookId = new Map(
			readingStates.map((state) => [state.bookId, state]),
		);

		for (const [bookId, readingState] of readingByBookId) {
			if (readingState.lastModified <= syncToken.readingStateLastModified) {
				continue;
			}

			const book = bookById.get(bookId);
			if (!book) {
				continue;
			}

			syncResults.push({
				ChangedReadingState: {
					ReadingState: getKoboReadingStateResponse({
						book: {
							uuid: book.uuid,
							timestamp: book.timestamp,
						},
						state: {
							id: readingState.id,
							userId,
							bookId,
							status: getStatusOrDefault(readingState.status),
							lastTimeStartedReading: readingState.lastTimeStartedReading,
							timesStartedReading: readingState.timesStartedReading,
							lastModified: readingState.lastModified,
							priorityTimestamp: readingState.priorityTimestamp,
						},
						bookmark: readingState.bookmarkLastModified
							? {
									koboReadingStateId: readingState.id,
									lastModified: readingState.bookmarkLastModified,
									locationSource: readingState.locationSource,
									locationType: readingState.locationType,
									locationValue: readingState.locationValue,
									progressPercent: readingState.progressPercent,
									contentSourceProgressPercent:
										readingState.contentSourceProgressPercent,
								}
							: null,
						statistics: readingState.statisticsLastModified
							? {
									koboReadingStateId: readingState.id,
									lastModified: readingState.statisticsLastModified,
									remainingTimeMinutes: readingState.remainingTimeMinutes,
									spentReadingMinutes: readingState.spentReadingMinutes,
								}
							: null,
					}),
				},
			});

			nextSyncToken.readingStateLastModified =
				readingState.lastModified > nextSyncToken.readingStateLastModified
					? readingState.lastModified
					: nextSyncToken.readingStateLastModified;
		}

		if (archivedOrphanBookIds.length > 0) {
			const uniqueArchivedOrphanBookIds = [...new Set(archivedOrphanBookIds)];
			const existingArchivedRows = yield* database
				.select({ bookId: schema.archivedBooks.bookId })
				.from(schema.archivedBooks)
				.where(
					and(
						eq(schema.archivedBooks.userId, userId),
						inArray(schema.archivedBooks.bookId, uniqueArchivedOrphanBookIds),
					),
				);

			const existingArchivedBookIdSet = new Set(
				existingArchivedRows.map((row) => row.bookId),
			);

			if (existingArchivedBookIdSet.size > 0) {
				yield* database
					.update(schema.archivedBooks)
					.set({
						isArchived: true,
						lastModified: archivedOrphanTimestamp,
					})
					.where(
						and(
							eq(schema.archivedBooks.userId, userId),
							inArray(schema.archivedBooks.bookId, [
								...existingArchivedBookIdSet,
							]),
						),
					);
			}

			const missingArchivedBookIds = uniqueArchivedOrphanBookIds.filter(
				(bookId) => !existingArchivedBookIdSet.has(bookId),
			);

			if (missingArchivedBookIds.length > 0) {
				yield* database.insert(schema.archivedBooks).values(
					missingArchivedBookIds.map((bookId) => ({
						id: crypto.randomUUID(),
						userId,
						bookId,
						isArchived: true,
						lastModified: archivedOrphanTimestamp,
					})),
				);
			}

			yield* database
				.delete(schema.koboSyncedBooks)
				.where(
					and(
						eq(schema.koboSyncedBooks.userId, userId),
						inArray(schema.koboSyncedBooks.bookId, uniqueArchivedOrphanBookIds),
					),
				);
		}

		if (newSyncedBookIds.length > 0) {
			yield* database.insert(schema.koboSyncedBooks).values(
				newSyncedBookIds.map((bookId) => ({
					id: crypto.randomUUID(),
					userId,
					bookId,
				})),
			);
		}

		return {
			syncResults,
			syncToken: nextSyncToken,
			continueSync,
			pendingConversions,
		} satisfies KoboLocalSyncResult;
	});

export const createMissingKepubConversionJobs = (
	requests: KoboPendingConversion[],
) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		if (requests.length === 0) {
			return [];
		}

		const requestByKey = new Map<string, KoboPendingConversion>();
		for (const request of requests) {
			const key = `${request.bookId}:${request.sourceFileId}`;
			if (!requestByKey.has(key)) {
				requestByKey.set(key, request);
			}
		}

		const uniqueRequests = [...requestByKey.values()];
		const bookIds = [
			...new Set(uniqueRequests.map((request) => request.bookId)),
		];
		const sourceFileIds = [
			...new Set(uniqueRequests.map((request) => request.sourceFileId)),
		];

		const existingJobs = yield* database
			.select({
				bookId: schema.conversionJobs.bookId,
				sourceFileId: schema.conversionJobs.sourceFileId,
			})
			.from(schema.conversionJobs)
			.where(
				and(
					inArray(schema.conversionJobs.bookId, bookIds),
					inArray(schema.conversionJobs.sourceFileId, sourceFileIds),
					eq(schema.conversionJobs.targetFormat, "kepub"),
					inArray(schema.conversionJobs.status, ["pending", "processing"]),
				),
			);

		const existingKeySet = new Set(
			existingJobs.map((job) => `${job.bookId}:${job.sourceFileId}`),
		);
		const missingRequests = uniqueRequests.filter(
			(request) =>
				!existingKeySet.has(`${request.bookId}:${request.sourceFileId}`),
		);

		const createdJobs = yield* Effect.forEach(
			missingRequests,
			(request) =>
				createConversionJob({
					bookId: request.bookId,
					sourceFileId: request.sourceFileId,
					targetFormat: "kepub",
				}),
			{ concurrency: "unbounded" },
		);

		return createdJobs.map((job) => job.jobId);
	});

export const getBookByUuid = (bookUuid: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const rows = yield* database
			.select()
			.from(schema.books)
			.where(eq(schema.books.uuid, bookUuid))
			.limit(1);

		const book = rows[0];
		if (!book) {
			return yield* Effect.fail(new KoboBookNotFound({ bookUuid }));
		}

		return book;
	});

export const getBookMetadataByUuid = ({
	bookUuid,
	origin,
	token,
}: {
	bookUuid: string;
	origin: string;
	token: string;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const book = yield* getBookByUuid(bookUuid);

		const fileRows = yield* database
			.select({
				id: schema.bookFiles.id,
				format: schema.bookFiles.format,
				size: schema.bookFiles.size,
			})
			.from(schema.bookFiles)
			.where(
				and(
					eq(schema.bookFiles.bookId, book.id),
					inArray(schema.bookFiles.format, ["epub", "kepub"]),
				),
			);

		const commentRows = yield* database
			.select({ text: schema.comments.text })
			.from(schema.comments)
			.where(eq(schema.comments.bookId, book.id))
			.limit(1);

		const publisherRows = book.publisherId
			? yield* database
					.select({ name: schema.publishers.name })
					.from(schema.publishers)
					.where(eq(schema.publishers.id, book.publisherId))
					.limit(1)
			: [];

		const seriesRows = book.seriesId
			? yield* database
					.select({ id: schema.series.id, name: schema.series.name })
					.from(schema.series)
					.where(eq(schema.series.id, book.seriesId))
					.limit(1)
			: [];

		const kepubFile = fileRows.find((file) => file.format === "kepub");
		const epubFile = fileRows.find((file) => file.format === "epub");
		const selectedFile = kepubFile ?? epubFile;
		if (!selectedFile) {
			return yield* Effect.fail(
				new KoboFileNotFound({
					bookId: book.id,
					requestedFormat: "kepub|epub",
				}),
			);
		}

		const downloadUrls =
			selectedFile.format === "kepub"
				? [
						{
							Format: "KEPUB",
							Size: selectedFile.size,
							Url: buildDownloadUrl({
								origin,
								token,
								bookId: book.id,
								bookFormat: selectedFile.format,
							}),
							Platform: "Generic" as const,
						},
					]
				: [
						{
							Format: "EPUB3",
							Size: selectedFile.size,
							Url: buildDownloadUrl({
								origin,
								token,
								bookId: book.id,
								bookFormat: selectedFile.format,
							}),
							Platform: "Generic" as const,
						},
						{
							Format: "EPUB",
							Size: selectedFile.size,
							Url: buildDownloadUrl({
								origin,
								token,
								bookId: book.id,
								bookFormat: selectedFile.format,
							}),
							Platform: "Generic" as const,
						},
					];

		return buildMetadata({
			book: {
				uuid: book.uuid,
				title: book.title,
				authors: book.authors,
				language: book.language,
				pubdate: book.pubdate,
				timestamp: book.timestamp,
			},
			description: commentRows[0]?.text ?? null,
			publisher: publisherRows[0]?.name ?? null,
			series:
				typeof book.seriesIndex === "number" && seriesRows[0]?.name
					? {
							id: seriesRows[0].id,
							name: seriesRows[0].name,
							index: book.seriesIndex,
						}
					: undefined,
			downloadUrls,
		});
	});

export const getDownloadFileForKobo = ({
	bookId,
	requestedFormat,
}: {
	bookId: string;
	requestedFormat: string;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const books = yield* database
			.select()
			.from(schema.books)
			.where(eq(schema.books.id, bookId))
			.limit(1);

		const book = books[0];
		if (!book) {
			return yield* Effect.fail(new KoboBookNotFound({ bookUuid: bookId }));
		}

		const rows = yield* database
			.select()
			.from(schema.bookFiles)
			.where(eq(schema.bookFiles.bookId, bookId));

		const normalizedFormat = requestedFormat.toLowerCase();
		const exact = rows.find((row) => row.format === normalizedFormat);
		const kepub = rows.find((row) => row.format === "kepub");
		const epub = rows.find((row) => row.format === "epub");

		const selected =
			exact ?? (normalizedFormat === "kepub" ? epub : (kepub ?? epub));
		if (!selected) {
			return yield* Effect.fail(
				new KoboFileNotFound({
					bookId,
					requestedFormat,
				}),
			);
		}

		return {
			book,
			file: selected,
			fallbackToEpub:
				normalizedFormat === "kepub" && selected.format === "epub",
			conversionSourceFileId:
				normalizedFormat === "kepub" && selected.format === "epub"
					? selected.id
					: null,
		} satisfies KoboDownloadFileResult;
	});
export const getOrCreateReadingStateByBookUuid = ({
	userId,
	bookUuid,
}: {
	userId: string;
	bookUuid: string;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const book = yield* getBookByUuid(bookUuid);

		const existingRows = yield* database
			.select()
			.from(schema.koboReadingStates)
			.where(
				and(
					eq(schema.koboReadingStates.userId, userId),
					eq(schema.koboReadingStates.bookId, book.id),
				),
			)
			.limit(1);

		const state =
			existingRows[0] ??
			(yield* Effect.gen(function* () {
				const insertValue = {
					id: crypto.randomUUID(),
					userId,
					bookId: book.id,
					status: "ReadyToRead" as const,
					timesStartedReading: 0,
					lastModified: now(),
					priorityTimestamp: now(),
				};
				yield* database.insert(schema.koboReadingStates).values(insertValue);
				return insertValue;
			}));

		const bookmarkRows = yield* database
			.select()
			.from(schema.koboBookmarks)
			.where(eq(schema.koboBookmarks.koboReadingStateId, state.id))
			.limit(1);
		if (!bookmarkRows[0]) {
			yield* database.insert(schema.koboBookmarks).values({
				koboReadingStateId: state.id,
				lastModified: now(),
			});
		}

		const statisticsRows = yield* database
			.select()
			.from(schema.koboStatistics)
			.where(eq(schema.koboStatistics.koboReadingStateId, state.id))
			.limit(1);
		if (!statisticsRows[0]) {
			yield* database.insert(schema.koboStatistics).values({
				koboReadingStateId: state.id,
				lastModified: now(),
			});
		}

		const [readingState] = yield* database
			.select({
				bookUuid: schema.books.uuid,
				bookTimestamp: schema.books.timestamp,
				id: schema.koboReadingStates.id,
				status: schema.koboReadingStates.status,
				lastTimeStartedReading: schema.koboReadingStates.lastTimeStartedReading,
				timesStartedReading: schema.koboReadingStates.timesStartedReading,
				lastModified: schema.koboReadingStates.lastModified,
				priorityTimestamp: schema.koboReadingStates.priorityTimestamp,
				bookmarkLastModified: schema.koboBookmarks.lastModified,
				locationSource: schema.koboBookmarks.locationSource,
				locationType: schema.koboBookmarks.locationType,
				locationValue: schema.koboBookmarks.locationValue,
				progressPercent: schema.koboBookmarks.progressPercent,
				contentSourceProgressPercent:
					schema.koboBookmarks.contentSourceProgressPercent,
				statisticsLastModified: schema.koboStatistics.lastModified,
				remainingTimeMinutes: schema.koboStatistics.remainingTimeMinutes,
				spentReadingMinutes: schema.koboStatistics.spentReadingMinutes,
			})
			.from(schema.koboReadingStates)
			.innerJoin(
				schema.books,
				eq(schema.books.id, schema.koboReadingStates.bookId),
			)
			.leftJoin(
				schema.koboBookmarks,
				eq(
					schema.koboBookmarks.koboReadingStateId,
					schema.koboReadingStates.id,
				),
			)
			.leftJoin(
				schema.koboStatistics,
				eq(
					schema.koboStatistics.koboReadingStateId,
					schema.koboReadingStates.id,
				),
			)
			.where(eq(schema.koboReadingStates.id, state.id))
			.limit(1);

		if (!readingState) {
			return yield* Effect.fail(new KoboBookNotFound({ bookUuid }));
		}

		return {
			book: {
				uuid: readingState.bookUuid,
				timestamp: readingState.bookTimestamp,
			},
			state: {
				id: readingState.id,
				userId,
				bookId: book.id,
				status: getStatusOrDefault(readingState.status),
				lastTimeStartedReading: readingState.lastTimeStartedReading,
				timesStartedReading: readingState.timesStartedReading,
				lastModified: readingState.lastModified,
				priorityTimestamp: readingState.priorityTimestamp,
			},
			bookmark: readingState.bookmarkLastModified
				? {
						koboReadingStateId: readingState.id,
						lastModified: readingState.bookmarkLastModified,
						locationSource: readingState.locationSource,
						locationType: readingState.locationType,
						locationValue: readingState.locationValue,
						progressPercent: readingState.progressPercent,
						contentSourceProgressPercent:
							readingState.contentSourceProgressPercent,
					}
				: null,
			statistics: readingState.statisticsLastModified
				? {
						koboReadingStateId: readingState.id,
						lastModified: readingState.statisticsLastModified,
						remainingTimeMinutes: readingState.remainingTimeMinutes,
						spentReadingMinutes: readingState.spentReadingMinutes,
					}
				: null,
		};
	});

export const updateReadingStateByBookUuid = ({
	userId,
	bookUuid,
	payload,
}: {
	userId: string;
	bookUuid: string;
	payload: unknown;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const nowDate = now();
		const parsed = parseReadingStatePayload(payload);
		if (!parsed.readingState) {
			return {
				RequestResult: "Success",
				UpdateResults: [
					{
						EntitlementId: bookUuid,
						LastModified: toKoboTimestamp(nowDate),
						PriorityTimestamp: toKoboTimestamp(nowDate),
					},
				],
			} satisfies {
				RequestResult: "Success";
				UpdateResults: Array<{
					EntitlementId: string;
					LastModified: string;
					PriorityTimestamp: string;
					CurrentBookmarkResult?: { Result: "Success" };
					StatisticsResult?: { Result: "Success" };
					StatusInfoResult?: { Result: "Success" };
				}>;
			};
		}

		const current = yield* getOrCreateReadingStateByBookUuid({
			userId,
			bookUuid,
		});

		const statusInfo = parsed.readingState.StatusInfo;
		const bookmark = parsed.readingState.CurrentBookmark;
		const statistics = parsed.readingState.Statistics;

		const nextStatus = getStatusOrDefault(statusInfo?.Status);
		const incrementsReadingStarts =
			nextStatus === "Reading" && current.state.status !== "Reading";

		yield* database
			.update(schema.koboReadingStates)
			.set({
				status: nextStatus,
				lastTimeStartedReading: statusInfo?.LastTimeStartedReading
					? new Date(statusInfo.LastTimeStartedReading)
					: current.state.lastTimeStartedReading,
				timesStartedReading:
					current.state.timesStartedReading + (incrementsReadingStarts ? 1 : 0),
				lastModified: nowDate,
				priorityTimestamp: nowDate,
			})
			.where(eq(schema.koboReadingStates.id, current.state.id));

		if (bookmark) {
			yield* database
				.update(schema.koboBookmarks)
				.set({
					lastModified: nowDate,
					progressPercent: bookmark.ProgressPercent ?? null,
					contentSourceProgressPercent:
						bookmark.ContentSourceProgressPercent ?? null,
					locationValue: bookmark.Location?.Value ?? null,
					locationType: bookmark.Location?.Type ?? null,
					locationSource: bookmark.Location?.Source ?? null,
				})
				.where(eq(schema.koboBookmarks.koboReadingStateId, current.state.id));
		}

		if (statistics) {
			yield* database
				.update(schema.koboStatistics)
				.set({
					lastModified: nowDate,
					spentReadingMinutes:
						typeof statistics.SpentReadingMinutes === "number"
							? Math.max(0, Math.floor(statistics.SpentReadingMinutes))
							: null,
					remainingTimeMinutes:
						typeof statistics.RemainingTimeMinutes === "number"
							? Math.max(0, Math.floor(statistics.RemainingTimeMinutes))
							: null,
				})
				.where(eq(schema.koboStatistics.koboReadingStateId, current.state.id));
		}

		const refreshed = yield* getOrCreateReadingStateByBookUuid({
			userId,
			bookUuid,
		});
		return {
			RequestResult: "Success",
			UpdateResults: [
				{
					EntitlementId: refreshed.book.uuid,
					LastModified: toKoboTimestamp(refreshed.state.lastModified),
					PriorityTimestamp: toKoboTimestamp(refreshed.state.priorityTimestamp),
					CurrentBookmarkResult: bookmark ? { Result: "Success" } : undefined,
					StatisticsResult: statistics ? { Result: "Success" } : undefined,
					StatusInfoResult: statusInfo ? { Result: "Success" } : undefined,
				},
			],
		} satisfies {
			RequestResult: "Success";
			UpdateResults: Array<{
				EntitlementId: string;
				LastModified: string;
				PriorityTimestamp: string;
				CurrentBookmarkResult?: { Result: "Success" };
				StatisticsResult?: { Result: "Success" };
				StatusInfoResult?: { Result: "Success" };
			}>;
		};
	});

export const getReadingStateResponseByBookUuid = ({
	userId,
	bookUuid,
}: {
	userId: string;
	bookUuid: string;
}) =>
	Effect.gen(function* () {
		const data = yield* getOrCreateReadingStateByBookUuid({ userId, bookUuid });
		return [
			getKoboReadingStateResponse({
				book: data.book,
				state: data.state,
				bookmark: data.bookmark,
				statistics: data.statistics,
			}),
		] satisfies KoboReadingStateResponse[];
	});

export const setArchivedBookByUuid = ({
	userId,
	bookUuid,
	isArchived,
}: {
	userId: string;
	bookUuid: string;
	isArchived: boolean;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const book = yield* getBookByUuid(bookUuid);

		const existing = yield* database
			.select({ id: schema.archivedBooks.id })
			.from(schema.archivedBooks)
			.where(
				and(
					eq(schema.archivedBooks.userId, userId),
					eq(schema.archivedBooks.bookId, book.id),
				),
			)
			.limit(1);

		if (existing[0]) {
			yield* database
				.update(schema.archivedBooks)
				.set({ isArchived, lastModified: now() })
				.where(eq(schema.archivedBooks.id, existing[0].id));
		} else {
			yield* database.insert(schema.archivedBooks).values({
				id: crypto.randomUUID(),
				userId,
				bookId: book.id,
				isArchived,
				lastModified: now(),
			});
		}

		if (isArchived) {
			yield* database
				.delete(schema.koboSyncedBooks)
				.where(
					and(
						eq(schema.koboSyncedBooks.userId, userId),
						eq(schema.koboSyncedBooks.bookId, book.id),
					),
				);
		}

		return { success: true as const, bookId: book.id };
	});

const normalizeRevisionIds = (revisionIds: string[]) => [
	...new Set(revisionIds.map((value) => value.trim()).filter(Boolean)),
];

const resolveBookIdsByRevisionIds = (revisionIds: string[]) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const normalized = normalizeRevisionIds(revisionIds);
		if (normalized.length === 0) {
			return {
				bookIds: [] as string[],
				unknownRevisionIds: [] as string[],
			};
		}

		const rows = yield* database
			.select({
				bookId: schema.books.id,
				revisionId: schema.books.uuid,
			})
			.from(schema.books)
			.where(inArray(schema.books.uuid, normalized));

		const revisionToBookId = new Map(
			rows.map((row) => [row.revisionId, row.bookId]),
		);

		const bookIds: string[] = [];
		const unknownRevisionIds: string[] = [];
		for (const revisionId of normalized) {
			const bookId = revisionToBookId.get(revisionId);
			if (!bookId) {
				unknownRevisionIds.push(revisionId);
				continue;
			}

			bookIds.push(bookId);
		}

		return {
			bookIds,
			unknownRevisionIds,
		};
	});

const ensureEditableTagShelfForUser = ({
	userId,
	tagId,
}: {
	userId: string;
	tagId: string;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const rows = yield* database
			.select({
				tagId: schema.shelves.id,
				tagName: schema.shelves.name,
				role: schema.shelfMembers.role,
				enableKoboSync: schema.shelfMembers.enableKoboSync,
			})
			.from(schema.shelfMembers)
			.innerJoin(
				schema.shelves,
				eq(schema.shelves.id, schema.shelfMembers.shelfId),
			)
			.where(
				and(
					eq(schema.shelfMembers.userId, userId),
					eq(schema.shelfMembers.shelfId, tagId),
					isNull(schema.shelves.deletedAt),
				),
			)
			.limit(1);

		const shelf = rows[0];
		if (!shelf) {
			return yield* Effect.fail(new KoboTagNotFound({ tagId }));
		}

		if (!isEditableShelfRole(shelf.role)) {
			return yield* Effect.fail(new KoboTagAccessDenied({ tagId, userId }));
		}

		if (!shelf.enableKoboSync) {
			yield* database
				.update(schema.shelfMembers)
				.set({ enableKoboSync: true, koboSyncDisabledAt: null })
				.where(
					and(
						eq(schema.shelfMembers.shelfId, tagId),
						eq(schema.shelfMembers.userId, userId),
					),
				);
		}

		return shelf;
	});

const addBookIdsToTagShelf = ({
	tagId,
	tagName,
	bookIds,
}: {
	tagId: string;
	tagName: string;
	bookIds: string[];
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const normalizedBookIds = [...new Set(bookIds)];
		if (normalizedBookIds.length === 0) {
			return { addedCount: 0 };
		}

		const existingRows = yield* database
			.select({
				bookId: schema.shelfBooks.bookId,
				order: schema.shelfBooks.order,
			})
			.from(schema.shelfBooks)
			.where(eq(schema.shelfBooks.shelfId, tagId));

		const existingBookIds = new Set(existingRows.map((row) => row.bookId));
		const toInsertBookIds = normalizedBookIds.filter(
			(bookId) => !existingBookIds.has(bookId),
		);

		if (toInsertBookIds.length === 0) {
			return { addedCount: 0 };
		}

		const maxOrder = existingRows.reduce(
			(max, row) => (row.order > max ? row.order : max),
			-1,
		);

		yield* database.insert(schema.shelfBooks).values(
			toInsertBookIds.map((bookId, index) => ({
				shelfId: tagId,
				bookId,
				order: maxOrder + index + 1,
			})),
		);

		// Touch shelf row so tag LastModified reflects item changes as well.
		yield* database
			.update(schema.shelves)
			.set({ name: tagName })
			.where(eq(schema.shelves.id, tagId));

		return { addedCount: toInsertBookIds.length };
	});

const removeBookIdsFromTagShelf = ({
	tagId,
	tagName,
	bookIds,
}: {
	tagId: string;
	tagName: string;
	bookIds: string[];
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const normalizedBookIds = [...new Set(bookIds)];
		if (normalizedBookIds.length === 0) {
			return { removedCount: 0 };
		}

		yield* database
			.delete(schema.shelfBooks)
			.where(
				and(
					eq(schema.shelfBooks.shelfId, tagId),
					inArray(schema.shelfBooks.bookId, normalizedBookIds),
				),
			);

		// Touch shelf row so tag LastModified reflects item removals too.
		yield* database
			.update(schema.shelves)
			.set({ name: tagName })
			.where(eq(schema.shelves.id, tagId));

		return { removedCount: normalizedBookIds.length };
	});

export const createOrUpdateKoboTag = ({
	userId,
	name,
	revisionIds,
}: {
	userId: string;
	name: string;
	revisionIds: string[];
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const normalizedName = name.trim();
		if (!normalizedName) {
			return yield* Effect.fail(
				new KoboTagInvalidPayload({ reason: "Tag name is required" }),
			);
		}

		const existingRows = yield* database
			.select({
				tagId: schema.shelves.id,
				tagName: schema.shelves.name,
				role: schema.shelfMembers.role,
				enableKoboSync: schema.shelfMembers.enableKoboSync,
			})
			.from(schema.shelfMembers)
			.innerJoin(
				schema.shelves,
				eq(schema.shelves.id, schema.shelfMembers.shelfId),
			)
			.where(
				and(
					eq(schema.shelfMembers.userId, userId),
					eq(schema.shelves.name, normalizedName),
					isNull(schema.shelves.deletedAt),
				),
			)
			.limit(1);

		const existing = existingRows[0];
		let tagId: string;
		let tagName: string;
		let created = false;

		if (!existing) {
			tagId = crypto.randomUUID();
			tagName = normalizedName;
			created = true;

			yield* database.insert(schema.shelves).values({
				id: tagId,
				name: tagName,
				visibility: "private",
			});

			yield* database.insert(schema.shelfMembers).values({
				shelfId: tagId,
				userId,
				role: "owner",
				addedByUserId: userId,
				enableKoboSync: true,
				koboSyncDisabledAt: null,
			});
		} else {
			if (!isEditableShelfRole(existing.role)) {
				return yield* Effect.fail(
					new KoboTagAccessDenied({ tagId: existing.tagId, userId }),
				);
			}

			tagId = existing.tagId;
			tagName = existing.tagName;
			if (!existing.enableKoboSync) {
				yield* database
					.update(schema.shelfMembers)
					.set({ enableKoboSync: true, koboSyncDisabledAt: null })
					.where(
						and(
							eq(schema.shelfMembers.shelfId, tagId),
							eq(schema.shelfMembers.userId, userId),
						),
					);
			}
		}

		const { bookIds, unknownRevisionIds } =
			yield* resolveBookIdsByRevisionIds(revisionIds);
		yield* addBookIdsToTagShelf({
			tagId,
			tagName,
			bookIds,
		});

		return {
			tagId,
			created,
			unknownRevisionIds,
		};
	});

export const renameKoboTag = ({
	userId,
	tagId,
	name,
}: {
	userId: string;
	tagId: string;
	name: string;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const normalizedName = name.trim();
		if (!normalizedName) {
			return yield* Effect.fail(
				new KoboTagInvalidPayload({ reason: "Tag name is required" }),
			);
		}

		yield* ensureEditableTagShelfForUser({ userId, tagId });
		yield* database
			.update(schema.shelves)
			.set({ name: normalizedName })
			.where(eq(schema.shelves.id, tagId));

		return { tagId, name: normalizedName };
	});

export const deleteKoboTag = ({
	userId,
	tagId,
}: {
	userId: string;
	tagId: string;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		yield* ensureEditableTagShelfForUser({ userId, tagId });

		yield* database
			.update(schema.shelves)
			.set({ deletedAt: now() })
			.where(eq(schema.shelves.id, tagId));

		return { success: true as const, tagId };
	});

export const addItemsToKoboTag = ({
	userId,
	tagId,
	revisionIds,
}: {
	userId: string;
	tagId: string;
	revisionIds: string[];
}) =>
	Effect.gen(function* () {
		const shelf = yield* ensureEditableTagShelfForUser({ userId, tagId });
		const { bookIds, unknownRevisionIds } =
			yield* resolveBookIdsByRevisionIds(revisionIds);
		yield* addBookIdsToTagShelf({
			tagId,
			tagName: shelf.tagName,
			bookIds,
		});

		return { success: true as const, tagId, unknownRevisionIds };
	});

export const removeItemsFromKoboTag = ({
	userId,
	tagId,
	revisionIds,
}: {
	userId: string;
	tagId: string;
	revisionIds: string[];
}) =>
	Effect.gen(function* () {
		const shelf = yield* ensureEditableTagShelfForUser({ userId, tagId });
		const { bookIds, unknownRevisionIds } =
			yield* resolveBookIdsByRevisionIds(revisionIds);
		yield* removeBookIdsFromTagShelf({
			tagId,
			tagName: shelf.tagName,
			bookIds,
		});

		return { success: true as const, tagId, unknownRevisionIds };
	});

export const buildDummyAuthResponse = (
	userKey: string | null,
): KoboAuthResponse => ({
	AccessToken: toBase64(crypto.getRandomValues(new Uint8Array(24))),
	RefreshToken: toBase64(crypto.getRandomValues(new Uint8Array(24))),
	TokenType: "Bearer",
	TrackingId: crypto.randomUUID(),
	UserKey: userKey ?? "",
});

export const setRawStoreSyncTokenFromResponse = ({
	syncToken,
	upstreamResponse,
}: {
	syncToken: KoboSyncToken;
	upstreamResponse: Response;
}) => {
	const storeToken = upstreamResponse.headers.get(SYNC_TOKEN_HEADER);
	if (storeToken) {
		syncToken.rawKoboStoreToken = storeToken;
	}
};

export const copySyncHeadersFromUpstream = ({
	upstreamResponse,
	outgoing,
}: {
	upstreamResponse: Response;
	outgoing: Headers;
}) => {
	for (const header of [
		"x-kobo-sync",
		"x-kobo-sync-mode",
		"x-kobo-recent-reads",
	]) {
		const value = upstreamResponse.headers.get(header);
		if (value) {
			outgoing.set(header, value);
		}
	}
};

export const getSyncItemLimit = () => SYNC_ITEM_LIMIT;
