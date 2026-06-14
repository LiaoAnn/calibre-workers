import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";

interface BatchDeleteConfirmDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	selectedCount: number;
	onConfirm: () => void;
	isSubmitting: boolean;
}

export function BatchDeleteConfirmDialog({
	open,
	onOpenChange,
	selectedCount,
	onConfirm,
	isSubmitting,
}: BatchDeleteConfirmDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-120">
				<DialogHeader>
					<DialogTitle>批次移除書籍</DialogTitle>
					<DialogDescription>
						確定要從書架移除已勾選的 {selectedCount} 本書嗎？
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline" disabled={isSubmitting}>
							取消
						</Button>
					</DialogClose>
					<Button
						type="button"
						variant="destructive"
						disabled={isSubmitting}
						onClick={onConfirm}
					>
						確認移除
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
