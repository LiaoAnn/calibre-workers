import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	listShelfKoboSyncSettingsServerFn,
	setShelfKoboSyncServerFn,
} from "#/features/shelves/server/shelves";

const shelfKoboSyncQueryKeys = {
	all: ["shelves", "kobo-sync"] as const,
} as const;

const toErrorMessage = (error: unknown, fallback: string) =>
	error instanceof Error ? error.message : fallback;

export function useShelfKoboSyncSettings(
	initialData?: Awaited<ReturnType<typeof listShelfKoboSyncSettingsServerFn>>,
) {
	return useQuery({
		queryKey: shelfKoboSyncQueryKeys.all,
		queryFn: () => listShelfKoboSyncSettingsServerFn(),
		...(initialData ? { initialData } : {}),
	});
}

export function useSetShelfKoboSync() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["shelves", "mutation", "set-kobo-sync"] as const,
		mutationFn: ({ shelfId, enabled }: { shelfId: string; enabled: boolean }) =>
			setShelfKoboSyncServerFn({
				data: { shelfId, enabled },
			}),
		onSuccess: ({ enabled }) => {
			toast.success(enabled ? "已啟用書架 Kobo 同步" : "已停用書架 Kobo 同步");
			void queryClient.invalidateQueries({
				queryKey: shelfKoboSyncQueryKeys.all,
			});
		},
		onError: (error) => {
			toast.error(toErrorMessage(error, "更新書架 Kobo 同步設定失敗"));
		},
	});
}
