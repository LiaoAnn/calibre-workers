import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import { requiredSessionMiddleware } from "#/middleware/auth";
import {
	createKoboAuthToken,
	listKoboAuthTokensForUser,
	revokeKoboAuthToken,
} from "#/services/KoboService";
import {
	listShelfKoboSyncSettings,
	setShelfKoboSync,
} from "#/services/ShelfService";

interface RevokeKoboTokenInput {
	tokenId?: string;
}

interface SetShelfKoboSyncInput {
	shelfId: string;
	enabled: boolean;
}

export const getKoboSettingsServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.handler(async ({ context }) => {
		const userId = context.session.user.id;
		return Effect.runPromise(
			Effect.all({
				tokens: listKoboAuthTokensForUser(userId),
				shelves: listShelfKoboSyncSettings(userId),
			}).pipe(Effect.provide(AppLayer)),
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

export const setShelfKoboSyncServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: SetShelfKoboSyncInput) => input)
	.handler(async ({ context, data }) => {
		return Effect.runPromise(
			setShelfKoboSync({
				userId: context.session.user.id,
				shelfId: data.shelfId,
				enabled: data.enabled,
			}).pipe(Effect.provide(AppLayer)),
		);
	});
