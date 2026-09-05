# Production Readiness

What this application still needs before it runs on the company network with
real deliveries in it, and — for each gap — the question whose answer decides
how we close it.

Today's code is a working product built against three stand-ins (`erpMock.ts`,
`lib/storage.ts`, `lib/tamperCheck.ts`) with no authentication, on one process,
against one Postgres, storing photos on the local disk. That was the right
shape for building the product. It is not the shape that survives a warehouse,
a phone on bad wifi, a deploy, or a dispute with a courier.

**DESIGN.md remains the source of truth for what the product does and why.**
This file only covers *running it for real*. The vendor-contract questions
(tamper API, ERP view, storage service) live in DESIGN.md §9 and are referenced
here rather than repeated.

## How to use this document

Every gap is numbered (`P1`, `P2`, …) so it can be referenced from a branch
name, a commit, or a changelog entry. Each one has the same four parts:

- **Today** — what the code actually does now, with the file to look at.
- **Breaks when** — the concrete condition that turns it into an incident.
  A gap with no such condition is not on this list.
- **Open question** — what we do not yet know, and who can tell us.
- **Once answered** — the work that follows, so the answer converts straight
  into a slice.

When an answer arrives, record it in §10 with the date and the source, update
the item's **Once answered** into what we actually decided, and let the
implementing slice delete the item. An item is removed from this file only when
its work is merged.

## Gate summary

Four tiers, in the order they matter.

| Tier | Meaning | Items |
|---|---|---|
| **Blocker** | Cannot serve real deliveries. Data loss, no accountability, or a state nothing can get out of. | P1–P11, P13 |
| **Scale** | Correct on one instance with a few thousand rows; wrong beyond that. | P12, P14–P21 |
| **Operate** | Runs, but nobody can tell when it stops running. | P22–P25 |
| **Policy** | Not a code question. Someone in the business has to decide. | P26–P30 |

The tiers are about *risk*, not effort. Several blockers are an afternoon each.

---

## 1. Identity, roles and access — Blocker

### P1 — There is no authenticated user

**Today.** `backend/src/lib/currentUser.ts` exports the constant
`"local-dev-user"`. It is written into `Delivery.createdBy`,
`PackageImage.uploadedBy` and `Package.verdictOverriddenBy`. Every row in the
database claims the same author.

**Breaks when.** The first time anyone asks who received a package, or who
overrode a verdict. The override note (DESIGN.md §4.4.5) is deliberately the
permanent record of a physical check — attributed to nobody, it is not a
record, it is an anecdote.

**Open question.** DESIGN.md §6 fixes production on Keycloak (OIDC, bearer JWT
validated against the realm), but the off-network development strategy is still
open. Which realm, which client ids for SPA and API, which claim carries the
employee identifier we want to store — and what stands in for Keycloak on a
laptop that cannot reach it?

**Once answered.** Replace `CURRENT_USER` with a request-scoped actor resolved
from the verified token, threaded through the routes to the services. The
constant stays as the local stub behind the same accessor, so tests and offline
dev do not need a token server. Store a stable subject identifier, not a display
name — display names change and the audit trail must not.

### P2 — No route checks a role

**Today.** `POST /api/packages/:id/review` (`backend/src/routes/packages.ts`)
is the Inventory Manager's verdict override. Any client that can reach the API
can call it. The same is true of every other endpoint.

**Breaks when.** An employee — or anything else on the network — overrides a
manager's verdict, or reads every delivery in the company. There are two roles
in DESIGN.md §2 and the API enforces neither.

**Open question.** Do the two roles come from Keycloak realm/client roles, or
from an ERP/HR attribute? Is "Inventory Manager" global, or scoped to a site,
department or delivery direction? Can one person hold both?

**Once answered.** Role assertion middleware on the manager-only routes, with
the role read from the verified token and never from the request body. If the
role turns out to be scoped rather than global, authorization becomes per
resource — check the delivery's site against the actor's — which is a different
and larger change, so this question is worth asking early.

