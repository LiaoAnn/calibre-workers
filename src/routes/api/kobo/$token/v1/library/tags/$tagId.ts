import { createFileRoute } from "@tanstack/react-router";
import { Effect, Either } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import {
	encodeKoboSingleSpaceTextResponse,
	KOBO_TEXT_HEADERS,
	koboJsonErrorResponse,
	mapTagError,
	parseRenameTagBody,
} from "#/lib/kobo.server";
import { withKoboAuth } from "#/server/koboApi";
import { deleteKoboTag, renameKoboTag } from "#/services/KoboService";

export const Route = createFileRoute("/api/kobo/$token/v1/library/tags/$tagId")(
	{
		server: {
			handlers: {
				DELETE: async (input) =>
					withKoboAuth(input, async ({ params, koboAuth }) => {
						const result = await Effect.runPromise(
							Effect.either(
								deleteKoboTag({
									userId: koboAuth.userId,
									tagId: params.tagId,
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

						const encodedResponse = encodeKoboSingleSpaceTextResponse(" ");
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
				PUT: async (input) =>
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

						const name = parseRenameTagBody(body);
						if (!name) {
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
								renameKoboTag({
									userId: koboAuth.userId,
									tagId: params.tagId,
									name,
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

						const encodedResponse = encodeKoboSingleSpaceTextResponse(" ");
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
	},
);
