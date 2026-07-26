import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Schema } from "effect";
import {
	UserRoleSchema,
	UserService,
	UserStatusSchema,
} from "#/features/users/services/UserService";
import { auth } from "#/shared/auth/auth";
import { adminMiddleware } from "#/shared/auth/middleware";
import { runServerEffect } from "#/shared/server/runServerEffect";
import { validateInput } from "#/shared/server/validateInput";

const CreateManagedUserInput = Schema.Struct({
	name: Schema.NonEmptyString,
	email: Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)),
	// Better Auth enforces its own policy on top; this is the floor.
	password: Schema.String.pipe(Schema.minLength(8)),
	role: Schema.optional(UserRoleSchema),
	status: Schema.optional(UserStatusSchema),
});

const UpdateUserInput = Schema.Struct({
	userId: Schema.NonEmptyString,
	role: Schema.optional(UserRoleSchema),
	status: Schema.optional(UserStatusSchema),
});

const DeleteUserInput = Schema.Struct({
	userId: Schema.NonEmptyString,
});

export const getUsersServerFn = createServerFn({ method: "GET" })
	.middleware([adminMiddleware])
	.handler(async () => {
		return runServerEffect(UserService.listUsers());
	});

export const createManagedUserServerFn = createServerFn({ method: "POST" })
	.middleware([adminMiddleware])
	.inputValidator(validateInput(CreateManagedUserInput))
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

		return runServerEffect(
			UserService.applyManagedUserDefaults({
				userId: result.user.id,
				role,
				status,
			}),
		);
	});

export const updateUserServerFn = createServerFn({ method: "POST" })
	.middleware([adminMiddleware])
	.inputValidator(validateInput(UpdateUserInput))
	.handler(async ({ data, context }) => {
		return runServerEffect(
			UserService.updateUser({
				actorId: context.session.user.id,
				userId: data.userId,
				role: data.role,
				status: data.status,
			}),
		);
	});

export const deleteUserServerFn = createServerFn({ method: "POST" })
	.middleware([adminMiddleware])
	.inputValidator(validateInput(DeleteUserInput))
	.handler(async ({ data, context }) => {
		return runServerEffect(
			UserService.deleteUser({
				actorId: context.session.user.id,
				userId: data.userId,
			}),
		);
	});
