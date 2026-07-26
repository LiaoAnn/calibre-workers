import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { UserService } from "#/features/users/services/UserService";
import { runTest, runTestExit, seedUser } from "#/shared/test/helpers";

const causeOf = (exit: Exit.Exit<unknown, unknown>) =>
	JSON.stringify(Exit.causeOption(exit));

describe("UserService", () => {
	describe("listUsers", () => {
		it("returns users without leaking credential columns", async () => {
			const users = await runTest(
				Effect.gen(function* () {
					yield* seedUser({ name: "Ada", role: "admin" });
					return yield* UserService.listUsers();
				}),
			);

			const ada = users.find((user) => user.name === "Ada");
			expect(ada).toBeDefined();
			expect(Object.keys(ada ?? {}).sort()).toEqual([
				"createdAt",
				"deletedAt",
				"email",
				"id",
				"name",
				"role",
				"status",
				"updatedAt",
			]);
		});
	});

	describe("updateUser", () => {
		it("changes role and status for another user", async () => {
			const result = await runTest(
				Effect.gen(function* () {
					const actorId = yield* seedUser({ role: "admin" });
					const targetId = yield* seedUser({ role: "user", status: "pending" });

					yield* UserService.updateUser({
						actorId,
						userId: targetId,
						role: "admin",
						status: "active",
					});

					const users = yield* UserService.listUsers();
					return users.find((user) => user.id === targetId);
				}),
			);

			expect(result?.role).toBe("admin");
			expect(result?.status).toBe("active");
		});

		it("fails with UserNotFound for an unknown id", async () => {
			const exit = await runTestExit(
				Effect.gen(function* () {
					const actorId = yield* seedUser({ role: "admin" });
					return yield* UserService.updateUser({
						actorId,
						userId: "missing",
						role: "user",
					});
				}),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			expect(causeOf(exit)).toContain("UserNotFound");
		});

		it("fails with InvalidUserUpdate when neither role nor status is given", async () => {
			const exit = await runTestExit(
				Effect.gen(function* () {
					const actorId = yield* seedUser({ role: "admin" });
					const targetId = yield* seedUser();
					return yield* UserService.updateUser({ actorId, userId: targetId });
				}),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			expect(causeOf(exit)).toContain("InvalidUserUpdate");
		});

		it("fails with UserAlreadyDeleted when the target is soft deleted", async () => {
			const exit = await runTestExit(
				Effect.gen(function* () {
					const actorId = yield* seedUser({ role: "admin" });
					const targetId = yield* seedUser({ deletedAt: new Date() });
					return yield* UserService.updateUser({
						actorId,
						userId: targetId,
						status: "active",
					});
				}),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			expect(causeOf(exit)).toContain("UserAlreadyDeleted");
		});

		it("fails with CannotDemoteSelf when an admin demotes themselves", async () => {
			const exit = await runTestExit(
				Effect.gen(function* () {
					const actorId = yield* seedUser({ role: "admin", status: "active" });
					return yield* UserService.updateUser({
						actorId,
						userId: actorId,
						role: "user",
					});
				}),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			expect(causeOf(exit)).toContain("CannotDemoteSelf");
		});

		it("fails with LastAdminRequired when demoting the only active admin", async () => {
			const exit = await runTestExit(
				Effect.gen(function* () {
					const actorId = yield* seedUser({ role: "admin", status: "active" });
					const onlyAdmin = yield* seedUser({
						role: "admin",
						status: "active",
					});

					// Take the actor out of the running admin count first, so the target
					// really is the last active admin left.
					yield* UserService.updateUser({
						actorId: onlyAdmin,
						userId: actorId,
						status: "pending",
					});

					return yield* UserService.updateUser({
						actorId,
						userId: onlyAdmin,
						status: "pending",
					});
				}),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			expect(causeOf(exit)).toContain("LastAdminRequired");
		});
	});

	describe("deleteUser", () => {
		it("soft deletes another user", async () => {
			const target = await runTest(
				Effect.gen(function* () {
					const actorId = yield* seedUser({ role: "admin", status: "active" });
					const targetId = yield* seedUser({ role: "user" });

					yield* UserService.deleteUser({ actorId, userId: targetId });

					const users = yield* UserService.listUsers();
					return users.find((user) => user.id === targetId);
				}),
			);

			expect(target?.deletedAt).toBeInstanceOf(Date);
		});

		it("is idempotent for an already deleted user", async () => {
			const result = await runTest(
				Effect.gen(function* () {
					const actorId = yield* seedUser({ role: "admin", status: "active" });
					const targetId = yield* seedUser({ deletedAt: new Date() });
					return yield* UserService.deleteUser({ actorId, userId: targetId });
				}),
			);

			expect(result).toEqual({ success: true });
		});

		it("fails with CannotDeleteSelf", async () => {
			const exit = await runTestExit(
				Effect.gen(function* () {
					const actorId = yield* seedUser({ role: "admin", status: "active" });
					return yield* UserService.deleteUser({
						actorId,
						userId: actorId,
					});
				}),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			expect(causeOf(exit)).toContain("CannotDeleteSelf");
		});

		it("fails with LastAdminRequired when deleting the only active admin", async () => {
			const exit = await runTestExit(
				Effect.gen(function* () {
					const actorId = yield* seedUser({ role: "user", status: "active" });
					const onlyAdmin = yield* seedUser({
						role: "admin",
						status: "active",
					});

					return yield* UserService.deleteUser({
						actorId,
						userId: onlyAdmin,
					});
				}),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			expect(causeOf(exit)).toContain("LastAdminRequired");
		});
	});

	describe("applyManagedUserDefaults", () => {
		it("sets role and status and clears a previous soft delete", async () => {
			const updated = await runTest(
				Effect.gen(function* () {
					const userId = yield* seedUser({
						role: "user",
						status: "pending",
						deletedAt: new Date(),
					});

					yield* UserService.applyManagedUserDefaults({
						userId,
						role: "admin",
						status: "active",
					});

					const users = yield* UserService.listUsers();
					return users.find((user) => user.id === userId);
				}),
			);

			expect(updated?.role).toBe("admin");
			expect(updated?.status).toBe("active");
			expect(updated?.deletedAt).toBeNull();
		});
	});
});