### P3 — CORS is wide open

**Today.** `backend/src/app.ts` calls bare `cors()`, which answers every origin
with `Access-Control-Allow-Origin: *`.

**Breaks when.** Any page on the network can call the API with the browser's
ambient context. It also stops working the moment auth uses cookies, because a
wildcard origin and credentials are mutually exclusive.

**Open question.** What origin(s) does the SPA actually serve from per
environment — one hostname per environment, or a shared one? Is the SPA served
by the same host as the API behind the ingress, in which case cross-origin
config narrows to development only?

**Once answered.** Pin the allowed origin from configuration, one value per
environment, and fail startup if it is unset outside development.

### P4 — Images are addressable by anyone who has an id

**Today.** `GET /api/images/:id` (`backend/src/routes/images.ts`) looks the
image up and serves the bytes. There is no check of who is asking.

**Breaks when.** Photos are evidence, and may show a customer address, a
shipping label, or the inside of a package. A UUID is hard to guess; that is
obscurity, not access control. Any endpoint that ever leaks an id — a log, an
error report, a shared link — leaks the photo.

**Open question.** Who is allowed to see a package's photos: only its creator,
anyone in the same site, or every authenticated employee? Managers presumably
see everything — confirm.

**Once answered.** Authorize the read against the package's delivery, and
extend the same rule to the list and detail endpoints, which currently return
every delivery to everyone.

### P5 — The mock tamper client can ship to production

**Today.** `backend/src/lib/tamperCheck.ts` holds a mutable module-level
`activeClient` defaulting to `MockTamperCheckClient`, and
`TAMPER_CHECK_OUTCOME` pins its verdict, read fresh on every call.

**Breaks when.** A production deploy inherits the default, or an environment
carries `TAMPER_CHECK_OUTCOME` forward from a demo. Every package then gets a
fabricated verdict that looks exactly like a real one — `verdictSource` says
`API` either way.

**Open question.** None outside our control. This is ours to fix, and it is
listed here because the cost of getting it wrong is silent and total.

**Once answered.** Fail startup in production if no real client is configured
or if `TAMPER_CHECK_OUTCOME` is set. Consider recording the client identity on
the `TamperCheck` row so a mocked verdict is distinguishable after the fact.

---

## 2. The photo upload path — Blocker

### P6 — One request carries an entire delivery, buffered in memory

**Today.** `backend/src/lib/photoUpload.ts` configures multer with
`memoryStorage()` and limits of 15 MB per file and 200 files per request.
`POST /api/deliveries` takes the whole delivery — every package, every photo —
in a single multipart request, because nothing is persisted before Submit
(DESIGN.md §3).

**Breaks when.** Two things, independently:

- *Memory.* The stated limits allow roughly 3 GB buffered in the process before
  any of our validation runs, and multer buffers before the handler sees
  anything. A handful of concurrent uploads is enough to take the process down.
  The limits are blast-radius caps, not a design.
- *The network.* Four photos minimum per package, taken on a personal phone
  (DESIGN.md §4.2), over warehouse wifi. A ten-package delivery is a large
  upload with no resume: one dropped connection and the employee re-shoots or
  re-picks everything.

**Open question.** What does the internal storage service accept (DESIGN.md §9)
— specifically, can a browser upload to it directly with a short-lived
credential, or must the bytes pass through our API? That single answer decides
whether we build presigned direct upload or a resumable proxy. Also: what does
the Tanzu ingress cap a request body at, and what is the idle timeout on a slow
upload?

**Once answered.** In descending order of value, and mostly independent of the
answer:

1. Resize and compress on the client before upload. A phone photo is several
   megabytes; evidence needs far less. This is the cheapest large win and needs
   no backend contract — though it does need the tamper API's minimum
   resolution first (DESIGN.md §9).
