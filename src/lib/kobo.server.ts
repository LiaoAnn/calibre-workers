import type { SqlError } from "@effect/sql/SqlError";
import { Either, Schema } from "effect";
import type { ConfigError } from "effect/ConfigError";
import type {
	KoboTagAccessDenied,
	KoboTagInvalidPayload,
	KoboTagNotFound,
} from "#/services/KoboService";

export const KOBO_TEXT_HEADERS = {
	"content-type": "text/plain; charset=utf-8",
};

const KoboReadStatusSchema = Schema.Literal(
	"ReadyToRead",
	"Reading",
	"Finished",
);

const KoboTagItemSchema = Schema.Struct({
	Type: Schema.Literal("ProductRevisionTagItem"),
	RevisionId: Schema.String,
});

const KoboCreateTagBodySchema = Schema.Struct({
	Name: Schema.String,
	Items: Schema.Array(KoboTagItemSchema),
});

const KoboTagItemsBodySchema = Schema.Struct({
	Items: Schema.Array(KoboTagItemSchema),
});

const KoboRenameTagBodySchema = Schema.Struct({
	Name: Schema.String,
});

const KoboDeviceAuthBodySchema = Schema.Struct({
	UserKey: Schema.optional(Schema.NullOr(Schema.String)),
});

const KoboReadingBookmarkInputLocationSchema = Schema.Struct({
	Value: Schema.optional(Schema.String),
	Type: Schema.optional(Schema.String),
	Source: Schema.optional(Schema.String),
});

const KoboReadingBookmarkInputSchema = Schema.Struct({
	ProgressPercent: Schema.optional(Schema.Number),
	ContentSourceProgressPercent: Schema.optional(Schema.Number),
	Location: Schema.optional(KoboReadingBookmarkInputLocationSchema),
});

const KoboReadingStatisticsInputSchema = Schema.Struct({
	SpentReadingMinutes: Schema.optional(Schema.Number.pipe(Schema.int())),
	RemainingTimeMinutes: Schema.optional(Schema.Number.pipe(Schema.int())),
});

const KoboReadingStatusInfoInputSchema = Schema.Struct({
	Status: Schema.optional(KoboReadStatusSchema),
	LastTimeStartedReading: Schema.optional(Schema.String),
});

const KoboReadingStateInputSchema = Schema.Struct({
	CurrentBookmark: Schema.optional(KoboReadingBookmarkInputSchema),
	Statistics: Schema.optional(KoboReadingStatisticsInputSchema),
	StatusInfo: Schema.optional(KoboReadingStatusInfoInputSchema),
});

const KoboReadingStateBodySchema = Schema.Struct({
	ReadingStates: Schema.NonEmptyArray(KoboReadingStateInputSchema),
});

const KoboReadingBookmarkOutputLocationSchema = Schema.Struct({
	Value: Schema.String,
	Type: Schema.NullOr(Schema.String),
	Source: Schema.NullOr(Schema.String),
});

const KoboReadingBookmarkOutputSchema = Schema.Struct({
	LastModified: Schema.String,
	ProgressPercent: Schema.optional(Schema.Number),
	ContentSourceProgressPercent: Schema.optional(Schema.Number),
	Location: Schema.optional(KoboReadingBookmarkOutputLocationSchema),
});

const KoboReadingStatisticsOutputSchema = Schema.Struct({
	LastModified: Schema.String,
	SpentReadingMinutes: Schema.optional(Schema.Number.pipe(Schema.int())),
	RemainingTimeMinutes: Schema.optional(Schema.Number.pipe(Schema.int())),
});

const KoboReadingStatusInfoOutputSchema = Schema.Struct({
	LastModified: Schema.String,
	Status: KoboReadStatusSchema,
	TimesStartedReading: Schema.Number.pipe(Schema.int()),
	LastTimeStartedReading: Schema.optional(Schema.String),
});

const KoboReadingStateResponseSchema = Schema.Struct({
	EntitlementId: Schema.String,
	Created: Schema.String,
	LastModified: Schema.String,
	PriorityTimestamp: Schema.String,
	StatusInfo: KoboReadingStatusInfoOutputSchema,
	Statistics: KoboReadingStatisticsOutputSchema,
	CurrentBookmark: KoboReadingBookmarkOutputSchema,
});

const KoboResultSuccessSchema = Schema.Struct({
	Result: Schema.Literal("Success"),
});

