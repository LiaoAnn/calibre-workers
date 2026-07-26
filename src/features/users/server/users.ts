import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Effect } from "effect";
import {
	type UserRole,
	UserService,
	type UserStatus,
} from "#/features/users/services/UserService";
import { auth } from "#/shared/auth/auth";
import { adminMiddleware } from "#/shared/auth/middleware";
import { ServerRuntime } from "#/shared/layers/AppRuntime";

interface CreateManagedUserInput {
	name: string;
	email: string;
	password: string;
	role?: UserRole;
	status?: UserStatus;
}

interface UpdateUserInput {
	userId: string;
	role?: UserRole;
	status?: UserStatus;
}

interface DeleteUserInput {
	userId: string;
}

export const getUsersServerFn = createServerFn({ method: "GET" })
	.middleware([adminMiddleware])
	.handler(async () => {
		return ServerRuntime.runPromise(UserService.listUsers());
	});

export const createManagedUserServerFn = createServerFn({ method: "POST" })
	.middleware([adminMiddleware])
	.inputValidator((input: CreateManagedUserInput) => input)
	.handler(async ({ data }) => {
		const role = data.role ?? "user";
		const status = data.status ?? "active";
		const headers = getRequestHeaders();

		// Better Auth owns account creation; the service only applies the
		// admin-chosen role and status afterwards.
		const result = await auth.api.signUpEmail({
			headers,
			body: {
				name: data.name,
				email: data.email,
				password: data.password,
			},
		});

		if (!result?.user?.id) {
			throw new Error("建立使用者失敗");
		}

		return ServerRuntime.runPromise(
			UserService.applyManagedUserDefaults({
				userId: result.user.id,
				role,
				status,
			}),
		);
	});

export const updateUserServerFn = createServerFn({ method: "POST" })
	.middleware([adminMiddleware])
	.inputValidator((input: UpdateUserInput) => input)
	.handler(async ({ data, context }) => {
		return ServerRuntime.runPromise(
			UserService.updateUser({
				actorId: context.session.user.id,
				userId: data.userId,
				role: data.role,
				status: data.status,
			}).pipe(
				Effect.catchTags({
					UserNotFound: () => Effect.die(new Error("找不到使用者")),
					UserAlreadyDeleted: () =>
						Effect.die(new Error("已刪除的使用者無法修改")),
					InvalidUserUpdate: () =>
						Effect.die(new Error("至少要提供 role 或 status 其中之一")),
					CannotDemoteSelf: () =>
						Effect.die(new Error("不能移除自己的管理員權限")),
					LastAdminRequired: () =>
						Effect.die(new Error("系統至少需要一位啟用中的管理員")),
				}),
			),
		);
	});

export const deleteUserServerFn = createServerFn({ method: "POST" })
	.middleware([adminMiddleware])
	.inputValidator((input: DeleteUserInput) => input)
	.handler(async ({ data, context }) => {
		return ServerRuntime.runPromise(
			UserService.deleteUser({
				actorId: context.session.user.id,
				userId: data.userId,
			}).pipe(
				Effect.catchTags({
					UserNotFound: () => Effect.die(new Error("找不到使用者")),
					CannotDeleteSelf: () => Effect.die(new Error("不能刪除自己的帳號")),
					LastAdminRequired: () =>
						Effect.die(new Error("系統至少需要一位啟用中的管理員")),
				}),
			),
		);
	});
