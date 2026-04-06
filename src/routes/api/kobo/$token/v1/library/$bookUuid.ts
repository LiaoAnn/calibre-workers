import { createFileRoute } from "@tanstack/react-router";
import { Effect, Either } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import { koboJsonErrorResponse } from "#/lib/kobo.server";
import { withKoboAuth } from "#/server/koboApi";
import {
	proxyKoboRequest,
	setArchivedBookByUuid,
} from "#/services/KoboService";

export const Route = createFileRoute("/api/kobo/$token/v1/library/$bookUuid")({
	server: {
		handlers: {
			DELETE: async (input) =>
				withKoboAuth(
					input,
					async ({ request, params, koboToken, koboAuth }) => {
						const result = await Effect.runPromise(
							Effect.either(
								setArchivedBookByUuid({
									userId: koboAuth.userId,
									bookUuid: params.bookUuid,
									isArchived: true,
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

						return {
							response: new Response(null, { status: 204 }),
							isHandledInternally: true,
						};
					},
				),
		},
	},
});
