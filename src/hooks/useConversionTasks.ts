import {
	useIsMutating,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { triggerConversionServerFn } from "#/server/conversions";
import { getConversionTasksServerFn, type Task } from "#/server/tasks";

export const conversionQueryKeys = {
	all: ["conversion", "tasks"] as const,
	tasks: (limit = 50) => [...conversionQueryKeys.all, { limit }] as const,
} as const;

export const conversionMutationKeys = {
	trigger: ["mutation", "convert-book"] as const,
} as const;

export function useConversionTasks(
	options: { limit?: number; bookId?: string } = {},
) {
	const queryClient = useQueryClient();
	const limit = options.limit ?? 50;

	const activeMutations = useIsMutating({
		mutationKey: conversionMutationKeys.trigger,
	});

	const { data, isLoading } = useQuery({
		queryKey: conversionQueryKeys.tasks(limit),
		queryFn: () => getConversionTasksServerFn({ data: { limit } }),
		refetchInterval: (state) => {
			const tasks = state.state.data ?? [];
			const hasActiveTasks = tasks.some(
				(t) => t.status === "pending" || t.status === "processing",
			);
			return hasActiveTasks || activeMutations > 0 ? 3000 : false;
		},
		refetchIntervalInBackground: false,
	});

	const triggerMutation = useMutation({
		mutationKey: conversionMutationKeys.trigger,
		mutationFn: async ({
			bookId,
			fileId,
			targetFormat,
		}: {
			bookId: string;
			fileId: string;
			targetFormat: string;
		}) => {
			const { jobId } = await triggerConversionServerFn({
				data: { bookId, fileId, targetFormat },
			});
			return { jobId, fileId };
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: conversionQueryKeys.all,
			});
		},
	});

	const allTasks = data ?? [];
	const tasks = options.bookId
		? allTasks.filter((task: Task) => task.bookId === options.bookId)
		: allTasks;
	const activeTasks = tasks.filter(
		(task: Task) => task.status === "pending" || task.status === "processing",
	);
	const completedTasks = tasks.filter(
		(task: Task) => task.status === "success" || task.status === "failed",
	);

	return {
		tasks,
		activeTasks,
		completedTasks,
		isLoading,
		triggerConversion: triggerMutation.mutateAsync,
		isTriggering: triggerMutation.isPending,
	};
}
