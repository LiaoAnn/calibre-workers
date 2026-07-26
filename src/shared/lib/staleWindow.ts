import { Clock, Duration, Effect } from "effect";

/**
 * The instant before which work counts as stale.
 *
 * Reads the current time from Effect's `Clock` rather than `Date.now()`, so the
 * sweep window is controllable under `TestClock`. The sweeper services keep
 * taking an explicit `staleBefore: Date`, which leaves them directly testable
 * with a fixed cutoff.
 */
export const staleBefore = (window: Duration.Duration) =>
	Effect.map(
		Clock.currentTimeMillis,
		(now) => new Date(now - Duration.toMillis(window)),
	);
