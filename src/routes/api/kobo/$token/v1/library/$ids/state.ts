import { createFileRoute } from "@tanstack/react-router";
import { Effect, Either } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import {
	encodeKoboReadingStateList,
	encodeKoboReadingStateUpdateResponse,
	koboJsonErrorResponse,
	koboJsonResponse,
} from "#/lib/kobo.server";
import { withKoboAuth } from "#/server/koboApi";
import {
	getReadingStateResponseByBookUuid,
	proxyKoboRequest,
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
				withKoboAuth(
					input,
					async ({ request, params, koboToken, koboAuth }) => {
						const ids = parseIds(params.ids);
						if (ids.length === 0) {
							return {
								response: koboJsonErrorResponse({
									status: 400,
									message: "Malformed state request",
									code: "MalformedRequest",
								}),
								isHandledInternally: true,
							};
						}

						const payload: unknown[] = [];

						for (const bookUuid of ids) {
							const result = await Effect.runPromise(
								Effect.either(
									getReadingStateResponseByBookUuid({
										userId: koboAuth.userId,
										bookUuid,
									}).pipe(Effect.provide(AppLayer)),
								),
							);

							if (Either.isLeft(result)) {
								try {
									const { response } = await Effect.runPromise(
										proxyKoboRequest({
											request: request.clone(),
											token: koboToken,
										}).pipe(Effect.provide(AppLayer)),
									);

									return {
										response,
										isHandledInternally: false,
									};
								} catch {
									return {
										response: koboJsonErrorResponse({
											status: 404,
											message: "Book not found",
											code: "BookNotFound",
										}),
										isHandledInternally: true,
									};
								}
							}

							payload.push(...result.right);
						}

						const encodedReadingStatePayload =
							encodeKoboReadingStateList(payload);
						if (!encodedReadingStatePayload) {
							return {
								response: koboJsonErrorResponse({
									status: 500,
									message: "Internal Server Error",
									code: "InternalServerError",
								}),
								isHandledInternally: true,
							};
						}

						return {
							response: koboJsonResponse(encodedReadingStatePayload, {
								status: 200,
							}),
							isHandledInternally: true,
						};
					},
				),
			PUT: async (input) =>
				withKoboAuth(
					input,
					async ({ request, params, koboToken, koboAuth }) => {
						const ids = parseIds(params.ids);
						const bookUuid = ids[0];
						if (!bookUuid) {
							return {
								response: koboJsonErrorResponse({
									status: 400,
									message: "Malformed state request",
									code: "MalformedRequest",
								}),
								isHandledInternally: true,
							};
						}

						let payload: unknown;
						try {
							payload = (await request.clone().json()) as unknown;
						} catch {
							return {
								response: koboJsonErrorResponse({
									status: 400,
									message: "Malformed state request",
									code: "MalformedRequest",
								}),
								isHandledInternally: true,
							};
						}

						const result = await Effect.runPromise(
							Effect.either(
								updateReadingStateByBookUuid({
									userId: koboAuth.userId,
									bookUuid,
									payload,
								}).pipe(Effect.provide(AppLayer)),
							),
						);

						if (Either.isLeft(result)) {
							try {
								const { response } = await Effect.runPromise(
									proxyKoboRequest({
										request: request.clone(),
										token: koboToken,
									}).pipe(Effect.provide(AppLayer)),
								);

								return {
									response,
									isHandledInternally: false,
								};
							} catch {
								return {
									response: koboJsonErrorResponse({
										status: 404,
										message: "Book not found",
										code: "BookNotFound",
									}),
									isHandledInternally: true,
								};
							}
						}

						const encodedUpdateResult = encodeKoboReadingStateUpdateResponse(
							result.right,
						);
						if (!encodedUpdateResult) {
							return {
								response: koboJsonErrorResponse({
									status: 500,
									message: "Internal Server Error",
									code: "InternalServerError",
								}),
								isHandledInternally: true,
							};
						}

						return {
							response: koboJsonResponse(encodedUpdateResult, { status: 200 }),
							isHandledInternally: true,
						};
					},
				),
		},
	},
});
