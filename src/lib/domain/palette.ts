/** Body colours available when creating a goal. */
export const PALETTE = [
	{ name: 'Ion', value: '#7dd3fc' },
	{ name: 'Nebula', value: '#a78bfa' },
	{ name: 'Solar', value: '#fbbf24' },
	{ name: 'Pulsar', value: '#f472b6' },
	{ name: 'Aurora', value: '#34d399' },
	{ name: 'Ember', value: '#fb7185' },
	{ name: 'Comet', value: '#e2e8f0' }
] as const;

export const DEFAULT_COLOR = PALETTE[1].value;

export function isPaletteColor(value: string): boolean {
	return PALETTE.some((entry) => entry.value === value);
}
