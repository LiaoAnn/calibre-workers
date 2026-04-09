import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import {
	encodeKoboSingleSpaceTextResponse,
	KOBO_TEXT_HEADERS,
	KoboEncodingFailure,
	KoboMalformedRequest,
	parseRenameTagBody,
} from "#/lib/kobo.server";
import { withKoboAuth } from "#/server/koboApi";
import { deleteKoboTag, renameKoboTag } from "#/services/KoboService";

export const Route = createFileRoute("/api/kobo/$token/v1/library/tags/$tagId")(
	{
		server: {
			handlers: {
				DELETE: async (input) =>
					withKoboAuth(input, ({ params, koboAuth }) =>
						Effect.gen(function* () {
							yield* deleteKoboTag({
								userId: koboAuth.userId,
								tagId: params.tagId,
							});

							const encodedResponse = encodeKoboSingleSpaceTextResponse(" ");
							if (!encodedResponse) {
								return yield* Effect.fail(
									new KoboEncodingFailure({
										operation: "library.tag.encodeSingleSpace",
									}),
								);
							}

							return {
								response: new Response(encodedResponse, {
									status: 200,
									headers: KOBO_TEXT_HEADERS,
								}),
								isHandledInternally: true,
							};
						}),
					),
				PUT: async (input) =>
					withKoboAuth(input, ({ request, params, koboAuth }) =>
						Effect.gen(function* () {
							const body = yield* Effect.tryPromise({
								try: () => request.clone().json() as Promise<unknown>,
								catch: () =>
									new KoboMalformedRequest({
										reason: "Malformed tags request",
									}),
							});

							const name = parseRenameTagBody(body);
							if (!name) {
								return yield* Effect.fail(
									new KoboMalformedRequest({
										reason: "Malformed tags request",
									}),
								);
							}

							yield* renameKoboTag({
								userId: koboAuth.userId,
								tagId: params.tagId,
								name,
							});

							const encodedResponse = encodeKoboSingleSpaceTextResponse(" ");
							if (!encodedResponse) {
								return yield* Effect.fail(
									new KoboEncodingFailure({
										operation: "library.tag.encodeSingleSpace",
									}),
								);
							}

							return {
								response: new Response(encodedResponse, {
									status: 200,
									headers: KOBO_TEXT_HEADERS,
								}),
								isHandledInternally: true,
							};
						}),
					),
			},
		},
	},
);
