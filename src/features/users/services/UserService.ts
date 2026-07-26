import "@tanstack/react-start/server-only";

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import * as schema from "#/shared/db/schema";
import { DatabaseContext, DatabaseLive } from "#/shared/layers/DatabaseLayer";

export type UserRole = "admin" | "user";
export type UserStatus = "pending" | "active";

class UserNotFound extends Data.TaggedError("UserNotFound")<{
	readonly userId: string;
}> {}

class UserAlreadyDeleted extends Data.TaggedError("UserAlreadyDeleted")<{
	readonly userId: string;
}> {}

class InvalidUserUpdate extends Data.TaggedError("InvalidUserUpdate")<{
	readonly reason: string;
}> {}

class CannotDemoteSelf extends Data.TaggedError("CannotDemoteSelf")<{
	readonly userId: string;
}> {}

class CannotDeleteSelf extends Data.TaggedError("CannotDeleteSelf")<{
	readonly userId: string;
}> {}

class LastAdminRequired extends Data.TaggedError("LastAdminRequired")<
	Record<string, never>
> {}

interface UpdateUserInput {
	actorId: string;
	userId: string;
	role?: UserRole;
	status?: UserStatus;
}

interface DeleteUserInput {
	actorId: string;
	userId: string;
}

interface ApplyManagedUserDefaultsInput {
	userId: string;
	role: UserRole;
	status: UserStatus;
}

export class UserService extends Effect.Service<UserService>()("UserService", {
	accessors: true,
	dependencies: [DatabaseLive],
	effect: Effect.gen(function* () {
		const database = yield* DatabaseContext;

		const countActiveAdmins = Effect.fn("UserService.countActiveAdmins")(
			function* (excludeUserId?: string) {
				const filters = [
					eq(schema.user.role, "admin"),
					eq(schema.user.status, "active"),
					isNull(schema.user.deletedAt),
				];

				if (excludeUserId) {
					filters.push(ne(schema.user.id, excludeUserId));
				}

				const rows = yield* database
					.select({ count: sql<number>`count(*)` })
					.from(schema.user)
					.where(and(...filters));

				return Number(rows[0]?.count ?? 0);
			},
		);

		/** Fails when removing this user would leave no active admin behind. */
		const ensureAnotherAdminRemains = Effect.fn(
			"UserService.ensureAnotherAdminRemains",
		)(function* (userId: string) {
			const adminsLeft = yield* countActiveAdmins(userId);
			if (adminsLeft === 0) {
				return yield* Effect.fail(new LastAdminRequired({}));
			}
		});

		// Explicit select rather than the relational query API: with sqlite-proxy
		// the relation mapper does not filter reliably here.
		const findUserForAdmin = Effect.fn("UserService.findUserForAdmin")(
			function* (userId: string) {
				const rows = yield* database
					.select({
						id: schema.user.id,
						role: schema.user.role,
						status: schema.user.status,
						deletedAt: schema.user.deletedAt,
					})
					.from(schema.user)
					.where(eq(schema.user.id, userId))
					.limit(1);

				const target = rows[0];
				if (!target) {
					return yield* Effect.fail(new UserNotFound({ userId }));
				}

				return target;
			},
		);

		const listUsers = Effect.fn("UserService.listUsers")(function* () {
			return yield* database.query.user.findMany({
				columns: {
					id: true,
					name: true,
					email: true,
					role: true,
					status: true,
					deletedAt: true,
					createdAt: true,
					updatedAt: true,
				},
				orderBy: desc(schema.user.createdAt),
			});
		});

		const applyManagedUserDefaults = Effect.fn(
			"UserService.applyManagedUserDefaults",
		)(function* ({ userId, role, status }: ApplyManagedUserDefaultsInput) {
			yield* database
				.update(schema.user)
				.set({ role, status, deletedAt: null })
				.where(eq(schema.user.id, userId));

			return { id: userId };
		});

		const updateUser = Effect.fn("UserService.updateUser")(function* ({
			actorId,
			userId,
			role,
			status,
		}: UpdateUserInput) {
			if (!role && !status) {
				return yield* Effect.fail(
					new InvalidUserUpdate({ reason: "role-or-status-required" }),
				);
			}

			const target = yield* findUserForAdmin(userId);

			if (target.deletedAt) {
				return yield* Effect.fail(new UserAlreadyDeleted({ userId }));
			}

			if (target.id === actorId && role === "user") {
				return yield* Effect.fail(new CannotDemoteSelf({ userId }));
			}

			const nextRole = role ?? target.role;
			const nextStatus = status ?? target.status;
			const staysActiveAdmin = nextRole === "admin" && nextStatus === "active";

			if (
				target.role === "admin" &&
				target.status === "active" &&
				!staysActiveAdmin
			) {
				yield* ensureAnotherAdminRemains(target.id);
			}

			yield* database
				.update(schema.user)
				.set({
					...(role ? { role } : {}),
					...(status ? { status } : {}),
				})
				.where(eq(schema.user.id, target.id));

			return { success: true };
		});

		const deleteUser = Effect.fn("UserService.deleteUser")(function* ({
			actorId,
			userId,
		}: DeleteUserInput) {
			const target = yield* findUserForAdmin(userId);

			if (target.id === actorId) {
				return yield* Effect.fail(new CannotDeleteSelf({ userId }));
			}

			if (target.deletedAt) {
				return { success: true };
			}

			if (target.role === "admin" && target.status === "active") {
				yield* ensureAnotherAdminRemains(target.id);
			}

			yield* database
				.update(schema.user)
				.set({ deletedAt: new Date() })
				.where(eq(schema.user.id, target.id));

			return { success: true };
		});

		return {
			listUsers,
			applyManagedUserDefaults,
			updateUser,
			deleteUser,
		};
	}),
}) {}
