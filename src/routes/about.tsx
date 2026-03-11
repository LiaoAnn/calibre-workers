import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";

export const Route = createFileRoute("/about")({
	component: About,
});

function About() {
	return (
		<main className="page-wrap px-4 py-12">
			<Card>
				<CardHeader className="p-6 sm:p-8">
					<p className="island-kicker mb-2">About</p>
					<CardTitle className="display-title mb-3 text-4xl font-bold sm:text-5xl">
						A small starter with room to grow.
					</CardTitle>
				</CardHeader>
				<CardContent className="px-6 pb-8 sm:px-8">
					<p className="m-0 max-w-3xl text-base leading-8 text-muted-foreground">
						TanStack Start gives you type-safe routing, server functions, and
						modern SSR defaults. Use this as a clean foundation, then layer in
						your own routes, styling, and add-ons.
					</p>
				</CardContent>
			</Card>
		</main>
	);
}
