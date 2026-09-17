<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import FieldError from '$components/FieldError.svelte';
	import { errorId } from '$domain/validation';
	import { applicationServerKey, isIosSafari, isStandalone, pushSupported } from '$lib/platform';
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/**
	 * What this device can do about reminders, which is a different question from
	 * whether the account wants them.
	 *
	 * - `unknown` until mount: every test below needs `navigator`, and guessing
	 *   in markup would be a hydration mismatch.
	 * - `install` is the iOS case. Safari delivers push only to a PWA that has
	 *   been added to the home screen — in a tab there is no `PushManager` at
	 *   all — so the honest answer is the install instructions rather than a
	 *   button that throws (#20 shipped the same guidance).
	 * - `unsupported` is every other browser without push.
	 * - `blocked` is permission already denied, which no button can undo: only
	 *   the browser's own site settings can.
	 */
	type DeviceState = 'unknown' | 'install' | 'unsupported' | 'blocked' | 'off' | 'on';

	let support = $state<DeviceState>('unknown');
	let busy = $state(false);
	let problem = $state('');

	/** The device list the server sent, refreshed after this device changes. */
	const devices = $derived(data.devices);

	async function currentSubscription(): Promise<PushSubscription | null> {
		const registration = await navigator.serviceWorker.getRegistration();
		return (await registration?.pushManager.getSubscription()) ?? null;
	}

	onMount(() => {
		if (!pushSupported()) {
			// An iPhone in a browser tab has no PushManager; on the home screen it
			// does. That is the whole difference, and it is worth explaining.
			support = isIosSafari() && !isStandalone() ? 'install' : 'unsupported';
			return;
		}
		if (Notification.permission === 'denied') {
			support = 'blocked';
			return;
		}
		void currentSubscription().then((subscription) => {
			support = subscription ? 'on' : 'off';
		});
	});

	/**
	 * Turn this device on: permission, then a subscription, then the row.
	 *
	 * Both halves have to land. A subscription the server never hears about is a
	 * device nothing will ever push to, so the row is written before this says
	 * anything, and a failure leaves the switch where it was.
	 */
	async function turnOn() {
		if (!data.publicKey) return;
		busy = true;
		problem = '';

		try {
			if ((await Notification.requestPermission()) !== 'granted') {
				support = 'blocked';
				return;
			}

			const registration = await navigator.serviceWorker.getRegistration();
			if (!registration) {
				// The worker registers on mount in `+layout.svelte`, and never in
				// development — so this is the honest answer rather than a wait that
				// never ends.
				problem = 'Nova’s service worker is not running in this browser yet. Reload and try again.';
				return;
			}

			const options = {
				// Required by every browser that implements push: a payload must
				// result in something the user can see.
				userVisibleOnly: true,
				applicationServerKey: applicationServerKey(data.publicKey)
			};
			let subscription = await registration.pushManager.getSubscription();
			if (!subscription) {
				subscription = await registration.pushManager.subscribe(options);
			} else if (!sameKey(subscription, options.applicationServerKey)) {
				// The instance's keys have been rotated since this device subscribed;
				// the old subscription can never be pushed to again.
				await subscription.unsubscribe();
				subscription = await registration.pushManager.subscribe(options);
			}

			const response = await fetch('/api/push', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(subscription.toJSON())
			});
			if (!response.ok) {
				problem = 'Nova could not store this device. Try again in a moment.';
				return;
			}

			support = 'on';
			await invalidateAll();
		} catch {
			problem = 'This browser refused the subscription. Check its notification settings.';
		} finally {
			busy = false;
		}
	}

	/** Whether an existing subscription was minted against the key we have now. */
	function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
		const existing = subscription.options.applicationServerKey;
		if (!existing) return false;
		const bytes = new Uint8Array(existing);
		return bytes.length === key.length && bytes.every((value, index) => value === key[index]);
	}

	/** Off is one tap, and it undoes both halves. */
	async function turnOff() {
		busy = true;
		problem = '';
		try {
			const subscription = await currentSubscription();
			if (subscription) {
				await fetch('/api/push', {
					method: 'DELETE',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ endpoint: subscription.endpoint })
				});
				await subscription.unsubscribe();
			}
			support = 'off';
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	function when(value: Date | null): string {
		return value
			? new Intl.DateTimeFormat('en-GB', {
					dateStyle: 'medium',
					timeStyle: 'short',
					timeZone: data.timeZone
				}).format(new Date(value))
			: 'never';
	}
</script>

<svelte:head><title>Reminders · Nova</title></svelte:head>

