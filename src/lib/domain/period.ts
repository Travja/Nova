import type { Cadence } from './tiers';

/**
 * Period maths for orbits.
 *
 * Every boundary is computed in the user's own time zone — "this week" has to
 * mean the same thing whether you log progress from home or from an airport —
 * but the values we store and compare are always UTC instants.
 */

export interface Period {
	/** Inclusive start instant. */
	start: Date;
	/** Exclusive end instant. */
	end: Date;
	/** Stable identifier, unique per cadence, e.g. `week:2026-W37`. */
	key: string;
	cadence: Cadence;
}

export interface PeriodOptions {
	timeZone: string;
	/** 0 = Sunday … 6 = Saturday. Defaults to Monday. */
	weekStartsOn?: number;
}

interface ZonedParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
	let formatter = formatterCache.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		formatterCache.set(timeZone, formatter);
	}
	return formatter;
}

/** Break an instant into wall-clock parts as seen in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
	const parts = formatterFor(timeZone).formatToParts(instant);
	const read = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((part) => part.type === type)?.value ?? '0');
	return {
		year: read('year'),
		month: read('month'),
		day: read('day'),
		hour: read('hour'),
		minute: read('minute'),
		second: read('second')
	};
}

/** Milliseconds that `timeZone` is ahead of UTC at the given instant. */
function offsetAt(utcMs: number, timeZone: string): number {
	const parts = zonedParts(new Date(utcMs), timeZone);
	const asIfUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second
	);
	// Second resolution is all the formatter gives us, so ignore sub-second drift.
	return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Resolve wall-clock parts in `timeZone` back to a UTC instant.
 *
 * DST shifts mean the offset depends on the answer, so we guess with the
 * offset at the naive instant and then correct once — enough for every real
 * world transition, which never exceeds a couple of hours.
 */
export function fromZonedParts(parts: ZonedParts, timeZone: string): Date {
	const naive = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second
	);
	let utcMs = naive - offsetAt(naive, timeZone);
	utcMs = naive - offsetAt(utcMs, timeZone);
	return new Date(utcMs);
}

