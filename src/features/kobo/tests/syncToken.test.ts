import { describe, expect, it } from "vitest";
import {
	parseKoboSyncTokenFromHeaders,
	setSyncTokenHeader,
} from "#/features/kobo/services/KoboService";

const HEADER = "x-kobo-synctoken";

const headersWith = (value?: string) => {
	const headers = new Headers();
	if (value !== undefined) {
		headers.set(HEADER, value);
	}
	return headers;
};

const EPOCH = new Date(0);

const expectDefaults = (
	token: ReturnType<typeof parseKoboSyncTokenFromHeaders>,
) => {
	expect(token.rawKoboStoreToken).toBe("");
	expect(token.booksLastModified).toEqual(EPOCH);
	expect(token.booksLastCreated).toEqual(EPOCH);
	expect(token.archiveLastModified).toEqual(EPOCH);
	expect(token.readingStateLastModified).toEqual(EPOCH);
	expect(token.tagsLastModified).toEqual(EPOCH);
};

// The sync token comes straight off a Kobo device, so every branch here is
// attacker-reachable input. Decoding stays deliberately tolerant — a token we
// cannot read means "sync from the beginning", never an error — but it must not
// reach the rest of the code as an unchecked cast.
describe("Kobo sync token", () => {
	it("returns defaults when the header is absent", () => {
		expectDefaults(parseKoboSyncTokenFromHeaders(headersWith()));
	});

	it("passes a raw Kobo store token straight through", () => {
		const raw = "aaa.bbb.ccc";
		const token = parseKoboSyncTokenFromHeaders(headersWith(raw));

		expect(token.rawKoboStoreToken).toBe(raw);
		expect(token.booksLastModified).toEqual(EPOCH);
	});

	it("round-trips a token it produced itself", () => {
		const original = {
			rawKoboStoreToken: "store-token",
			booksLastModified: new Date(1_700_000_000_000),
			booksLastCreated: new Date(1_600_000_000_000),
			archiveLastModified: new Date(1_500_000_000_000),
			readingStateLastModified: new Date(1_400_000_000_000),
			tagsLastModified: new Date(1_300_000_000_000),
		};

		const headers = new Headers();
		setSyncTokenHeader(headers, original);

		const parsed = parseKoboSyncTokenFromHeaders(headers);

		expect(parsed.rawKoboStoreToken).toBe("store-token");
		expect(parsed.booksLastModified).toEqual(original.booksLastModified);
		expect(parsed.booksLastCreated).toEqual(original.booksLastCreated);
		expect(parsed.archiveLastModified).toEqual(original.archiveLastModified);
		expect(parsed.readingStateLastModified).toEqual(
			original.readingStateLastModified,
		);
		expect(parsed.tagsLastModified).toEqual(original.tagsLastModified);
	});

	it("returns defaults for a value that is not base64", () => {
		expectDefaults(
			parseKoboSyncTokenFromHeaders(headersWith("!!!not base64!!!")),
		);
	});

	it("returns defaults when the decoded payload is not JSON", () => {
		expectDefaults(
			parseKoboSyncTokenFromHeaders(headersWith(btoa("not json"))),
		);
	});

	it("returns defaults when the payload has no data object", () => {
		expectDefaults(
			parseKoboSyncTokenFromHeaders(
				headersWith(btoa(JSON.stringify({ version: "1-1-0" }))),
			),
		);
	});

	it("returns defaults when data is not an object", () => {
		expectDefaults(
			parseKoboSyncTokenFromHeaders(
				headersWith(btoa(JSON.stringify({ data: "nope" }))),
			),
		);
	});

	it("returns defaults when the payload is a bare array", () => {
		expectDefaults(
			parseKoboSyncTokenFromHeaders(
				headersWith(btoa(JSON.stringify([1, 2, 3]))),
			),
		);
	});

	it("falls back per field when a timestamp has the wrong type", () => {
		const token = parseKoboSyncTokenFromHeaders(
			headersWith(
				btoa(
					JSON.stringify({
						data: {
							raw_kobo_store_token: 42,
							books_last_modified: "yesterday",
							books_last_created: 1_700_000,
						},
					}),
				),
			),
		);

		expect(token.rawKoboStoreToken).toBe("");
		expect(token.booksLastModified).toEqual(EPOCH);
		expect(token.booksLastCreated).toEqual(new Date(1_700_000 * 1000));
	});
});
