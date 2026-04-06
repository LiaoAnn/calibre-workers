import { createFileRoute } from "@tanstack/react-router";
import { Effect, Either } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import {
	encodeKoboTagId,
	koboJsonErrorResponse,
	koboJsonResponse,
	mapTagError,
	parseCreateTagBody,
} from "#/lib/kobo.server";
import { withKoboAuth } from "#/server/koboApi";
import { createOrUpdateKoboTag } from "#/services/KoboService";

export const Route = createFileRoute("/api/kobo/$token/v1/library/tags")({
	server: {
		handlers: {
			DELETE: async (input) =>
				withKoboAuth(input, async () => ({
					response: koboJsonErrorResponse({
						status: 405,
						message: "Method Not Allowed",
						code: "MethodNotAllowed",
					}),
					isHandledInternally: true,
				})),
			POST: async (input) =>
				withKoboAuth(input, async ({ request, koboAuth }) => {
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

					const parsedBody = parseCreateTagBody(body);
					if (!parsedBody) {
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
							createOrUpdateKoboTag({
								userId: koboAuth.userId,
								name: parsedBody.name,
								revisionIds: parsedBody.revisionIds,
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

					const encodedTagId = encodeKoboTagId(result.right.tagId);
					if (!encodedTagId) {
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
						response: koboJsonResponse(encodedTagId, { status: 201 }),
						isHandledInternally: true,
					};
				}),
		},
	},
});