2. Upload each photo on its own as it is taken, rather than all of them at
   Submit, so a failure costs one photo. Submit then references already-stored
   objects instead of carrying bytes.
3. If the storage service allows it, upload direct from the browser with a
   short-lived credential, and take our API out of the byte path entirely.
4. A total-bytes-per-request cap in addition to the per-file cap, whatever else
   changes.

### P7 — There is no client-side upload queue

**Today.** Photos live as in-session `File` objects until Submit. Navigating
away, closing the tab, or losing the app loses them.

**Breaks when.** An employee photographs ten packages in a bay with no signal,
walks back, and finds the work gone. This is the "upload queue" in its real
form: the queue belongs on the client, not the server.

**Open question.** Is the phone browser the actual capture device in production,
or is there a company handheld/scanner app? Do employees work in areas with no
coverage at all, or merely poor coverage? Is the SPA expected to be installable
(PWA), and does company device management permit that?

**Once answered.** Persist pending captures in IndexedDB with a background
retry loop, so capture survives a reload and drains when connectivity returns.
Scope depends entirely on the answer — a warehouse with real dead zones needs
offline-first capture; poor-but-present wifi needs only retry with backoff.

### P8 — Submitting a delivery is not idempotent

**Today.** `POST /api/deliveries` creates a delivery on every call. There is no
request key.

**Breaks when.** The request times out at a proxy after the transaction
committed, the employee presses Submit again, and the same physical delivery
exists twice — with two internal numbers, both photographed, both awaiting
receipt. On a slow upload this is not an edge case.

**Open question.** None external. The mechanism is a choice: an
`Idempotency-Key` header with a unique index, or a client-generated delivery id
supplied on the request.

**Once answered.** Whichever mechanism, the uniqueness has to be enforced by
the database, not by a pre-check — a pre-check has the same race as the bug it
fixes. The same treatment applies to `POST /:id/post-receive-photos`, which is
already protected by the `claimForCheck` status guard but would duplicate
images if the claim ever widened.

---

## 3. The tamper-detection job — Blocker at more than one instance

### P9 — The check runs in the web process and dies with it

**Today.** `startCheck` (`backend/src/services/tamperCheckService.ts`) creates
a `PENDING` row and deliberately does not await the call: the request returns
202 and the client polls. The work lives in the Node process.

**Breaks when.** Any restart — a deploy, a crash, a Tanzu rescheduling — during
a check. `recoverInterruptedChecks()` handles this by moving stranded packages
to `CHECK_FAILED` so the existing retry button reaches them, which is a sound
answer for one process.

**Open question.** How many instances does Tanzu run, and is that number under
our control? Is there a Redis or a message broker already available on the
platform, or is Postgres the only stateful thing we get?

**Once answered.** Move the check to a durable queue with an owned lease, retry
with backoff, a maximum attempt count, and a dead-letter path. `pg-boss` on the
Postgres we already have is the smallest step and needs no new infrastructure;
a broker is better if the platform already provides one.

### P10 — Startup recovery is unsafe with more than one instance

**Today.** `recoverInterruptedChecks()` runs at boot and moves *every* package
in `CHECKING` to `CHECK_FAILED`, and every `PENDING` check to `ERROR`.

**Breaks when.** A second instance starts — a rolling deploy, a scale-up — and
marks the first instance's in-flight checks as failed while they are still
running. Those checks then complete and write a verdict onto a package the
recovery already moved. The current code is correct at exactly one instance and
silently wrong at two, which is the worst kind of wrong.

**Open question.** Same as P9: instance count, and whether rolling deploys are
the platform default.

**Once answered.** Recovery becomes lease-based — reclaim only work whose lease
expired, identified by timestamp and owner, never "everything currently in
progress". This follows for free from P9's queue and is listed separately
because it is the specific bug, and because it must be fixed *before* the first
scale-up, not after.

### P11 — The vendor call has no deadline

