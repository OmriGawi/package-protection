# Contributing

How work is done in this repository. [README.md](README.md) covers what the
project is and how to run it; this file covers how to change it.

## Setup

Node 24 (matching CI) and Docker.

```bash
docker compose up -d                  # Postgres 16 on :5432

cd backend  && cp .env.example .env && npm ci && npx prisma migrate deploy
cd frontend && cp .env.example .env && npm ci
```

Two ways to get a database. Locally, `docker compose up -d` is the whole story.
Where Docker is blocked — which it is on the company laptops — Postgres runs on
the Kubernetes cluster and you reach it with `kubectl port-forward` (or
OpenLens) using credentials from a cluster Secret. Get them from the cluster,
never from a file in this repo, and never commit them; `.env` is gitignored and
stays that way. The port-forward has to stay running: without it the app starts
but `GET /ready` returns 503, which reads like a broken app if you have
forgotten the tunnel.

`npm run setup` in `backend/` runs the migrations and then seeds development
data — four deliveries covering the states the screens are built around. It is
re-runnable: the seed replaces only the rows it created, which are the ones
whose reference number contains `SEED`.

**If your Postgres is shared, give the tests their own.** The suite writes to
whatever `DATABASE_URL` names, so on a cluster database that means your
development data. Copy `backend/.env.test.example` to `.env.test` and point it
at a separate database, or a separate schema in the same one — vitest loads it
ahead of `.env`, so the separation is a file rather than a habit. With a
throwaway container you don't need the file at all.

CI is unaffected either way: the workflow starts its own Postgres service
container, which remains the impartial source of truth for whether the suite
passes.

`backend/.env.example` documents every variable `src/lib/config.ts` reads,
including which become required when `NODE_ENV=production`. Config is validated
once at import and reports *every* problem rather than the first, so a
misconfigured environment tells you everything wrong with it in one start.

## The Windows workstation

This project is developed from a Mac and from an external Windows box. Same
repo, same code — only `.env` differs, and `.env` is gitignored, so neither
machine's setup can break the other's.

The Windows box has no Docker daemon. Its database is a shared CloudNativePG
cluster reached through a port-forward, which has to stay running:

```powershell
$env:KUBECONFIG="$HOME\.kube\package-management-dev-user-kubeconfig.yaml"
kubectl port-forward -n package-management svc/pg16-rw 5432:5432
```

The cluster's hostname resolves but never accepts a direct connection — the
services are ClusterIP, so the port-forward is the only way in.

Four things differ there, each of which has already cost an afternoon:

- **`npm.cmd` / `npx.cmd`, not `npm` / `npx`.** PowerShell's execution policy
  blocks the `.ps1` shims.
