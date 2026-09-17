# 51 — A closing orbit takes the sheet away with it

Closing an orbit is the best thing that happens in Nova, and #9 built a whole
moment for it: the dial sweeps to its new reading, the body travels round to
meet the arc, and a burst fires when it arrives. Logging from a goal sheet on
`/today` — the fastest route to a closing there is — throws that moment away.
The sheet vanishes the instant the log lands and nothing replaces it.

## What happens

1. `/today`, compact density. A goal is in **at risk** with one log left in it.
2. Tap the row. The sheet opens with the goal's card, its dial and the custom
   amount field.
3. Log the amount that closes the orbit.
4. The sheet disappears. No sweep, no burst. The goal is in the Closed fold.

## Why

One root cause wearing two faces.

**The row is destroyed by the re-render the log triggers.**
`focusForToday()` (`src/lib/domain/progress.ts`) partitions on
`snapshot.current.complete`:

```ts
for (const snapshot of snapshots) {
    if (snapshot.current.complete) {
        closed.push(snapshot);
        continue;
    }
    ...
    (row.closing || row.behindPace ? atRisk : steady).push(row);
}
```

A goal that closes leaves `focus.atRisk` and joins `focus.closed`, which renders
a plain `<a>` and a bit of text rather than a `GoalRow`. The `{#each}` blocks are
keyed by goal id, so Svelte destroys the `GoalRow` — and the `<dialog>` that
holds the sheet lives inside it (`src/lib/components/GoalRow.svelte`). A modal
dialog whose element is removed is simply gone; nothing closes it, there is
nothing left to close.

**And the celebration is deliberately late.** `noteOrbits()` in
`src/lib/celebration.svelte.ts` waits `SWEEP_MS` (700 ms) before raising
anything, which is correct — the burst belongs at the end of the body's journey,
not the start of it. But the list has re-rendered long before that. The
celebration is raised against a goal whose dial is no longer mounted, so
`celebrationFor(goal.id)` has nothing left to read it.

Note what this means: the two halves are individually right. The partition is
right, the delay is right. What is missing is that the list reorders itself on
the same fact the celebration is about, and does it first.

**Non-compact `/today` has the same bug without a sheet.** The `GoalCard` in
`focus.atRisk` is replaced by a line of text mid-sweep, so the dial disappears
partway round. Less startling than losing a modal, same cause.

**The dashboard at `/` is fine.** Its sections are built by tier and filtered by
tier; a closing does not move a goal between them, so the row — and its open
sheet — survives. Worth keeping that way.

## What to do

Hold a closing goal in the section it was already in until its celebration is
over, then let it move.

The hold belongs to the page, not to `focusForToday()`. That function is a pure
function over plain data, per the architectural rule, and teaching it about an
animation clock would mean passing it a timer — the wrong direction entirely.
`/today` already reads `celebration()` for its astronaut, so it has what it needs
to know which goal is mid-moment. Two shapes both work:

- the page derives its partition and then patches it: a goal being celebrated
  stays in the bucket it held on the previous look
- or the store gains a small "which goal is mid-celebration, including its
  pending sweep" reading, and the page defers the move on that

Prefer whichever keeps the page readable; this is a handful of lines either way.
What matters is that the row outlives its own sweep and burst.

Two details that decide whether the fix actually delivers the moment:

- **The burst has to be the one inside the sheet.** The sheet is a modal
  `<dialog>`, so anything the page draws behind it — the cheering `Astronaut` at
  the top of `/today` — is behind the backdrop and invisible. What the user
  should see is `OrbitDial`'s own burst on the card inside the sheet. Confirm it
  plays there and that the sheet's scroll container does not clip its reach.
- **The sheet must not shut itself.** `GoalSheet`'s custom form already stays put
  by design and `GoalCard`'s quick-log does not navigate, so nothing needs
  changing there — but a fix that closes and reopens the dialog, or rebuilds it,
  loses the dial's sweep just as thoroughly as deleting the row did.

## Done when

- Logging the closing amount from a sheet on `/today` leaves the sheet open, and
  the dial inside it sweeps to full and then bursts.
- The goal moves into the Closed fold once the celebration has finished, not
  before.
- Non-compact `/today` keeps its `GoalCard` through the sweep, for the same
  reason and by the same mechanism.
- The dashboard at `/` still behaves as it does today.
- A Playwright journey covers it: open a sheet on `/today`, log the amount that
  closes the orbit, assert the dialog is still open and the celebration rendered
  inside it, and that the goal reaches Closed afterwards.
- `prefers-reduced-motion` is no worse off. Motion is suppressed in CSS while the
  store's timings are unchanged, so the held row will sit still for the length of
  a sweep — check that reads as a pause and not as a hang.
