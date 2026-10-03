---
title: 'Universe polish: pinch taps, an idle loop, in-place updates'
labels: [frontend, performance]
milestone: 'M2 — The fun part'
---

# 63 — Universe polish

A follow-up to #11, from reading the renderer once it had merged. The view is
right; it costs more than it should on a phone, and one gesture opens a sheet
nobody asked for. Everything here is in `src/lib/universe/` and
`$components/Universe.svelte`. The domain does not change, and neither does
anything a user would notice except the bug and the battery.

The #11 spec still holds. In particular decision 10 — a still universe costs
nothing — is what part 2 restores.

## 1. A pinch can open a goal sheet

`onPointerDown` and `onPointerUp` in `src/lib/universe/index.ts` keep one
`down` position for whichever pointer went down last. In a two-finger zoom,
lifting the finger that did not move is measured against that position. When the
still finger went down second, it measures zero, counts as a tap, and opens the
nearest body's sheet and flies to it mid-pinch. There is no `pointercancel`
handler either, so a gesture the browser took over leaves `down` set.

**Fix.** Track pointers by `pointerId`. A gesture is a tap only if exactly one
pointer was down from the first `pointerdown` until the last `pointerup`, and that
pointer moved no more than `TAP_SLOP_PX`. A second pointer at any point voids the
tap for the rest of the gesture. `pointercancel` removes its pointer and voids
the tap.

