# Package Protection

Photograph a package before it ships and again when it arrives, and have a
tamper-detection API say whether it was opened in transit.

An internal web app with two roles — Employee and Inventory Manager — and an
RTL Hebrew interface. A **Delivery** holds one or more **Packages**; each
package carries 4+ photos taken at shipping and 4+ taken at receiving. The
comparison produces a verdict per package: intact, opened, or inconclusive. A
manager can override a verdict after checking the box physically, and that
override is recorded with a note and an author.

## Status

The full flow works end to end against a real database: create a delivery,
upload pre-ship photos, receive, run the check, review verdicts on the
dashboard, override one.

Three external systems this project does not own are **stand-ins**, each behind
a seam so the real one swaps in at a single file:

| Seam | File | Reality |
|---|---|---|
| ERP reference lookup | `backend/src/services/erpMock.ts` | mocked |
| Photo storage | `backend/src/lib/storage.ts` | local disk |
| Tamper detection | `backend/src/lib/tamperCheck.ts` | random verdict |

Set `TAMPER_CHECK_OUTCOME` to pin the fake verdict when demoing a specific
state. There is no authentication yet — the current user is a stand-in too.

What is still missing before this serves real deliveries is written down, one
numbered item each, in [docs/production-readiness.md](docs/production-readiness.md).

## Quickstart

Requires **Node 24** and a PostgreSQL 16 to talk to.

```bash
cd backend  && npm ci && cp .env.example .env
cd ../frontend && npm ci && cp .env.example .env
```

Then a database, by whichever route the machine allows:

```bash
docker compose up -d                       # (a) local container
kubectl port-forward svc/<postgres> 5432:5432   # (b) cluster Postgres, when
                                           #     Docker is blocked — then put
                                           #     the cluster credentials in
                                           #     backend/.env
```

```bash
cd backend  && npm run setup               # migrate, then seed development data
cd backend  && npm run dev                 # http://localhost:4000
cd frontend && npm run dev                 # http://localhost:5173
```

`npm run setup` is re-runnable; the seed replaces only its own rows. Every
backend environment variable is documented in `backend/.env.example`, including
which become required in production.

## Environments

The app reads all of its configuration from the environment, so the same image
runs everywhere and only the values differ.

| | Where it runs | Database | Config from |
|---|---|---|---|
| **Local development** | your machine, `npm run dev` | a local container, or a schema of your own on the cluster Postgres via port-forward | `backend/.env` |
| **Tests** | your machine and CI | a throwaway container, a separate database, or a schema of its own — never the one holding your development data | `backend/.env.test` if present, else `.env`; CI passes it directly |
| **Test / production** | pods in the cluster | the Postgres the platform team provisions per environment | a ConfigMap and a Secret — no `.env` file is involved |

A schema named for you on a shared Postgres is a local-development
convenience, not an environment: it exists because a company laptop cannot run
Docker. Nothing deployed reads it, and nothing about it constrains how the real
environments are configured.

## Before calling anything done

```bash
cd backend  && npm run verify     # typecheck, lint, test, build
cd frontend && npm run verify
```

Both packages, every time. See [CONTRIBUTING.md](CONTRIBUTING.md) for why, and
for how work is organised here.

## Layout

```
backend/     Express 5 + Prisma + PostgreSQL  (routes → services → lib)
frontend/    React 19 + Vite + React Router
docs/        Architecture, user flows, production readiness
```

## Where things are written down

| File | What it holds |
|---|---|
| [DESIGN.md](DESIGN.md) | **The source of truth.** What is being built, why, every decision's reasoning, open questions, and a changelog with one entry per merged unit of work. |
| [docs/architecture.md](docs/architecture.md) | Module layout, API surface, request lifecycle, data model, the three seams. |
| [docs/user-flows.md](docs/user-flows.md) | Screens, the package state machine, the flows. |
| [docs/production-readiness.md](docs/production-readiness.md) | The gap between this and a production deployment, item by item. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to set up, test, branch, commit and review. |
| [AGENTS.md](AGENTS.md) | The same rules, addressed to coding agents. |

Section numbers in `DESIGN.md` (§3, §4.2…) are referenced throughout the code
and the docs. When `DESIGN.md` and anything in `docs/` disagree, `DESIGN.md` is
right and the other file needs fixing.

## Deployment

Both packages ship as separate container images and run on Kubernetes (VMware
Tanzu), tagged with the same commit so a frontend and a backend are always
traceable to one source revision. Neither Dockerfile exists yet.

What the platform needs to know about this app:

- **Migrations are a deploy step.** Run `prisma migrate deploy` as its own Job
  before the new version serves traffic — not at pod boot, and not as an
  initContainer, which runs once per pod and lets replicas race each other.
- **The frontend's API URL is baked in at build time.** `VITE_API_URL` is
  inlined by Vite, so an image is pinned to one URL. Serving both behind a
  single Ingress host makes it same-origin and disposes of the CORS question
  (P3) at the same time.
- **`TRUST_PROXY` is required in production and must be a hop count**, not
  `true`. Behind an Ingress, leaving it unset makes every request look like it
  came from the Ingress, so the whole deployment shares one rate-limit bucket.
- **Photos are on the pod's local disk.** Pods are ephemeral and replicas share
  no filesystem, so photos are lost on restart and invisible to other replicas.
  Until the internal storage service exists, that means one replica with a
  PersistentVolumeClaim, or accepting loss in a test environment
  ([P13](docs/production-readiness.md)).
- **`NODE_ENV=production` refuses to start** while the tamper-detection client
  is the mock — deliberately, since a mock verdict is indistinguishable from a
  real one afterwards (`verdictSource` says `API` either way). A test cluster
  runs with `NODE_ENV=development` until the real API exists.
- **Probes**: liveness `GET /api/health`, which deliberately does not touch the
  database so a DB blip cannot get a healthy pod restarted; readiness
  `GET /api/ready`, which fails while draining and when the database is
  unreachable.
- **Give it time to drain.** `terminationGracePeriodSeconds` must exceed
  `SHUTDOWN_GRACE_MS` (default 10s). On SIGTERM the process stops accepting
  traffic, finishes in-flight requests *and* waits for running tamper checks —
  which is what stops a deploy stranding a package in `CHECKING`.
