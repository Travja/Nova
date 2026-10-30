import { END_PROBLEM_MESSAGE } from '$domain/ending';
import { PARENT_PROBLEM_MESSAGE, TIER_PROBLEM_MESSAGE } from '$domain/nesting';
import { formError, type FormErrors } from '$domain/validation';
import type { GoalWriteResult } from '$lib/server/goals';

/**
 * A refused goal write as errors the form can render.
 *
 * Nesting failures belong to the parent picker rather than to the form as a
 * whole, so they land on `parentId` and appear under the control that caused
 * them — except the tier rule, which is broken by the tier radio group even
 * though it is about the children.
 */
export function goalWriteErrors(result: Extract<GoalWriteResult, { ok: false }>): FormErrors {
	if (result.missing) return formError('That goal is not in orbit.');
	if (result.problem.kind === 'tier') return { tier: TIER_PROBLEM_MESSAGE };
	if (result.problem.kind === 'end') return { endsOn: END_PROBLEM_MESSAGE[result.problem.problem] };
	return { parentId: PARENT_PROBLEM_MESSAGE[result.problem.problem] };
}

/**
 * A goal form's fields as `goalSchema` reads them.
 *
 * `Object.fromEntries` keeps only the last of a repeated name, and the weekday
 * toggles are one name posted once per ticked day. `schedule` is the marker the
 * form sends whenever it offered the toggles, so "none ticked" can be told
 * apart from "not asked".
 */
export function goalFormInput(form: FormData): Record<string, unknown> {
	return {
		...Object.fromEntries(form),
		flyingDays: form.has('schedule') ? form.getAll('flyingDays') : undefined
	};
}
