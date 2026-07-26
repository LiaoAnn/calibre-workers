import { Cause, type Exit } from "effect";

export type QueueOutcome = "ack" | "retry";

/**
 * Decide whether a processed queue message should be acknowledged or left for
 * Cloudflare to redeliver.
 *
 * Both queue handlers previously acknowledged every message, including ones
 * that ended in a defect. A defect is a bug — a thrown TypeError, a broken
 * invariant — so acking it threw the message away: no retry, no dead-letter
 * queue, no second chance once the bug is fixed.
 *
 * Expected failures are different. A missing job, an unsupported target format
 * or a timeout will fail again on redelivery, so the message is acked and the
 * job is recorded as failed instead. A cause that mixes both is treated as a
 * defect, because the bug is the more important signal.
 */
export const queueOutcomeForExit = (
	exit: Exit.Exit<unknown, unknown>,
): QueueOutcome => {
	if (exit._tag === "Success") {
		return "ack";
	}

	const { cause } = exit;

	if (Cause.isInterruptedOnly(cause) || Cause.defects(cause).length > 0) {
		return "retry";
	}

	return Cause.isFailure(cause) ? "ack" : "retry";
};
