import type { SqlError } from "@effect/sql/SqlError";
import { Data, Effect, Either, Schema } from "effect";
import type { ConfigError } from "effect/ConfigError";
import type { AppServices } from "#/shared/layers/AppLayer";

export const KOBO_TEXT_HEADERS = {
	"content-type": "text/plain; charset=utf-8",
};

export class KoboMalformedRouteParams extends Data.TaggedError(
	"KoboMalformedRouteParams",
)<Record<string, never>> {}

export class KoboUnauthorized extends Data.TaggedError("KoboUnauthorized")<
	Record<string, never>
> {}

export class KoboMalformedRequest extends Data.TaggedError(
	"KoboMalformedRequest",
)<{
	readonly reason: string;
	readonly code?: string;
}> {}

export class KoboMethodNotAllowed extends Data.TaggedError(
	"KoboMethodNotAllowed",
)<Record<string, never>> {}

export class KoboEncodingFailure extends Data.TaggedError(
	"KoboEncodingFailure",
)<{
	readonly operation: string;
	readonly cause?: unknown;
}> {}

export class KoboBookNotFound extends Data.TaggedError("KoboBookNotFound")<{
	readonly bookUuid?: string;
}> {}

export class KoboFileNotFound extends Data.TaggedError("KoboFileNotFound")<{
	readonly bookId?: string;
	readonly requestedFormat?: string;
}> {}

export class KoboTagNotFound extends Data.TaggedError("KoboTagNotFound")<{
	readonly tagId: string;
}> {}

export class KoboTagAccessDenied extends Data.TaggedError(
	"KoboTagAccessDenied",
)<{
	readonly tagId: string;
	readonly userId: string;
}> {}

export class KoboTagInvalidPayload extends Data.TaggedError(
	"KoboTagInvalidPayload",
)<{
	readonly reason: string;
}> {}

interface KoboNormalizedError {
	readonly status: number;
	readonly message: string;
	readonly code: string;
}

export type KoboHandledError =
	| KoboMalformedRouteParams
	| KoboUnauthorized
	| KoboMalformedRequest
	| KoboMethodNotAllowed
	| KoboEncodingFailure
	| KoboBookNotFound
	| KoboFileNotFound
	| KoboTagAccessDenied
	| KoboTagNotFound
	| KoboTagInvalidPayload
	| SqlError
	| ConfigError;

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
export type KoboLocalSyncItem = typeof KoboLocalSyncItemSchema.Type;
type KoboAuthResponse = typeof KoboAuthResponseSchema.Type;

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

