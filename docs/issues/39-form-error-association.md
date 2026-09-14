---
title: Tie form field errors to the inputs they belong to
labels: [a11y, frontend]
milestone: 'M1 — Daily driver'
---

Found during #7 and deliberately left out of it, because it is a change to every
form rather than to the orbit visuals that issue was about.

Every form in Nova renders a field's error as a sibling paragraph inside
`.field`:

```svelte
<div class="field">
	<label for="email">Email</label>
	<input id="email" name="email" type="email" required />
	{#if form?.errors?.email}<p class="error">{form.errors.email}</p>{/if}
</div>
```

Nothing connects the two. A screen reader that reaches the input by name — which
is how a form is filled in, one control at a time — announces "Email, edit text"
and stops. The sentence saying _why the submit bounced_ is a separate paragraph
that is only read if the user happens to arrow through the page rather than tab
through the form. The field also does not report itself as invalid, so there is
no signal at all that this particular control is the one that needs attention.

axe does not flag it. There is no rule for "an error message that exists but is
not associated", which is exactly why it survived a pass that scanned every route
under every preference and came back clean.

## Build

Give each error an `id` and point the control at it, plus `aria-invalid` so the
control says it is the one at fault:

```svelte
<input
	id="email"
	name="email"
	aria-invalid={form?.errors?.email ? 'true' : undefined}
	aria-describedby={form?.errors?.email ? 'email-error' : undefined}
/>
{#if form?.errors?.email}<p id="email-error" class="error">{form.errors.email}</p>{/if}
```

`undefined` rather than `"false"` on both, so a clean field carries no attributes
at all rather than an explicit denial.

The forms, and the fields on each:

- `/login` — email, password
- `/register` — displayName, email, password
- `/forgot` — email
- `/reset` — password, confirmPassword
- `/settings` — displayName, timeZone
- `/settings/security` — currentPassword, newPassword, confirmPassword
- `GoalForm` — title, target, and the tier `<fieldset>` (which needs the legend's
  group rather than a single control)
- `/goals/[id]` — amount, occurredAt, and the sheet's amount in `GoalSheet`

Repeating that three times per field across eight files is the part worth
thinking about before starting. A small helper — a `field` snippet, or a tiny
`describedBy(errors, name)` — would carry the pattern once, and is more likely to
be right on the next form somebody adds than a convention nobody can enforce.
`FormErrors` from `$domain/validation` is already the shared shape both halves
read, so the helper has something to hang off.

Two things that are already right and should stay: form-level errors
(`errors.form`) sit above the submit and are reached on the way to it, and the
pages that post without `enhance` navigate, so the browser announces the new
page. Neither needs a live region.

## Done when

- Reaching an errored control by keyboard announces its error along with its
  name, and the control reports itself invalid.
- A field with no error carries neither attribute.
- The pattern is expressed once rather than copied per field, so the next form
  gets it for free.
- An end-to-end test submits a form with a bad value and asserts the association
  from the accessibility tree, not from the markup — `e2e/keyboard-and-focus.spec.ts`
  already reads Chromium's own tree over CDP for the `<details>` state and can do
  the same here.