const KoboReadingStateUpdateResultSchema = Schema.Struct({
	EntitlementId: Schema.String,
	LastModified: Schema.String,
	PriorityTimestamp: Schema.String,
	CurrentBookmarkResult: Schema.optional(KoboResultSuccessSchema),
	StatisticsResult: Schema.optional(KoboResultSuccessSchema),
	StatusInfoResult: Schema.optional(KoboResultSuccessSchema),
});

const KoboReadingStateUpdateResponseSchema = Schema.Struct({
	RequestResult: Schema.Literal("Success"),
	UpdateResults: Schema.NonEmptyArray(KoboReadingStateUpdateResultSchema),
});

const KoboBookEntitlementSchema = Schema.Struct({
	Accessibility: Schema.Literal("Full"),
	ActivePeriod: Schema.Struct({
		From: Schema.String,
	}),
	Created: Schema.String,
	CrossRevisionId: Schema.String,
	Id: Schema.String,
	IsRemoved: Schema.Boolean,
	IsHiddenFromArchive: Schema.Boolean,
	IsLocked: Schema.Boolean,
	LastModified: Schema.String,
	OriginCategory: Schema.Literal("Imported"),
	RevisionId: Schema.String,
	Status: Schema.Literal("Active"),
});

const KoboDownloadUrlSchema = Schema.Struct({
	Format: Schema.String,
	Size: Schema.Number.pipe(Schema.int()),
	Url: Schema.String,
	Platform: Schema.Literal("Generic"),
});

const KoboContributorRoleSchema = Schema.Struct({
	Name: Schema.String,
});

const KoboSeriesSchema = Schema.Struct({
	Name: Schema.String,
	Number: Schema.Number,
	NumberFloat: Schema.Number,
	Id: Schema.String,
});

const KoboPublisherSchema = Schema.Struct({
	Imprint: Schema.String,
	Name: Schema.NullOr(Schema.String),
});

const KoboPriceSchema = Schema.Struct({
	CurrencyCode: Schema.String,
	TotalAmount: Schema.Number,
});

const KoboBookMetadataSchema = Schema.Struct({
	Categories: Schema.Array(Schema.String),
	CoverImageId: Schema.String,
	CrossRevisionId: Schema.String,
	CurrentDisplayPrice: KoboPriceSchema,
	CurrentLoveDisplayPrice: Schema.Struct({
		TotalAmount: Schema.Number,
	}),
	EntitlementId: Schema.String,
	ExternalIds: Schema.Array(Schema.Unknown),
	Genre: Schema.String,
	IsEligibleForKoboLove: Schema.Boolean,
	RevisionId: Schema.String,
	WorkId: Schema.String,
	Title: Schema.String,
	Description: Schema.NullOr(Schema.String),
	Language: Schema.String,
	PublicationDate: Schema.String,
	DownloadUrls: Schema.Array(KoboDownloadUrlSchema),
	Contributors: Schema.NullOr(Schema.Array(Schema.String)),
	ContributorRoles: Schema.optional(Schema.Array(KoboContributorRoleSchema)),
	PhoneticPronunciations: Schema.Record({
		key: Schema.String,
		value: Schema.Unknown,
	}),
	Series: Schema.optional(KoboSeriesSchema),
	Publisher: KoboPublisherSchema,
	IsSocialEnabled: Schema.Boolean,
	IsInternetArchive: Schema.Boolean,
	IsPreOrder: Schema.Boolean,
});

const KoboTagPayloadSchema = Schema.Struct({
	Tag: Schema.Struct({
		Created: Schema.String,
		Id: Schema.String,
		Items: Schema.Array(KoboTagItemSchema),
		LastModified: Schema.String,
		Name: Schema.String,
		Type: Schema.Literal("UserTag"),
	}),
});

const KoboDeletedTagSchema = Schema.Struct({
	Tag: Schema.Struct({
		Id: Schema.String,
		LastModified: Schema.String,
	}),
});

const KoboSyncEntitlementSchema = Schema.Struct({
	BookEntitlement: KoboBookEntitlementSchema,
	BookMetadata: KoboBookMetadataSchema,
});

