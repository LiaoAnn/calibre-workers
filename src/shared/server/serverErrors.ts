/**
 * One place that decides what a tagged domain error means over HTTP.
 *
 * Before this existed, every server function converted its typed errors into
 * defects with `Effect.die(new Error(...))`, so a missing shelf and a broken
 * database both reached the client as an opaque 500. Keeping the mapping pure
 * and separate from the response side-effect makes it directly testable.
 */

export interface HttpError {
	readonly status: number;
	readonly message: string;
}

interface TaggedError {
	readonly _tag: string;
}

const hasStringField = <K extends string>(
	value: unknown,
	key: K,
): value is Record<K, string> =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as Record<string, unknown>)[key] === "string";

type Mapping = HttpError | ((error: TaggedError) => HttpError);

// Messages are kept identical to what the previous `Effect.die(new Error(...))`
// calls threw, so existing UI toasts read the same; only the status changes.
const MAPPINGS: Record<string, Mapping> = {
	// 404 — the addressed resource does not exist
	BookNotFound: { status: 404, message: "找不到書籍" },
	FileNotFound: { status: 404, message: "找不到檔案" },
	ObjectNotFound: { status: 404, message: "找不到檔案" },
	ShelfNotFound: { status: 404, message: "書架不存在" },
	ConversionJobNotFound: { status: 404, message: "找不到轉檔工作" },
	MetadataJobNotFound: { status: 404, message: "找不到中繼資料工作" },
	UserNotFound: { status: 404, message: "找不到使用者" },

	// 403 — authenticated but not allowed
	ShelfAccessDenied: { status: 403, message: "沒有權限存取此書架" },

	// 400 — the request itself is malformed or invalid
	InvalidShelfName: (error) => ({
		status: 400,
		message: hasStringField(error, "reason") ? error.reason : "書架名稱無效",
	}),
	InvalidUserUpdate: {
		status: 400,
		message: "至少要提供 role 或 status 其中之一",
	},
	UploadError: (error) => ({
		status: 400,
		message: hasStringField(error, "message") ? error.message : "上傳失敗",
	}),

	// 409 — valid request that conflicts with current state
	UserAlreadyDeleted: { status: 409, message: "已刪除的使用者無法修改" },
	CannotDemoteSelf: { status: 409, message: "不能移除自己的管理員權限" },
	CannotDeleteSelf: { status: 409, message: "不能刪除自己的帳號" },
	LastAdminRequired: { status: 409, message: "系統至少需要一位啟用中的管理員" },
};

const INTERNAL: HttpError = { status: 500, message: "伺服器發生錯誤" };

/**
 * Resolve a tagged error to a status and a client-safe message.
 *
 * Anything unmapped — including `SqlError`, `StorageError`, `ParseError` and any
 * tag added later without a decision here — falls through to 500 with a generic
 * message, so causes are never leaked to the client. The caller is responsible
 * for logging the real cause.
 */
export const httpErrorForTaggedError = (error: TaggedError): HttpError => {
	const mapping = MAPPINGS[error._tag];
	if (!mapping) {
		return INTERNAL;
	}

	return typeof mapping === "function" ? mapping(error) : mapping;
};
