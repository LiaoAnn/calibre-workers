import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Combobox, type ComboboxOption } from "#/components/ui/combobox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { getSessionFromMiddlewareFn } from "#/middleware/auth";
import {
	createManagedUserServerFn,
	deleteUserServerFn,
	getUsersServerFn,
	updateUserServerFn,
} from "#/server/users";

const roleOptions: ComboboxOption[] = [
	{ value: "user", label: "一般使用者" },
	{ value: "admin", label: "管理員" },
];

const statusOptions: ComboboxOption[] = [
	{ value: "active", label: "啟用" },
	{ value: "pending", label: "待審核" },
];

function isRole(value: string): value is "admin" | "user" {
	return value === "admin" || value === "user";
}

function isStatus(value: string): value is "active" | "pending" {
	return value === "active" || value === "pending";
}

export const Route = createFileRoute("/admin/users")({
	beforeLoad: async () => {
		const session = await getSessionFromMiddlewareFn();

		if (!session?.user || session.user.deletedAt) {
			throw redirect({ to: "/login" });
		}

		if (session.user.status !== "active") {
			throw redirect({ to: "/pending-approval" });
		}

		if (session.user.role !== "admin") {
			throw redirect({ to: "/" });
		}
	},
	loader: async () => {
		const [users, session] = await Promise.all([
			getUsersServerFn(),
			getSessionFromMiddlewareFn(),
		]);

		return { users, currentUserId: session?.user?.id };
	},
	component: AdminUsersPage,
});

function AdminUsersPage() {
	const { users, currentUserId } = Route.useLoaderData();
	const router = useRouter();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [role, setRole] = useState<"admin" | "user">("user");
	const [status, setStatus] = useState<"active" | "pending">("active");
	const [createError, setCreateError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [rowError, setRowError] = useState<string | null>(null);

	async function refresh() {
		await router.invalidate();
	}

	async function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setCreating(true);
		setCreateError(null);

		try {
			await createManagedUserServerFn({
				data: {
					name: name.trim(),
					email: email.trim(),
					password,
					role,
					status,
				},
			});

			setName("");
			setEmail("");
			setPassword("");
			setRole("user");
			setStatus("active");
			await refresh();
		} catch (error) {
			setCreateError(error instanceof Error ? error.message : "建立使用者失敗");
		} finally {
			setCreating(false);
		}
	}

	async function handleRoleChange(userId: string, nextRole: "admin" | "user") {
		setRowError(null);
		try {
			await updateUserServerFn({ data: { userId, role: nextRole } });
			await refresh();
		} catch (error) {
			setRowError(error instanceof Error ? error.message : "更新角色失敗");
		}
	}

	async function handleStatusChange(
		userId: string,
		nextStatus: "active" | "pending",
	) {
		setRowError(null);
		try {
			await updateUserServerFn({ data: { userId, status: nextStatus } });
			await refresh();
		} catch (error) {
			setRowError(error instanceof Error ? error.message : "更新狀態失敗");
		}
	}

	async function handleDelete(userId: string) {
		setRowError(null);
		try {
			await deleteUserServerFn({ data: { userId } });
			await refresh();
		} catch (error) {
			setRowError(error instanceof Error ? error.message : "刪除使用者失敗");
		}
	}

	return (
		<main className="page-wrap space-y-6 px-4 py-10">
			<Card>
				<CardHeader>
					<CardTitle>新增使用者</CardTitle>
				</CardHeader>
				<CardContent>
					<form
						className="grid gap-4 md:grid-cols-2"
						onSubmit={handleCreateUser}
					>
						<div className="space-y-2">
							<Label htmlFor="admin-create-name">名稱</Label>
							<Input
								id="admin-create-name"
								required
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="admin-create-email">Email</Label>
							<Input
								id="admin-create-email"
								type="email"
								required
								value={email}
								onChange={(event) => setEmail(event.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="admin-create-password">密碼</Label>
							<Input
								id="admin-create-password"
								type="password"
								required
								minLength={8}
								value={password}
								onChange={(event) => setPassword(event.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="admin-create-role">角色</Label>
							<Combobox
								options={roleOptions}
								value={role}
								onChange={(value) => {
									if (typeof value === "string" && isRole(value)) {
										setRole(value);
									}
								}}
								className="h-9"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="admin-create-status">狀態</Label>
							<Combobox
								options={statusOptions}
								value={status}
								onChange={(value) => {
									if (typeof value === "string" && isStatus(value)) {
										setStatus(value);
									}
								}}
								className="h-9"
							/>
						</div>
						<div className="flex justify-end items-end">
							<Button type="submit" disabled={creating}>
								{creating ? "建立中..." : "建立使用者"}
							</Button>
						</div>
					</form>
					{createError ? (
						<p className="mt-3 text-sm text-destructive">{createError}</p>
					) : null}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>使用者管理</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					{rowError ? (
						<p className="text-sm text-destructive">{rowError}</p>
					) : null}
					<div className="space-y-3">
						{users.map((user) => {
							const isDeleted = Boolean(user.deletedAt);
							const isSelf = user.id === currentUserId;

							return (
								<div
									key={user.id}
									className="rounded-lg border border-[var(--line)] p-4"
								>
									<div className="mb-3 flex flex-wrap items-center gap-2">
										<p className="font-medium">{user.name || "(未命名)"}</p>
										<p className="text-sm text-muted-foreground">
											{user.email}
										</p>
										{user.role === "admin" ? <Badge>Admin</Badge> : null}
										{user.status === "pending" ? (
											<Badge variant="secondary">Pending</Badge>
										) : (
											<Badge variant="secondary">Active</Badge>
										)}
										{isDeleted ? (
											<Badge variant="destructive">Deleted</Badge>
										) : null}
									</div>
									<div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
										<Combobox
											options={roleOptions}
											value={user.role}
											disabled={isDeleted}
											onChange={(value) => {
												if (typeof value === "string" && isRole(value)) {
													handleRoleChange(user.id, value);
												}
											}}
											className="h-9"
										/>
										<Combobox
											options={statusOptions}
											value={user.status}
											disabled={isDeleted}
											onChange={(value) => {
												if (typeof value === "string" && isStatus(value)) {
													handleStatusChange(user.id, value);
												}
											}}
											className="h-9"
										/>
										<Button
											type="button"
											variant="destructive"
											disabled={isDeleted || isSelf}
											onClick={() => handleDelete(user.id)}
										>
											軟刪除
										</Button>
									</div>
								</div>
							);
						})}
					</div>
				</CardContent>
			</Card>
		</main>
	);
}
