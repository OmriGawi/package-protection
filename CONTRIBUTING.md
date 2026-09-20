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
but `GET /api/ready` returns 503, which reads like a broken app if you have
forgotten the tunnel.

`npm run setup` in `backend/` runs the migrations and then seeds development
data — four deliveries covering the states the screens are built around. It is
re-runnable: the seed replaces only the rows it created, which are the ones
whose reference number contains `SEED`.

**Give the tests their own database, on every machine.** The suite writes to
whatever `DATABASE_URL` names, so by default that is your development data.
Copy `backend/.env.test.example` to `backend/.env.test` and run `npx prisma
migrate deploy` once with it — vitest loads it ahead of `.env`, so the
separation is a file rather than a habit.

After a schema edit, migrate both. `npm run migrate` in `backend/` does it in
one command — `prisma migrate dev` against the schema `.env` names, then
`scripts/migrate-test.mjs` against the one `.env.test` names, whatever it is
called there:

```bash
cd backend && npm run migrate -- --name <change>
```

The script sets `DATABASE_URL` for a child process rather than for your shell,
which is what makes it the same command on both machines: PowerShell has no
`VAR=value command` prefix, so the alternative there is `$env:DATABASE_URL` plus
remembering to clear it, and forgetting leaves every later command in that
session pointed at the test schema. With no `.env.test` present — CI — it prints
a line and exits 0.

The backend logs the schema it is pointed at on every boot (`dbSchema` in
`server_listening`), so `npm run dev` answers "which one am I on?" without
anyone running `prisma migrate status` to find out.

On a shared Postgres the reason for the separate schema is that the suite must
never touch a database someone else is reading. On a throwaway container it is smaller but real: a run
deletes the seeded deliveries under whichever screen you had open and leaves a
few hundred fixtures in their place, and `npm run seed` afterwards restores the
seeded rows without removing the fixtures. This used to say the file was
unnecessary with a container, which is how a development database ended up
holding 188 of them.

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

Every change reaches `main` through one, and `main` takes no other input —
nothing is merged from a laptop. The pull request is what ties a commit to a
review and to a green CI run; without it, neither is recoverable later.

- Title under ~70 characters, in the same Conventional Commits form as a commit
  subject. The squash merge turns it into one.
- Body in plain prose: a short **Summary** in bullets, and a **Test plan**
  saying what was actually run — the gates, plus any manual browser check. The
  template prefills both.
- Link the `DESIGN.md` section or production-readiness item the work relates
  to, where there is one.
- Label it with its Conventional Commits type — `feat`, `fix`, `docs`, `chore`,
  `ci`. The label is what files it under a heading in the release notes.
- **Squash on merge**, always. One commit per pull request keeps `main` linear
  and stamps the number onto the subject — `feat(frontend): right-align the
  reference heading (#12)` — so every commit leads back to the review that
  accepted it. The branch is the unit a reviewer reads, so keep branches small
  enough that flattening one loses nothing worth keeping.

```bash
git switch -c feat/thing
# ... the six steps above ...
git push -u origin feat/thing
gh pr create --fill --label feat
gh pr merge --squash --delete-branch      # once CI is green
```

The repository settings hold that shape rather than trusting anyone to
remember it: squash is the only merge button, the subject comes from the pull
request title, and the branch is deleted on merge. Those live on GitHub rather
than in the tree, so a fresh clone on another machine inherits them with no
setup.

## Releases

A release is a tag on `main` plus the notes GitHub generates from the pull
requests merged since the previous tag. There is no release branch, and no
release note is written by hand.

```bash
git switch main && git pull
git tag v0.2.0 && git push origin v0.2.0
```

`.github/workflows/release.yml` does the rest: it refuses a tag that does not
point at a commit on `main` — which would publish a release for code no CI run
ever saw — and then publishes the release with generated notes.
`.github/release.yml` decides their headings.

- **One version for the whole repository.** The backend and the frontend deploy
  together, so they share a tag. The `version` fields in the two
  `package.json` files are not that number and are not kept in step with it;
  neither package is published anywhere, so the tag is the only version that
  means anything.
- **Semver, read loosely.** Nothing installs this as a dependency, so there is
  no API to break. Minor for a feature, patch for a fix, major when deploying
  it takes a manual step — a migration that will not run backwards, say.
- **This is not `DESIGN.md` §11.** The changelog records decisions and the
  reasoning behind them for someone reading in a year; release notes record
  what shipped under which tag. Keep both. Neither replaces the other.

## The three stand-ins

The ERP lookup, the photo storage and the tamper-detection API are all fakes
behind seams (`services/erpMock.ts`, `lib/storage.ts`, `lib/tamperCheck.ts`).
None of the real systems exist yet, and the questions that would let us build
against them are listed in `DESIGN.md` §9 — they are owned by other teams, and
getting them answered unblocks more than any code in this repo.

When you touch a seam, keep the fake and the interface in step: the seam is the
only thing that makes swapping in the real system a one-file change.
