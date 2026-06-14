import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import {
	createKoboAuthToken,
	listKoboAuthTokensForUser,
	revokeKoboAuthToken,
} from "#/features/kobo/services/KoboService";
import { requiredSessionMiddleware } from "#/shared/auth/middleware";
import { AppLayer } from "#/shared/layers/AppLayer";

interface RevokeKoboTokenInput {
	tokenId?: string;
}

export const getKoboTokensServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.handler(async ({ context }) => {
		return Effect.runPromise(
			listKoboAuthTokensForUser(context.session.user.id).pipe(
				Effect.provide(AppLayer),
			),
		);
	});

export const createKoboTokenServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.handler(async ({ context }) => {
		return Effect.runPromise(
			createKoboAuthToken(context.session.user.id).pipe(
				Effect.provide(AppLayer),
			),
		);
	});

export const revokeKoboTokenServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: RevokeKoboTokenInput | undefined) => input)
	.handler(async ({ context, data }) => {
		return Effect.runPromise(
			revokeKoboAuthToken({
				userId: context.session.user.id,
				tokenId: data?.tokenId,
			}).pipe(Effect.provide(AppLayer)),
		);
	});
