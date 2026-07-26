import { Data } from "effect";
import { describe, expect, it } from "vitest";
import { httpErrorForTaggedError } from "#/shared/server/serverErrors";

class ShelfNotFound extends Data.TaggedError("ShelfNotFound")<{
	readonly shelfId: string;
}> {}
class ShelfAccessDenied extends Data.TaggedError("ShelfAccessDenied")<{
	readonly shelfId: string;
}> {}
class InvalidShelfName extends Data.TaggedError("InvalidShelfName")<{
	readonly reason: string;
}> {}
class LastAdminRequired extends Data.TaggedError("LastAdminRequired")<
	Record<string, never>
> {}
class ObjectNotFound extends Data.TaggedError("ObjectNotFound")<{
	readonly r2Key: string;
}> {}
class StorageError extends Data.TaggedError("StorageError")<{
	readonly operation: string;
	readonly cause: unknown;
}> {}
class Unmapped extends Data.TaggedError("SomethingNobodyMapped")<
	Record<string, never>
> {}

describe("httpErrorForTaggedError", () => {
	it("maps missing resources to 404", () => {
		expect(
			httpErrorForTaggedError(new ShelfNotFound({ shelfId: "s1" })),
		).toEqual({ status: 404, message: "書架不存在" });
		expect(
			httpErrorForTaggedError(new ObjectNotFound({ r2Key: "books/a.epub" }))
				.status,
		).toBe(404);
	});

	it("maps authorization failures to 403", () => {
		expect(
			httpErrorForTaggedError(new ShelfAccessDenied({ shelfId: "s1" })),
		).toEqual({ status: 403, message: "沒有權限存取此書架" });
	});

	it("maps invalid input to 400 and keeps the domain reason", () => {
		expect(
			httpErrorForTaggedError(new InvalidShelfName({ reason: "名稱不可空白" })),
		).toEqual({ status: 400, message: "名稱不可空白" });
	});

	it("maps state conflicts to 409", () => {
		expect(httpErrorForTaggedError(new LastAdminRequired({}))).toEqual({
			status: 409,
			message: "系統至少需要一位啟用中的管理員",
		});
	});

	it("maps infrastructure failures to 500 without leaking details", () => {
		const mapped = httpErrorForTaggedError(
			new StorageError({ operation: "file.upload", cause: "boom" }),
		);
		expect(mapped.status).toBe(500);
		expect(mapped.message).not.toContain("boom");
	});

	it("defaults an unmapped tag to 500 rather than silently succeeding", () => {
		expect(httpErrorForTaggedError(new Unmapped({})).status).toBe(500);
	});
});
