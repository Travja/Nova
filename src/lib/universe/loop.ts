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
 */

export interface FrameLoop {
	/** Ask for a frame. Cheap to call often: one is scheduled at most. */
	request(): void;
	/** Pause for `reason`, or lift that pause. Frames run only with no pauses. */
	pause(reason: string, paused: boolean): void;
	/** Frames drawn so far, for the tests that prove a still universe draws none. */
	readonly frames: number;
	stop(): void;
}

export function createLoop(frame: (time: number) => boolean): FrameLoop {
	const pauses = new Set<string>();
	let handle: number | null = null;
	let pending = false;
	let stopped = false;
	let frames = 0;

	function run(time: number) {
		handle = null;
		if (stopped || pauses.size > 0) return;
		frames += 1;
		pending = false;
		const more = frame(time);
		if (more || pending) schedule();
	}

	function schedule() {
		if (stopped) return;
		if (pauses.size > 0) {
			pending = true;
			return;
		}
		if (handle === null) handle = requestAnimationFrame(run);
	}

	return {
		request() {
			pending = true;
			schedule();
		},
		pause(reason, paused) {
			if (paused) {
				pauses.add(reason);
				if (handle !== null) {
					cancelAnimationFrame(handle);
					handle = null;
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
		}
	};
}
