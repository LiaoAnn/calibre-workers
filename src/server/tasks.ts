import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import * as schema from "#/db/schema";
import { AppLayer } from "#/layers/AppLayer";
import { DatabaseContext } from "#/layers/DatabaseLayer";
import { requiredSessionMiddleware } from "#/middleware/auth";

type TaskType = "upload" | "conversion";
export type TaskStatus = "pending" | "processing" | "success" | "failed";

export interface Task {
	id: string;
	type: TaskType;
	fileName: string;
	status: TaskStatus;
	bookId?: string;
	sourceFileId?: string;
	errorMessage?: string;
	readAt?: number | null;
	createdAt: number;
	updatedAt: number;
}

interface GetTasksInput {
	limit?: number;
}

export const getUploadTasksServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: GetTasksInput) => input)
	.handler(async ({ data, context }) => {
		const limit = data.limit ?? 50;
		const userId = context.session.user.id;

		const runnable = Effect.gen(function* () {
			const database = yield* DatabaseContext;

			// Fetch upload tasks for this user
			const uploadTasks = yield* database.query.uploadTasks.findMany({
				where: eq(schema.uploadTasks.userId, userId),
				orderBy: desc(schema.uploadTasks.createdAt),
				limit: limit,
			});

			// Map upload tasks to unified Task format
			const uploadTasksMapped: Task[] = uploadTasks.map((task) => ({
				id: task.id,
				type: "upload" as const,
				fileName: task.fileName,
				status: task.status,
				bookId: task.bookId ?? undefined,
				errorMessage: task.errorMessage ?? undefined,
				readAt: task.readAt?.getTime() ?? null,
				createdAt: task.createdAt.getTime(),
				updatedAt: task.updatedAt.getTime(),
			}));

			return uploadTasksMapped;
		});

		return Effect.runPromise(runnable.pipe(Effect.provide(AppLayer)));
	});

export const getConversionTasksServerFn = createServerFn({
	method: "GET",
})
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: GetTasksInput) => input)
	.handler(async ({ data }) => {
		const limit = data.limit ?? 50;

		const runnable = Effect.gen(function* () {
			const database = yield* DatabaseContext;

			const conversionJobsRaw = yield* database.query.conversionJobs.findMany({
				with: {
					sourceFile: true,
				},
				orderBy: desc(schema.conversionJobs.updatedAt),
				limit: limit,
			});

			return conversionJobsRaw.map(
				(job): Task => ({
					id: job.id,
					type: "conversion",
					bookId: job.bookId,
					sourceFileId: job.sourceFileId,
					fileName: job.sourceFile
						? `${job.sourceFile.fileName} → ${job.targetFormat.toUpperCase()}`
						: `Conversion to ${job.targetFormat.toUpperCase()}`,
					status:
						job.status === "done" ? "success" : (job.status as TaskStatus),
					errorMessage: job.errorMessage ?? undefined,
					readAt: job.readAt?.getTime() ?? null,
					createdAt: job.createdAt.getTime(),
					updatedAt: job.updatedAt.getTime(),
				}),
			);
		});

		return Effect.runPromise(runnable.pipe(Effect.provide(AppLayer)));
	});

interface MarkTaskAsReadInput {
	taskId: string;
	taskType: TaskType;
}

export const markTaskAsReadServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: MarkTaskAsReadInput) => input)
	.handler(async ({ data, context }) => {
		const userId = context.session.user.id;

		const runnable = Effect.gen(function* () {
			const database = yield* DatabaseContext;

			if (data.taskType === "upload") {
				yield* database
					.update(schema.uploadTasks)
					.set({ readAt: new Date() })
					.where(
						and(
							eq(schema.uploadTasks.id, data.taskId),
							eq(schema.uploadTasks.userId, userId),
						),
					);
			} else if (data.taskType === "conversion") {
				yield* database
					.update(schema.conversionJobs)
					.set({ readAt: new Date() })
					.where(eq(schema.conversionJobs.id, data.taskId));
			}

			return { success: true };
		});

		return Effect.runPromise(runnable.pipe(Effect.provide(AppLayer)));
	});

interface MarkTasksAsReadInput {
	taskIds: { id: string; type: TaskType }[];
}

export const markTasksAsReadServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: MarkTasksAsReadInput) => input)
	.handler(async ({ data, context }) => {
		const userId = context.session.user.id;

		const runnable = Effect.gen(function* () {
			const database = yield* DatabaseContext;
			const uploadIds = data.taskIds
				.filter((t) => t.type === "upload")
				.map((t) => t.id);
			const conversionIds = data.taskIds
				.filter((t) => t.type === "conversion")
				.map((t) => t.id);

			const now = new Date();

			if (uploadIds.length > 0) {
				yield* database
					.update(schema.uploadTasks)
					.set({ readAt: now })
					.where(
						and(
							inArray(schema.uploadTasks.id, uploadIds),
							eq(schema.uploadTasks.userId, userId),
						),
					);
			}

			if (conversionIds.length > 0) {
				yield* database
					.update(schema.conversionJobs)
					.set({ readAt: now })
					.where(inArray(schema.conversionJobs.id, conversionIds));
			}

			return { success: true };
		});

		return Effect.runPromise(runnable.pipe(Effect.provide(AppLayer)));
	});