<section class="reminders">
	<header class="head">
		<h1>Reminders</h1>
		<p class="muted">
			One nudge a day at most, and only when an orbit is genuinely running out of time — never for
			something you have already closed.
		</p>
	</header>

	{#if !data.configured}
		<!-- No VAPID keys: this instance cannot send anything, and saying so is
		     better than a switch that silently does nothing. -->
		<div class="panel note">
			<h2>Not set up on this server</h2>
			<p class="muted">
				Reminders need a VAPID key pair, the same way mail needs an SMTP server. Whoever runs this
				Nova can generate one with <code>npx web-push generate-vapid-keys</code> and set
				<code>VAPID_PUBLIC_KEY</code>
				and <code>VAPID_PRIVATE_KEY</code>; <code>docs/DEPLOYMENT.md</code> has the details.
			</p>
		</div>
	{:else}
		<form class="panel form" method="POST" action="?/save">
			<p class="saved" role="status">
				{#if form?.saved}Saved.{:else if form?.tested}Sent to {form.tested}
					{form.tested === 1 ? 'device' : 'devices'}.{:else if form?.forgot}Device forgotten.{/if}
			</p>

			{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}

			<div class="switch">
				<input
					id="enabled"
					name="enabled"
					type="checkbox"
					defaultChecked={data.reminders.enabled}
					role="switch"
				/>
				<label for="enabled">Send me reminders</label>
			</div>

			<fieldset class="quiet">
				<legend>Quiet hours</legend>
				<p class="muted hint" id="quiet-hint">
					Nothing is sent between these times, read on your own clock ({data.timeZone}). A window
					that crosses midnight is the usual one.
				</p>
				<div class="row">
					<div class="field">
						<label for="quietFrom">From</label>
						<!-- Written out rather than through `describedBy()`, which replaces
						     the description instead of adding to it: the hint has to
						     survive an error message arriving beside it. -->
						<input
							id="quietFrom"
							name="quietFrom"
							type="time"
							required
							defaultValue={data.reminders.quietFrom}
							aria-invalid={form?.errors?.quietFrom ? 'true' : undefined}
							aria-describedby={form?.errors?.quietFrom
								? `quiet-hint ${errorId('quietFrom')}`
								: 'quiet-hint'}
						/>
					</div>
					<div class="field">
						<label for="quietUntil">Until</label>
						<input
							id="quietUntil"
							name="quietUntil"
							type="time"
							required
							defaultValue={data.reminders.quietUntil}
							aria-describedby="quiet-hint"
						/>
					</div>
				</div>
				<FieldError id="quietFrom" message={form?.errors?.quietFrom} />
			</fieldset>

			<button class="button" type="submit">Save</button>
		</form>

		<div class="panel form">
			<h2>This device</h2>
			{#if support === 'install'}
				<p class="muted">
					On an iPhone or iPad, notifications only reach Nova once it is on your home screen. Tap
					<strong>Share</strong>, then <strong>Add to Home Screen</strong>, open Nova from there and
					come back to this page.
				</p>
			{:else if support === 'unsupported'}
				<p class="muted">This browser cannot receive push notifications.</p>
			{:else if support === 'blocked'}
				<p class="muted">
					Notifications are blocked for Nova in this browser. Allow them in its site settings, then
					reload this page.
				</p>
			{:else if support === 'on'}
				<p class="muted">This device is set up to receive reminders.</p>
				<div class="actions">
					<button class="button button--ghost tap" type="button" onclick={turnOff} disabled={busy}>
						Turn off for this device
					</button>
					<form method="POST" action="?/test">
						<button class="button button--ghost tap" type="submit">Send a test</button>
					</form>
				</div>
			{:else if support === 'off'}
				<p class="muted">
					Your browser will ask for permission. Reminders also need the switch above to be on.
				</p>
				<button class="button tap" type="button" onclick={turnOn} disabled={busy}>
					Turn on for this device
				</button>
			{:else}
				<!-- Nothing is known until mount; a spinner would say less than this. -->
				<p class="muted">Checking what this browser supports…</p>
			{/if}

			{#if problem}<p class="error">{problem}</p>{/if}

			<noscript>
				<p class="muted">
					Turning a device on needs JavaScript — the subscription is made by the browser itself.
					Everything above is saved without it.
				</p>
			</noscript>
		</div>

		<div class="panel form">
			<h2>Devices</h2>
			{#if devices.length === 0}
				<p class="muted">No device is set up to receive reminders yet.</p>
			{:else}
				<ul class="devices">
					{#each devices as device (device.id)}
						<li>
							<span>{device.device}</span>
							<span class="muted">last reminded {when(device.lastSentAt)}</span>
							<form method="POST" action="?/forget">
								<input type="hidden" name="id" value={device.id} />
								<button class="button button--ghost tap" type="submit">Forget</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="muted hint">
				A device that stops answering is removed on its own — a push service says so the first time
				Nova tries.
			</p>
		</div>
	{/if}

	<p class="muted">
		Back to <a href={resolve('/settings')}>flight settings</a>.
	</p>
</section>

<style>
	.reminders {
		display: grid;
		gap: var(--gap-view);
		max-width: 34rem;
	}

	.head {
		display: grid;
		gap: 0.35rem;
	}

	.form {
		display: grid;
		gap: 1rem;
		padding: var(--pad-panel);
	}

	.note {
		display: grid;
		gap: 0.5rem;
		padding: var(--pad-panel);
	}

	.saved:empty {
		display: none;
	}

	.saved {
		color: var(--success);
		font-size: var(--text-secondary);
	}

	.switch {
		align-items: center;
		display: flex;
		gap: 0.6rem;
	}

	.switch input {
		height: 1.25rem;
		width: 1.25rem;
	}

	.quiet {
		border: 1px solid var(--space-border);
		border-radius: var(--radius);
		display: grid;
		gap: 0.6rem;
		padding: 0.8rem;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.field {
		display: grid;
		gap: 0.3rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	.hint {
		font-size: var(--text-secondary);
	}

	.devices {
		display: grid;
		gap: 0.5rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.devices li {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.8rem;
		justify-content: space-between;
	}

	.devices .muted {
		font-size: var(--text-secondary);
	}
</style>
