import type { FormEvent } from "react";
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
import { Input } from "#/components/ui/input";

interface RenameShelfDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	value: string;
	onValueChange: (nextValue: string) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	isSubmitting: boolean;
}

export function RenameShelfDialog({
	open,
	onOpenChange,
	value,
	onValueChange,
	onSubmit,
	isSubmitting,
}: RenameShelfDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-120">
				<DialogHeader>
					<DialogTitle>重新命名書架</DialogTitle>
					<DialogDescription>
						更新後會立即套用在書架列表與此頁面。
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={onSubmit} className="space-y-4">
					<Input
						autoFocus
						value={value}
						onChange={(event) => onValueChange(event.target.value)}
						maxLength={120}
						disabled={isSubmitting}
					/>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline" disabled={isSubmitting}>
								取消
							</Button>
						</DialogClose>
						<Button type="submit" disabled={isSubmitting || !value.trim()}>
							儲存名稱
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
