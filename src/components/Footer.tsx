import { Separator } from "#/components/ui/separator";

export default function Footer() {
	const year = new Date().getFullYear();

	return (
		<footer className="mt-20 px-4 pb-14 pt-10 text-[var(--sea-ink-soft)]">
			<Separator className="mb-10" />
			<div className="page-wrap flex justify-center text-center">
				<p className="m-0 text-sm">
					&copy; {year} Calibre Workers. All rights reserved.
				</p>
			</div>
		</footer>
	);
}
