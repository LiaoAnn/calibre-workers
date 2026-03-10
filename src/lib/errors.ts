import { Data } from "effect";

export class BookNotFound extends Data.TaggedError("BookNotFound")<{
	readonly bookId: string;
}> {}

export class ParseError extends Data.TaggedError("ParseError")<{
	readonly stage: string;
	readonly cause: unknown;
}> {}
