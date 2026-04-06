import { createFileRoute } from "@tanstack/react-router";
import { Effect, Either } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import {
	encodeKoboEmptyTextResponse,
	KOBO_TEXT_HEADERS,
	koboJsonErrorResponse,
	mapTagError,
	parseTagItemsBody,
} from "#/lib/kobo.server";
import { withKoboAuth } from "#/server/koboApi";
import { removeItemsFromKoboTag } from "#/services/KoboService";

export const Route = createFileRoute(
	"/api/kobo/$token/v1/library/tags/$tagId/items/delete",
)({
	server: {
		handlers: {
			POST: async (input) =>
				withKoboAuth(input, async ({ request, params, koboAuth }) => {
					let body: unknown;
					try {
						body = (await request.clone().json()) as unknown;
					} catch {
						return {
							response: koboJsonErrorResponse({
								status: 400,
								message: "Malformed tags request",
								code: "MalformedRequest",
							}),
							isHandledInternally: true,
						};
					}

					const revisionIds = parseTagItemsBody(body);
					if (!revisionIds) {
						return {
							response: koboJsonErrorResponse({
								status: 400,
								message: "Malformed tags request",
								code: "MalformedRequest",
							}),
							isHandledInternally: true,
						};
					}

					const result = await Effect.runPromise(
						Effect.either(
							removeItemsFromKoboTag({
								userId: koboAuth.userId,
								tagId: params.tagId,
								revisionIds,
							}).pipe(Effect.provide(AppLayer)),
						),
					);

					if (Either.isLeft(result)) {
						const { status, message, code } = mapTagError(result.left);
						return {
							response: koboJsonErrorResponse({
								status,
								message,
								code,
							}),
							isHandledInternally: true,
						};
					}

					const encodedResponse = encodeKoboEmptyTextResponse("");
					if (!encodedResponse) {
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
						response: new Response(encodedResponse, {
							status: 200,
							headers: KOBO_TEXT_HEADERS,
						}),
						isHandledInternally: true,
					};
				}),
		},
	},
});
