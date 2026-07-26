import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ServerFnError } from "#/shared/server/serverErrors";
import { validateInput } from "#/shared/server/validateInput";

const ShelfInput = Schema.Struct({
	shelfId: Schema.String,
	page: Schema.optional(Schema.Number),
});

// A wholly optional payload is `UndefinedOr`, not `optional` — the latter is a
// property-signature helper and is not a standalone schema.
const OptionalInput = Schema.UndefinedOr(
	Schema.Struct({ limit: Schema.optional(Schema.Number) }),
);

describe("validateInput", () => {
	const validate = validateInput(ShelfInput);

	it("passes a well-formed payload through", () => {
		expect(validate({ shelfId: "s1", page: 2 })).toEqual({
			shelfId: "s1",
			page: 2,
		});
	});

	it("accepts an omitted optional field", () => {
		expect(validate({ shelfId: "s1" })).toEqual({ shelfId: "s1" });
	});

	it("rejects a missing required field with a 400", () => {
		expect(() => validate({})).toThrow(ServerFnError);
		try {
			validate({});
		} catch (error) {
			expect((error as ServerFnError).status).toBe(400);
			expect((error as ServerFnError).tag).toBe("InvalidInput");
		}
	});

	it("rejects a wrong field type", () => {
		expect(() => validate({ shelfId: 42 })).toThrow(ServerFnError);
	});

	it("rejects a non-object payload", () => {
		expect(() => validate("nope")).toThrow(ServerFnError);
		expect(() => validate(null)).toThrow(ServerFnError);
		expect(() => validate([])).toThrow(ServerFnError);
	});

	it("names the offending field so the client can act on it", () => {
		try {
			validate({ shelfId: 42 });
		} catch (error) {
			expect((error as ServerFnError).message).toContain("shelfId");
		}
	});

	it("does not let unexpected extra properties through", () => {
		const result = validate({ shelfId: "s1", injected: "x" }) as Record<
			string,
			unknown
		>;
		expect(result.injected).toBeUndefined();
	});

	it("supports a wholly optional payload", () => {
		const validateOptional = validateInput(OptionalInput);
		expect(validateOptional(undefined)).toBeUndefined();
		expect(validateOptional({ limit: 5 })).toEqual({ limit: 5 });
		expect(() => validateOptional({ limit: "five" })).toThrow(ServerFnError);
	});
});
