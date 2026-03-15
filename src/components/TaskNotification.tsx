import { Link } from "@tanstack/react-router";
import {
	CheckCircle2,
	Clock,
	FileText,
	Inbox,
	Loader2,
	RefreshCw,
	X,
	XCircle,
} from "lucide-react";
import { Button } from "#/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
import {
	useMarkAllNotificationsAsReadMutation,
	useMarkNotificationTaskAsReadMutation,
	useNotificationTasks,
} from "#/hooks/useNotificationTasks";
import type { Task, TaskStatus } from "#/server/tasks";

function getStatusIcon(status: TaskStatus) {
	switch (status) {
		case "pending":
			return <Clock className="h-4 w-4 text-muted-foreground" />;
		case "processing":
			return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
		case "success":
			return <CheckCircle2 className="h-4 w-4 text-green-500" />;
		case "failed":
			return <XCircle className="h-4 w-4 text-red-500" />;
	}
}

function getStatusText(status: TaskStatus) {
	switch (status) {
		case "pending":
			return "等待中";
		case "processing":
			return "處理中";
		case "success":
			return "完成";
		case "failed":
			return "失敗";
	}
}

function TaskItem({
	task,
	onRemove,
}: {
	task: Task;
	onRemove: (id: string, type: Task["type"]) => void;
}) {
	return (
		<div className="flex items-start gap-2 py-2 px-1 border-b border-border last:border-0">
			<div className="mt-0.5 shrink-0">{getStatusIcon(task.status)}</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
					<p className="text-sm font-medium truncate">{task.fileName}</p>
				</div>
				<p className="text-xs text-muted-foreground mt-0.5">
					{getStatusText(task.status)}
					{task.type === "conversion" && " (轉換)"}
				</p>
				{task.errorMessage && (
					<p className="text-xs text-red-500 mt-1">{task.errorMessage}</p>
				)}
				{task.status === "success" && task.bookId && (
					<Link
						to="/books/$bookId"
						params={{ bookId: task.bookId }}
						className="text-xs text-primary hover:underline mt-1 inline-block"
					>
						查看書籍
					</Link>
				)}
			</div>
			{task.status !== "processing" && (
				<Button
					variant="ghost"
					size="icon"
					className="h-6 w-6 shrink-0 -mr-1"
					title="標示已讀"
					onClick={() => onRemove(task.id, task.type)}
				>
					<X className="h-3 w-3" />
				</Button>
			)}
		</div>
	);
}

export function TaskNotification() {
	const { data: tasks = [] } = useNotificationTasks();
	const markOneMutation = useMarkNotificationTaskAsReadMutation();
	const markAllMutation = useMarkAllNotificationsAsReadMutation();

	const activeTasks = tasks.filter(
		(t) => t.status === "pending" || t.status === "processing",
	);
	const completedTasks = tasks.filter(
		(t) => t.status === "success" || t.status === "failed",
	);

	const hasActiveTasks = activeTasks.length > 0;
	const hasCompleted = completedTasks.length > 0;
	const hasTasks = tasks.length > 0;

	const handleRemove = (taskId: string, taskType: Task["type"]) => {
		markOneMutation.mutate({ taskId, taskType });
	};

	const handleClearCompleted = () => {
		markAllMutation.mutate();
	};

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="icon" className="relative">
					{hasActiveTasks ? (
						<RefreshCw className="h-5 w-5 animate-spin" />
					) : (
						<Inbox className="h-5 w-5" />
					)}
					{hasActiveTasks && (
						<span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary" />
					)}
					{!hasActiveTasks && hasCompleted && (
						<span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500" />
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 max-h-96 overflow-hidden p-0">
				<div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
					<h3 className="text-sm font-semibold">任務中心</h3>
					{hasCompleted && (
						<Button
							variant="ghost"
							size="sm"
							className="h-7 text-xs"
							onClick={handleClearCompleted}
							disabled={markAllMutation.isPending}
						>
							<X className="h-3 w-3 mr-1" />
							全部標示已讀
						</Button>
					)}
				</div>

				<div className="max-h-80 overflow-y-auto">
					{!hasTasks ? (
						<div className="py-6 text-center text-sm text-muted-foreground">
							暫無任務
						</div>
					) : (
						<>
							{activeTasks.length > 0 && (
								<div className="px-3">
									<p className="text-xs font-medium text-muted-foreground py-2">
										進行中 ({activeTasks.length})
									</p>
									{activeTasks.map((task) => (
										<TaskItem
											key={task.id}
											task={task}
											onRemove={handleRemove}
										/>
									))}
								</div>
							)}

							{/* Completed Tasks */}
							{completedTasks.length > 0 && (
								<div className="px-3">
									<p className="text-xs font-medium text-muted-foreground py-2 border-t border-border">
										已完成 ({completedTasks.length})
									</p>
									{completedTasks.map((task) => (
										<TaskItem
											key={task.id}
											task={task}
											onRemove={handleRemove}
										/>
									))}
								</div>
							)}
						</>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
