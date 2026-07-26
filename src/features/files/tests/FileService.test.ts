import { eq } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { BookService } from "#/features/books/services/BookService";
import { FileService } from "#/features/files/services/FileService";
import * as schema from "#/shared/db/schema";
import { DatabaseContext } from "#/shared/layers/DatabaseLayer";
import { R2Context } from "#/shared/layers/R2Layer";
import { runTest, runTestExit, seedUser } from "#/shared/test/helpers";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("FileService", () => {
	describe("upload / get / delete round-trip", () => {
		it("stores a file in R2 and reads it back", async () => {
			const payload = bytes("hello epub world");
			const r2Key = "books/round-trip.epub";

			const { size } = await runTest(
				FileService.uploadBookFile({
					r2Key,
					body: payload,
					contentType: "application/epub+zip",
				}),
			);
			expect(size).toBe(payload.byteLength);

			const object = await runTest(FileService.getBookFile(r2Key));
			const text = await runTest(Effect.promise(() => object.text()));
			expect(text).toBe("hello epub world");
		});

		it("reads a byte range", async () => {
			const r2Key = "books/range.epub";
			await runTest(
				FileService.uploadBookFile({ r2Key, body: bytes("0123456789") }),
			);

			const slice = await runTest(
				FileService.getBookFileRange({
					r2Key,
					range: { offset: 2, length: 3 },
				}),
			);
			expect(new TextDecoder().decode(slice)).toBe("234");
		});

		it("deletes a file", async () => {
			const r2Key = "books/to-delete.epub";
			await runTest(FileService.uploadBookFile({ r2Key, body: bytes("bye") }));
			await runTest(FileService.deleteBookFile(r2Key));

			const exit = await runTestExit(FileService.getBookFile(r2Key));
			expect(Exit.isFailure(exit)).toBe(true);
		});

		it("fails and removes the object on a size mismatch", async () => {
			const r2Key = "books/bad-size.epub";
			const exit = await runTestExit(
				FileService.uploadBookFile({
					r2Key,
					body: bytes("four"),
					expectedSize: 999,
				}),
			);
			expect(Exit.isFailure(exit)).toBe(true);

			// The partially uploaded object is not retrievable afterwards.
			const getExit = await runTestExit(FileService.getBookFile(r2Key));
			expect(Exit.isFailure(getExit)).toBe(true);
		});
	});

	describe("multipart upload", () => {
		it("creates, uploads a part and completes", async () => {
			const r2Key = "books/multipart.epub";
			const part = bytes("multipart body contents");

			const result = await runTest(
				Effect.gen(function* () {
					const created = yield* FileService.createMultipartUpload({
						r2Key,
						contentType: "application/epub+zip",
					});
					const uploaded = yield* FileService.uploadMultipartPart({
						r2Key,
						uploadId: created.uploadId,
						partNumber: 1,
						body: part,
					});
					return yield* FileService.completeMultipartUpload({
						r2Key,
						uploadId: created.uploadId,
						uploadedParts: [uploaded],
					});
				}),
			);
			expect(result.size).toBe(part.byteLength);

			const object = await runTest(FileService.getBookFile(r2Key));
			const text = await runTest(Effect.promise(() => object.text()));
			expect(text).toBe("multipart body contents");
		});

		it("aborts a multipart upload", async () => {
			const r2Key = "books/aborted.epub";
			await runTest(
				Effect.gen(function* () {
					const created = yield* FileService.createMultipartUpload({ r2Key });
					yield* FileService.uploadMultipartPart({
						r2Key,
						uploadId: created.uploadId,
						partNumber: 1,
						body: bytes("temp"),
					});
					yield* FileService.abortMultipartUpload({
						r2Key,
						uploadId: created.uploadId,
					});
				}),
			);

			const exit = await runTestExit(FileService.getBookFile(r2Key));
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	describe("FileService.failStaleUploadTasks", () => {
		it("marks stale tasks failed and cleans up their staging objects", async () => {
			const stagingKey = "staging/stale-upload.epub";
			const oldDate = new Date(Date.now() - 60 * 60 * 1000);

			const { staleId, freshId } = await runTest(
				Effect.gen(function* () {
					const storage = yield* R2Context;
					yield* Effect.promise(() => storage.put(stagingKey, bytes("x")));

					const db = yield* DatabaseContext;
					const userId = yield* seedUser();

					const staleId = crypto.randomUUID();
					yield* db.insert(schema.uploadTasks).values({
						id: staleId,
						userId,
						fileName: "stale.epub",
						stagingR2Key: stagingKey,
						status: "processing",
						updatedAt: oldDate,
					});

					const freshId = crypto.randomUUID();
					yield* db.insert(schema.uploadTasks).values({
						id: freshId,
						userId,
						fileName: "fresh.epub",
						status: "pending",
					});

					return { staleId, freshId };
				}),
			);

			const result = await runTest(
				FileService.failStaleUploadTasks({
					staleBefore: new Date(Date.now() - 30 * 60 * 1000),
					errorMessage: "stale upload",
				}),
			);
			expect(result.affectedCount).toBe(1);

			const { staleStatus, freshStatus } = await runTest(
				Effect.gen(function* () {
					const db = yield* DatabaseContext;
					const stale = yield* db
						.select()
						.from(schema.uploadTasks)
						.where(eq(schema.uploadTasks.id, staleId));
					const fresh = yield* db
						.select()
						.from(schema.uploadTasks)
						.where(eq(schema.uploadTasks.id, freshId));
					return {
						staleStatus: stale[0]?.status,
						freshStatus: fresh[0]?.status,
					};
				}),
			);

			expect(staleStatus).toBe("failed");
			expect(freshStatus).toBe("pending");

			// The orphaned staging object was cleaned up and is no longer retrievable.
			const stagingExit = await runTestExit(
				FileService.getBookFile(stagingKey),
			);
			expect(Exit.isFailure(stagingExit)).toBe(true);
		});
	});

	describe("FileService.getBookFileRecord", () => {
		it("returns the file record and fails with FileNotFound for an unknown id", async () => {
			const created = await runTest(
				BookService.createBookFromUpload({
					title: "Record",
					authors: ["A"],
					fileName: "record.epub",
					size: 7,
				}),
			);

			const record = await runTest(
				FileService.getBookFileRecord(created.book.id, created.file.id),
			);
			expect(record.id).toBe(created.file.id);
			expect(record.fileName).toBe("record.epub");

			const exit = await runTestExit(
				FileService.getBookFileRecord(created.book.id, "missing-file"),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(JSON.stringify(Exit.causeOption(exit))).toContain(
					"FileNotFound",
				);
			}
		});
	});
});