const KoboLocalSyncItemSchema = Schema.Union(
	Schema.Struct({
		NewEntitlement: KoboSyncEntitlementSchema,
	}),
	Schema.Struct({
		ChangedEntitlement: KoboSyncEntitlementSchema,
	}),
	Schema.Struct({
		NewTag: KoboTagPayloadSchema,
	}),
	Schema.Struct({
		ChangedTag: KoboTagPayloadSchema,
	}),
	Schema.Struct({
		DeletedTag: KoboDeletedTagSchema,
	}),
	Schema.Struct({
		ChangedReadingState: Schema.Struct({
			ReadingState: KoboReadingStateResponseSchema,
		}),
	}),
);

const KoboInitializationResponseSchema = Schema.Struct({
	Resources: Schema.Record({
		key: Schema.String,
		value: Schema.Unknown,
	}),
});

const KoboBenefitsResponseSchema = Schema.Struct({
	Benefits: Schema.Record({
		key: Schema.String,
		value: Schema.Unknown,
	}),
});

const KoboAnalyticsTestsResponseSchema = Schema.Struct({
	Result: Schema.Literal("Success"),
	TestKey: Schema.String,
	Tests: Schema.Record({
		key: Schema.String,
		value: Schema.Unknown,
	}),
});

const KoboEmptyObjectResponseSchema = Schema.Struct({});
const KoboSingleSpaceTextResponseSchema = Schema.Literal(" ");
const KoboEmptyTextResponseSchema = Schema.Literal("");

const KoboAuthResponseSchema = Schema.Struct({
	AccessToken: Schema.String,
	RefreshToken: Schema.String,
	TokenType: Schema.Literal("Bearer"),
	TrackingId: Schema.String,
	UserKey: Schema.String,
});

const KoboMetadataListSchema = Schema.Array(KoboBookMetadataSchema);
const KoboReadingStateListSchema = Schema.Array(KoboReadingStateResponseSchema);
const KoboLocalSyncResultSchema = Schema.Array(KoboLocalSyncItemSchema);
const KoboTagIdSchema = Schema.String;

export type KoboBookEntitlement = typeof KoboBookEntitlementSchema.Type;
export type KoboDownloadUrl = typeof KoboDownloadUrlSchema.Type;
export type KoboBookMetadata = typeof KoboBookMetadataSchema.Type;
export type KoboTagPayload = typeof KoboTagPayloadSchema.Type;
export type KoboReadingStateResponse =
	typeof KoboReadingStateResponseSchema.Type;
export type KoboReadingStateUpdateResponse =
	typeof KoboReadingStateUpdateResponseSchema.Type;
export type KoboLocalSyncItem = typeof KoboLocalSyncItemSchema.Type;
export type KoboAuthResponse = typeof KoboAuthResponseSchema.Type;

const encodeKoboOutput = <A, I>(
	schema: Schema.Schema<A, I, never>,
	value: unknown,
): I | null => {
	const encoded = Schema.encodeUnknownEither(schema)(value);
	if (Either.isLeft(encoded)) {
		return null;
	}

	return encoded.right;
};

export const encodeKoboMetadataList = (value: unknown) =>
	encodeKoboOutput(KoboMetadataListSchema, value);

export const encodeKoboReadingStateList = (value: unknown) =>
	encodeKoboOutput(KoboReadingStateListSchema, value);

export const encodeKoboReadingStateUpdateResponse = (value: unknown) =>
	encodeKoboOutput(KoboReadingStateUpdateResponseSchema, value);

export const encodeKoboTagId = (value: unknown) =>
	encodeKoboOutput(KoboTagIdSchema, value);

export const encodeKoboAuthResponse = (value: unknown) =>
	encodeKoboOutput(KoboAuthResponseSchema, value);

export const encodeKoboLocalSyncResults = (value: unknown) =>
	encodeKoboOutput(KoboLocalSyncResultSchema, value);

export const encodeKoboInitializationResponse = (value: unknown) =>
	encodeKoboOutput(KoboInitializationResponseSchema, value);

export const encodeKoboBenefitsResponse = (value: unknown) =>
	encodeKoboOutput(KoboBenefitsResponseSchema, value);

export const encodeKoboAnalyticsTestsResponse = (value: unknown) =>
	encodeKoboOutput(KoboAnalyticsTestsResponseSchema, value);

export const encodeKoboEmptyObjectResponse = (value: unknown) =>
	encodeKoboOutput(KoboEmptyObjectResponseSchema, value);

