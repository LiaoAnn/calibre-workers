import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { Effect, Either } from "effect";
import {
	encodeKoboLocalSyncResults,
	KoboEncodingFailure,
	koboJsonResponse,
	proxyKoboHandlerOutput,
} from "#/features/kobo/lib/kobo.server";
import { withKoboAuth } from "#/features/kobo/server/withKoboAuth";
import {
	buildLocalLibrarySync,
	copySyncHeadersFromUpstream,
	createMissingKepubConversionJobs,
	parseKoboSyncTokenFromHeaders,
	setRawStoreSyncTokenFromResponse,
	setSyncTokenHeader,
} from "#/features/kobo/services/KoboService";

export const Route = createFileRoute("/api/kobo/$token/v1/library/sync")({
	server: {
		handlers: {
			GET: async (input) =>
				withKoboAuth(input, ({ request, koboToken, koboAuth }) =>
					Effect.gen(function* () {
						const syncToken = parseKoboSyncTokenFromHeaders(request.headers);
						const origin = new URL(request.url).origin;

						const localSync = yield* buildLocalLibrarySync({
							userId: koboAuth.userId,
							token: koboToken,
							origin,
							syncToken,
						});

						if (localSync.pendingConversions.length > 0) {
							const jobIds = yield* createMissingKepubConversionJobs(
								localSync.pendingConversions,
							);

							if (jobIds.length > 0) {
								const enqueueResult = yield* Effect.either(
									Effect.tryPromise({
										try: () =>
											Promise.all(
												jobIds.map((jobId) =>
													env.CONVERSION_QUEUE.send({ jobId }),
												),
											),
										catch: (error) => error,
									}),
								);

								if (Either.isLeft(enqueueResult)) {
									console.error("Failed to enqueue Kobo sync conversion jobs", {
										jobIds,
										error: enqueueResult.left,
									});
								}
							}
						}

						const encodedLocalSyncResults = encodeKoboLocalSyncResults(
							localSync.syncResults,
						);
						if (!encodedLocalSyncResults) {
							return yield* Effect.fail(
								new KoboEncodingFailure({
									operation: "library.sync.encodeLocalSyncResults",
								}),
							);
						}

						let syncResults: unknown[] = [...encodedLocalSyncResults];
						const headers = new Headers();
						headers.set("content-type", "application/json; charset=utf-8");

						if (localSync.continueSync) {
							headers.set("x-kobo-sync", "continue");
						} else {
							const proxied = yield* Effect.either(
								proxyKoboHandlerOutput({
									request,
									token: koboToken,
									rawStoreToken:
										localSync.syncToken.rawKoboStoreToken || undefined,
								}),
							);

							if (Either.isRight(proxied)) {
								setRawStoreSyncTokenFromResponse({
									syncToken: localSync.syncToken,
									upstreamResponse: proxied.right.response,
								});
								copySyncHeadersFromUpstream({
									upstreamResponse: proxied.right.response,
									outgoing: headers,
								});

								const upstreamResultsResult = yield* Effect.either(
									Effect.tryPromise({
										try: () =>
											proxied.right.response.clone().json() as Promise<unknown>,
										catch: () => null,
									}),
								);

								if (
									Either.isRight(upstreamResultsResult) &&
									Array.isArray(upstreamResultsResult.right)
								) {
									syncResults = syncResults.concat(upstreamResultsResult.right);
								}
							}
							// Sync falls back to local catalog when upstream is unavailable.
						}

						setSyncTokenHeader(headers, localSync.syncToken);

						return {
							response: koboJsonResponse(syncResults, { status: 200, headers }),
							isHandledInternally: true,
						};
					}),
				),
		},
	},
});
