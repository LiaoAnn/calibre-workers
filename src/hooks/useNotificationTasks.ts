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
import { metadataQueryKeys, useMetadataTasks } from "#/hooks/useMetadataTasks";
import {
	getUploadTasksServerFn,
	markTaskAsReadServerFn,
	markTasksAsReadServerFn,
	type Task,
} from "#/server/tasks";

const notificationQueryKeys = {
	all: ["notification"] as const,
	tasks: (limit = 10) =>
		[...notificationQueryKeys.all, "tasks", { limit }] as const,
	uploadTasks: (limit = 10) =>
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
	const { tasks: metadataTasks, isLoading: isMetadataLoading } =
		useMetadataTasks({
			limit,
		});

	const uploadQuery = useQuery({
		queryKey: notificationQueryKeys.uploadTasks(limit),
		queryFn: () => getUploadTasksServerFn({ data: { limit } }),
		refetchInterval: (query) => {
			const tasks = query.state.data ?? [];
			const hasActiveFromApi = tasks.some(
				(task) => task.status === "pending" || task.status === "processing",
			);
			return hasActiveFromApi || activeUploads > 0 ? 3000 : false;
		},
		refetchIntervalInBackground: false,
	});

	const uploadTasks = uploadQuery.data ?? [];
	const mergedTasks = [
		...uploadTasks,
		...conversionTasks,
		...metadataTasks,
	].sort((a, b) => b.updatedAt - a.updatedAt);
	const unreadTasks = mergedTasks.filter((task) => !task.readAt);

	return {
		data: unreadTasks,
		allTasks: mergedTasks,
		isLoading:
			uploadQuery.isLoading || isConversionLoading || isMetadataLoading,
	};
}

export function useMarkNotificationTaskAsReadMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			taskId,
			taskType,
		}: {
			taskId: string;
			taskType: Task["type"];
		}) => markTaskAsReadServerFn({ data: { taskId, taskType } }),
		// onMutate: async ({ taskId }) => {
		// 	await queryClient.cancelQueries({ queryKey: notificationQueryKeys.all });
		// 	await queryClient.cancelQueries({ queryKey: conversionQueryKeys.all });

		// 	const now = Date.now();
		// 	queryClient.setQueriesData(
		// 		{ queryKey: notificationQueryKeys.all },
		// 		(old) => {
		// 			if (!old) return old;
		// 			if (!Array.isArray(old)) return old;
		// 			return old.map((task) =>
		// 				task &&
		// 				typeof task === "object" &&
		// 				"id" in task &&
		// 				task.id === taskId
		// 					? { ...task, readAt: now }
		// 					: task,
		// 			);
		// 		},
		// 	);

		// 	queryClient.setQueriesData(
		// 		{ queryKey: conversionQueryKeys.all },
		// 		(old) => {
		// 			if (!old) return old;
		// 			if (!Array.isArray(old)) return old;
		// 			return old.map((task) =>
		// 				task &&
		// 				typeof task === "object" &&
		// 				"id" in task &&
		// 				task.id === taskId
		// 					? { ...task, readAt: now }
		// 					: task,
		// 			);
		// 		},
		// 	);
		// },
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: notificationQueryKeys.all,
			});
			queryClient.invalidateQueries({
				queryKey: conversionQueryKeys.all,
			});
			queryClient.invalidateQueries({
				queryKey: metadataQueryKeys.all,
			});
		},
	});
}

export function useMarkAllNotificationsAsReadMutation() {
	const queryClient = useQueryClient();
	const { data: tasks = [] } = useNotificationTasks(10);

	return useMutation({
		mutationFn: async () => {
			const completedTasks = tasks.filter(
				(task) =>
					(task.status === "success" || task.status === "failed") &&
					!task.readAt,
			);

			if (completedTasks.length > 0) {
				await markTasksAsReadServerFn({
					data: {
						taskIds: completedTasks.map((t) => ({ id: t.id, type: t.type })),
					},
				});
			}
			return { success: true, taskIds: completedTasks.map((t) => t.id) };
		},
		// onMutate: async () => {
		// 	await queryClient.cancelQueries({ queryKey: notificationQueryKeys.all });
		// 	await queryClient.cancelQueries({ queryKey: conversionQueryKeys.all });

		// 	const completedTasks = tasks.filter(
		// 		(task) =>
		// 			(task.status === "success" || task.status === "failed") &&
		// 			!task.readAt,
		// 	);
		// 	const taskIds = new Set(completedTasks.map((t) => t.id));

		// 	const now = Date.now();
		// 	queryClient.setQueriesData(
		// 		{ queryKey: notificationQueryKeys.all },
		// 		(old) => {
		// 			if (!old) return old;
		// 			if (!Array.isArray(old)) return old;
		// 			return old.map((task) =>
		// 				task &&
		// 				typeof task === "object" &&
		// 				"id" in task &&
		// 				taskIds.has(task.id as string)
		// 					? { ...task, readAt: now }
		// 					: task,
		// 			);
		// 		},
		// 	);

		// 	queryClient.setQueriesData(
		// 		{ queryKey: conversionQueryKeys.all },
		// 		(old) => {
		// 			if (!old) return old;
		// 			if (!Array.isArray(old)) return old;
		// 			return old.map((task) =>
		// 				task &&
		// 				typeof task === "object" &&
		// 				"id" in task &&
		// 				taskIds.has(task.id as string)
		// 					? { ...task, readAt: now }
		// 					: task,
		// 			);
		// 		},
		// 	);
		// },
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: notificationQueryKeys.all,
			});
			queryClient.invalidateQueries({
				queryKey: conversionQueryKeys.all,
			});
			queryClient.invalidateQueries({
				queryKey: metadataQueryKeys.all,
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
