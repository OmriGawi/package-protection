# Package Protector

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

Requires **Node 24** and Docker.

```bash
docker compose up -d                  # Postgres 16

cd backend
cp .env.example .env
npm ci
npx prisma migrate deploy
npm run dev                           # http://localhost:4000

cd ../frontend
cp .env.example .env
npm ci
npm run dev                           # http://localhost:5173
```

Every environment variable the backend reads is documented in
`backend/.env.example`, including which ones become required in production.

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
ui/          Standalone HTML mockup — not the production frontend
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
- **Probes**: liveness `GET /health`, which deliberately does not touch the
  database so a DB blip cannot get a healthy pod restarted; readiness
  `GET /ready`, which fails while draining and when the database is
  unreachable.
- **Give it time to drain.** `terminationGracePeriodSeconds` must exceed
  `SHUTDOWN_GRACE_MS` (default 10s). On SIGTERM the process stops accepting
  traffic, finishes in-flight requests *and* waits for running tamper checks —
  which is what stops a deploy stranding a package in `CHECKING`.
