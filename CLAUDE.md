# Package Protector

Photograph a package before it ships and after it arrives, and have a
tamper-detection API say whether it was opened in transit. RTL Hebrew UI,
two roles (Employee, Inventory Manager), no login yet.

## Where things are written down

- **`DESIGN.md`** — the source of truth. What is being built and why, every
  decision's reasoning, the open questions, and a changelog with one entry per
  merged unit of work. Section numbers (§3, §4.2…) are referenced throughout
  the code; keep them meaningful.
- **`docs/architecture.md`** — module layout, API surface, request lifecycle,
  data model, the three seams.
- **`docs/user-flows.md`** — screens, the package state machine, the flows.
- **`ui/index.html`** — a standalone mockup, *not* the production frontend.
  Screens get rebuilt in React once settled there.

When DESIGN.md and `docs/` disagree, DESIGN.md is right.

## How work is done here

Two skills govern this, and they are not optional:

- **`dev-workflow`** — the six-step loop for any real change: plan, implement,
  write tests, run tests *and* typecheck, code review, update docs.
- **`git-conventions`** — branch flow, staging discipline, commit scopes, PR
  shape. Commit message format belongs to `caveman-commit`.

## Commands that must pass before anything is called done

```bash
cd backend  && npm test && npm run typecheck
cd frontend && npm test && npm run typecheck
```

Both, every time. Vitest strips types without checking them, so a green suite
can sit on a broken build — that has happened here.

The backend suite needs Postgres: `docker compose up -d`. Test files run in
parallel against that one database, so a test that compares two separate reads
of a global count is flaky by construction; scope assertions to the rows the
suite created.

## Stand-ins

The ERP lookup, the photo storage and the tamper-detection API are all fakes
behind seams (`services/erpMock.ts`, `lib/storage.ts`, `lib/tamperCheck.ts`).
None of the real systems exist yet. `TAMPER_CHECK_OUTCOME` pins the fake
verdict for a demo.
