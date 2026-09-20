# Agent instructions

The one place agent rules are written. `CLAUDE.md` imports this file and
`.github/copilot-instructions.md` points at it, so every assistant reads the
same rules. If you add a pointer for another tool, keep it a pointer.

[CONTRIBUTING.md](CONTRIBUTING.md) holds the setup, the six-step loop and the
git conventions, and they apply to you unchanged. This file is what an agent
needs on top of them.

## Starting the project

A fresh clone needs dependencies, a database, a schema and data — in that
order. Dependencies and `.env` files are not in the repo.

```bash
cd backend  && npm ci && cp .env.example .env
cd ../frontend && npm ci && cp .env.example .env
```

Then a database, by whichever route this machine allows:

```bash
# (a) local container — fastest, when Docker is available
docker compose up -d

# (b) Postgres on the Kubernetes cluster — when Docker is blocked, which it is
#     on the company laptops. Leave this running in its own terminal.
kubectl port-forward svc/<postgres-service> 5432:5432
#     then put the cluster credentials in backend/.env as DATABASE_URL
```

```bash
cd backend && npm run setup     # prisma migrate deploy, then seed
```

`npm run setup` is safe to re-run: the seed replaces only the rows it created,
which are the deliveries whose reference number contains `SEED`.

Now run it — two terminals:

```bash
cd backend  && npm run dev      # :4000
cd frontend && npm run dev      # :5173
```

If the database is unreachable, the backend still starts and `GET /api/ready`
returns 503. Check the port-forward before assuming the app is broken.

On the Windows workstation the commands differ — `npm.cmd`, a TLS flag, and a
test schema that must not be the default one. `CONTRIBUTING.md` has the four
differences; don't improvise around them.

## Commands

```bash
cd backend  && npm run verify   # typecheck, lint, test, build
cd frontend && npm run verify   # same

cd backend  && npm run seed     # reset the development data
cd backend  && npx prisma migrate dev --name <change>   # after a schema edit
```

`npm run verify` in **both** packages is the bar for calling work done — not
one of them, and not only the package you think you touched. Vitest strips
types without checking them, so a green suite can sit on a broken build.

The suite writes to whatever `DATABASE_URL` names. Where Postgres is shared
rather than a throwaway container, `backend/.env.test` points the tests at
their own database or schema — see `backend/.env.test.example`. Never run the
suite against a database someone else is reading.

## What this project is

Photograph a package before it ships and after it arrives, and have a
tamper-detection API say whether it was opened in transit. RTL Hebrew UI, two
roles (Employee, Inventory Manager), no authentication yet.

`DESIGN.md` is the source of truth: what is being built and why, the open
questions, and a changelog. Its section numbers (§3, §4.2…) are referenced
throughout the code — keep them meaningful. When `DESIGN.md` and anything under
`docs/` disagree, `DESIGN.md` is right.

## Where new code goes

| It does this | It belongs in |
|---|---|
| Parses a request, validates input, shapes a response | `backend/src/routes/` |
| Decides something — a status, a verdict, an ordering | `backend/src/services/` |
| Talks to an external system, or is cross-cutting config/logging | `backend/src/lib/` |
| Runs on every request regardless of route | `backend/src/middleware/` |
| Owns a URL | `frontend/src/pages/` |
| Is reused by more than one page | `frontend/src/components/` |
| Formats, derives or remembers — no JSX | `frontend/src/lib/` |

A service never imports `express`. That rule is what keeps services directly
unit-testable, so don't move logic into a route handler because it is shorter.

`frontend/src/api/client.ts` is the only module that knows the API's shape. It
hand-declares the domain unions (`WorkflowStatus`, `Verdict`, `Phase`) that
Prisma also generates on the backend, and nothing checks that the two agree —
change one server-side and you must change it here.

## Rules

- **Run both `verify` scripts before reporting anything done.** If one fails,
  quote the output; don't describe the change as complete.
- **Backend tests share one database and run in parallel.** Scope assertions to
  rows your own test created — comparing two reads of a global count is flaky
  by construction.
- **Don't merge, push or open a PR unless asked.** Getting a branch mergeable
  and merging it are two decisions; the second is the user's.
- **No AI attribution** in commits or PR bodies: no co-author trailers,
  generated-with footers, or session links.
- **Stage deliberately** — `git add <specific files>` after reading
  `git status`, never a blind `git add -A`.
- **Update the docs as step 6.** Ask which of `DESIGN.md`,
  `docs/architecture.md` and `docs/user-flows.md` the change affects. The
  `DESIGN.md` §11 changelog gets an entry per merged unit of work, written for
  someone reading it in a year with none of this session's context.
- **Ask before adding a dependency.** This repo deploys inside a company
  network; a new package is a conversation, not a detail.

## Do not touch

| Path | Why |
|---|---|
| `.env`, any `.env.*` | Secrets. Never read them into a response, never commit them. Document variables in `.env.example` instead. |
| `backend/prisma/migrations/*` (existing) | Already applied. Never edit one — write a new migration. |
| `backend/prisma/client` / generated Prisma output | Regenerated from the schema. |
| `package-lock.json` | Changed by npm, not by hand. |
| `DESIGN.md` §11 changelog (existing entries) | A historical record. Add entries; never rewrite past ones. |

## The stand-ins

`services/erpMock.ts`, `lib/storage.ts` and `lib/tamperCheck.ts` are fakes
behind seams; none of the three real systems exist yet, and their contracts are
open questions (`DESIGN.md` §9, `docs/production-readiness.md`). Keep each seam
narrow — that is what makes swapping in the real system a one-file change — and
never invent a contract for a system nobody has specified.

`NODE_ENV=production` deliberately refuses to start while the tamper client is
the mock. That is not a bug to fix.