export const encodeKoboSingleSpaceTextResponse = (value: unknown) =>
	encodeKoboOutput(KoboSingleSpaceTextResponseSchema, value);

export const encodeKoboEmptyTextResponse = (value: unknown) =>
	encodeKoboOutput(KoboEmptyTextResponseSchema, value);

export const encodeKoboLocalSyncItem = (value: unknown) =>
	encodeKoboOutput(KoboLocalSyncItemSchema, value);

const trimNonEmpty = (value: string): string | null => {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const normalizeRevisionIds = (
	items: ReadonlyArray<typeof KoboTagItemSchema.Type>,
): string[] | null => {
	const revisionIds: string[] = [];
	for (const item of items) {
		const revisionId = trimNonEmpty(item.RevisionId);
		if (!revisionId) {
			return null;
		}
		revisionIds.push(revisionId);
	}

	return revisionIds;
};

export const koboJsonResponse = (
	payload: unknown,
	init?: ResponseInit,
): Response => {
	const headers = new Headers(init?.headers);
	if (!headers.has("content-type")) {
		headers.set("content-type", "application/json; charset=utf-8");
	}

	return new Response(JSON.stringify(payload), {
		...init,
		headers,
	});
};

export const koboJsonErrorResponse = ({
	status,
	message,
	code,
}: {
	status: number;
	message: string;
	code?: string;
}): Response => {
	const headers = new Headers({ "cache-control": "no-store" });
	return koboJsonResponse(
		{
			Code: code ?? "Error",
			Message: message,
		},
		{
			status,
			headers,
		},
	);
};

export const parseCreateTagBody = (
	value: unknown,
): { name: string; revisionIds: string[] } | null => {
	const decoded = Schema.decodeUnknownEither(KoboCreateTagBodySchema)(value);
	if (Either.isLeft(decoded)) {
		return null;
	}

	const name = trimNonEmpty(decoded.right.Name);
	if (!name) {
		return null;
	}

	const revisionIds = normalizeRevisionIds(decoded.right.Items);
	if (!revisionIds) {
		return null;
	}

	return { name, revisionIds };
};

export const parseTagItemsBody = (value: unknown): string[] | null => {
	const decoded = Schema.decodeUnknownEither(KoboTagItemsBodySchema)(value);
	if (Either.isLeft(decoded)) {
		return null;
	}

	return normalizeRevisionIds(decoded.right.Items);
};

export const parseRenameTagBody = (value: unknown): string | null => {
	const decoded = Schema.decodeUnknownEither(KoboRenameTagBodySchema)(value);
	if (Either.isLeft(decoded)) {
		return null;
	}

	return trimNonEmpty(decoded.right.Name);
};

export const parseDeviceAuthBody = (
	value: unknown,
): { userKey: string | null } | null => {
	const decoded = Schema.decodeUnknownEither(KoboDeviceAuthBodySchema)(value);
	if (Either.isLeft(decoded)) {
		return null;
	}

	const userKey =
		typeof decoded.right.UserKey === "string" ? decoded.right.UserKey : null;
	return { userKey };
};

type ParsedReadingStatePayload = {
	readingState?: typeof KoboReadingStateInputSchema.Type;
};

export const parseReadingStatePayload = (
	value: unknown,
): ParsedReadingStatePayload => {
	const decoded = Schema.decodeUnknownEither(KoboReadingStateBodySchema)(value);
	if (Either.isLeft(decoded)) {
		return {};
	}

	const readingState = decoded.right.ReadingStates[0];
	return readingState ? { readingState } : {};
};

export const mapTagError = (
	error:
		| KoboTagAccessDenied
		| SqlError
		| ConfigError
		| KoboTagNotFound
		| KoboTagInvalidPayload,
): { status: number; message: string; code: string } => {
	const tag = error._tag;
	if (tag === "KoboTagNotFound") {
		return {
			status: 404,
			message: "Collection isn't known to server",
			code: "KoboTagNotFound",
		};
	}

	if (tag === "KoboTagAccessDenied") {
		return { status: 401, message: "Unauthorized", code: "Unauthorized" };
	}

	if (tag === "KoboTagInvalidPayload") {
		return {
			status: 400,
			message: "Malformed tags request",
			code: "MalformedRequest",
		};
	}

	return {
		status: 500,
		message: "Internal Server Error",
		code: "InternalServerError",
	};
};
