import { useQuery } from "@tanstack/react-query";
import { getMetadataTasksServerFn, type Task } from "#/server/tasks";

export const metadataQueryKeys = {
	all: ["metadata", "tasks"] as const,
	tasks: (limit = 10) => [...metadataQueryKeys.all, { limit }] as const,
} as const;

export function useMetadataTasks(
	options: { limit?: number; bookId?: string } = {},
) {
	const limit = options.limit ?? 10;

	const { data, isLoading } = useQuery({
		queryKey: metadataQueryKeys.tasks(limit),
		queryFn: () => getMetadataTasksServerFn({ data: { limit } }),
		refetchInterval: (state) => {
			const tasks = state.state.data ?? [];
			const hasActiveTasks = tasks.some(
				(task) => task.status === "pending" || task.status === "processing",
			);
			return hasActiveTasks ? 3000 : false;
		},
		refetchIntervalInBackground: false,
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
	};
}
