import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import {
	useCreateKoboToken,
	useKoboSettings,
	useRevokeKoboToken,
	useSetShelfKoboSync,
} from "#/hooks/useKoboSettings";
import { getPageTitle } from "#/lib/utils";
import { getSessionFromMiddlewareFn } from "#/middleware/auth";
import { getKoboSettingsServerFn } from "#/server/kobo";

const formatDateTime = (value: Date | string | number | null) => {
	if (!value) {
		return "-";
	}

	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "-";
	}

	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
};

const roleLabel: Record<"owner" | "editor" | "viewer", string> = {
	owner: "擁有者",
	editor: "編輯者",
	viewer: "檢視者",
};

export const Route = createFileRoute("/settings/kobo")({
	beforeLoad: async () => {
		const session = await getSessionFromMiddlewareFn();

		if (!session?.user || session.user.deletedAt) {
			throw redirect({ to: "/login" });
		}

		if (session.user.status !== "active") {
			throw redirect({ to: "/pending-approval" });
		}
	},
	head: () => ({
		meta: [{ title: getPageTitle("Kobo 裝置同步") }],
	}),
	loader: () => getKoboSettingsServerFn(),
	component: KoboSettingsPage,
});

function KoboSettingsPage() {
	const initialData = Route.useLoaderData();
	const { data } = useKoboSettings(initialData);
	const settings = data ?? initialData;
	const createKoboTokenMutation = useCreateKoboToken();
	const revokeKoboTokenMutation = useRevokeKoboToken();
	const setShelfKoboSyncMutation = useSetShelfKoboSync();
	const [endpointDialogToken, setEndpointDialogToken] = useState<string | null>(
		null,
	);

	const activeTokens = useMemo(
		() => settings.tokens.filter((token) => !token.revokedAt),
		[settings.tokens],
	);

	const endpointOrigin =
		typeof window === "undefined" ? "" : window.location.origin;

	const endpointDialogOpen = Boolean(endpointDialogToken);
	const endpointValue = endpointDialogToken
		? `${endpointOrigin}/api/kobo/${endpointDialogToken}`
		: "";

	function handleCreateToken() {
		createKoboTokenMutation.mutate(undefined);
	}

	async function handleCopyEndpoint() {
		if (!endpointValue) {
			return;
		}

		try {
			await navigator.clipboard.writeText(endpointValue);
			toast.success("已複製 api_endpoint");
		} catch {
			toast.error("複製失敗，請手動複製");
		}
	}

	return (
		<main className="page-wrap space-y-6 px-4 py-10">
			<Card>
				<CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-2">
						<CardTitle>Kobo 裝置授權 Token</CardTitle>
						<CardDescription>
							建立與撤銷 Kobo 裝置同步所需的 API Token。建立新 Token 後舊 Token
							會自動失效。
						</CardDescription>
					</div>
					<Button
						type="button"
						disabled={createKoboTokenMutation.isPending}
						className="w-fit"
						onClick={handleCreateToken}
					>
						{createKoboTokenMutation.isPending ? "建立中..." : "產生新 Token"}
					</Button>
				</CardHeader>
				<CardContent className="space-y-4">
					{activeTokens.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							目前沒有啟用中的 Kobo Token。
						</p>
					) : (
						<div className="space-y-3">
							{activeTokens.map((token) => {
								const isRevoking =
									revokeKoboTokenMutation.isPending &&
									revokeKoboTokenMutation.variables?.tokenId === token.id;

								return (
									<div
										key={token.id}
										className="space-y-3 rounded-lg border border-(--line) p-4"
									>
										<div className="flex items-center gap-2">
											<Badge>啟用中</Badge>
											<p className="text-xs text-muted-foreground">
												建立於 {formatDateTime(token.createdAt)}
											</p>
										</div>
										<code className="block w-full break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
											{token.token}
										</code>
										<div className="flex items-center justify-between gap-4">
											<p className="text-xs text-muted-foreground">
												最後更新 {formatDateTime(token.updatedAt)}
											</p>
											<div className="flex items-center gap-2">
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() => {
														setEndpointDialogToken(token.token);
													}}
												>
													查看 api_endpoint
												</Button>
												<Button
													type="button"
													variant="destructive"
													size="sm"
													disabled={isRevoking}
													onClick={() => {
														revokeKoboTokenMutation.mutate({
															tokenId: token.id,
														});
													}}
												>
													{isRevoking ? "撤銷中..." : "撤銷"}
												</Button>
											</div>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>書架同步設定</CardTitle>
					<CardDescription>
						設定哪些書架要同步到 Kobo 裝置。僅擁有者或編輯者可調整。
					</CardDescription>
				</CardHeader>
				<CardContent>
					{settings.shelves.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							目前沒有可設定同步的書架。
						</p>
					) : (
						<div className="space-y-3">
							{settings.shelves.map((shelf) => {
								const canEdit =
									shelf.memberRole === "owner" || shelf.memberRole === "editor";
								const isUpdating =
									setShelfKoboSyncMutation.isPending &&
									setShelfKoboSyncMutation.variables?.shelfId === shelf.shelfId;

								return (
									<div
										key={shelf.shelfId}
										className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-(--line) p-4"
									>
										<div className="space-y-1">
											<div className="flex flex-wrap items-center gap-2">
												<p className="font-medium">{shelf.shelfName}</p>
												<Badge variant="secondary">
													{roleLabel[shelf.memberRole]}
												</Badge>
												{shelf.enableKoboSync ? (
													<Badge>同步中</Badge>
												) : (
													<Badge variant="outline">未同步</Badge>
												)}
											</div>
											<p className="text-xs text-muted-foreground">
												最後更新 {formatDateTime(shelf.updatedAt)}
											</p>
										</div>
										<Button
											type="button"
											variant={shelf.enableKoboSync ? "secondary" : "outline"}
											disabled={isUpdating || !canEdit}
											onClick={() => {
												setShelfKoboSyncMutation.mutate({
													shelfId: shelf.shelfId,
													enabled: !shelf.enableKoboSync,
												});
											}}
										>
											{!canEdit
												? "無權限"
												: isUpdating
													? "更新中..."
													: shelf.enableKoboSync
														? "停用同步"
														: "啟用同步"}
										</Button>
									</div>
								);
							})}
						</div>
					)}
				</CardContent>
			</Card>

			<Dialog
				open={endpointDialogOpen}
				onOpenChange={(open) => {
					if (!open) {
						setEndpointDialogToken(null);
					}
				}}
			>
				<DialogContent className="sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>Kobo api_endpoint 設定值</DialogTitle>
						<DialogDescription>
							請將 Kobo 裝置端的 api_endpoint 替換為下列字串。
						</DialogDescription>
					</DialogHeader>
					<code className="block w-full break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
						{endpointValue}
					</code>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								關閉
							</Button>
						</DialogClose>
						<Button type="button" onClick={handleCopyEndpoint}>
							複製 api_endpoint
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</main>
	);
}