const koboJsonErrorResponse = ({
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

const KOBO_INTERNAL_SERVER_ERROR: KoboNormalizedError = {
	status: 500,
	message: "Internal Server Error",
	code: "InternalServerError",
};

type KoboErrorMapEntry =
	| KoboNormalizedError
	| ((error: KoboHandledError) => KoboNormalizedError);

const KOBO_ERROR_MAP_BY_TAG: Readonly<
	Record<KoboHandledError["_tag"], KoboErrorMapEntry>
> = {
	KoboMalformedRequest: (error) => ({
		status: 400,
		message:
			error instanceof KoboMalformedRequest
				? error.reason || "Malformed request"
				: "Malformed request",
		code:
			error instanceof KoboMalformedRequest
				? (error.code ?? "MalformedRequest")
				: "MalformedRequest",
	}),
	KoboMalformedRouteParams: {
		status: 400,
		message: "Malformed route params",
		code: "MalformedRouteParams",
	},
	KoboUnauthorized: {
		status: 401,
		message: "Unauthorized",
		code: "Unauthorized",
	},
	KoboTagAccessDenied: {
		status: 401,
		message: "Unauthorized",
		code: "Unauthorized",
	},
	KoboMethodNotAllowed: {
		status: 405,
		message: "Method Not Allowed",
		code: "MethodNotAllowed",
	},
	KoboTagNotFound: {
		status: 404,
		message: "Collection isn't known to server",
		code: "KoboTagNotFound",
	},
	KoboTagInvalidPayload: {
		status: 400,
		message: "Malformed tags request",
		code: "MalformedRequest",
	},
	KoboBookNotFound: {
		status: 404,
		message: "Book not found",
		code: "BookNotFound",
	},
	KoboFileNotFound: {
		status: 404,
		message: "File not found",
		code: "FileNotFound",
	},
	KoboEncodingFailure: KOBO_INTERNAL_SERVER_ERROR,
	SqlError: KOBO_INTERNAL_SERVER_ERROR,
	ConfigError: KOBO_INTERNAL_SERVER_ERROR,
};

export const koboErrorResponseFromError = (
	error: KoboHandledError,
): Response => {
	const entry = KOBO_ERROR_MAP_BY_TAG[error._tag];
	if (!entry) {
		return koboJsonErrorResponse(KOBO_INTERNAL_SERVER_ERROR);
	}

	return koboJsonErrorResponse(
		typeof entry === "function" ? entry(error) : entry,
	);
};

export const koboInternalServerErrorResponse = (): Response =>
	koboJsonErrorResponse(KOBO_INTERNAL_SERVER_ERROR);

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

export const koboInitializationResourceSnapshot: Record<string, unknown> = {
	user_tasteprofile_genre:
		"https://storeapi.kobo.com/v2/user/tasteprofile/genre",
	user_tasteprofile_complete:
		"https://storeapi.kobo.com/v2/user/tasteprofile/complete",
	sepa_banks: "https://storeapi.kobo.com/v2/purchasing/sepa/banks",
	morebyauthor:
		"https://storeapi.kobo.com/v2/products/recommendations/morebyauthor",
	related: "https://storeapi.kobo.com/v2/products/recommendations/related",
	featuredlist2: "https://storeapi.kobo.com/v2/products/list/featured",
	topproducts: "https://storeapi.kobo.com/v2/products/list/topproducts",
	geography_data:
		"https://storeapi.kobo.com/v2/configuration/geography/country",
	bam: "https://storeapi.kobo.com/v2/activity/bam/success",
	tracking: "https://storeapi.kobo.com/v2/tracking/searchperformed",
	personalizedrecommendations:
		"https://storeapi.kobo.com/v2/users/personalizedrecommendations",
	ereaderdevices: "https://storeapi.kobo.com/v2/products/EReaderDeviceFeeds",
	contributorsv2: "https://storeapi.kobo.com/v2/contributors/author",
	productsv2: "https://storeapi.kobo.com/v2/products",
	productstatebyslug:
		"https://storeapi.kobo.com/v2/products/itemState/{ProductType}/{Slug}",
	productstatebyid:
		"https://storeapi.kobo.com/v2/products/itemStateById/{ProductType}/{Id}",
	productbyslug:
		"https://storeapi.kobo.com/v2/products/itemDetail/{ProductType}/{Slug}",
	productbyid:
		"https://storeapi.kobo.com/v2/products/itemDetailById/{ProductType}/{Id}",
	categoriesv2: "https://storeapi.kobo.com/api/v2/Categories/Top",
	user_wishlist: "https://storeapi.kobo.com/v1/user/wishlist",
	user_platform: "https://storeapi.kobo.com/v1/user/platform",
	user_profile: "https://storeapi.kobo.com/v1/user/profile",
	user_linked_accounts: "https://storeapi.kobo.com/v1/user/linkedaccounts",
	get_download_link: "https://storeapi.kobo.com/v1/library/downloadlink",
	get_download_keys: "https://storeapi.kobo.com/v1/library/downloadkeys",
	checkout_borrowed_book: "https://storeapi.kobo.com/v1/library/borrow",
	library_sync: "https://storeapi.kobo.com/v1/library/sync",
	library_search: "https://storeapi.kobo.com/v1/library/search",
	library_items: "https://storeapi.kobo.com/v1/user/library",
	add_entitlement: "https://storeapi.kobo.com/v1/library/{RevisionIds}",
	delete_entitlement: "https://storeapi.kobo.com/v1/library/{Ids}",
	tags: "https://storeapi.kobo.com/v1/library/tags",
	autocomplete: "https://storeapi.kobo.com/v1/products/autocomplete",
	user_reviews: "https://storeapi.kobo.com/v1/user/reviews",
	user_ratings: "https://storeapi.kobo.com/v1/user/ratings",
	user_recommendations: "https://storeapi.kobo.com/v1/user/recommendations",
	taste_profile: "https://storeapi.kobo.com/v1/products/tasteprofile",
	fte_feedback: "https://storeapi.kobo.com/v1/products/ftefeedback",
	shelfie_recommendations:
		"https://storeapi.kobo.com/v1/user/recommendations/shelfie",
	recommendations: "https://storeapi.kobo.com/v1/products/bulk",
	featured_lists: "https://storeapi.kobo.com/v1/products/featured",
	daily_deal: "https://storeapi.kobo.com/v1/products/dailydeal",
	category: "https://storeapi.kobo.com/v1/categories/{CategoryId}",
	browse_history: "https://storeapi.kobo.com/v1/user/browsehistory",
	notifications_registration_issue:
		"https://storeapi.kobo.com/v1/notifications/registration",
	exchange_auth: "https://storeapi.kobo.com/v1/auth/exchange",
	rakuten_token_exchange:
		"https://storeapi.kobo.com/v1/auth/rakuten_token_exchange",
	device_auth: "https://storeapi.kobo.com/v1/auth/device",
	device_refresh: "https://storeapi.kobo.com/v1/auth/refresh",
	add_device: "https://storeapi.kobo.com/v1/user/add-device",
	get_tests_request: "https://storeapi.kobo.com/v1/analytics/gettests",
	post_analytics_event: "https://storeapi.kobo.com/v1/analytics/event",
	user_loyalty_benefits: "https://storeapi.kobo.com/v1/user/loyalty/benefits",
	user_loyalty_membership:
		"https://storeapi.kobo.com/v1/user/loyalty/membership",
	redeem_loyalty_points: "https://storeapi.kobo.com/v1/user/loyalty/redeem",
	patch_user_linked_accounts:
		"https://storeapi.kobo.com/v1/user/linkedaccounts/{Id}",
	delete_user_linked_accounts:
		"https://storeapi.kobo.com/v1/user/linkedaccounts/{Id}",
	reading_state: "https://storeapi.kobo.com/v1/library/{Ids}/state",
	library_metadata: "https://storeapi.kobo.com/v1/library/{Ids}/metadata",
	update_accessibility_to_preview:
		"https://storeapi.kobo.com/v1/library/{EntitlementIds}/preview",
	rename_tag: "https://storeapi.kobo.com/v1/library/tags/{TagId}",
	delete_tag: "https://storeapi.kobo.com/v1/library/tags/{TagId}",
	user_currencyconversion: "https://storeapi.kobo.com/v1/user/currency/convert",
	quickbuy_create: "https://storeapi.kobo.com/v1/store/quickbuy/purchase",
	audiobook_purchase_withcredit:
		"https://storeapi.kobo.com/v1/store/audiobook/{Id}",
	product_reviews: "https://storeapi.kobo.com/v1/products/{ProductIds}/reviews",
	review: "https://storeapi.kobo.com/v1/products/reviews/{ReviewId}",
	product_recommendations:
		"https://storeapi.kobo.com/v1/products/{ProductId}/recommendations",
	product_nextread:
		"https://storeapi.kobo.com/v1/products/{ProductIds}/nextread",
	product_prices: "https://storeapi.kobo.com/v1/products/{ProductIds}/prices",
	book: "https://storeapi.kobo.com/v1/products/books/{ProductId}",
	audiobook: "https://storeapi.kobo.com/v1/products/audiobooks/{ProductId}",
	book_subscription:
		"https://storeapi.kobo.com/v1/products/books/subscriptions",
	related_items: "https://storeapi.kobo.com/v1/products/{Id}/related",
	featured_list:
		"https://storeapi.kobo.com/v1/products/featured/{FeaturedListId}",
	category_featured_lists:
		"https://storeapi.kobo.com/v1/categories/{CategoryId}/featured",
	category_products:
		"https://storeapi.kobo.com/v1/categories/{CategoryId}/products",
	delete_tag_items:
		"https://storeapi.kobo.com/v1/library/tags/{TagId}/items/delete",
	review_sentiment:
		"https://storeapi.kobo.com/v1/products/reviews/{ReviewId}/sentiment/{Sentiment}",
	library_prices: "https://storeapi.kobo.com/v1/user/library/previews/prices",
	library_book:
		"https://storeapi.kobo.com/v1/user/library/books/{LibraryItemId}",
	tag_items: "https://storeapi.kobo.com/v1/library/tags/{TagId}/items",
	quickbuy_checkout:
		"https://storeapi.kobo.com/v1/store/quickbuy/{PurchaseId}/checkout",
	rating: "https://storeapi.kobo.com/v1/products/{ProductId}/rating/{Rating}",
	authorproduct_recommendations:
		"https://storeapi.kobo.com/v1/products/books/authors/recommendations",
	external_book: "https://storeapi.kobo.com/v1/products/books/external/{Ids}",
	remaining_book_series:
		"https://storeapi.kobo.com/v1/products/books/series/{SeriesId}",
	audiobook_preview:
		"https://storeapi.kobo.com/v1/products/audiobooks/{Id}/preview",
	content_access_book:
		"https://storeapi.kobo.com/v1/products/books/{ProductId}/access",
	products: "https://storeapi.kobo.com/v1/products",
	categories: "https://storeapi.kobo.com/v1/categories",
	funnel_metrics: "https://storeapi.kobo.com/v1/funnelmetrics",
	deals: "https://storeapi.kobo.com/v1/deals",
	configuration_data: "https://storeapi.kobo.com/v1/configuration",
	assets: "https://storeapi.kobo.com/v1/assets",
	affiliaterequest: "https://storeapi.kobo.com/v1/affiliate",
	notebooks: "https://storeapi.kobo.com/api/internal/notebooks",
	image_host: "https://storeapi.kobo.com",
	store_host: "www.kobo.com",
	store_home: "www.kobo.com/{region}/{language}",
	social_authorization_host: "https://social.kobobooks.com:8443",
	social_host: "https://social.kobobooks.com",
	reading_services_host: "https://readingservices.kobo.com",
	discovery_host: "https://discovery.kobobooks.com",
	oauth_host: "https://oauth.kobo.com",
	eula_page: "https://www.kobo.com/termsofuse?style=onestore",
	password_retrieval_page: "https://www.kobo.com/passwordretrieval.html",
	store_search: "https://www.kobo.com/{region}/{language}/Search?Query={query}",
	store_top50: "https://www.kobo.com/{region}/{language}/ebooks/Top",
	store_newreleases:
		"https://www.kobo.com/{region}/{language}/List/new-releases/961XUjtsU0qxkFItWOutGA",
	privacy_page: "https://www.kobo.com/privacypolicy?style=onestore",
	terms_of_sale_page:
		"https://authorize.kobo.com/{region}/{language}/terms/termsofsale",
	book_detail_page: "https://www.kobo.com/{region}/{language}/ebook/{slug}",
	book_detail_page_rakuten: "http://books.rakuten.co.jp/rk/{crossrevisionid}",
	book_landing_page: "https://www.kobo.com/ebooks",
	magazine_landing_page: "https://www.kobo.com/emagazines",
	purchase_buy: "https://www.kobo.com/checkoutoption/",
	purchase_buy_templated:
		"https://www.kobo.com/{region}/{language}/checkoutoption/{ProductId}",
	love_points_redemption_page:
		"https://www.kobo.com/{region}/{language}/KoboSuperPointsRedemption?productId={ProductId}",
	categories_page: "https://www.kobo.com/ebooks/categories",
	redeem_interstitial_page: "https://www.kobo.com",
	love_dashboard_page:
		"https://www.kobo.com/{region}/{language}/kobosuperpoints",
	help_page: "https://www.kobo.com/help",
	image_url_template:
		"https://storeapi.kobo.com/{ImageId}/{Width}/{Height}/false/image.jpg",
	image_url_quality_template:
		"https://storeapi.kobo.com/{ImageId}/{Width}/{Height}/{Quality}/{IsGreyscale}/image.jpg",
	overdrive_account: "https://auth.overdrive.com/account",
	overdrive_library: "https://{libraryKey}.auth.overdrive.com/library",
	overdrive_library_finder_host: "https://libraryfinder.api.overdrive.com",
	overdrive_thunder_host: "https://thunder.api.overdrive.com",
	customer_care_live_chat:
		"https://v2.zopim.com/widget/livechat.html?key=Y6gwUmnu4OATxN3Tli4Av9bYN319BTdO",
	audiobook_landing_page: "https://www.kobo.com/{region}/{language}/audiobooks",
	userguide_host: "https://ereaderfiles.kobo.com",
	dictionary_host: "https://ereaderfiles.kobo.com",
	audiobook_detail_page:
		"https://www.kobo.com/{region}/{language}/audiobook/{slug}",
	wishlist_page: "https://www.kobo.com/{region}/{language}/account/wishlist",
	audiobook_subscription_orange_deal_inclusion_url:
		"https://authorize.kobo.com/inclusion",
	giftcard_redeem_url: "https://www.kobo.com/{storefront}/{language}/redeem",
	giftcard_epd_redeem_url:
		"https://www.kobo.com/{storefront}/{language}/redeem-ereader",
	account_page: "https://www.kobo.com/account/settings",
	account_page_rakuten: "https://my.rakuten.co.jp/",
	pocket_link_account_start:
		"https://authorize.kobo.com/{region}/{language}/linkpocket",
	client_authd_referral:
		"https://authorize.kobo.com/api/AuthenticatedReferral/client/v1/getLink",
	dropbox_link_account_start: "https://authorize.kobo.com/LinkDropbox/start",
	dropbox_link_account_poll:
		"https://authorize.kobo.com/{region}/{language}/LinkDropbox",
	googledrive_link_account_start:
		"https://authorize.kobo.com/{region}/{language}/linkcloudstorage/provider/google_drive",
	subs_management_page:
		"https://www.kobo.com/{region}/{language}/account/subscriptions",
	subs_landing_page: "https://www.kobo.com/{region}/{language}/plus",
	subs_purchase_buy_templated:
		"https://www.kobo.com/{region}/{language}/Checkoutoption/{ProductId}/{TierId}",
	subs_plans_page: "https://www.kobo.com/{region}/{language}/plus/plans",
	sign_in_page: "https://auth.kobobooks.com/ActivateOnWeb",
	more_sign_in_options:
		"https://authorize.kobo.com/signin?returnUrl=https://kobo.com/#allProviders",
	registration_page:
		"https://authorize.kobo.com/signup?returnUrl=https://kobo.com/",
	facebook_sso_page:
		"https://authorize.kobo.com/signin/provider/Facebook/login?returnUrl=https://kobo.com/",
	provider_external_sign_in_page:
		"https://authorize.kobo.com/ExternalSignIn/{providerName}?returnUrl=https://kobo.com/",
	free_books_page: {
		EN: "https://www.kobo.com/{region}/{language}/p/free-ebooks",
		FR: "https://www.kobo.com/{region}/{language}/p/livres-gratuits",
		IT: "https://www.kobo.com/{region}/{language}/p/libri-gratuiti",
		NL: "https://www.kobo.com/{region}/{language}/List/bekijk-het-overzicht-van-gratis-ebooks/QpkkVWnUw8sxmgjSlCbJRg",
		PT: "https://www.kobo.com/{region}/{language}/p/livros-gratis",
	},
	blackstone_header: {
		key: "x-amz-request-payer",
		value: "requester",
	},
	use_one_store: "True",
	kobo_superpoints_enabled: "False",
	kobo_subscriptions_enabled: "True",
	kobo_onestorelibrary_enabled: "False",
	kobo_nativeborrow_enabled: "True",
	kobo_audiobooks_enabled: "True",
	kobo_audiobooks_subscriptions_enabled: "False",
	kobo_audiobooks_credit_redemption: "False",
	kobo_audiobooks_orange_deal_enabled: "False",
	kobo_wishlist_enabled: "True",
	kobo_shelfie_enabled: "False",
	kobo_redeem_enabled: "True",
	kobo_dropbox_link_account_enabled: "True",
	kobo_display_price: "True",
	kobo_google_tax: "False",
	kobo_googledrive_link_account_enabled: "True",
	kobo_onedrive_link_account_enabled: "False",
	kobo_shopping_cart_enabled: "False",
	gpb_flow_enabled: "False",
	ppx_purchasing_url: "https://purchasing.kobo.com",
	createpurchaseifallowed_url:
		"https://www.kobo.com/checkout/createpurchaseifallowed",
	elabel_url: "https://ereaderfiles.kobo.com/elabels/",
	display_parental_controls_enabled: "False",
	display_accessibility_enabled: "False",
	text_to_speech_region_override: "False",
	reflowable_page_cache_enabled: "True",
	fixed_layout_page_cache_enabled: "True",
	optimus_enabled: "False",
	instapaper_enabled: "True",
	instapaper_link_account_start:
		"https://authorize.kobo.com/{region}/{language}/linkinstapaper",
	instapaper_env_url: "https://www.instapaper.com/api/kobo",
};

const KOBO_STORE_API_URL = "https://storeapi.kobo.com";
export const MAX_LOG_BODY_BYTES = 64 * 1024;

export interface BodySerializablePayload {
	body: ReadableStream | null;
	headers: Headers;
	formData(): Promise<FormData>;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export interface KoboAuthTokenContext {
	authTokenId: string;
	token: string;
	userId: string;
}

export type KoboRequestPayload = Pick<
	Request,
	"method" | "url" | "headers" | "clone" | "body" | "formData" | "arrayBuffer"
>;

export type KoboRouteParams = object;
export type KoboTokenRouteParams = {
	token: string | undefined;
};

export type KoboNormalizedParams<TParams extends KoboRouteParams> = {
	[K in keyof TParams]-?: Exclude<TParams[K], undefined>;
};

export interface KoboRouteHandlerInput<TParams extends KoboRouteParams> {
	request: KoboRequestPayload;
	params: TParams;
}

export type KoboAuthorizedHandlerInput<
	TInput extends KoboRouteHandlerInput<KoboRouteParams>,
> = {
	request: TInput["request"];
	params: KoboNormalizedParams<TInput["params"]>;
	koboToken: string;
	koboAuth: KoboAuthTokenContext;
};

export interface KoboHandlerOutput {
	response: Response;
	isHandledInternally: boolean;
}

type KoboLocalOrProxyResult<A> =
	| {
			readonly source: "local";
			readonly value: A;
	  }
	| {
			readonly source: "proxy";
			readonly output: KoboHandlerOutput;
	  };

export const toBase64 = (bytes: Uint8Array) => {
	let binary = "";
	const chunkSize = 0x8000;
	for (let index = 0; index < bytes.length; index += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
	}
	return btoa(binary);
};

const buildStoreUrl = (requestUrl: URL, token: string) => {
	const prefix = `/api/kobo/${token}`;
	const relativePath = requestUrl.pathname.startsWith(prefix)
		? requestUrl.pathname.slice(prefix.length) || "/"
		: requestUrl.pathname;
	const normalizedPath = relativePath.startsWith("/")
		? relativePath
		: `/${relativePath}`;

	return `${KOBO_STORE_API_URL}${normalizedPath}${requestUrl.search}`;
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

export const buildDummyAuthResponse = (
	userKey: string | null,
): KoboAuthResponse => ({
	AccessToken: toBase64(crypto.getRandomValues(new Uint8Array(24))),
	RefreshToken: toBase64(crypto.getRandomValues(new Uint8Array(24))),
	TokenType: "Bearer",
	TrackingId: crypto.randomUUID(),
	UserKey: userKey ?? "",
});

const toKoboProxyHandlerOutput = (response: Response): KoboHandlerOutput => ({
	response,
	isHandledInternally: false,
});

export const proxyKoboHandlerOutput = ({
	request,
	token,
	rawStoreToken,
}: {
	request: KoboRequestPayload;
	token: string;
	rawStoreToken?: string;
}) =>
	Effect.tryPromise({
		try: async () => {
			const proxySource = request.clone();
			const proxyUrl = buildStoreUrl(new URL(proxySource.url), token);
			const outgoingHeaders = new Headers(proxySource.headers);
			outgoingHeaders.delete("host");
			if (rawStoreToken) {
				outgoingHeaders.set("x-kobo-synctoken", rawStoreToken);
			}

			const proxyRequest = new Request(proxyUrl, {
				method: proxySource.method,
				headers: outgoingHeaders,
				body:
					proxySource.method === "GET" || proxySource.method === "HEAD"
						? null
						: proxySource.body,
				redirect: "manual",
			});

			const response = await fetch(proxyRequest);
			return toKoboProxyHandlerOutput(response);
		},
		catch: (cause) =>
			new Error(
				`Kobo proxy failed: ${cause instanceof Error ? cause.message : String(cause)}`,
			),
	});

export const resolveKoboLocalOrProxy = <A, E extends KoboHandledError>({
	local,
	request,
	token,
	rawStoreToken,
	onLocalFailure,
}: {
	local: Effect.Effect<A, E, AppServices>;
	request: KoboRequestPayload;
	token: string;
	rawStoreToken?: string;
	onLocalFailure: (error: E) => KoboHandledError;
}): Effect.Effect<KoboLocalOrProxyResult<A>, KoboHandledError, AppServices> =>
	Effect.gen(function* () {
		const localResult = yield* Effect.either(local);
		if (Either.isRight(localResult)) {
			return {
				source: "local",
				value: localResult.right,
			} as const;
		}

		const proxied = yield* Effect.either(
			proxyKoboHandlerOutput({
				request,
				token,
				rawStoreToken,
			}),
		);
		if (Either.isRight(proxied)) {
			return {
				source: "proxy",
				output: proxied.right,
			} as const;
		}

		return yield* Effect.fail(onLocalFailure(localResult.left));
	});
