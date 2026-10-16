---
title: 'Year in review: your year in orbit'
labels: [enhancement, frontend, design]
milestone: 'M5 — The long haul'
---

# 68 — Year in review

The Universe tier is a year, and a year of closed orbits is the best story Nova
holds. Today it is spread across goal pages, the history strip and `/stats`,
and nothing ever puts it together. At the turn of the year, Nova should show
your year in one place.

## What it is

A page at `/review/[year]`, available for any year with data. A card on the
dashboard invites you to open it from 26 December to 31 January, in your time
zone. Outside that window it's reached from `/stats`.

**What it shows**, all from data Nova already keeps:

- **The headline:** orbits closed this year, overall and per tier, with how many
  were possible. "212 orbits closed of 290."
- **Longest flight:** the best streak of the year, its goal, and the dates it
  ran.
- **The year as a sky:** one mark per day across the year, where each closed
  orbit lights its day. Reuse `dayGrid` from `$domain/history` for the layout
  rather than building a new one.
- **Per goal:** a short row per goal that flew this year, with its closed out of
  possible, best streak, and the tier's body drawn at its final standing.
- **Universe goals:** each yearly goal's result in a line, closed or not.
- **Notes:** the orbit notes (#18) written this year, in order. They are the
  user's own words, and the best part of looking back.
- **The belt:** how many asteroids (#30) were cleared.
- **Against last year,** when last year has data: the headline numbers side by
  side. No points, no grades. The roadmap rules out gamification.

## Rules

- **All the maths in `$domain/review.ts`,** as pure functions over goals,
  entries, archive windows and notes. Load the year through the
  `src/lib/server/goals.ts` services; never call `snapshotGoal()` from the route.
- **The year is a calendar year in the user's zone.** A period belongs to the
  year containing its **last instant**, the same rule nesting uses
  (`CLAUDE.md`, Time zones). So a week spanning 31 December belongs to the year
  it ends in. Test that week, and a DST date.
- **Dormant periods are not possible orbits.** Archived spans, and rest days if
  that has landed, never count against the year.
- **Visuals:** CSS and inline SVG, like everything outside the universe view.
  Respect reduced motion. Make it look good printed: a print stylesheet is
  cheap, and the page is worth printing.
- **Nothing leaves the server.** No share image and no public link. The page
  is the user's.

## Not in scope

- Sharing to social networks or a rendered share image. Raster generation is a
  different problem; it can come later if it's wanted.
- Reviews by month or quarter. Galaxy goals could have one some day.
- Emailing the review, or sending it by push. A notification never carries the
  user's words (`CLAUDE.md`), so a push could only say the review is ready.

## Done when

- `/review/2026` shows everything above for an account with a year of data, and
  `/review/<a year with nothing>` says so kindly.
- The dashboard card appears only in the window and disappears once dismissed.
- `$domain/review` has unit tests for:
  - the year-boundary week;
  - a DST date;
  - a dormant span;
  - a goal created mid-year, where "possible" starts at creation.
- A journey seeds a year of data with a pinned clock and reads the headline,
  axe included.
- `pnpm lint && pnpm check && pnpm test && pnpm e2e` pass. Screenshots go on the
  `screenshots` branch (`CLAUDE.md`).
