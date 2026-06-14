import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const APP_TITLE = "Calibre Workers";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function getPageTitle(title?: string | null) {
	const nextTitle = title?.trim();
	return nextTitle ? `${nextTitle} | ${APP_TITLE}` : APP_TITLE;
}
