import server from "@tanstack/react-start/server-entry";
import { handleQueue } from "#/queue";
import { handleScheduled } from "#/scheduled";

export { ConverterContainer } from "#/containers/converter";

const hasStartCompatibleAccept = (acceptHeader: string | null) => {
	if (!acceptHeader) {
		return true;
	}

	return acceptHeader
		.split(",")
		.map((value) => value.trim().toLowerCase())
		.some((value) => {
			const [mediaType, ...params] = value
				.split(";")
				.map((part) => part.trim());
			if (mediaType !== "*/*" && mediaType !== "text/html") {
				return false;
			}

			const q = params.find((part) => part.startsWith("q="));
			if (!q) {
				return true;
			}

			const qValue = Number.parseFloat(q.slice(2));
			return Number.isNaN(qValue) || qValue > 0;
		});
};

// we use createFileRoute to build Kobo sync api, and Kobo devices will send requests
// with duplicated slashes in the pathname and `accept: application/json` header,
// which will cause 307/500 responses from TanStack Start framework level.
// To avoid that, we normalize the pathname and accept header before forwarding
// the request to TanStack Start.
const normalizeKoboRequest = (request: Request) => {
	const originalUrl = new URL(request.url);
	const normalizedPathname = originalUrl.pathname.replace(/\/{2,}/g, "/");
	const shouldNormalizePath = normalizedPathname !== originalUrl.pathname;

	const acceptHeader = request.headers.get("accept");
	const shouldNormalizeAccept = !hasStartCompatibleAccept(acceptHeader);

	if (!shouldNormalizePath && !shouldNormalizeAccept) {
		return request;
	}

	const headers = new Headers(request.headers);
	if (shouldNormalizeAccept) {
		headers.set("accept", `${acceptHeader}, */*`);
	}

	if (!shouldNormalizePath) {
		return new Request(request, { headers });
	}

	const normalizedUrl = new URL(originalUrl);
	normalizedUrl.pathname = normalizedPathname;

	return new Request(normalizedUrl.toString(), {
		body: request.body,
		headers,
		method: request.method,
		redirect: request.redirect,
	});
};

export default {
	async fetch(request: Request) {
		const { pathname } = new URL(request.url);
		const requestForStart = pathname.startsWith("/api/kobo/")
			? normalizeKoboRequest(request)
			: request;

		return server.fetch(requestForStart);
	},
	queue: handleQueue,
	scheduled: handleScheduled,
};
