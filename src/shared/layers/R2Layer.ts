import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";
import { Context, Layer } from "effect";

export class R2Context extends Context.Tag("R2Context")<
	R2Context,
	R2Bucket
>() {}

// `Layer.sync`, not `Layer.succeed`: the binding is read when the layer is
// built rather than when this module is evaluated, which keeps a missing or
// misconfigured binding an error at layer construction instead of at import.
export const R2Live = Layer.sync(R2Context, () => env.BOOKS_STORAGE);