**Today.** `runCheck` awaits `client.check(...)` with no timeout. The mock
resolves after 1.8 s; a real HTTP client with no deadline can hang
indefinitely.

**Breaks when.** The vendor hangs rather than fails. The package sits in
`CHECKING` forever — a state with no retry button, because retry is offered
only from `CHECK_FAILED` (DESIGN.md §4.2). Recovery today requires a restart.

**Open question.** DESIGN.md §9 already asks whether the API is synchronous or
job-based and what its typical latency is. Add: what timeout does the vendor
recommend, and does a timed-out call still consume quota or produce a result we
could poll for later?

**Once answered.** A per-call deadline with `AbortController`, a bounded retry
policy with backoff, and a circuit breaker so a vendor outage does not turn
every package and every manager's retry click into more load. If the API turns
out to be job-based, the polling/webhook design replaces this item entirely.

### P12 — Retry semantics and cost are undefined

**Today.** Each attempt creates a new `TamperCheck` row — deliberate, for the
audit trail (DESIGN.md §3). Nothing limits how many attempts a package can
accumulate.

**Breaks when.** The vendor charges per call, or rate-limits us, and a manager
clicks retry in a loop against a service that is down.

**Open question.** DESIGN.md §9 covers rate limits, cost per call, and
retry/idempotency semantics. Those answers land here.

**Once answered.** Cap attempts per package, rate-limit the retry endpoint, and
— if the vendor supports an idempotency key — send one so a retried call after
a timeout cannot be billed or evaluated twice.

---

## 4. Storage — Blocker before scaling, Scale otherwise

### P13 — Photos are on the instance's local disk

**Today.** `LocalDiskStorage` (`backend/src/lib/storage.ts`) writes under
`STORAGE_DIR`. The `StorageClient` seam is exactly the right shape for
replacing this; the implementation is not shareable.

**Breaks when.** A second instance serves an image the first one wrote, and
returns 404. Also on every redeploy, if the container filesystem is ephemeral —
which on Tanzu it generally is. Evidence would be lost on deploy.

**Open question.** DESIGN.md §9's storage-service questions: the upload and
retrieval contracts, what identifier comes back to store on `PackageImage`,
auth, size and format limits, retention, and whether delete is supported.

**Once answered.** Implement `StorageClient` against the real service. Two
properties in the current code are worth preserving deliberately: images are
served by id through the client rather than from a static path, so no frontend
URL changes; and `storagePath` never leaves the API, so the store's layout stays
private. Keep the path-traversal guard in the new implementation too — the
equivalent check for whatever identifier the service uses.

### P14 — Deleted rows leave their files behind

**Today.** `PackageImage` cascades on delete at the database level. Nothing
deletes the corresponding stored file. The one cleanup path that exists is the
failure rollback in `routes/deliveries.ts`, which removes files written for a
transaction that then failed.

**Breaks when.** Slowly and invisibly, as orphaned bytes accumulate — and
sharply, the first time someone asks us to delete a specific delivery's photos
and we cannot prove they are gone.

**Open question.** Does the storage service support delete at all (DESIGN.md
§9)? Some internal stores are append-only by policy, which would change the
answer from "delete" to "mark and exclude".

**Once answered.** Either a reaper job reconciling stored objects against
`PackageImage` rows, or a soft-delete plus sweep. Decide alongside the retention
policy in P26 — they are the same conversation.

### P15 — Images are read fully into memory and served without caching

**Today.** `routes/images.ts` reads the whole file into a `Buffer` and sends it,
with no cache headers.

**Breaks when.** The dashboard shows many packages, each with four or more
photos, and every scroll re-fetches every byte through the API.

**Open question.** Does the storage service hand back a stream, a URL, or bytes?
A URL changes this from streaming to redirecting.

**Once answered.** Stream rather than buffer, and set long-lived immutable cache
headers — a stored photo never changes, so it is safely cacheable forever. If
the service can issue short-lived signed URLs, redirect instead and drop out of
the read path entirely.

