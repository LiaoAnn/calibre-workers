import "@tanstack/react-start/server-only";

import { Effect, Either } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import type { DatabaseContext } from "#/layers/DatabaseLayer";
import type { R2Context } from "#/layers/R2Layer";
import {
	type KoboHandledError,
	KoboMalformedRouteParams,
	KoboUnauthorized,
	koboErrorResponseFromError,
	koboInternalServerErrorResponse,
} from "#/lib/kobo.server";
import type { KoboAuthTokenContext } from "#/services/KoboService";
import {
	persistKoboApiLog,
	resolveKoboAuthToken,
	serializeBody,
} from "#/services/KoboService";

const KOBO_STORE_API_URL = "https://storeapi.kobo.com";

type KoboRequestPayload = Pick<
	Request,
	"method" | "url" | "headers" | "clone" | "body" | "formData" | "arrayBuffer"
>;

type KoboRouteParams = object;
type KoboTokenRouteParams = {
	token: string | undefined;
};

type KoboNormalizedParams<TParams extends KoboRouteParams> = {
	[K in keyof TParams]-?: Exclude<TParams[K], undefined>;
};

interface KoboRouteHandlerInput<TParams extends KoboRouteParams> {
	request: KoboRequestPayload;
	params: TParams;
}

type KoboAuthorizedHandlerInput<
	TInput extends KoboRouteHandlerInput<KoboRouteParams>,
> = {
	request: TInput["request"];
	params: KoboNormalizedParams<TInput["params"]>;
	koboToken: string;
	koboAuth: KoboAuthTokenContext;
};

const normalizeParams = <TParams extends KoboRouteParams>(params: TParams) => {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(
		params as Record<string, unknown>,
	)) {
		if (typeof value !== "string") {
			return null;
		}
		normalized[key] = value;
	}

	return normalized as KoboNormalizedParams<TParams>;
};

const buildStoreUrl = (requestUrl: URL, token: string) => {
	const prefix = `/api/kobo/${token}`;
	const relativePath = requestUrl.pathname.startsWith(prefix)
		? requestUrl.pathname.slice(prefix.length) || "/"
		: requestUrl.pathname;
	const normalizedPath = relativePath.startsWith("/")
		? relativePath
		: `/${relativePath}`;

	return `${KOBO_STORE_API_URL}${normalizedPath}${requestUrl.search}`;
};

const resolveAuthFromToken = async (token: string) => {
	const authResult = await Effect.runPromise(
		Effect.either(resolveKoboAuthToken(token).pipe(Effect.provide(AppLayer))),
	);

	if (Either.isLeft(authResult)) {
		return null;
	}

	return authResult.right;
};

const logKoboApi = async ({
	request,
	response,
	auth,
	isHandledInternally,
}: {
	request: KoboRequestPayload;
	response: Response;
	auth: KoboAuthTokenContext | null;
	isHandledInternally: boolean;
}) => {
	try {
		// Body streams are single-read in the runtime. We always clone before
		// serialization so logging never consumes the real request/response stream.
		const [requestBody, responseBody] = await Promise.all([
			serializeBody(request.clone()),
			serializeBody(response.clone()),
		]);

		await Effect.runPromise(
			persistKoboApiLog({
				authTokenId: auth?.authTokenId ?? null,
				method: request.method,
				requestUrl: new URL(request.url),
				isHandledInternally,
				requestHeaders: request.headers,
				requestBody,
				response,
				responseBody,
			}).pipe(Effect.provide(AppLayer)),
		);
	} catch (error) {
		// Logging should never block Kobo sync. Failures are best-effort only.
		console.error("Failed to persist Kobo API log", error);
	}
};

// createFileRoute server handlers do not have first-class middleware support.
// This helper is the middleware-equivalent entrypoint for token auth + audit log.
interface KoboHandlerOutput {
	response: Response;
	isHandledInternally: boolean;
}

type KoboLocalOrProxyResult<A> =
	| {
			readonly source: "local";
			readonly value: A;
	  }
	| {
			readonly source: "proxy";
			readonly output: KoboHandlerOutput;
	  };

const toKoboProxyHandlerOutput = (response: Response): KoboHandlerOutput => ({
	response,
	isHandledInternally: false,
});

