import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import {
	encodeKoboReadingStateList,
	encodeKoboReadingStateUpdateResponse,
	KoboBookNotFound,
	KoboEncodingFailure,
	KoboMalformedRequest,
	koboJsonResponse,
} from "#/lib/kobo.server";
import { resolveKoboLocalOrProxy, withKoboAuth } from "#/server/koboApi";
import {
	getReadingStateResponseByBookUuid,
	updateReadingStateByBookUuid,
} from "#/services/KoboService";

const parseIds = (value: string): string[] =>
	value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

export const Route = createFileRoute("/api/kobo/$token/v1/library/$ids/state")({
	server: {
		handlers: {
			GET: async (input) =>
				withKoboAuth(input, ({ request, params, koboToken, koboAuth }) =>
					Effect.gen(function* () {
						const ids = parseIds(params.ids);
						if (ids.length === 0) {
							return yield* Effect.fail(
								new KoboMalformedRequest({ reason: "Malformed state request" }),
							);
						}

						const payload: unknown[] = [];

						for (const bookUuid of ids) {
							const result = yield* resolveKoboLocalOrProxy({
								local: getReadingStateResponseByBookUuid({
									userId: koboAuth.userId,
									bookUuid,
								}),
								request,
								token: koboToken,
								onLocalFailure: () => new KoboBookNotFound({ bookUuid }),
							});

							if (result.source === "proxy") {
								return result.output;
							}

							payload.push(...result.value);
						}

						const encodedReadingStatePayload =
							encodeKoboReadingStateList(payload);
						if (!encodedReadingStatePayload) {
							return yield* Effect.fail(
								new KoboEncodingFailure({
									operation: "library.state.encodeList",
								}),
							);
						}

						return {
							response: koboJsonResponse(encodedReadingStatePayload, {
								status: 200,
							}),
							isHandledInternally: true,
						};
					}),
				),
			PUT: async (input) =>
				withKoboAuth(input, ({ request, params, koboToken, koboAuth }) =>
					Effect.gen(function* () {
						const ids = parseIds(params.ids);
						const bookUuid = ids[0];
						if (!bookUuid) {
							return yield* Effect.fail(
								new KoboMalformedRequest({ reason: "Malformed state request" }),
							);
						}

						const payload = yield* Effect.tryPromise({
							try: () => request.clone().json() as Promise<unknown>,
							catch: () =>
								new KoboMalformedRequest({ reason: "Malformed state request" }),
						});

						const result = yield* resolveKoboLocalOrProxy({
							local: updateReadingStateByBookUuid({
								userId: koboAuth.userId,
								bookUuid,
								payload,
							}),
							request,
							token: koboToken,
							onLocalFailure: () => new KoboBookNotFound({ bookUuid }),
						});

						if (result.source === "proxy") {
							return result.output;
						}

						const encodedUpdateResult = encodeKoboReadingStateUpdateResponse(
							result.value,
						);
						if (!encodedUpdateResult) {
							return yield* Effect.fail(
								new KoboEncodingFailure({
									operation: "library.state.encodeUpdateResult",
								}),
							);
						}

						return {
							response: koboJsonResponse(encodedUpdateResult, { status: 200 }),
							isHandledInternally: true,
						};
					}),
				),
		},
	},
});
