import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";
import { KoboService } from "#/features/kobo/services/KoboService";
import { requiredSessionMiddleware } from "#/shared/auth/middleware";
import { runServerEffect } from "#/shared/server/runServerEffect";
import { validateInput } from "#/shared/server/validateInput";

// The whole payload is optional: revoking without a token id revokes all of the
// caller's tokens.
const RevokeKoboTokenInput = Schema.UndefinedOr(
	Schema.Struct({ tokenId: Schema.optional(Schema.String) }),
);

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
	.validator(validateInput(RevokeKoboTokenInput))
	.handler(async ({ context, data }) => {
		return runServerEffect(
			KoboService.revokeKoboAuthToken({
				userId: context.session.user.id,
				tokenId: data?.tokenId,
			}),
		);
	});