---

## 5. Database and query shape — Scale

### P16 — The schema has no indexes

**Today.** `backend/prisma/schema.prisma` declares zero `@@index`. Prisma does
not create indexes for foreign keys on PostgreSQL, so the only indexes present
are the primary keys, `Delivery.internalNumber`'s unique constraint, and the
composite `@@unique([deliveryId, label])`.

**Breaks when.** Row counts grow past what a sequential scan hides. Missing, at
minimum: `PackageImage.packageId`, `TamperCheck.packageId`,
`Package.workflowStatus`, `Delivery.createdAt`, and `Delivery.referenceNumber`.
`Package.deliveryId` is served by the composite unique's leading column.

**Open question.** What is the real volume — deliveries per day, packages per
delivery, and how many years of history stay online? A hundred deliveries a day
and five years is a very different index and partitioning story from ten
thousand a day.

**Once answered.** Add the indexes in a migration, informed by `EXPLAIN` against
a realistically sized dataset rather than by guesswork.

### P17 — Search is an unindexed pattern match

**Today.** The deliveries list and the dashboard both search `referenceNumber`
with a case-insensitive pattern (`services/deliveryQuery.ts`,
`services/packageQuery.ts`).

**Breaks when.** The table outgrows memory-speed scanning. A leading-wildcard
pattern cannot use a B-tree index at all.

**Open question.** Volume again (P16), plus: do employees search by partial
reference, or always paste a full one? A full-value search needs only a plain
index; substring search needs a trigram index.

**Once answered.** Either a normalized uppercase column with a plain index, or
`pg_trgm` with a GIN index — the latter only if substring search is a real
requirement.

### P18 — The dashboard sorts by a derived expression over every package

**Today.** `services/packageQuery.ts` flattens every package across every
delivery and orders by an urgency expression, with the "needs review" rule kept
as one SQL fragment used by both the sort and the row flag so the two cannot
drift (see `docs/architecture.md`).

**Breaks when.** No index can serve a computed ordering, so the sort cost grows
with total package count on every dashboard load — including for managers who
only ever look at the first page.

**Open question.** Volume (P16), and: should the dashboard show all history, or
only an active window? "Everything ever" and "the last 90 days plus anything
unresolved" have very different costs and are a product decision, not a
technical one.

**Once answered.** If the window stays unbounded, persist what the sort needs —
a `needsReview` boolean and a priority tier maintained on write — and index it,
keeping the single-source-of-truth property the current fragment has. If a
window is acceptable, that is cheaper and simpler.

### P19 — The stat cards aggregate the whole table on every request

**Today.** The dashboard's five stat cards are deliberately counted over every
package rather than the returned page, because they describe the operation and
not the page (`docs/architecture.md`).

**Breaks when.** Full aggregation runs on every dashboard load and every filter
change.

**Open question.** How fresh must the counts be — live, or is a minute old
fine? Managers watching for an opened package may reasonably want live.

**Once answered.** A short-TTL cache if staleness is acceptable; otherwise
incrementally maintained counters. Do not change what the cards count — that
was a deliberate product decision.

### P20 — Deep pagination and connection pooling are unbudgeted

**Today.** Both lists page by offset, 20 rows a page. Prisma opens its own
connection pool per instance.

**Breaks when.** Deep offsets grow linearly in cost; and instance count times
pool size can exceed the Postgres connection limit, at which point the
application refuses connections while looking healthy.

**Open question.** What are the managed Postgres limits — `max_connections`,
memory, storage, and is a connection pooler such as pgbouncer available on the
platform?

**Once answered.** Size the pool against instance count deliberately, add a
pooler if the platform provides one, and switch to keyset pagination if deep
pages turn out to be used at all (they usually are not — check before building).

### P21 — `rawResponse` stores whatever the vendor sends, unbounded

