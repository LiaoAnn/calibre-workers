import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";
import { Context, Layer } from "effect";

export class R2Context extends Context.Tag("R2Context")<
	R2Context,
	R2Bucket
>() {}

export const R2Live = Layer.succeed(R2Context, env.BOOKS_STORAGE);
