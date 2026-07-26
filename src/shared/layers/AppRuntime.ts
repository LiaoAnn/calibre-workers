import "@tanstack/react-start/server-only";

import { ManagedRuntime } from "effect";
import { AppLayer, AppLayerWithContainer } from "#/shared/layers/AppLayer";

// Layer memoization is scoped to a single `Effect.provide` build, so calling
// `Effect.provide(AppLayer)` per request rebuilds the whole graph every time —
// including `D1Client.layer`, which is a `Layer.scopedContext`. A module-scope
// ManagedRuntime builds the graph lazily on first use and reuses it for the
// lifetime of the Worker isolate.
//
// Both runtimes are kept separate on purpose: only the queue and scheduled
// handlers may reach the converter container. They each hold their own
// `DatabaseContext`, which costs one extra client per isolate rather than one
// per request.

/** Runtime for SSR, server functions and API routes. */
export const ServerRuntime = ManagedRuntime.make(AppLayer);

/** Runtime for queue consumers and the cron handler — adds the converter. */
export const QueueRuntime = ManagedRuntime.make(AppLayerWithContainer);
