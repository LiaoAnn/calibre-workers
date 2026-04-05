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
	DialogTrigger,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";

interface CreateShelfDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	name: string;
	onNameChange: (nextValue: string) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	isSubmitting: boolean;
}

export function CreateShelfDialog({
	open,
	onOpenChange,
	name,
	onNameChange,
	onSubmit,
	isSubmitting,
}: CreateShelfDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button>新增書架</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-120">
				<DialogHeader>
					<DialogTitle>建立新書架</DialogTitle>
					<DialogDescription>
						為這個書架取一個清楚的名稱，之後可隨時調整。
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={onSubmit} className="space-y-4">
					<Input
						autoFocus
						placeholder="例如：今年必讀"
						value={name}
						onChange={(event) => onNameChange(event.target.value)}
						maxLength={120}
						disabled={isSubmitting}
					/>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline" disabled={isSubmitting}>
								取消
							</Button>
						</DialogClose>
						<Button type="submit" disabled={isSubmitting || !name.trim()}>
							建立書架
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
