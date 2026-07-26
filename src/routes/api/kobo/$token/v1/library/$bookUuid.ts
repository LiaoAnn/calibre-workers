import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import {
	KoboBookNotFound,
	resolveKoboLocalOrProxy,
} from "#/features/kobo/lib/kobo.server";
import { withKoboAuth } from "#/features/kobo/server/withKoboAuth";
import { setArchivedBookByUuid } from "#/features/kobo/services/KoboService";

export const Route = createFileRoute("/api/kobo/$token/v1/library/$bookUuid")({
	server: {
		handlers: {
			DELETE: async (input) =>
				withKoboAuth(input, ({ request, params, koboToken, koboAuth }) =>
					Effect.gen(function* () {
						const archivedResult = yield* resolveKoboLocalOrProxy({
							local: setArchivedBookByUuid({
								userId: koboAuth.userId,
								bookUuid: params.bookUuid,
								isArchived: true,
							}),
							request,
							token: koboToken,
							onLocalFailure: () =>
								new KoboBookNotFound({ bookUuid: params.bookUuid }),
						});

						if (archivedResult.source === "proxy") {
							return archivedResult.output;
						}

						return {
							response: new Response(null, { status: 204 }),
							isHandledInternally: true,
						};
					}),
				),
		},
	},
});
