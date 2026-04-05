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

interface DeleteShelfDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	shelfName: string;
	onConfirm: () => void;
	isSubmitting: boolean;
}

export function DeleteShelfDialog({
	open,
	onOpenChange,
	shelfName,
	onConfirm,
	isSubmitting,
}: DeleteShelfDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-120">
				<DialogHeader>
					<DialogTitle>刪除書架</DialogTitle>
					<DialogDescription>
						確定要刪除「{shelfName}」嗎？此操作無法復原，書架中的書不會被刪除。
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
						確認刪除
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
