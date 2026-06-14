import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { create } from "zustand";
import {
	abortBookUploadServerFn,
	completeBookUploadServerFn,
	createBookUploadSessionServerFn,
	uploadBookPartServerFn,
} from "#/features/books/server/files";

// TODO: centralized query key for tasks/jobs
const uploadQueueMutationKey = ["mutation", "upload-book"] as const;
const notificationTasksQueryKey = ["notification", "tasks"] as const;
const notificationUploadTasksQueryKey = [
	"notification",
	"upload-tasks",
] as const;

interface UploadBookWithMultipartOptions {
	title?: string;
	author?: string;
	onProgress?: (input: {
		uploadedBytes: number;
		totalBytes: number;
		uploadedParts: number;
		totalParts: number;
	}) => void;
	partConcurrency?: number;
}

const DEFAULT_PART_CONCURRENCY = 3;
const MAX_PART_RETRY_ATTEMPTS = 3;
const PART_RETRY_BASE_DELAY_MS = 250;

const wait = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

const normalizeErrorMessage = (error: unknown) =>
	error instanceof Error ? error.message : "Upload failed";

const uploadPartWithRetry = async (input: {
	taskId: string;
	partNumber: number;
	part: Blob;
}) => {
	let lastError: unknown;

	for (let attempt = 1; attempt <= MAX_PART_RETRY_ATTEMPTS; attempt += 1) {
		try {
			const formData = new FormData();
			formData.set("taskId", input.taskId);
			formData.set("partNumber", String(input.partNumber));
			formData.set("part", input.part, `part-${input.partNumber}`);

			return await uploadBookPartServerFn({ data: formData });
		} catch (error) {
			lastError = error;
			if (attempt >= MAX_PART_RETRY_ATTEMPTS) {
				break;
			}

			await wait(PART_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error("Failed to upload chunk");
};

async function uploadBookWithMultipart(
	file: File,
	options: UploadBookWithMultipartOptions = {},
) {
	const normalizedPartConcurrency = Math.max(
		1,
		Math.min(6, options.partConcurrency ?? DEFAULT_PART_CONCURRENCY),
	);
	let session: {
		taskId: string;
		partSizeBytes: number;
		totalParts: number;
	} | null = null;

	try {
		session = await createBookUploadSessionServerFn({
			data: {
				fileName: file.name,
				fileSize: file.size,
				mimeType: file.type || undefined,
			},
		});

		const taskId = session.taskId;
		const partSize = session.partSizeBytes;
		const totalParts = session.totalParts;
		const completedParts: Array<{ partNumber: number; eTag: string }> =
			new Array(totalParts);
		let nextPartNumber = 1;
		let uploadedBytes = 0;
		let uploadedParts = 0;
		let fatalError: unknown = null;

		const workers = Array.from(
			{ length: Math.min(normalizedPartConcurrency, totalParts) },
			() =>
				(async () => {
					while (true) {
						if (fatalError) {
							return;
						}

						const partNumber = nextPartNumber;
						nextPartNumber += 1;

						if (partNumber > totalParts) {
							return;
						}

						const start = (partNumber - 1) * partSize;
						const end = Math.min(file.size, start + partSize);
						const partBlob = file.slice(start, end);
						let uploadedPart: { partNumber: number; eTag: string };
						try {
							uploadedPart = await uploadPartWithRetry({
								taskId,
								partNumber,
								part: partBlob,
							});
						} catch (error) {
							fatalError = fatalError ?? error;
							throw error;
						}

						completedParts[partNumber - 1] = {
							partNumber: uploadedPart.partNumber,
							eTag: uploadedPart.eTag,
						};
						uploadedBytes += partBlob.size;
						uploadedParts += 1;

						options.onProgress?.({
							uploadedBytes,
							totalBytes: file.size,
							uploadedParts,
							totalParts,
						});
					}
				})(),
		);

		await Promise.all(workers);

		for (const part of completedParts) {
			if (!part) {
				throw new Error("Some upload chunks are missing");
			}
		}

		return await completeBookUploadServerFn({
			data: {
				taskId,
				parts: completedParts,
				fileSize: file.size,
				mimeType: file.type || undefined,
				title: options.title,
				author: options.author,
			},
		});
	} catch (error) {
		if (session?.taskId) {
			await abortBookUploadServerFn({
				data: {
					taskId: session.taskId,
					reason: `Client upload interrupted: ${normalizeErrorMessage(error)}`,
				},
			}).catch(() => undefined);
		}

		throw error;
	}
}

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
		mutationFn: async (file: File) => uploadBookWithMultipart(file),
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
