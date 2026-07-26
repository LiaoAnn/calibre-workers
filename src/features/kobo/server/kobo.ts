import { createServerFn } from "@tanstack/react-start";
import {
	createKoboAuthToken,
	listKoboAuthTokensForUser,
	revokeKoboAuthToken,
} from "#/features/kobo/services/KoboService";
import { requiredSessionMiddleware } from "#/shared/auth/middleware";
import { ServerRuntime } from "#/shared/layers/AppRuntime";

interface RevokeKoboTokenInput {
	tokenId?: string;
}

export const getKoboTokensServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.handler(async ({ context }) => {
		return ServerRuntime.runPromise(
			listKoboAuthTokensForUser(context.session.user.id),
		);
	});

export const createKoboTokenServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.handler(async ({ context }) => {
		return ServerRuntime.runPromise(
			createKoboAuthToken(context.session.user.id),
		);
	});

export const revokeKoboTokenServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: RevokeKoboTokenInput | undefined) => input)
	.handler(async ({ context, data }) => {
		return ServerRuntime.runPromise(
			revokeKoboAuthToken({
				userId: context.session.user.id,
				tokenId: data?.tokenId,
			}),
		);
	});
