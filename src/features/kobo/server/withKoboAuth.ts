import "@tanstack/react-start/server-only";

import { and, eq, isNull } from "drizzle-orm";
import { Data, Effect, Either } from "effect";
import {
	type BodySerializablePayload,
	type KoboAuthorizedHandlerInput,
	type KoboAuthTokenContext,
	type KoboHandledError,
	type KoboHandlerOutput,
	KoboMalformedRouteParams,
	type KoboNormalizedParams,
	type KoboRequestPayload,
	type KoboRouteHandlerInput,
	type KoboRouteParams,
	type KoboTokenRouteParams,
	KoboUnauthorized,
	koboErrorResponseFromError,
	koboInternalServerErrorResponse,
	MAX_LOG_BODY_BYTES,
	toBase64,
} from "#/features/kobo/lib/kobo.server";
import * as schema from "#/shared/db/schema";
import { ServerRuntime } from "#/shared/layers/AppRuntime";
import type { DatabaseContext as DatabaseContextType } from "#/shared/layers/DatabaseLayer";
import { DatabaseContext } from "#/shared/layers/DatabaseLayer";
import type { R2Context } from "#/shared/layers/R2Layer";

class KoboAuthTokenNotFound extends Data.TaggedError("KoboAuthTokenNotFound")<{
	readonly token: string;
}> {}

const parseJsonSafe = (text: string): unknown | undefined => {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
};

const isJsonContentType = (contentType: string): boolean =>
	contentType.includes("application/json") || contentType.includes("+json");

const isFormContentType = (contentType: string): boolean =>
	contentType.includes("multipart/form-data") ||
	contentType.includes("application/x-www-form-urlencoded");

const isTextContentType = (contentType: string): boolean =>
	contentType.startsWith("text/") ||
	contentType.includes("application/xml") ||
	contentType.includes("application/xhtml+xml") ||
	contentType.includes("application/javascript") ||
	contentType.includes("application/x-javascript") ||
	contentType.includes("application/ecmascript") ||
	contentType.includes("image/svg+xml");

const appendFormValue = (
	target: Record<string, unknown>,
	key: string,
	value: unknown,
) => {
	const existing = target[key];
	if (existing === undefined) {
		target[key] = value;
		return;
	}

	if (Array.isArray(existing)) {
		existing.push(value);
		return;
	}

	target[key] = [existing, value];
};

const headersToRecord = (headers: Headers): Record<string, string> => {
	const out: Record<string, string> = {};
	headers.forEach((value, key) => {
		out[key] = value;
	});
	return out;
};

const clampBodyBytes = (bytes: Uint8Array) => {
	if (bytes.byteLength <= MAX_LOG_BODY_BYTES) {
		return { bytes, truncated: false };
	}

	return {
		bytes: bytes.subarray(0, MAX_LOG_BODY_BYTES),
		truncated: true,
	};
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

const serializeBody = async (
	payload: BodySerializablePayload,
): Promise<schema.KoboLoggedBody> => {
	if (!payload.body) {
		return { type: "empty" };
	}

	const contentType = (payload.headers.get("content-type") ?? "").toLowerCase();

	if (isFormContentType(contentType)) {
		const formData = await payload.formData();
		const form: Record<string, unknown> = {};

		for (const [key, value] of formData.entries()) {
			if (typeof value === "string") {
				appendFormValue(form, key, value);
				continue;
			}

			const raw = new Uint8Array(await value.arrayBuffer());
			const { bytes, truncated } = clampBodyBytes(raw);
			appendFormValue(form, key, {
				kind: "file",
				name: value.name,
				contentType: value.type || "application/octet-stream",
				size: value.size,
				encoding: "base64",
				data: toBase64(bytes),
				truncated,
			});
		}

		return { type: "form", value: form };
	}

	const raw = new Uint8Array(await payload.arrayBuffer());
	if (raw.byteLength === 0) {
		return { type: "empty" };
	}

	const { bytes, truncated } = clampBodyBytes(raw);
	const text = new TextDecoder().decode(bytes);

	if (isJsonContentType(contentType) && !truncated) {
		const parsed = parseJsonSafe(text);
		if (parsed !== undefined) {
			return { type: "json", value: parsed };
		}
	}

	if (isTextContentType(contentType)) {
		return {
			type: "text",
			contentType: contentType || "text/plain",
			value: text,
			truncated,
		};
	}

	return {
		type: "binary",
		contentType: contentType || "application/octet-stream",
		encoding: "base64",
		value: toBase64(bytes),
		truncated,
	};
};

const persistKoboApiLog = ({
	authTokenId,
	method,
	requestUrl,
	isHandledInternally,
	requestHeaders,
	requestBody,
	response,
	responseBody,
}: {
	authTokenId: string | null;
	method: string;
	requestUrl: URL;
	isHandledInternally: boolean;
	requestHeaders: Headers;
	requestBody: schema.KoboLoggedBody;
	response: Response;
	responseBody: schema.KoboLoggedBody;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		yield* database.insert(schema.koboApiLogs).values({
			id: crypto.randomUUID(),
			authTokenId,
			method,
			path: requestUrl.pathname,
			query: requestUrl.search || null,
			isHandledInternally,
			requestHeaders: headersToRecord(requestHeaders),
			requestBody,
			responseStatus: response.status,
			responseHeaders: headersToRecord(response.headers),
			responseBody,
		});
	});

const resolveKoboAuthToken = (token: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const rows = yield* database
			.select({
				authTokenId: schema.koboAuthTokens.id,
				token: schema.koboAuthTokens.token,
				userId: schema.koboAuthTokens.userId,
			})
			.from(schema.koboAuthTokens)
			.where(
				and(
					eq(schema.koboAuthTokens.token, token),
					isNull(schema.koboAuthTokens.revokedAt),
				),
			)
			.limit(1);

		const authToken = rows[0];
		if (!authToken) {
			return yield* Effect.fail(new KoboAuthTokenNotFound({ token }));
		}

		return authToken satisfies KoboAuthTokenContext;
	});

const resolveAuthFromToken = async (token: string) => {
	const authResult = await ServerRuntime.runPromise(
		Effect.either(resolveKoboAuthToken(token)),
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
		const [requestBody, responseBody] = await Promise.all([
			serializeBody(request.clone()),
			serializeBody(response.clone()),
		]);

		await ServerRuntime.runPromise(
			persistKoboApiLog({
				authTokenId: auth?.authTokenId ?? null,
				method: request.method,
				requestUrl: new URL(request.url),
				isHandledInternally,
				requestHeaders: request.headers,
				requestBody,
				response,
				responseBody,
			}),
		);
	} catch (error) {
		console.error("Failed to persist Kobo API log", error);
	}
};

export const withKoboAuth = async <
	TInput extends KoboRouteHandlerInput<KoboRouteParams & KoboTokenRouteParams>,
>(
	input: TInput,
	handler: (
		authorizedInput: KoboAuthorizedHandlerInput<TInput>,
	) => Effect.Effect<
		KoboHandlerOutput,
		KoboHandledError,
		DatabaseContextType | R2Context
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
			Effect.match({
				onFailure: (error) => ({
					response: koboErrorResponseFromError(error),
					isHandledInternally: true,
				}),
				onSuccess: (output) => output,
			}),
		);

		const output = await ServerRuntime.runPromise(handledEffect);
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
