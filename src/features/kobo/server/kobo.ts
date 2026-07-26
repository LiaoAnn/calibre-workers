import { createServerFn } from "@tanstack/react-start";
import { KoboService } from "#/features/kobo/services/KoboService";
import { requiredSessionMiddleware } from "#/shared/auth/middleware";
import { runServerEffect } from "#/shared/server/runServerEffect";

interface RevokeKoboTokenInput {
	tokenId?: string;
}

export const getKoboTokensServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.handler(async ({ context }) => {
		return runServerEffect(
			KoboService.listKoboAuthTokensForUser(context.session.user.id),
		);
	});

export const createKoboTokenServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.handler(async ({ context }) => {
		return runServerEffect(
			KoboService.createKoboAuthToken(context.session.user.id),
		);
	});

export const revokeKoboTokenServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: RevokeKoboTokenInput | undefined) => input)
	.handler(async ({ context, data }) => {
		return runServerEffect(
			KoboService.revokeKoboAuthToken({
				userId: context.session.user.id,
				tokenId: data?.tokenId,
			}),
		);
	});
