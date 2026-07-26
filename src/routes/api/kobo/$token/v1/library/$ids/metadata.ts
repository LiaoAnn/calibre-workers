import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import {
	encodeKoboMetadataList,
	KoboBookNotFound,
	KoboEncodingFailure,
	KoboMalformedRequest,
	koboJsonResponse,
	resolveKoboLocalOrProxy,
} from "#/features/kobo/lib/kobo.server";
import { withKoboAuth } from "#/features/kobo/server/withKoboAuth";
import { getBookMetadataByUuid } from "#/features/kobo/services/KoboService";

const parseIds = (value: string): string[] =>
	value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

export const Route = createFileRoute(
	"/api/kobo/$token/v1/library/$ids/metadata",
)({
	server: {
		handlers: {
			GET: async (input) =>
				withKoboAuth(input, ({ request, params, koboToken }) =>
					Effect.gen(function* () {
						const ids = parseIds(params.ids);
						if (ids.length === 0) {
							return yield* Effect.fail(
								new KoboMalformedRequest({
									reason: "Malformed metadata request",
								}),
							);
						}

						const origin = new URL(request.url).origin;
						const metadataPayload: unknown[] = [];

						for (const bookUuid of ids) {
							const result = yield* resolveKoboLocalOrProxy({
								local: getBookMetadataByUuid({
									bookUuid,
									origin,
									token: koboToken,
								}),
								request,
								token: koboToken,
								onLocalFailure: () => new KoboBookNotFound({ bookUuid }),
							});

							if (result.source === "proxy") {
								return result.output;
							}

							metadataPayload.push(result.value);
						}

						const encodedMetadataPayload =
							encodeKoboMetadataList(metadataPayload);
						if (!encodedMetadataPayload) {
							return yield* Effect.fail(
								new KoboEncodingFailure({
									operation: "library.metadata.encodeList",
								}),
							);
						}

						return {
							response: koboJsonResponse(encodedMetadataPayload, {
								status: 200,
							}),
							isHandledInternally: true,
						};
					}),
				),
		},
	},
});