Put the bookkeeping in `pick.ts` as a small pure tracker (events in, "tap at
x, y" or nothing out), so `pick.test.ts` can cover:

- one finger, no movement: a tap;
- one finger, moved past the slop: no tap;
- a pinch where the still finger goes down second and lifts first: no tap;
- the same with the fingers the other way round: no tap;
- `pointercancel` partway through: no tap, and the next clean tap still works.

## 2. With motion allowed, the view never stops drawing

`ambient()` returns true while any living body is on screen, so with motion
allowed the loop never idles. The journey test even asserts that frames keep
coming. On top of that, ambient frames are paced by skipping: `frame()` returns
early when less than `AMBIENT_FRAME_MS` has passed, so `requestAnimationFrame`
fires on every display refresh, 120 times a second on a 120Hz phone, to draw 30.

**Settle.** Ambient motion runs for `AMBIENT_IDLE_MS` (20 s) after the last
interaction, then stops. Bodies stay where they are, with no snap back to a rest
pose. These count as interaction and start the window again:

- a pointer, wheel or keyboard gesture on the view;
- the zoom being moved;
- a flight;
- `update()` or `celebrate()`;
- the view becoming visible again after being hidden, off screen or covered.

Sweeps, flights and closings always run to the end, whatever the window says.

**Resume without a jump.** `live(seconds)` gets the page clock now, and a closed
orbit's lap is measured from `lapStart`. Resuming after a pause would jump every
body to where it would have been. Give the ambient motion its own clock that
advances only while ambient frames are being drawn. Settling, hiding or covering
the view pauses that clock, and resuming continues from it. Reduced motion keeps
its current behaviour: the rest pose, and the lap waiting at its start mark.

**Pace without waking.** When the only thing running is ambient motion, don't
wake on every refresh. Schedule the next frame `AMBIENT_FRAME_MS` out — a
`setTimeout` that then asks for a frame is fine. `loop.ts` grows whatever it
needs for that. In `loop.test.ts`, with fake timers, prove these:

- no frame callback runs between ambient frames;
- a `request()` during the wait draws straight away, not at the end of the wait;
- every pause still stops everything, including a pending wait.

**The journey.** Change `e2e/universe-journey.spec.ts` to assert that the bodies
draw frames while the window is open, and none once it closes. Don't make the
test wait 20 seconds: give the dev-only `__novaUniverse` probe a way to shorten
the window. It stays dev-only, as everything on that probe is.

## 3. Every log rebuilds the whole scene

`update()` calls `build(true)`. That disposes every geometry, material and
label, and builds them all again. While a sheet is open the rebuild waits, so it
lands in `setCovered(false)` — exactly when the sheet closes and the trail should
sweep. `bridge()` shifts the sweep's start past the stall so the sweep isn't cut
short. That hides the stall; it doesn't prevent it. Every body also builds its
own geometry: each planet has its own 72×48 `SphereGeometry`, and each craft its
own boxes and cylinders.

**In place when the shape holds.** Define a shape key over the tree: every node's
id, parent, kind, body variant, and anything else that decides what geometry or
which material a node gets. A log almost never changes it. When the new tree has
the same key as the drawn one:

- move each changed trail from what it showed to the new fraction, with the same
  sweep a rebuild runs now;
- switch a node that has just closed to its closed width and start its lap;
- update the label text, and re-measure only the labels whose text changed, in
  one batch, as `buildScene` measures them now;
- don't dispose or create anything else.

A different shape key — a goal added, archived, re-parented, or moved to another
tier — rebuilds as now. Unit-test the key: a log, a closing and a percentage
change keep it; each of the shape changes listed changes it.

**Shared geometry.** Geometry that depends only on a body's variant and level of
detail comes from one cache, like `Kit`'s textures do now. That cache lives as
long as the view does, and a scene's `dispose()` never disposes anything from it.
Materials carrying a goal's colour stay per body.

**Measure it.** Put the time `update()` takes, before and after, in the PR. Use
the 40-goal account from `scripts/universe-screenshots.mjs`, two numbers each,
one log that keeps the shape and one that adds a goal. SwiftShader's absolute
times mean little, so the ratio is the number.

## 4. Layout reads in the frame, and labels without memory

**Avoid-boxes.** `avoidBoxes()` calls `getBoundingClientRect()` on the canvas, the
zoom's words and track, and the full-screen button on every drawn frame.
`labels.render()` wrote styles at the end of the previous frame, so every frame
forces a synchronous layout. Measure these boxes once, then again when the view
resizes, the zoom's stops change, or full screen is entered or left. A
`ResizeObserver` on the view and on the zoom covers all of it. The frame reads
only the cached boxes. Nothing inside `frame()` reads layout.

**Label hysteresis.** `levelOfDetail()` picks labels from scratch every frame.
As closed orbits lap, two labels competing for the same space can trade places
frame to frame, and when one leaves, the next candidate pops in. Give labels
memory:

- A label shown last frame stays shown while it still fits in the view, its body
  still has room from its host, and the label is under the cap.
- It gives way only to a candidate whose box overlaps it and whose body is
  clearly larger on screen — 1.5× — not just larger.
- Placing shown labels first and then the rest, by the current order, does
  this.

Keep the decluttering a pure function of its inputs plus the set shown last
frame, so it can be unit-tested without three:

- a label shown last frame survives a candidate that is slightly larger;
- it yields to one that is 1.5× larger;
- it leaves when it no longer fits;
- the cap of twelve still holds.

## Not in scope

- Anything in `$domain/universe` or the tree's rules.
- New visuals, new motion, a different frame rate. If something looks
  different after this, that is a regression.
- `logarithmicDepthBuffer`. It has a cost on phone GPUs, but replacing it means
  managing near and far planes per zoom stop. That is its own issue if it ever
  shows up in a profile.

## Screenshots

None are needed; nothing should look different. If you take any, follow the
**Screenshots** section of `CLAUDE.md`. Images go on the `screenshots` branch,
never on `main`.

## Done when

- A pinch never opens a sheet, and `pointercancel` ends a tap, covered by unit
  tests in `pick.test.ts`.
- With motion allowed, frames stop after the idle window and start again on
  interaction, with no jump in any body or lap. No frame callback runs between
  ambient frames. Both are covered in `loop.test.ts` and in the journey.
- A log that keeps the shape key updates in place: no scene rebuild, and no
  geometry or material created. Bodies of the same variant share geometry. The
  PR gives before and after `update()` times at 40 goals.
- Nothing in `frame()` reads layout. Label choice is stable frame to frame, with
  unit tests for the rules above.
- Reduced motion behaves exactly as before, and the existing journeys pass
  unchanged except where this spec changes them.
- `pnpm lint && pnpm check && pnpm test && pnpm e2e` pass. The universe chunk
  stays under 180 kB gzipped; give the number in the PR.
