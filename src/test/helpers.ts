import { Effect, Layer } from "effect";
import * as schema from "#/db/schema";
import { AppLayer } from "#/layers/AppLayer";
import { ConverterContainerContext } from "#/layers/ConverterContainerLayer";
import type { DatabaseContext } from "#/layers/DatabaseLayer";
import { DatabaseContext as DbTag } from "#/layers/DatabaseLayer";
import type { R2Context } from "#/layers/R2Layer";

// ---------------------------------------------------------------------------
// Fake converter container
// ---------------------------------------------------------------------------
// The real ConverterContainerLive talks to a Docker-backed durable object that
// Miniflare cannot run. Services under test never call it directly (the queue
// handler does), but we provide a deterministic stub so the context tag can be
// satisfied wherever it is required.

const cannedStream = (bytes: Uint8Array) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});

const cannedResult = () => {
	const bytes = new TextEncoder().encode("converted-bytes");
	return {
		body: cannedStream(bytes),
		contentType: "application/octet-stream",
		size: bytes.byteLength,
	};
};

const FakeConverterLayer = Layer.succeed(ConverterContainerContext, {
	process: () => Effect.succeed(cannedResult()),
	convert: () => Effect.succeed(cannedResult()),
});

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
// AppLayer wires the real local D1 + R2 bindings (populated by Miniflare via
// `cloudflare:workers`). FakeConverterLayer covers the converter tag.

const TestLayer = Layer.mergeAll(AppLayer, FakeConverterLayer);

type TestEnv = DatabaseContext | R2Context | ConverterContainerContext;

/** Run an Effect against the real local bindings; rejects on failure. */
export const runTest = <A, E>(effect: Effect.Effect<A, E, TestEnv>) =>
	Effect.runPromise(Effect.provide(effect, TestLayer));

/** Run an Effect and capture success/failure as an Exit for asserting error tags. */
export const runTestExit = <A, E>(effect: Effect.Effect<A, E, TestEnv>) =>
	Effect.runPromiseExit(Effect.provide(effect, TestLayer));

// ---------------------------------------------------------------------------
// Seed helpers — Effects requiring DatabaseContext, composable inside a test's
// own Effect.gen block alongside the service call under test.
// ---------------------------------------------------------------------------

const id = () => crypto.randomUUID();

export const seedUser = (
	overrides: Partial<typeof schema.user.$inferInsert> = {},
) =>
	Effect.gen(function* () {
		const db = yield* DbTag;
		const userId = overrides.id ?? id();
		yield* db.insert(schema.user).values({
			id: userId,
			name: overrides.name ?? "Test User",
			email: overrides.email ?? `${userId}@test.local`,
			role: overrides.role ?? "user",
			status: overrides.status ?? "active",
			emailVerified: overrides.emailVerified ?? true,
			...overrides,
		});
		return userId;
	});

export const seedBook = (
	overrides: Partial<typeof schema.books.$inferInsert> = {},
) =>
	Effect.gen(function* () {
		const db = yield* DbTag;
		const bookId = overrides.id ?? id();
		yield* db.insert(schema.books).values({
			id: bookId,
			uuid: overrides.uuid ?? id(),
			title: overrides.title ?? "Test Book",
			authors: overrides.authors ?? "Test Author",
			...overrides,
		});
		return bookId;
	});

export const seedBookFile = (
	bookId: string,
	overrides: Partial<typeof schema.bookFiles.$inferInsert> = {},
) =>
	Effect.gen(function* () {
		const db = yield* DbTag;
		const fileId = overrides.id ?? id();
		yield* db.insert(schema.bookFiles).values({
			id: fileId,
			bookId,
			format: overrides.format ?? "epub",
			fileName: overrides.fileName ?? "test.epub",
			r2Key: overrides.r2Key ?? `books/${fileId}.epub`,
			size: overrides.size ?? 1024,
			...overrides,
		});
		return fileId;
	});
