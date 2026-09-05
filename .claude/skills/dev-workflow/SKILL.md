---
name: dev-workflow
description: Use before writing any non-trivial code in this repo — a new slice, a feature, a bug fix touching real logic. Enforces the six-step loop this project always follows — plan, implement, write tests, run tests, code review, update docs — in order, every time, before calling work done or offering to merge. Skip only for genuinely trivial one-line changes.
---

# Dev workflow

This repo's standing process for any real code change, backend or
frontend. Don't shortcut steps or reorder them — the point is that
every slice gets the same discipline, not just the ones that feel
risky.

1. **Plan.** Use plan mode (`EnterPlanMode`) before touching files, unless
   the change is a one-liner. Get the approach agreed before writing code.

2. **Implement.** Write the code per the approved plan. Verify it actually
   runs (start the dev server, hit the endpoint, load the page) — this
   project also does manual/browser verification per the `run` skill, but
   that's in addition to step 3, not a substitute for it.

3. **Write tests.** Every new piece of real logic gets an automated test,
   not just a manual check:
   - Backend (`backend/`): Vitest. Pure logic (services like
     `erpMock.ts`) gets unit tests; API routes get an integration test
     (supertest against the real Express app).
   - Frontend (`frontend/`): Vitest + React Testing Library. Component
     behavior that matters to the user (validation states, submit flow)
     gets a test, not just a visual check.
   If no test runner exists yet in the package you're touching, set it up
   as part of this step — don't skip tests because the harness isn't
   there yet.

4. **Run tests _and_ typecheck.** Execute the suite (`npm test`) *and*
   `npm run typecheck` in each package you touched, and confirm both are
   green. Don't assume a test passes because it looks right.

   Both, because they catch different things: Vitest strips types without
   checking them, so `npm test` can be fully green while `npm run build` is
   broken — that is exactly how a type error once sat undetected across a
   whole slice here.

5. **Code review.** Run the `code-review` skill on the diff before
   considering the work finished or offering to merge.

   `code-review` reads the diff and returns prose; it runs in a subagent, so
   the session's caveman mode does not reach it. Relaying its report is the
   step that applies `caveman-review` — one line per finding:

   ```
   <path>:L<line> — <🔴 bug|🟡 risk|🔵 nit> <problem>. <fix>. [confirmed|rejected: <why>]
   ```

   Check each finding against the code before acting on it, and say which way
   it went. Reviewers are wrong sometimes — two findings were rejected on
   2026-09-05, one of them contradicting an earlier review — so a report
   relayed without a verdict per line hides the part that took the work.

   Fix what survives, or say explicitly why not.

6. **Update the docs.** Ask which of the three is affected before calling the
   work done — most changes touch one, some touch none, but the question gets
   asked every time:
   - `DESIGN.md` — behavior the user can see, a decision made, a constraint
     found. Its §11 changelog gets an entry per merged unit of work, written
     for someone reading it in a year with none of this session's context.
   - `docs/architecture.md` — a new route, a moved module, a schema change, a
     new seam.
   - `docs/user-flows.md` — a screen doing something different.

   The changelog fell two merges behind before this step existed. It is
   cheapest to write while the reasoning is still in hand.

Only after all six steps does a slice count as done. Merging
`feat/*` → `main` is a separate, explicit checkpoint per the git-flow
already in use for this repo — this skill governs getting a branch to a
mergeable state, not the merge itself.