**Today.** `TamperCheck.rawResponse` is `Json` and stores the vendor payload
verbatim — deliberate, so nothing is lost before we know what matters.

**Breaks when.** The vendor returns something large per call, such as annotated
images inline, and the table grows far faster than the row count suggests.

**Open question.** DESIGN.md §9 asks about the output format. Add: how large is
a typical response, and does it embed image data?

**Once answered.** Keep storing it verbatim, with a size cap and truncation
marker. If it embeds images, store them through the storage client and keep
references rather than bytes in a database column.

---

## 6. Runtime and operations — Operate

### P22 — No health or readiness endpoint

**Today.** `app.ts` mounts three routers and nothing else. The platform has no
way to ask whether this instance is serving.

**Breaks when.** Tanzu routes traffic to an instance whose database connection
is dead, or restarts a healthy instance because it cannot tell.

**Open question.** What does the platform probe, on what path, and with what
timing and failure threshold? Does it distinguish liveness from readiness?

**Once answered.** A liveness endpoint that only proves the process is up, and a
separate readiness endpoint that checks the database. Keep them distinct — a
liveness probe that fails on a database blip restarts a process that would have
recovered.

### P23 — No graceful shutdown

**Today.** `index.ts` calls `app.listen` and nothing handles `SIGTERM`.

**Breaks when.** Every deploy. In-flight requests are cut, and in-flight tamper
checks are lost (P9/P10).

**Open question.** What termination grace period does the platform allow before
`SIGKILL`?

**Once answered.** On `SIGTERM`: stop accepting new connections, let in-flight
requests finish within the grace period, close the Prisma client, exit. Once
checks are on a queue, the worker stops claiming new jobs and finishes or
releases what it holds.

### P24 — Logging is `console`, and there is no error handler

**Today.** `console.log` and `console.error` with plain strings. Express's
default error handler serves anything thrown from a route.

**Breaks when.** An incident. Nothing correlates a user's report to a request,
nothing aggregates errors, and the default handler's response body depends on
`NODE_ENV` being set correctly — which nothing here verifies.

**Open question.** What does the company platform already collect — a log
aggregator with an expected JSON shape, an error tracker, a metrics system? We
should emit what the existing tooling reads rather than invent a format.

**Once answered.** Structured JSON logging with a request id, actor id and
package id on every line, plus an explicit Express error handler that logs the
full error and returns a generic message with a correlation id. Never log photo
bytes, and treat the override note as user content, not diagnostics. Worth
watching: upload latency and failure rate, check duration, verdict
distribution, queue depth, and the `CHECK_FAILED` rate — a spike there means the
vendor is down, not that packages are being tampered with, and the alert should
say so.

### P25 — Configuration is unvalidated and unhardened

**Today.** `dotenv` loads whatever is present. `PORT` falls back to 4000,
`STORAGE_DIR` falls back to a path next to the source. A missing
`DATABASE_URL` surfaces as a Prisma error at first query. There is no `helmet`,
and no rate limiting anywhere.

**Breaks when.** A misconfigured environment starts successfully and fails
later, in production, on the first request that touches the missing piece.

**Open question.** How are secrets delivered on the platform — environment
variables from a config store, mounted files, a vault? What is available for
rate limiting at the ingress, so we do not duplicate it in the application?

**Once answered.** Validate the whole environment at boot and refuse to start on
anything missing or invalid, with the production assertions from P5 in the same
check. Add `helmet`, and rate-limit the upload and retry endpoints specifically
— unless the ingress already does it.

---

## 7. Data lifecycle, evidence and privacy — Policy

These are not engineering questions. They need an answer from whoever owns the
process, and each one changes what we build.

### P26 — Retention and legal hold

How long are photos and verdicts kept? Package photos are evidence in a dispute
with a courier, which argues for keeping them; storage cost and privacy argue
for expiring them. Is there a hold mechanism that must prevent deletion while a
claim is open? The answer decides P14's delete design, and whether the schema
needs a retention or hold column.

