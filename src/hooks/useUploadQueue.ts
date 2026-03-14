import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { create } from "zustand";
import { uploadBookServerFn } from "#/server/files";

const uploadQueueMutationKey = ["mutation", "upload-book"] as const;
const notificationTasksQueryKey = ["notification", "tasks"] as const;
const notificationUploadTasksQueryKey = [
	"notification",
	"upload-tasks",
] as const;

interface UploadQueueItem {
	id: string;
	file: File;
	status: "queued" | "uploading";
	submittedAt: number;
}

interface UploadQueueState {
	queue: UploadQueueItem[];
	uploadFn: ((file: File) => Promise<void>) | null;
	addFiles: (files: File[]) => void;
	setUploadFn: (fn: (file: File) => Promise<void>) => void;
	remove: (id: string) => void;
	processNext: () => void;
}

const useUploadQueueStore = create<UploadQueueState>((set, get) => ({
	queue: [],
	uploadFn: null,
	addFiles: (files) => {
		set((state) => ({
			queue: [
				...state.queue,
				...files.map((file) => ({
					id: `local-${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
					file,
					status: "queued" as const,
					submittedAt: Date.now(),
				})),
			],
		}));
		setTimeout(() => get().processNext(), 0);
	},
	setUploadFn: (fn) => set({ uploadFn: fn }),
	remove: (id) => {
		set((state) => ({
			queue: state.queue.filter((item) => item.id !== id),
		}));
		setTimeout(() => get().processNext(), 0);
	},
	processNext: () => {
		const { queue, uploadFn } = get();
		const uploading = queue.find((item) => item.status === "uploading");
		if (uploading) return;

		const next = queue.find((item) => item.status === "queued");
		if (!next || !uploadFn) return;

		set((state) => ({
			queue: state.queue.map((item) =>
				item.id === next.id ? { ...item, status: "uploading" as const } : item,
			),
		}));

		uploadFn(next.file).finally(() => {
			get().remove(next.id);
		});
	},
}));

export function useUploadQueue() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const { queue, addFiles, setUploadFn } = useUploadQueueStore();

	const uploadMutation = useMutation({
		mutationKey: uploadQueueMutationKey,
		mutationFn: async (file: File) => {
			const formData = new FormData();
			formData.set("file", file);
			return uploadBookServerFn({ data: formData });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: notificationTasksQueryKey,
			});
			queryClient.invalidateQueries({
				queryKey: notificationUploadTasksQueryKey,
			});
			router.invalidate();
		},
		onError: () => {
			queryClient.invalidateQueries({
				queryKey: notificationTasksQueryKey,
			});
			queryClient.invalidateQueries({
				queryKey: notificationUploadTasksQueryKey,
			});
		},
	});

	useEffect(() => {
		if (useUploadQueueStore.getState().uploadFn) return;
		setUploadFn(async (file) => {
			await uploadMutation.mutateAsync(file);
		});
	}, [setUploadFn, uploadMutation]);

	const queuedItems = queue.filter((item) => item.status === "queued");
	const uploadingItem = queue.find((item) => item.status === "uploading");

	return {
		addFilesToQueue: addFiles,
		removeItem: useUploadQueueStore.getState().remove,
		queuedItems,
		uploadingItem,
		totalQueueLength: queue.length,
	};
}
