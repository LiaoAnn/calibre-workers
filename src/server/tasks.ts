import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
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
					createdAt: job.createdAt.getTime(),
					updatedAt: job.updatedAt.getTime(),
				}),
			);
		});

		return Effect.runPromise(runnable.pipe(Effect.provide(AppLayer)));
	});

interface DeleteTaskInput {
	taskId: string;
	taskType: TaskType;
}

export const deleteTaskServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: DeleteTaskInput) => input)
	.handler(async ({ data, context }) => {
		const userId = context.session.user.id;

		const runnable = Effect.gen(function* () {
			const database = yield* DatabaseContext;

			if (data.taskType === "upload") {
				// Delete upload task if it belongs to this user
				yield* database
					.delete(schema.uploadTasks)
					.where(
						and(
							eq(schema.uploadTasks.id, data.taskId),
							eq(schema.uploadTasks.userId, userId),
						),
					);
			} else if (data.taskType === "conversion") {
				yield* database
					.delete(schema.conversionJobs)
					.where(eq(schema.conversionJobs.id, data.taskId));
			}

			return { success: true };
		});

		return Effect.runPromise(runnable.pipe(Effect.provide(AppLayer)));
	});
