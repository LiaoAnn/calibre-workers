import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useNotificationTasks } from "#/hooks/useNotificationTasks";
import type { Task } from "#/server/tasks";

export function TaskToastListener() {
	const { data: tasks = [], isLoading } = useNotificationTasks();
	const prevTasksRef = useRef<Task[]>([]);
	const knownTaskIdsRef = useRef<Set<string>>(new Set());
	const hasInitializedRef = useRef(false);

	useEffect(() => {
		// 先等待第一次 API 讀取完成，避免初始載入時有舊的已完成任務觸發通知
		if (isLoading) return;

		if (!hasInitializedRef.current) {
			hasInitializedRef.current = true;
			prevTasksRef.current = tasks;
			knownTaskIdsRef.current = new Set(tasks.map((t) => t.id));
			return;
		}

		const prevTasks = prevTasksRef.current;
		const prevTaskMap = new Map(prevTasks.map((t) => [t.id, t]));

		for (const task of tasks) {
			const wasKnown = knownTaskIdsRef.current.has(task.id);
			const prevTask = prevTaskMap.get(task.id);

			let justSucceeded = false;
			let justFailed = false;

			if (wasKnown) {
				// 我們之前看過它 (在某個狀態下)，如果前一次不是 success/failed，但這次是，則觸發
				if (
					task.status === "success" &&
					prevTask &&
					prevTask.status !== "success"
				) {
					justSucceeded = true;
				}
				if (
					task.status === "failed" &&
					prevTask &&
					prevTask.status !== "failed"
				) {
					justFailed = true;
				}
			} else {
				// 全新出現的 ID：可能是剛上傳完成被寫入 DB 並重新 fetch，或者是舊通知滾進來
				knownTaskIdsRef.current.add(task.id);

				// 通過檢查 updatedAt 是否在最近 30 秒內來過濾掉「補上的舊歷史記錄」
				const isRecent = Math.abs(Date.now() - task.updatedAt) < 30000;
				if (isRecent) {
					if (task.status === "success") justSucceeded = true;
					if (task.status === "failed") justFailed = true;
				}
			}

			if (justSucceeded) {
				const isConversion = task.type === "conversion";
				toast.success(
					<div className="flex flex-col gap-1">
						<span className="font-medium">
							{isConversion ? "轉換完成" : "上傳完成"}
						</span>
						<span className="text-sm text-muted-foreground line-clamp-2">
							{task.fileName}
						</span>
						{task.bookId && (
							<Link
								to="/books/$bookId"
								params={{ bookId: task.bookId }}
								className="text-sm text-primary hover:underline mt-1"
								onClick={(e) => {
									e.preventDefault();
									window.location.href = `/books/${task.bookId}`;
								}}
							>
								查看書籍 →
							</Link>
						)}
					</div>,
					{ duration: 5000 },
				);
			}

			if (justFailed) {
				const isConversion = task.type === "conversion";
				toast.error(
					<div className="flex flex-col gap-1">
						<span className="font-medium">
							{isConversion ? "轉換失敗" : "上傳失敗"}
						</span>
						<span className="text-sm text-muted-foreground">
							{task.fileName}
						</span>
						{task.errorMessage && (
							<span className="text-xs text-red-500">{task.errorMessage}</span>
						)}
					</div>,
					{ duration: 8000 },
				);
			}
		}

		prevTasksRef.current = tasks;
	}, [tasks, isLoading]);

	return null;
}
