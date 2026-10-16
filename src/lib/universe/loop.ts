/**
 * The frame loop, on demand (#11, decision 10).
 *
 * A still universe costs nothing: no permanent `requestAnimationFrame`, only a
 * frame when something asks for one — the controls moved, a flight is under
 * way, the data changed. The frame itself answers whether it needs another:
 * true while a flight or a sweep is in progress, while damping is settling,
 * or while motion is allowed and a closed body is lapping on screen. When it
 * answers false, the loop stops until the next request.
 *
 * It also stops outright while anything pauses it — the tab hidden, the canvas
 * scrolled out of view, the WebGL context lost — and a request made while
 * paused is kept for when the last pause lifts. A phone left on the dashboard
 * should not run a GPU at 60fps for a picture that is not moving.
 *
 * When the only thing a frame needs is a slower ambient rate (#63, part 2), it
 * calls `requestPaced(ms)` instead of relying on its return value: a
 * `setTimeout` for `ms`, which then asks for a single frame, rather than a
 * `requestAnimationFrame` that fires on every refresh and mostly does
 * nothing. A plain `request()` made during that wait cancels it and draws
 * immediately — the sooner ask always wins — and a pause cancels it too, same
 * as a pending `requestAnimationFrame`.
 */

export interface FrameLoop {
	/** Ask for a frame. Cheap to call often: one is scheduled at most. */
	request(): void;
	/**
	 * Ask for a frame no sooner than `ms` from now, by a timer rather than a
	 * `requestAnimationFrame` that would fire — and do nothing — on every
	 * refresh in between. Called from inside the frame callback itself, to
	 * pace the next call rather than this one; a plain `request()` in the
	 * meantime still draws right away.
	 */
	requestPaced(ms: number): void;
	/** Pause for `reason`, or lift that pause. Frames run only with no pauses. */
	pause(reason: string, paused: boolean): void;
	/** Frames drawn so far, for the tests that prove a still universe draws none. */
	readonly frames: number;
	stop(): void;
}

export function createLoop(frame: (time: number) => boolean): FrameLoop {
	const pauses = new Set<string>();
	let handle: number | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending = false;
	let stopped = false;
	let frames = 0;
	/** Set only while `frame` is running, so it can defer its own pacing past the call that return value would otherwise schedule immediately. */
	let running = false;
	let pacedMs: number | null = null;

	function clearTimer() {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	}

	function run(time: number) {
		handle = null;
		if (stopped || pauses.size > 0) return;
		frames += 1;
		pending = false;
		pacedMs = null;
		running = true;
		const more = frame(time);
		running = false;
		if (pacedMs !== null) schedulePaced(pacedMs);
		else if (more || pending) schedule();
	}

	function schedule() {
		if (stopped) return;
		if (pauses.size > 0) {
			pending = true;
			return;
		}
		clearTimer();
		if (handle === null) handle = requestAnimationFrame(run);
	}

	function schedulePaced(ms: number) {
		if (stopped) return;
		if (pauses.size > 0) {
			pending = true;
			return;
		}
		// An immediate frame is already coming — the sooner one wins, and it
		// will pace whatever comes after it in its own turn.
		if (handle !== null) return;
		clearTimer();
		timer = setTimeout(() => {
			timer = null;
			if (handle === null) handle = requestAnimationFrame(run);
		}, ms);
	}

	return {
		request() {
			pending = true;
			schedule();
		},
		requestPaced(ms) {
			pending = true;
			// Called from inside `frame`: leave the scheduling to `run`, once it
			// knows whether this is the only thing asked for this turn.
			if (running) {
				pacedMs = ms;
				return;
			}
			schedulePaced(ms);
		},
		pause(reason, paused) {
			if (paused) {
				pauses.add(reason);
				if (handle !== null) {
					cancelAnimationFrame(handle);
					handle = null;
					pending = true;
				}
				if (timer !== null) {
					clearTimeout(timer);
					timer = null;
					pending = true;
				}
				return;
			}
			pauses.delete(reason);
			if (pending) schedule();
		},
		get frames() {
			return frames;
		},
		stop() {
			stopped = true;
			if (handle !== null) cancelAnimationFrame(handle);
			handle = null;
			clearTimer();
		}
	};
}