- **`NODE_OPTIONS=--use-system-ca`.** A corporate proxy re-signs TLS, and
  without it Prisma's engine download dies on `unable to get local issuer
  certificate`.
- **`sslmode=disable` in the connection string.** The server's certificate is
  issued for `pg16-rw` and the tunnel presents it as `localhost`. The hop to
  the Kubernetes API server is the encrypted one.
- **The tests must not touch the default schema**, which is shared with DevOps.
  This used to mean overriding `DATABASE_URL` in the shell before every run,
  which works only as long as nobody forgets. It is now a file — copy
  `backend/.env.test.example` to `backend/.env.test` and give it the test
  schema:

  ```
  DATABASE_URL="postgresql://appuser:<pw>@localhost:5432/appdb?sslmode=disable&schema=test_omri"
  ```

  vitest loads it ahead of `.env`, so the suite lands in `test_omri` whether or
  not anyone remembered. `npx.cmd prisma migrate deploy` once with that URL to
  create the tables in it.


## The gates

```bash
cd backend  && npm run verify
cd frontend && npm run verify
```

`verify` is typecheck, lint, test and build in that order — cheapest failure
first. Both packages, every time, regardless of which one you thought you
touched. CI runs the same four steps individually, so it can report all of them
rather than stopping at the first.

Each gate catches something the others do not:

- **`npm test`** — Vitest. The backend suite talks to a real Postgres rather
  than a mock, because the priority ladders and the paging are SQL and mocking
  the database would test nothing that ships.
- **`npm run typecheck`** — Vitest strips types without checking them, so a
  fully green suite can sit on a broken build. That has happened here.
- **`npm run lint`** — oxlint with `--max-warnings=0`. Both packages are clean,
  so anything it prints is new.
- **`npm run build`** — the last word on whether it compiles.

`npm run coverage` prints a report in either package, and CI prints it on every
run. It is reported, not enforced: no threshold gates a merge, because a
threshold set at today's number mostly fires on noise. The same goes for
`npm audit`.

### Writing backend tests

Test files run in parallel against one shared database. A test that compares
two separate reads of a global count is therefore flaky by construction — scope
every assertion to the rows your own test created.

Rate limiting and the abandoned-check sweep are both off under `NODE_ENV=test`:
a limiter would turn a suite that uploads dozens of times from one address into
flakiness, and a sweep firing mid-suite would race the fixtures a test just
built. The suite calls the sweep directly instead.

## Making a change

The same six steps every time, in order — the point is that every change gets
the same discipline, not just the ones that feel risky.

1. **Plan.** Agree the approach before touching files. Skip only for a genuine
   one-liner.
2. **Implement**, and actually run it — start the server, hit the endpoint,
   load the page.
3. **Write tests.** Every new piece of real logic gets an automated test, not
   just a manual check. Backend: Vitest for services, supertest against the
   real Express app for routes. Frontend: Vitest and React Testing Library for
   behaviour a user can observe — validation states, submit flows — not just a
   visual check.
4. **Run the gates**, in every package you touched, and confirm they are green.
   Don't assume a test passes because it looks right.
5. **Review the diff** before considering the work finished. Check each finding
   against the code rather than applying it on sight; reviewers are wrong
   sometimes, and a report relayed without a verdict per finding hides the part
   that took the work. Fix what survives, or say why not.
6. **Update the docs.** Ask which are affected before calling the work done —
   most changes touch one, some touch none, but the question gets asked every
   time:
   - `DESIGN.md` — behaviour a user can see, a decision made, a constraint
     found. Its §11 changelog gets an entry per merged unit of work, written
     for someone reading it in a year with none of today's context.
   - `docs/architecture.md` — a new route, a moved module, a schema change, a
     new seam.
   - `docs/user-flows.md` — a screen doing something different.

   The changelog is cheapest to write while the reasoning is still in hand. It
   fell two merges behind once, before this step was written down.

## Branches

GitHub flow. `main` is always deployable; there are no `develop`, `release` or
`hotfix` branches.

- One short-lived branch per unit of work: `feat/<feature>`, `fix/<bug>`,
  `docs/<topic>`, `chore/<task>` — e.g. `feat/keycloak-auth`.
- A branch is mergeable once it has been through all six steps above.
- Delete the branch after merging.
- Never force-push `main`. Never `--no-verify`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/). Adopted
2026-09-05 — commits before that point have prose subjects, and history is
deliberately not reformatted to match.

- Scopes follow the repo layout: `backend`, `frontend`, `db`, `ci`, `docs`.
- One logical change per commit. Don't bundle an unrelated fix into a feature
  commit just because you noticed it along the way.
- Stage deliberately (`git add <specific files>`). Never a blind `git add -A`
  without reading `git status` first — this repo has caught a stray install
  landing at the wrong path that way.
- Body caps at roughly 8 lines: one paragraph per non-obvious decision, three
  at most. Explain *why*, not what the diff already shows.
- **No AI attribution.** No `Co-Authored-By` lines, generated-with trailers, or
  session links in commits or PR bodies, whatever tool wrote the code.

## Pull requests

- Title under ~70 characters.
- Body in plain prose: a short **Summary** in bullets, and a **Test plan**
  saying what was actually run — the gates, plus any manual browser check. The
  template prefills both.
- Link the `DESIGN.md` section or production-readiness item the work relates
  to, where there is one.

## The three stand-ins

The ERP lookup, the photo storage and the tamper-detection API are all fakes
behind seams (`services/erpMock.ts`, `lib/storage.ts`, `lib/tamperCheck.ts`).
None of the real systems exist yet, and the questions that would let us build
against them are listed in `DESIGN.md` §9 — they are owned by other teams, and
getting them answered unblocks more than any code in this repo.

When you touch a seam, keep the fake and the interface in step: the seam is the
only thing that makes swapping in the real system a one-file change.
