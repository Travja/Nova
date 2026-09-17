import { periodFor, zonedDayOfWeek, type Period, type PeriodOptions } from './period';
import { parentPeriodFor } from './nesting';
import type { Orbit } from './progress';
import type { Cadence } from './tiers';

/**
 * The history page: a calendar heatmap plus the full orbit list, paged back
 * through a goal's whole life rather than the twelve-orbit window every other
 * screen defaults to (#15).
 *
 * `snapshotGoal()` and `snapshotDerivedGoal()` already build the orbit list
 * for an arbitrary window — pass a large `historyLength` and slice the page
 * out of it — so this module only adds what those do not: pairing a period
 * with what actually happened inside it, and laying daily periods into a
 * calendar grid.
 */

/** How many periods one page of history shows, so a Satellite's page reads as
 *  roughly a year and a Universe's as a couple of decades. */
export const HISTORY_PAGE_LENGTH: Record<Cadence, number> = {
	day: 371,
	week: 52,
	month: 24,
	quarter: 16,
	year: 20
};

/** One thing behind a cell — a leaf's entry, or a child's closed orbit. */
export interface HistoryDetail {
	/** An entry's note, or the child's title for a derived goal. Null for an unnoted entry. */
	label: string | null;
	amount: number;
	at: Date;
}

export interface HistoryCell {
	orbit: Orbit;
	/** What is behind the cell. Empty for a period nothing landed in. */
	details: HistoryDetail[];
}

/** Pair each orbit with whatever landed in its period. */
export function historyCells(
	history: readonly Orbit[],
	detailsByPeriod: ReadonlyMap<string, HistoryDetail[]>
): HistoryCell[] {
	return history.map((orbit) => ({ orbit, details: detailsByPeriod.get(orbit.period.key) ?? [] }));
}

type EntryLike = { amount: number; note: string | null; occurredAt: Date };

/** A leaf's entries, bucketed into the periods they landed in. */
export function detailsFromEntries(
	entries: readonly EntryLike[],
	cadence: Cadence,
	options: PeriodOptions
): Map<string, HistoryDetail[]> {
	const buckets = new Map<string, HistoryDetail[]>();
	for (const entry of entries) {
		const { key } = periodFor(entry.occurredAt, cadence, options);
		const detail: HistoryDetail = { label: entry.note, amount: entry.amount, at: entry.occurredAt };
		const bucket = buckets.get(key);
		if (bucket) bucket.push(detail);
		else buckets.set(key, [detail]);
	}
	return buckets;
}

/**
 * A derived goal's cells, one detail per closed child orbit.
 *
 * A parent's heatmap is measured in orbits (`metricFor`), so what is "behind"
 * a cell is which children closed rather than an amount logged — the same
 * `parentPeriodFor` that decides which parent period a closed child orbit
 * counts toward decides which cell it is listed under here, so the two can
 * never disagree about where a closure landed.
 */
export function detailsFromClosures(
	children: readonly { title: string; periods: readonly Period[] }[],
	parentCadence: Cadence,
	options: PeriodOptions
): Map<string, HistoryDetail[]> {
	const buckets = new Map<string, HistoryDetail[]>();
	for (const child of children) {
		for (const period of child.periods) {
			const parentPeriod = parentPeriodFor(period, parentCadence, options);
			const detail: HistoryDetail = { label: child.title, amount: 1, at: period.end };
			const bucket = buckets.get(parentPeriod.key);
			if (bucket) bucket.push(detail);
			else buckets.set(parentPeriod.key, [detail]);
		}
	}
	return buckets;
}

/** One cell placed on a GitHub-style week grid: which column, which row. */
export interface DayGridCell {
	cell: HistoryCell;
	week: number;
	/** 0 = Sunday … 6 = Saturday, so the grid reads the same whatever the account's own week start is. */
	weekday: number;
}

/**
 * Lay daily cells into weeks for the calendar heatmap.
 *
 * Only the `day` cadence draws this way — every other cadence has too few
 * cells per page to need a grid, and renders as a plain wrapped row instead.
 * Rows are fixed Sunday-to-Saturday regardless of `weekStartsOn`, which only
 * ever governs period boundaries elsewhere, not how this picture reads.
 */
export function dayGrid(cells: readonly HistoryCell[], timeZone: string): DayGridCell[] {
	let week = 0;
	let lastWeekday = -1;
	return cells.map((cell) => {
		const weekday = zonedDayOfWeek(cell.orbit.period.start, timeZone);
		if (lastWeekday !== -1 && weekday < lastWeekday) week += 1;
		lastWeekday = weekday;
		return { cell, week, weekday };
	});
}
