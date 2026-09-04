---
name: dev-workflow
description: Use before writing any non-trivial code in this repo — a new slice, a feature, a bug fix touching real logic. Enforces the five-step loop this project always follows — plan, implement, write tests, run tests, code review — in order, every time, before calling work done or offering to merge. Skip only for genuinely trivial one-line changes.
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

4. **Run tests.** Actually execute the suite (`npm test` in the relevant
   package) and confirm it's green. Don't assume a test passes because it
   looks right.

5. **Code review.** Run the `code-review` skill on the diff before
   considering the work finished or offering to merge. Fix what it finds,
   or say explicitly why not.

Only after all five steps does a slice count as done. Merging
`feat/*` → `main` is a separate, explicit checkpoint per the git-flow
already in use for this repo — this skill governs getting a branch to a
mergeable state, not the merge itself.
