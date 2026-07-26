import "@tanstack/react-start/server-only";

import { setResponseStatus } from "@tanstack/react-start/server";
import { Cause, Effect, Exit } from "effect";
import type { AppServices } from "#/shared/layers/AppLayer";
import { ServerRuntime } from "#/shared/layers/AppRuntime";
import {
	httpErrorForTaggedError,
	ServerFnError,
} from "#/shared/server/serverErrors";

const isTagged = (value: unknown): value is { readonly _tag: string } =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { _tag?: unknown })._tag === "string";

/**
 * Run a server-function Effect against the shared runtime and translate its
 * typed failures into HTTP semantics.
 *
 * Expected failures become a `ServerFnError` carrying the mapped status, so a
 * missing shelf is a 404 and a permission problem is a 403 rather than the
 * blanket 500 that `Effect.die` used to produce. Defects stay defects: they are
 * logged with their full cause and reported as 500, because they indicate a bug
 * rather than a situation the client can act on.
 */
export const runServerEffect = async <A, E>(
	effect: Effect.Effect<A, E, AppServices>,
): Promise<A> => {
	const exit = await ServerRuntime.runPromiseExit(effect);

	if (Exit.isSuccess(exit)) {
		return exit.value;
	}

	const failure = Cause.failureOption(exit.cause);

	if (failure._tag === "Some" && isTagged(failure.value)) {
		const { status, message } = httpErrorForTaggedError(failure.value);

		// 5xx means we mapped nothing useful — keep the cause in the logs.
		if (status >= 500) {
			await ServerRuntime.runPromise(
				Effect.logError("server function failed", exit.cause),
			);
		}

		setResponseStatus(status);
		throw new ServerFnError(status, message, failure.value._tag);
	}

	// Defect, interruption, or an untagged failure: a bug, not a client problem.
	await ServerRuntime.runPromise(
		Effect.logError("server function defect", exit.cause),
	);
	setResponseStatus(500);
	throw new ServerFnError(500, "伺服器發生錯誤", "Defect");
};