### P27 — Deletion requests

Can a delivery ever be deleted, and if so does that mean the rows, the photos,
or both? Does anything need to survive as a tombstone for audit? Today
`onDelete: Cascade` removes rows and orphans files (P14); no endpoint exposes
deletion at all.

### P28 — EXIF and what the photos carry

Phone photos carry GPS coordinates, device identifiers and timestamps. We store
them untouched. Location is arguably valuable evidence — it proves where a
package was photographed — and is arguably employee tracking. Someone has to
choose, deliberately, whether to strip EXIF on upload, keep it, or keep it
separately from the image. Note the tamper API may also want it (DESIGN.md §9).

### P29 — What the audit trail must prove

Today only the manager override records who and when. Nothing records who
shipped, who received, or when a status changed. If a verdict is ever used
against a courier or an employee, the trail needs to be append-only, timestamped
by the server, and complete. Decide the standard before choosing between adding
columns and adding an event log — they are very different amounts of work.

### P30 — Note content and rendering

`overrideNote` is free text, required, permanent, and rendered in an RTL Hebrew
UI. It is unbounded in length and unnormalized. Decide a maximum length, and
handle bidirectional control characters at render time so a note cannot reorder
the interface around it.

---

## 8. Environment and deployment — to confirm with the platform team

DESIGN.md §8 fixes the target as containers on VMware Tanzu through the existing
company CI/CD. The specifics that change our code are still unknown:

- **Instances.** How many, and are rolling deploys the default? P10 is a real
  bug the moment the answer is more than one.
- **Postgres.** Managed or self-run, which version, what connection limit, what
  backup schedule and restore procedure, and who runs migrations —
  `prisma migrate deploy` in a release step, or a DBA-reviewed script?
- **Environments.** How many, how are they promoted, and is there one with
  realistic data volume where P16–P20 can actually be measured?
- **Ingress.** Request body size cap, idle and header timeouts, TLS
  termination point, and whether rate limiting exists there already (P6, P25).
- **Egress.** Can the container reach the tamper-detection vendor directly, or
  through a proxy that needs configuring? Same question for Keycloak and the
  storage service.
- **Secrets.** Delivery mechanism and rotation (P25).
- **Backups.** The database and the photo store are backed up by different
  systems; a restore has to leave them consistent, or we get verdict rows
  pointing at photos that no longer exist. Confirm this is possible before
  relying on it.
- **Filesystem.** Is any container storage persistent across restarts? If not,
  P13 becomes a hard blocker rather than a scaling one.

## 9. What is already right

Worth stating, so nobody "fixes" these while working through the list:

- **Photo type detection reads magic bytes, not the client's content type**
  (`lib/imageTypes.ts`), and SVG is excluded deliberately because serving it
  from our own origin would be an XSS vector.
- **Path traversal is guarded in the storage client** (`lib/storage.ts`), even
  though `storagePath` comes from our own database.
- **Concurrent state changes are decided by the database, not by a read.**
  `claimForCheck` puts the current status in the `WHERE` clause, and the review
  endpoint guards `verdictSource` in the `UPDATE` itself, so two managers
  submitting at once cannot destroy each other's note.
- **Failed writes clean up after themselves.** Both upload paths delete the
  files they wrote if the transaction fails.
- **Storage layout is private to the storage client.** `storagePath` never
  leaves the API, which is what makes P13 a one-file change.
- **`TamperCheck` is one row per attempt**, so a retry leaves an audit trail
  instead of overwriting one.
- **Timestamps are `timestamptz`**, stored UTC and converted at display.

## 10. Answers received

Fill in as answers arrive. Each row makes one or more items above concrete;
update the item's **Once answered** to what was actually decided, and let the
implementing slice delete it from this file.

| Date | Item(s) | Question | Answer | Source |
|---|---|---|---|---|
| | | | | |
