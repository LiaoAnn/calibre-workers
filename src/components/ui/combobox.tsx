import { Check, ChevronsUpDown, X } from "lucide-react";
import * as React from "react";
import { Button } from "#/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "#/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
import { cn } from "#/lib/utils";

export interface ComboboxOption {
	value: string;
	label: string;
}

interface ComboboxProps {
	options: ComboboxOption[];
	value: string | string[];
	onChange: (value: string | string[]) => void;
	placeholder?: string;
	emptyText?: string;
	className?: string;
	disabled?: boolean;
	multi?: boolean;
}

export function Combobox({
	options,
	value,
	onChange,
	placeholder = "選擇...",
	emptyText = "沒有找到結果",
	className,
	disabled = false,
	multi = false,
}: ComboboxProps) {
	const [open, setOpen] = React.useState(false);
	const [inputValue, setInputValue] = React.useState("");

	if (multi) {
		return (
			<MultiSelectCombobox
				options={options}
				value={value as string[]}
				onChange={onChange as (value: string[]) => void}
				placeholder={placeholder}
				emptyText={emptyText}
				className={className}
				disabled={disabled}
				inputValue={inputValue}
				setInputValue={setInputValue}
				open={open}
				setOpen={setOpen}
			/>
		);
	}

	return (
		<SingleSelectCombobox
			options={options}
			value={value as string}
			onChange={onChange as (value: string) => void}
			placeholder={placeholder}
			emptyText={emptyText}
			className={className}
			disabled={disabled}
			inputValue={inputValue}
			setInputValue={setInputValue}
			open={open}
			setOpen={setOpen}
		/>
	);
}

interface SharedProps {
	options: ComboboxOption[];
	placeholder: string;
	emptyText: string;
	className?: string;
	disabled: boolean;
	inputValue: string;
	setInputValue: (value: string) => void;
	open: boolean;
	setOpen: (open: boolean) => void;
}

function SingleSelectCombobox({
	options,
	value,
	onChange,
	placeholder,
	emptyText,
	className,
	disabled,
	inputValue,
	setInputValue,
	open,
	setOpen,
}: SharedProps & { value: string; onChange: (value: string) => void }) {
	const selectedOption = options.find((opt) => opt.value === value);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					disabled={disabled}
					className={cn(
						"w-full justify-between font-normal",
						!selectedOption && "text-muted-foreground",
						className,
					)}
				>
					{selectedOption ? selectedOption.label : placeholder}
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-[--radix-popover-trigger-width] p-0"
				align="start"
			>
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="搜尋..."
						value={inputValue}
						onValueChange={setInputValue}
					/>
					<CommandList>
						<CommandEmpty>{emptyText}</CommandEmpty>
						<CommandGroup>
							{options
								.filter((opt) =>
									opt.label.toLowerCase().includes(inputValue.toLowerCase()),
								)
								.map((option) => (
									<CommandItem
										key={option.value}
										value={option.value}
										onSelect={(currentValue) => {
											onChange(currentValue === value ? "" : currentValue);
											setOpen(false);
											setInputValue("");
										}}
									>
										<Check
											className={cn(
												"mr-2 h-4 w-4",
												value === option.value ? "opacity-100" : "opacity-0",
											)}
										/>
										{option.label}
									</CommandItem>
								))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

function MultiSelectCombobox({
	options,
	value,
	onChange,
	placeholder,
	emptyText,
	className,
	disabled,
	inputValue,
	setInputValue,
	open,
	setOpen,
}: SharedProps & { value: string[]; onChange: (value: string[]) => void }) {
	const handleSelect = (selectedValue: string) => {
		if (value.includes(selectedValue)) {
			onChange(value.filter((v) => v !== selectedValue));
		} else {
			onChange([...value, selectedValue]);
		}
	};

	const handleRemove = (selectedValue: string) => {
		onChange(value.filter((v) => v !== selectedValue));
	};

	const filteredOptions = options.filter(
		(opt) =>
			opt.label.toLowerCase().includes(inputValue.toLowerCase()) &&
			!value.includes(opt.value),
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					disabled={disabled}
					className={cn(
						"w-full justify-between font-normal h-auto min-h-9 px-3 py-1.5",
						value.length === 0 && "text-muted-foreground",
						className,
					)}
				>
					<div className="flex flex-wrap gap-1 flex-1">
						{value.length === 0 ? (
							<span>{placeholder}</span>
						) : (
							value.map((v) => {
								const opt = options.find((o) => o.value === v);
								return (
									<span
										key={v}
										className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium"
									>
										{opt?.label ?? v}
										<button
											type="button"
											className="ml-0.5 hover:text-destructive"
											onClick={(e) => {
												e.stopPropagation();
												handleRemove(v);
											}}
										>
											<X className="h-3 w-3" />
										</button>
									</span>
								);
							})
						)}
					</div>
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-[--radix-popover-trigger-width] p-0"
				align="start"
			>
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="搜尋或輸入新值..."
						value={inputValue}
						onValueChange={setInputValue}
						onKeyDown={(e) => {
							if (e.key === "Enter" && inputValue.trim()) {
								e.preventDefault();
								// Allow adding custom values
								const trimmedValue = inputValue.trim();
								if (!value.includes(trimmedValue)) {
									onChange([...value, trimmedValue]);
								}
								setInputValue("");
							}
						}}
					/>
					<CommandList>
						<CommandEmpty>
							{inputValue.trim() ? (
								<button
									type="button"
									className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent"
									onClick={() => {
										const trimmedValue = inputValue.trim();
										if (!value.includes(trimmedValue)) {
											onChange([...value, trimmedValue]);
										}
										setInputValue("");
									}}
								>
									新增「{inputValue.trim()}」
								</button>
							) : (
								emptyText
							)}
						</CommandEmpty>
						<CommandGroup>
							{filteredOptions.map((option) => (
								<CommandItem
									key={option.value}
									value={option.value}
									onSelect={() => handleSelect(option.value)}
								>
									<Check
										className={cn(
											"mr-2 h-4 w-4",
											value.includes(option.value)
												? "opacity-100"
												: "opacity-0",
										)}
									/>
									{option.label}
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
