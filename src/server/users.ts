import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "#/db";
import * as schema from "#/db/schema";
import { auth } from "#/lib/auth";
import { adminMiddleware } from "#/middleware/auth";

type UserRole = "admin" | "user";
type UserStatus = "pending" | "active";

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

async function countActiveAdmins(excludeUserId?: string) {
	const filters = [
		eq(schema.user.role, "admin"),
		eq(schema.user.status, "active"),
		isNull(schema.user.deletedAt),
	];

	if (excludeUserId) {
		filters.push(ne(schema.user.id, excludeUserId));
	}

	const [{ count }] = await db
		.select({ count: sql<number>`count(*)` })
		.from(schema.user)
		.where(and(...filters));

	return count;
}

async function ensureNotRemovingLastAdmin(
	nextRole: UserRole,
	nextStatus: UserStatus,
	userId: string,
) {
	if (nextRole === "admin" && nextStatus === "active") {
		return;
	}

	const adminsLeft = await countActiveAdmins(userId);
	if (adminsLeft === 0) {
		throw new Error("系統至少需要一位啟用中的管理員");
	}
}

export const getUsersServerFn = createServerFn({ method: "GET" })
	.middleware([adminMiddleware])
	.handler(async () => {
		return db.query.user.findMany({
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

export const createManagedUserServerFn = createServerFn({ method: "POST" })
	.middleware([adminMiddleware])
	.inputValidator((input: CreateManagedUserInput) => input)
	.handler(async ({ data }) => {
		const role = data.role ?? "user";
		const status = data.status ?? "active";
		const headers = getRequestHeaders();

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

		await db
			.update(schema.user)
			.set({
				role,
				status,
				deletedAt: null,
			})
			.where(eq(schema.user.id, result.user.id));

		return { id: result.user.id };
	});

export const updateUserServerFn = createServerFn({ method: "POST" })
	.middleware([adminMiddleware])
	.inputValidator((input: UpdateUserInput) => input)
	.handler(async ({ data, context }) => {
		if (!data.role && !data.status) {
			throw new Error("至少要提供 role 或 status 其中之一");
		}

		const target = await db.query.user.findFirst({
			where: eq(schema.user.id, data.userId),
			columns: {
				id: true,
				role: true,
				status: true,
				deletedAt: true,
			},
		});

		if (!target) {
			throw new Error("找不到使用者");
		}

		if (target.deletedAt) {
			throw new Error("已刪除的使用者無法修改");
		}

		if (target.id === context.session.user.id && data.role === "user") {
			throw new Error("不能移除自己的管理員權限");
		}

		const nextRole = data.role ?? target.role;
		const nextStatus = data.status ?? target.status;

		if (target.role === "admin" && target.status === "active") {
			await ensureNotRemovingLastAdmin(nextRole, nextStatus, target.id);
		}

		await db
			.update(schema.user)
			.set({
				...(data.role ? { role: data.role } : {}),
				...(data.status ? { status: data.status } : {}),
			})
			.where(eq(schema.user.id, target.id));

		return { success: true };
	});

export const deleteUserServerFn = createServerFn({ method: "POST" })
	.middleware([adminMiddleware])
	.inputValidator((input: DeleteUserInput) => input)
	.handler(async ({ data, context }) => {
		const target = await db.query.user.findFirst({
			where: eq(schema.user.id, data.userId),
			columns: {
				id: true,
				role: true,
				status: true,
				deletedAt: true,
			},
		});

		if (!target) {
			throw new Error("找不到使用者");
		}

		if (target.id === context.session.user.id) {
			throw new Error("不能刪除自己的帳號");
		}

		if (target.deletedAt) {
			return { success: true };
		}

		if (target.role === "admin" && target.status === "active") {
			const adminsLeft = await countActiveAdmins(target.id);
			if (adminsLeft === 0) {
				throw new Error("系統至少需要一位啟用中的管理員");
			}
		}

		await db
			.update(schema.user)
			.set({
				deletedAt: new Date(),
			})
			.where(eq(schema.user.id, target.id));

		return { success: true };
	});
