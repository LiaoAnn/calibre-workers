import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	createKoboTokenServerFn,
	getKoboTokensServerFn,
	revokeKoboTokenServerFn,
} from "#/features/kobo/server/kobo";

const koboTokensQueryKeys = {
	all: ["kobo", "tokens"] as const,
} as const;

const koboMutationKeys = {
	createToken: ["kobo", "mutation", "create-token"] as const,
	revokeToken: ["kobo", "mutation", "revoke-token"] as const,
} as const;

const toErrorMessage = (error: unknown, fallback: string) =>
	error instanceof Error ? error.message : fallback;

export function useKoboTokens(
	initialData?: Awaited<ReturnType<typeof getKoboTokensServerFn>>,
) {
	return useQuery({
		queryKey: koboTokensQueryKeys.all,
		queryFn: () => getKoboTokensServerFn(),
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
				queryKey: koboTokensQueryKeys.all,
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
				queryKey: koboTokensQueryKeys.all,
			});
		},
		onError: (error) => {
			toast.error(toErrorMessage(error, "撤銷 Kobo Token 失敗"));
		},
	});
}
