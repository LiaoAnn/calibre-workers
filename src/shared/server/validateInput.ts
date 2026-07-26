import { Either, ParseResult, Schema } from "effect";
import { ServerFnError } from "#/shared/server/serverErrors";

/**
 * Build a `createServerFn().validator(...)` from a Schema.
 *
 * Every server function previously used `(input: T) => input`, an identity cast
 * that told TypeScript a shape it never checked. Anything a client sent reached
 * the handler and the database unvalidated.
 *
 * Decoding here rejects malformed payloads at the boundary with a 400 and a
 * message naming the offending field. Decoding also strips properties the schema
 * does not declare, so a caller cannot smuggle extra keys into whatever the
 * handler spreads downstream.
 */
export const validateInput =
	<A, I>(schema: Schema.Schema<A, I>) =>
	(input: unknown): A => {
		const decoded = Schema.decodeUnknownEither(schema)(input, {
			errors: "all",
		});

		if (Either.isLeft(decoded)) {
			throw new ServerFnError(
				400,
				ParseResult.TreeFormatter.formatIssueSync(decoded.left.issue),
				"InvalidInput",
			);
		}

		return decoded.right;
	};