export const proxyKoboHandlerOutput = ({
	request,
	token,
	rawStoreToken,
}: {
	request: KoboRequestPayload;
	token: string;
	rawStoreToken?: string;
}) =>
	Effect.tryPromise({
		try: async () => {
			const proxySource = request.clone();
			const proxyUrl = buildStoreUrl(new URL(proxySource.url), token);
			const outgoingHeaders = new Headers(proxySource.headers);
			outgoingHeaders.delete("host");
			if (rawStoreToken) {
				outgoingHeaders.set("x-kobo-synctoken", rawStoreToken);
			}

			const proxyRequest = new Request(proxyUrl, {
				method: proxySource.method,
				headers: outgoingHeaders,
				body:
					proxySource.method === "GET" || proxySource.method === "HEAD"
						? null
						: proxySource.body,
				redirect: "manual",
			});

			const response = await fetch(proxyRequest);
			return toKoboProxyHandlerOutput(response);
		},
		catch: (cause) =>
			new Error(
				`Kobo proxy failed: ${cause instanceof Error ? cause.message : String(cause)}`,
			),
	});

export const resolveKoboLocalOrProxy = <A, E extends KoboHandledError>({
	local,
	request,
	token,
	rawStoreToken,
	onLocalFailure,
}: {
	local: Effect.Effect<A, E, DatabaseContext | R2Context>;
	request: KoboRequestPayload;
	token: string;
	rawStoreToken?: string;
	onLocalFailure: (error: E) => KoboHandledError;
}): Effect.Effect<
	KoboLocalOrProxyResult<A>,
	KoboHandledError,
	DatabaseContext | R2Context
> =>
	Effect.gen(function* () {
		const localResult = yield* Effect.either(local);
		if (Either.isRight(localResult)) {
			return {
				source: "local",
				value: localResult.right,
			} as const;
		}

		const proxied = yield* Effect.either(
			proxyKoboHandlerOutput({
				request,
				token,
				rawStoreToken,
			}),
		);
		if (Either.isRight(proxied)) {
			return {
				source: "proxy",
				output: proxied.right,
			} as const;
		}

		return yield* Effect.fail(onLocalFailure(localResult.left));
	});

export const withKoboAuth = async <
	TInput extends KoboRouteHandlerInput<KoboRouteParams & KoboTokenRouteParams>,
>(
	input: TInput,
	handler: (
		authorizedInput: KoboAuthorizedHandlerInput<TInput>,
	) => Effect.Effect<
		KoboHandlerOutput,
		KoboHandledError,
		DatabaseContext | R2Context
	>,
): Promise<Response> => {
	const normalizedParams = normalizeParams<TInput["params"]>(input.params);
	if (!normalizedParams) {
		const response = koboErrorResponseFromError(
			new KoboMalformedRouteParams({}),
		);
		await logKoboApi({
			request: input.request,
			response,
			auth: null,
			isHandledInternally: true,
		});
		return response;
	}

	const token = normalizedParams.token;
	const auth = token ? await resolveAuthFromToken(token) : null;

	if (!token || !auth) {
		const response = koboErrorResponseFromError(new KoboUnauthorized({}));
		await logKoboApi({
			request: input.request,
			response,
			auth: null,
			isHandledInternally: true,
		});
		return response;
	}

	try {
		const handledEffect = handler({
			request: input.request,
			params: normalizedParams,
			koboToken: token,
			koboAuth: auth,
		}).pipe(
			Effect.provide(AppLayer),
			Effect.match({
				onFailure: (error) => ({
					response: koboErrorResponseFromError(error),
					isHandledInternally: true,
				}),
				onSuccess: (output) => output,
			}),
		);

		const output = await Effect.runPromise(handledEffect);
		await logKoboApi({
			request: input.request,
			response: output.response,
			auth,
			isHandledInternally: output.isHandledInternally,
		});
		return output.response;
	} catch (error) {
		console.error("Unhandled Kobo API handler error", error);
		const response = koboInternalServerErrorResponse();
		await logKoboApi({
			request: input.request,
			response,
			auth,
			isHandledInternally: true,
		});
		return response;
	}
};
