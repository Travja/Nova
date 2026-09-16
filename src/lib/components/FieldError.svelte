<script lang="ts">
	import { errorId } from '$domain/validation';

	/**
	 * The other half of `describedBy()`: the paragraph a control's
	 * `aria-describedby` points at, rendered at the same id so the two stay in
	 * step without repeating the id string at every call site.
	 */
	interface Props {
		/** The control's own id — `describedBy` was called with the same one. */
		id: string;
		message?: string | null;
	}

	let { id, message }: Props = $props();
</script>

{#if message}<p id={errorId(id)} class="error">{message}</p>{/if}
