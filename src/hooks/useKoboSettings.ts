import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	createKoboTokenServerFn,
	getKoboSettingsServerFn,
	revokeKoboTokenServerFn,
	setShelfKoboSyncServerFn,
} from "#/server/kobo";

const koboSettingsQueryKeys = {
	all: ["kobo", "settings"] as const,
} as const;

const koboMutationKeys = {
	createToken: ["kobo", "mutation", "create-token"] as const,
	revokeToken: ["kobo", "mutation", "revoke-token"] as const,
	setShelfSync: ["kobo", "mutation", "set-shelf-sync"] as const,
} as const;

const toErrorMessage = (error: unknown, fallback: string) =>
	error instanceof Error ? error.message : fallback;

export function useKoboSettings(
	initialData?: Awaited<ReturnType<typeof getKoboSettingsServerFn>>,
) {
	return useQuery({
		queryKey: koboSettingsQueryKeys.all,
		queryFn: () => getKoboSettingsServerFn(),
		...(initialData ? { initialData } : {}),
	});
}

export function useCreateKoboToken() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: koboMutationKeys.createToken,
		mutationFn: () => createKoboTokenServerFn(),
		onSuccess: () => {
			toast.success(
				"已建立新的 Kobo Token，舊 Token 已失效。可用「查看 api_endpoint」取得完整字串。",
			);
			void queryClient.invalidateQueries({
				queryKey: koboSettingsQueryKeys.all,
			});
		},
		onError: (error) => {
			toast.error(toErrorMessage(error, "建立 Kobo Token 失敗"));
		},
	});
}

export function useRevokeKoboToken() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: koboMutationKeys.revokeToken,
		mutationFn: ({ tokenId }: { tokenId: string }) =>
			revokeKoboTokenServerFn({
				data: { tokenId },
			}),
		onSuccess: () => {
			toast.success("已撤銷 Kobo Token");
			void queryClient.invalidateQueries({
				queryKey: koboSettingsQueryKeys.all,
			});
		},
		onError: (error) => {
			toast.error(toErrorMessage(error, "撤銷 Kobo Token 失敗"));
		},
	});
}

export function useSetShelfKoboSync() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: koboMutationKeys.setShelfSync,
		mutationFn: ({ shelfId, enabled }: { shelfId: string; enabled: boolean }) =>
			setShelfKoboSyncServerFn({
				data: { shelfId, enabled },
			}),
		onSuccess: ({ enabled }) => {
			toast.success(enabled ? "已啟用書架 Kobo 同步" : "已停用書架 Kobo 同步");
			void queryClient.invalidateQueries({
				queryKey: koboSettingsQueryKeys.all,
			});
		},
		onError: (error) => {
			toast.error(toErrorMessage(error, "更新書架 Kobo 同步設定失敗"));
		},
	});
}
