import { Cause, Data, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { queueOutcomeForExit } from "#/shared/queue/queueOutcome";

class JobNotFound extends Data.TaggedError("JobNotFound")<{
	readonly jobId: string;
}> {}

describe("queueOutcomeForExit", () => {
	it("acks a successful job", () => {
		expect(queueOutcomeForExit(Exit.succeed("done"))).toBe("ack");
	});

	it("acks an expected failure so the job can be settled as failed", () => {
		const exit = Exit.fail(new JobNotFound({ jobId: "j1" }));
		expect(queueOutcomeForExit(exit)).toBe("ack");
	});

	it("acks a timeout, which is an expected outcome for a long job", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.never.pipe(Effect.timeout("1 millis")),
		);
		expect(queueOutcomeForExit(exit)).toBe("ack");
	});

	it("retries a defect instead of silently acking a bug", () => {
		const exit = Exit.die(new Error("null is not a function"));
		expect(queueOutcomeForExit(exit)).toBe("retry");
	});

	it("retries an interruption", () => {
		expect(
			queueOutcomeForExit(Exit.failCause(Cause.interrupt(0 as never))),
		).toBe("retry");
	});

	it("retries when a defect accompanies an expected failure", () => {
		const exit = Exit.failCause(
			Cause.parallel(
				Cause.fail(new JobNotFound({ jobId: "j1" })),
				Cause.die(new Error("boom")),
			),
		);
		expect(queueOutcomeForExit(exit)).toBe("retry");
	});
});
