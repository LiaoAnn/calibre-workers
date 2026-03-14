import {
	useIsMutating,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	conversionQueryKeys,
	useConversionTasks,
} from "#/hooks/useConversionTasks";
import { useUploadQueue } from "#/hooks/useUploadQueue";
import {
	deleteTaskServerFn,
	getUploadTasksServerFn,
	type Task,
} from "#/server/tasks";

const notificationQueryKeys = {
	all: ["notification"] as const,
	tasks: (limit = 50) =>
		[...notificationQueryKeys.all, "tasks", { limit }] as const,
	uploadTasks: (limit = 50) =>
		[...notificationQueryKeys.all, "upload-tasks", { limit }] as const,
} as const;

const notificationMutationKeys = {
	uploadBook: ["mutation", "upload-book"] as const,
} as const;

export function useNotificationTasks(limit = 10) {
	const activeUploads = useIsMutating({
		mutationKey: notificationMutationKeys.uploadBook,
	});
	const { tasks: conversionTasks, isLoading: isConversionLoading } =
		useConversionTasks({
			limit,
		});
	const { queuedItems, uploadingItem, totalQueueLength } = useUploadQueue();

	const uploadQuery = useQuery({
		queryKey: notificationQueryKeys.uploadTasks(limit),
		queryFn: () => getUploadTasksServerFn({ data: { limit } }),
		refetchInterval: (query) => {
			const tasks = query.state.data ?? [];
			const hasActiveFromApi = tasks.some(
				(task) => task.status === "pending" || task.status === "processing",
			);
			const hasLocalQueue = totalQueueLength > 0;
			return hasActiveFromApi || hasLocalQueue || activeUploads > 0
				? 3000
				: false;
		},
		refetchIntervalInBackground: false,
	});

	const localQueueTasks: Task[] = [
		...queuedItems.map((item) => ({
			id: item.id,
			type: "upload" as const,
			fileName: item.file.name,
			status: "pending" as const,
			createdAt: item.submittedAt,
			updatedAt: item.submittedAt,
		})),
		...(uploadingItem
			? [
					{
						id: uploadingItem.id,
						type: "upload" as const,
						fileName: uploadingItem.file.name,
						status: "processing" as const,
						createdAt: uploadingItem.submittedAt,
						updatedAt: Date.now(),
					},
				]
			: []),
	];

	const uploadTasks = uploadQuery.data ?? [];
	const mergedTasks = [
		...localQueueTasks,
		...uploadTasks,
		...conversionTasks,
	].sort((a, b) => b.updatedAt - a.updatedAt);

	return {
		data: mergedTasks,
		isLoading: uploadQuery.isLoading || isConversionLoading,
	};
}

export function useDeleteNotificationTaskMutation() {
	const queryClient = useQueryClient();
	const { removeItem } = useUploadQueue();

	return useMutation({
		mutationFn: ({
			taskId,
			taskType,
		}: {
			taskId: string;
			taskType: Task["type"];
		}) => {
			if (taskId.startsWith("local-")) {
				removeItem(taskId);
				return Promise.resolve({ success: true });
			}
			return deleteTaskServerFn({ data: { taskId, taskType } });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: notificationQueryKeys.all,
			});
			queryClient.invalidateQueries({
				queryKey: conversionQueryKeys.all,
			});
		},
	});
}

export function useHasActiveNotificationTasks() {
	const { data: tasks = [] } = useNotificationTasks();
	const activeUploads = useIsMutating({
		mutationKey: notificationMutationKeys.uploadBook,
	});

	return (
		tasks.some((t) => t.status === "pending" || t.status === "processing") ||
		activeUploads > 0
	);
}
