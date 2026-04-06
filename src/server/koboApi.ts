import "@tanstack/react-start/server-only";

import { Effect, Either } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import { koboJsonErrorResponse } from "#/lib/kobo.server";
import type { KoboAuthTokenContext } from "#/services/KoboService";
import {
	persistKoboApiLog,
	resolveKoboAuthToken,
	serializeBody,
} from "#/services/KoboService";

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
// TODO: should can use POST: withKoboAuth(async ({request, params}) => {...}) directly
// not POST: async (input) => withKoboAuth(input, async ({request, params}) => {...})
export const withKoboAuth = async <
	TInput extends KoboRouteHandlerInput<KoboRouteParams & KoboTokenRouteParams>,
>(
	input: TInput,
	handler: (
		authorizedInput: KoboAuthorizedHandlerInput<TInput>,
	) => Promise<KoboHandlerOutput>,
): Promise<Response> => {
	const normalizedParams = normalizeParams<TInput["params"]>(input.params);
	if (!normalizedParams) {
		const response = koboJsonErrorResponse({
			status: 400,
			message: "Malformed route params",
			code: "MalformedRouteParams",
		});
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
		const response = koboJsonErrorResponse({
			status: 401,
			message: "Unauthorized",
			code: "Unauthorized",
		});
		await logKoboApi({
			request: input.request,
			response,
			auth: null,
			isHandledInternally: true,
		});
		return response;
	}

	try {
		const output = await handler({
			request: input.request,
			params: normalizedParams,
			koboToken: token,
			koboAuth: auth,
		});
		await logKoboApi({
			request: input.request,
			response: output.response,
			auth,
			isHandledInternally: output.isHandledInternally,
		});
		return output.response;
	} catch (error) {
		console.error("Unhandled Kobo API handler error", error);
		const response = koboJsonErrorResponse({
			status: 500,
			message: "Internal Server Error",
			code: "InternalServerError",
		});
		await logKoboApi({
			request: input.request,
			response,
			auth,
			isHandledInternally: true,
		});
		return response;
	}
};