/** Day of week in the user's zone: 0 = Sunday … 6 = Saturday. */
export function zonedDayOfWeek(instant: Date, timeZone: string): number {
	const parts = zonedParts(instant, timeZone);
	return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function startOfZonedDay(parts: ZonedParts, timeZone: string): Date {
	return fromZonedParts({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone);
}

function pad(value: number, length = 2): string {
	return String(value).padStart(length, '0');
}

/**
 * ISO-8601 week number and week-year for a date, used to key weekly orbits.
 * Only meaningful when weeks start on Monday; other week starts fall back to
 * keying on the week's own start date.
 */
function isoWeek(year: number, month: number, day: number): { year: number; week: number } {
	const date = new Date(Date.UTC(year, month - 1, day));
	// Thursday of the current ISO week decides which year the week belongs to.
	const dayOfWeek = (date.getUTCDay() + 6) % 7;
	date.setUTCDate(date.getUTCDate() - dayOfWeek + 3);
	const isoYear = date.getUTCFullYear();
	const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
	const firstDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
	firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayOfWeek + 3);
	const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
	return { year: isoYear, week };
}

/** The period of the given cadence that contains `instant`. */
export function periodFor(instant: Date, cadence: Cadence, options: PeriodOptions): Period {
	const { timeZone, weekStartsOn = 1 } = options;
	const parts = zonedParts(instant, timeZone);

	switch (cadence) {
		case 'day': {
			const start = startOfZonedDay(parts, timeZone);
			const end = addPeriods(start, 'day', 1, options);
			return {
				start,
				end,
				cadence,
				key: `day:${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
			};
		}
		case 'week': {
			const dayOfWeek = zonedDayOfWeek(instant, timeZone);
			const daysBack = (dayOfWeek - weekStartsOn + 7) % 7;
			const dayStart = startOfZonedDay(parts, timeZone);
			const startParts = zonedParts(new Date(dayStart.getTime() - daysBack * 86_400_000), timeZone);
			const start = startOfZonedDay(startParts, timeZone);
			const end = addPeriods(start, 'week', 1, options);
			const key =
				weekStartsOn === 1
					? (() => {
							const { year, week } = isoWeek(startParts.year, startParts.month, startParts.day);
							return `week:${year}-W${pad(week)}`;
						})()
					: `week:${startParts.year}-${pad(startParts.month)}-${pad(startParts.day)}`;
			return { start, end, cadence, key };
		}
		case 'month': {
			const start = startOfZonedDay({ ...parts, day: 1 }, timeZone);
			const end = addPeriods(start, 'month', 1, options);
			return { start, end, cadence, key: `month:${parts.year}-${pad(parts.month)}` };
		}
		case 'quarter': {
			const quarter = Math.floor((parts.month - 1) / 3);
			const start = startOfZonedDay({ ...parts, month: quarter * 3 + 1, day: 1 }, timeZone);
			const end = addPeriods(start, 'quarter', 1, options);
			return { start, end, cadence, key: `quarter:${parts.year}-Q${quarter + 1}` };
		}
		case 'year': {
			const start = startOfZonedDay({ ...parts, month: 1, day: 1 }, timeZone);
			const end = addPeriods(start, 'year', 1, options);
			return { start, end, cadence, key: `year:${parts.year}` };
		}
	}
}

/** Shift an instant by whole periods, keeping wall-clock alignment. */
export function addPeriods(
	instant: Date,
	cadence: Cadence,
	count: number,
	options: PeriodOptions
): Date {
	const { timeZone } = options;
	const parts = zonedParts(instant, timeZone);

	switch (cadence) {
		case 'day':
			return fromZonedParts({ ...parts, day: parts.day + count }, timeZone);
		case 'week':
			return fromZonedParts({ ...parts, day: parts.day + count * 7 }, timeZone);
		case 'month':
			return clampedMonthShift(parts, count, timeZone);
		case 'quarter':
			return clampedMonthShift(parts, count * 3, timeZone);
		case 'year':
			return clampedMonthShift(parts, count * 12, timeZone);
	}
}

/** Month arithmetic that never rolls "31 Jan + 1 month" into March. */
function clampedMonthShift(parts: ZonedParts, months: number, timeZone: string): Date {
	const zeroBased = parts.month - 1 + months;
	const year = parts.year + Math.floor(zeroBased / 12);
	const month = ((zeroBased % 12) + 12) % 12;
	const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	return fromZonedParts(
		{ ...parts, year, month: month + 1, day: Math.min(parts.day, daysInMonth) },
		timeZone
	);
}

/** The period immediately before the given one. */
export function previousPeriod(period: Period, options: PeriodOptions): Period {
	return periodFor(addPeriods(period.start, period.cadence, -1, options), period.cadence, options);
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Read a `datetime-local` value (`2026-09-12T14:30`) as wall-clock time in
 * `timeZone`.
 *
 * `new Date(value)` would read it in the server's zone instead, which is how a
 * backdated entry ends up in the wrong orbit. Returns null if the shape is
 * wrong; a time that daylight saving skipped is resolved the same way every
 * other boundary is, by `fromZonedParts`.
 */
export function parseLocalDateTime(value: string, timeZone: string): Date | null {
	const match = LOCAL_DATE_TIME.exec(value.trim());
	if (!match) return null;
	const [, year, month, day, hour, minute, second] = match;
	return fromZonedParts(
		{
			year: Number(year),
			month: Number(month),
			day: Number(day),
			hour: Number(hour),
			minute: Number(minute),
			second: Number(second ?? '0')
		},
		timeZone
	);
}

/** Render an instant as a `datetime-local` value in `timeZone`, for form fields. */
export function toLocalDateTime(instant: Date, timeZone: string): string {
	const parts = zonedParts(instant, timeZone);
	return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

const labelFormatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * A fixed locale keeps labels identical on the server and in the browser, which
 * matters because they are rendered from hydrated data.
 */
function labelFormatter(
	timeZone: string,
	options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
	const key = `${timeZone}|${JSON.stringify(options)}`;
	let formatter = labelFormatterCache.get(key);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-GB', { timeZone, ...options });
		labelFormatterCache.set(key, formatter);
	}
	return formatter;
}

/**
 * How a period is named in copy, e.g. `Sun 8 Mar`, `the week of 7 Sep`,
 * `March 2026`. Used when an entry lands somewhere other than the orbit in
 * flight and the screen has to say which one moved.
 */
export function periodLabel(period: Period, timeZone: string): string {
	const parts = zonedParts(period.start, timeZone);
	switch (period.cadence) {
		case 'day':
			return labelFormatter(timeZone, {
				weekday: 'short',
				day: 'numeric',
				month: 'short'
			}).format(period.start);
		case 'week':
			return `the week of ${labelFormatter(timeZone, { day: 'numeric', month: 'short' }).format(period.start)}`;
		case 'month':
			return labelFormatter(timeZone, { month: 'long', year: 'numeric' }).format(period.start);
		case 'quarter':
			return `Q${Math.floor((parts.month - 1) / 3) + 1} ${parts.year}`;
		case 'year':
			return String(parts.year);
	}
}

/** Walk back `count` periods, newest first, starting from the one containing `instant`. */
export function recentPeriods(
	instant: Date,
	cadence: Cadence,
	count: number,
	options: PeriodOptions
): Period[] {
	const periods: Period[] = [];
	let current = periodFor(instant, cadence, options);
	for (let index = 0; index < count; index += 1) {
		periods.push(current);
		current = previousPeriod(current, options);
	}
	return periods;
}
