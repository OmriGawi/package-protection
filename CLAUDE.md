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

Both live in `.claude/skills/`, and GitHub Copilot in VS Code reads them and
this file too — the repo is worked on from Claude Code and from Copilot, and
neither gets its own copy of the rules. What does *not* cross over is
`.claude/settings.json`: its attribution setting and its `PostToolUse` test
hook are Claude Code features, so under Copilot the no-AI-attribution rule is
convention rather than configuration.

## Commands that must pass before anything is called done

```bash
cd backend  && npm test && npm run typecheck && npm run lint
cd frontend && npm test && npm run typecheck && npm run lint
```

Both, every time. Vitest strips types without checking them, so a green suite
can sit on a broken build — that has happened here.

`lint` is oxlint, and a warning fails it (`--max-warnings=0`). Both packages are
clean, so anything it prints is new.

`npm run coverage` in either package prints a report. CI prints it too, on
every run. It is reported, not enforced: no threshold gates a merge.

The backend suite needs Postgres: `docker compose up -d`. Test files run in
parallel against that one database, so a test that compares two separate reads
of a global count is flaky by construction; scope assertions to the rows the
suite created.

## Two machines

Development happens on a Mac and on an external Windows workstation. Same repo,
same code; only `.env` differs, and `.env` is git-ignored, so neither machine's
setup can break the other's.

The Mac runs its own Postgres from `docker compose`, as above. The external box
has no Docker daemon — its database is a shared CloudNativePG cluster reached
through a Kubernetes port-forward:

```powershell
$env:KUBECONFIG="$HOME\.kube\package-management-dev-user-kubeconfig.yaml"
kubectl port-forward -n package-management svc/pg16-rw 5432:5432
```

Three things differ there, each of which has already cost an afternoon:

- **`npm.cmd` / `npx.cmd`, not `npm` / `npx`.** PowerShell's execution policy
  blocks the `.ps1` shims.
- **`NODE_OPTIONS=--use-system-ca`.** A corporate proxy re-signs TLS, and
  without this Prisma's engine download dies on `unable to get local issuer
  certificate`.
- **Tests must not run against the default schema.** That database is shared
  with DevOps, and the suite writes to it. Override per run — dotenv leaves an
  existing variable alone, so the shell value wins:

  ```powershell
  $env:DATABASE_URL="postgresql://appuser:<pw>@localhost:5432/appdb?sslmode=disable&schema=test_omri"
  npm.cmd test
  ```

  `sslmode=disable` because the server's certificate is issued for `pg16-rw`
  and the tunnel presents it as `localhost`; the hop to the Kubernetes API
  server is the encrypted one.

The cluster's hostname resolves but never accepts a direct connection — the
services are ClusterIP. The port-forward is the only way in.

## Stand-ins

The ERP lookup, the photo storage and the tamper-detection API are all fakes
behind seams (`services/erpMock.ts`, `lib/storage.ts`, `lib/tamperCheck.ts`).
None of the real systems exist yet. `TAMPER_CHECK_OUTCOME` pins the fake
verdict for a demo.
