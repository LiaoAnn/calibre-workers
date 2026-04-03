import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import * as React from "react";
import { Button } from "#/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandLoading,
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
	onInputValueChange?: (value: string) => void;
	loading?: boolean;
	placeholder?: string;
	emptyText?: string;
	className?: string;
	disabled?: boolean;
	multi?: boolean;
}

const normalizeText = (text: string) => text.trim().toLowerCase();

const optionMatchesQuery = (
	option: ComboboxOption,
	normalizedQuery: string,
) => {
	if (!normalizedQuery) {
		return true;
	}

	return (
		normalizeText(option.label).includes(normalizedQuery) ||
		normalizeText(option.value).includes(normalizedQuery)
	);
};

const hasExactOptionMatch = (options: ComboboxOption[], input: string) => {
	const normalizedInput = normalizeText(input);
	if (!normalizedInput) {
		return false;
	}

	return options.some(
		(option) =>
			normalizeText(option.label) === normalizedInput ||
			normalizeText(option.value) === normalizedInput,
	);
};

export function Combobox({
	options,
	value,
	onChange,
	onInputValueChange,
	loading = false,
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
				onInputValueChange={onInputValueChange}
				loading={loading}
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
			onInputValueChange={onInputValueChange}
			loading={loading}
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
	onInputValueChange?: (value: string) => void;
	loading: boolean;
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
	onInputValueChange,
	loading,
	inputValue,
	setInputValue,
	open,
	setOpen,
}: SharedProps & { value: string; onChange: (value: string) => void }) {
	const handleInputValueChange = (nextValue: string) => {
		setInputValue(nextValue);
		onInputValueChange?.(nextValue);
	};

	const selectedOption = options.find((opt) => opt.value === value);
	const trimmedInput = inputValue.trim();
	const normalizedQuery = normalizeText(inputValue);
	const hasExactMatch = hasExactOptionMatch(options, trimmedInput);
	const inputMatchesCurrentValue =
		normalizeText(value) === normalizeText(trimmedInput);
	const canCreateInput =
		trimmedInput.length > 0 && !hasExactMatch && !inputMatchesCurrentValue;
	const filteredOptions = options.filter((opt) =>
		optionMatchesQuery(opt, normalizedQuery),
	);

	const handleCreateInput = () => {
		if (!canCreateInput) {
			return;
		}

		onChange(trimmedInput);
		setOpen(false);
		handleInputValueChange("");
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					disabled={disabled}
					className={cn(
						"w-full justify-between gap-2 overflow-hidden font-normal",
						!selectedOption && "text-muted-foreground",
						className,
					)}
				>
					<span className="min-w-0 flex-1 truncate text-left">
						{selectedOption ? selectedOption.label : placeholder}
					</span>
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
						onValueChange={handleInputValueChange}
					/>
					<CommandList>
						{loading ? (
							<CommandLoading>
								<div className="flex items-center justify-center gap-2 text-muted-foreground">
									<Loader2 className="h-4 w-4 animate-spin" />
									<span>載入中...</span>
								</div>
							</CommandLoading>
						) : null}
						{loading ? null : <CommandEmpty>{emptyText}</CommandEmpty>}
						<CommandGroup>
							{canCreateInput ? (
								<CommandItem
									value={`__create__${trimmedInput}`}
									onSelect={handleCreateInput}
								>
									<span className="min-w-0 flex-1 truncate">
										新增「{trimmedInput}」
									</span>
								</CommandItem>
							) : null}
							{filteredOptions.map((option) => (
								<CommandItem
									key={option.value}
									value={option.value}
									onSelect={(currentValue) => {
										onChange(currentValue === value ? "" : currentValue);
										setOpen(false);
										handleInputValueChange("");
									}}
								>
									<Check
										className={cn(
											"mr-2 h-4 w-4",
											value === option.value ? "opacity-100" : "opacity-0",
										)}
									/>
									<span
										className="min-w-0 flex-1 truncate"
										title={option.label}
									>
										{option.label}
									</span>
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
	onInputValueChange,
	loading,
	inputValue,
	setInputValue,
	open,
	setOpen,
}: SharedProps & { value: string[]; onChange: (value: string[]) => void }) {
	const handleInputValueChange = (nextValue: string) => {
		setInputValue(nextValue);
		onInputValueChange?.(nextValue);
	};

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

	const trimmedInput = inputValue.trim();
	const normalizedQuery = normalizeText(inputValue);
	const normalizedInput = normalizeText(trimmedInput);
	const hasExactMatch = hasExactOptionMatch(options, trimmedInput);
	const isAlreadySelected = value.some(
		(selectedValue) => normalizeText(selectedValue) === normalizedInput,
	);
	const canCreateInput =
		trimmedInput.length > 0 && !hasExactMatch && !isAlreadySelected;

	const handleCreateInput = () => {
		if (!canCreateInput) {
			return;
		}

		onChange([...value, trimmedInput]);
		handleInputValueChange("");
	};

	const filteredOptions = options.filter(
		(opt) =>
			optionMatchesQuery(opt, normalizedQuery) && !value.includes(opt.value),
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
						"h-auto min-h-9 w-full justify-between gap-2 overflow-hidden px-3 py-1.5 font-normal",
						value.length === 0 && "text-muted-foreground",
						className,
					)}
				>
					<div className="flex min-w-0 flex-1 flex-wrap gap-1">
						{value.length === 0 ? (
							<span>{placeholder}</span>
						) : (
							value.map((v) => {
								const opt = options.find((o) => o.value === v);
								return (
									<span
										key={v}
										className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium"
									>
										<span className="truncate" title={opt?.label ?? v}>
											{opt?.label ?? v}
										</span>
										<button
											type="button"
											className="ml-0.5 shrink-0 hover:text-destructive"
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
						onValueChange={handleInputValueChange}
						onKeyDown={(e) => {
							if (e.key === "Enter" && canCreateInput) {
								e.preventDefault();
								handleCreateInput();
							}
						}}
					/>
					<CommandList>
						{loading ? (
							<CommandLoading>
								<div className="flex items-center justify-center gap-2 text-muted-foreground">
									<Loader2 className="h-4 w-4 animate-spin" />
									<span>載入中...</span>
								</div>
							</CommandLoading>
						) : null}
						{loading ? null : <CommandEmpty>{emptyText}</CommandEmpty>}
						<CommandGroup>
							{canCreateInput ? (
								<CommandItem
									value={`__create__${trimmedInput}`}
									onSelect={handleCreateInput}
								>
									<span className="min-w-0 flex-1 truncate">
										新增「{trimmedInput}」
									</span>
								</CommandItem>
							) : null}
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
									<span
										className="min-w-0 flex-1 truncate"
										title={option.label}
									>
										{option.label}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
