import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import {
	encodeKoboLocalSyncResults,
	koboJsonErrorResponse,
	koboJsonResponse,
} from "#/lib/kobo.server";
import { withKoboAuth } from "#/server/koboApi";
import {
	buildLocalLibrarySync,
	copySyncHeadersFromUpstream,
	createMissingKepubConversionJobs,
	parseKoboSyncTokenFromHeaders,
	proxyKoboRequest,
	setRawStoreSyncTokenFromResponse,
	setSyncTokenHeader,
} from "#/services/KoboService";

export const Route = createFileRoute("/api/kobo/$token/v1/library/sync")({
	server: {
		handlers: {
			GET: async (input) =>
				withKoboAuth(input, async ({ request, koboToken, koboAuth }) => {
					const syncToken = parseKoboSyncTokenFromHeaders(request.headers);
					const origin = new URL(request.url).origin;

					const localSync = await Effect.runPromise(
						buildLocalLibrarySync({
							userId: koboAuth.userId,
							token: koboToken,
							origin,
							syncToken,
						}).pipe(Effect.provide(AppLayer)),
					);

					if (localSync.pendingConversions.length > 0) {
						const jobIds = await Effect.runPromise(
							createMissingKepubConversionJobs(
								localSync.pendingConversions,
							).pipe(Effect.provide(AppLayer)),
						);

						if (jobIds.length > 0) {
							try {
								await Promise.all(
									jobIds.map((jobId) => env.CONVERSION_QUEUE.send({ jobId })),
								);
							} catch (error) {
								console.error("Failed to enqueue Kobo sync conversion jobs", {
									jobIds,
									error,
								});
							}
						}
					}

					const encodedLocalSyncResults = encodeKoboLocalSyncResults(
						localSync.syncResults,
					);
					if (!encodedLocalSyncResults) {
						return {
							response: koboJsonErrorResponse({
								status: 500,
								message: "Internal Server Error",
								code: "InternalServerError",
							}),
							isHandledInternally: true,
						};
					}

					let syncResults: unknown[] = [...encodedLocalSyncResults];
					const headers = new Headers();
					headers.set("content-type", "application/json; charset=utf-8");

					if (localSync.continueSync) {
						headers.set("x-kobo-sync", "continue");
					} else {
						try {
							const { response } = await Effect.runPromise(
								proxyKoboRequest({
									request: request.clone(),
									token: koboToken,
									rawStoreToken:
										localSync.syncToken.rawKoboStoreToken || undefined,
								}).pipe(Effect.provide(AppLayer)),
							);

							setRawStoreSyncTokenFromResponse({
								syncToken: localSync.syncToken,
								upstreamResponse: response,
							});
							copySyncHeadersFromUpstream({
								upstreamResponse: response,
								outgoing: headers,
							});

							const upstreamResults = (await response
								.clone()
								.json()) as unknown;
							if (Array.isArray(upstreamResults)) {
								syncResults = syncResults.concat(upstreamResults);
							}
						} catch {
							// Sync falls back to local catalog when upstream is unavailable.
						}
					}

					setSyncTokenHeader(headers, localSync.syncToken);

					return {
						response: koboJsonResponse(syncResults, { status: 200, headers }),
						isHandledInternally: true,
					};
				}),
		},
	},
});
