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
| **Blocker** | Cannot serve real deliveries. Data loss, no accountability, or a state nothing can get out of. | P1–P4, P6, P7, P9–P11, P13 |
| **Scale** | Correct on one instance with a few thousand rows; wrong beyond that. | P12, P14–P21 |
| **Operate** | Runs, but nobody can tell when it stops running. | P24, P25 |
| **Policy** | Not a code question. Someone in the business has to decide. | P26–P30 |

Closed items keep their numbers rather than being renumbered, so a reference in
a commit or a changelog entry stays valid: **P5, P22 and P23 were closed by the
runtime-hardening slice and P8 by the upload-limits slice (both 2026-09-05)**;
P3, P6, P16, P24 and P25 shrank to what is left of them.

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

### P3 — The allowed CORS origins are not known yet

**Today.** `CORS_ORIGIN` is a comma-separated list read by `src/lib/config.ts`,
required in production and empty (meaning any origin) in development. The
mechanism is in place; the values are not.

**Breaks when.** Nothing, until deployment — at which point the process refuses
to start rather than serving a wildcard, which is the intended failure.

**Open question.** What origin does the SPA serve from in each environment, and
is it served from the same host as the API behind the ingress? If it is,
cross-origin configuration narrows to development only.

**Once answered.** Set the value per environment. Nothing in the code changes.

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

---

## 2. The photo upload path — Blocker

### P6 — The bytes still go through the API, in one request

**Today.** A request is capped at 150MB as a whole
(`src/middleware/uploadSize.ts`), on top of multer's 15MB per photo and 200
files — the three together replaced a bound of roughly 3GB held in memory
before any validation ran. The cap reads `Content-Length`, so a chunked request
without one still falls through to the per-file limits.

The shape underneath is unchanged: `POST /api/deliveries` takes the whole
delivery — every package, every photo — in one multipart request, buffered in
this process, because nothing is persisted before Submit (DESIGN.md §3).

**Breaks when.** Four photos minimum per package, taken on a personal phone
(DESIGN.md §4.2), over warehouse wifi. A ten-package delivery is a large upload
with no resume: one dropped connection and the employee re-shoots or re-picks
everything. Retrying is at least safe now (P8), but it is still a full
re-upload.

**Open question.** What does the internal storage service accept (DESIGN.md
§9) — specifically, can a browser upload to it directly with a short-lived
credential, or must the bytes pass through our API? That single answer decides
whether we build presigned direct upload or a resumable proxy. Also: what does
the Tanzu ingress cap a request body at, and what is its idle timeout on a slow
upload?

**Once answered.** In descending order of value:

1. Resize and compress on the client before upload. A phone photo is several
   megabytes; evidence needs far less. Cheapest large win, needs no backend
   contract — but it does need the tamper API's minimum resolution first
   (DESIGN.md §9).
2. Upload each photo as it is taken rather than all of them at Submit, so a
   failure costs one photo. Submit then references stored objects instead of
   carrying bytes.
3. If the storage service allows it, upload direct from the browser with a
   short-lived credential, and take our API out of the byte path entirely —
   which also retires the `Content-Length` gap above.

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

Fold in the receive path while doing it. `POST /:id/post-receive-photos` never
got the idempotency treatment `POST /api/deliveries` did (P8): a retry after a
committed upload gets 409 "this package is already being received", which is
correct as a guard and a dead end for the employee holding the phone. It needs
either the same key mechanism or a retry that recognises its own earlier upload.
Scope depends entirely on the answer — a warehouse with real dead zones needs
offline-first capture; poor-but-present wifi needs only retry with backoff.

---

## 3. The tamper-detection job — Blocker at more than one instance

### P9 — The check runs in the web process and dies with it

**Today.** `startCheck` (`backend/src/services/tamperCheckService.ts`) creates
a `PENDING` row and deliberately does not await the call: the request returns
202 and the client polls. The work lives in the Node process.

**Breaks when.** Any restart — a deploy, a crash, a Tanzu rescheduling — during
a check. A `SIGTERM` is now handled: the drain waits for in-flight checks before
exiting (`src/index.ts`), so an orderly deploy no longer strands them. A crash
or a `SIGKILL` still does, and `recoverInterruptedChecks()` remains the answer
for that — it moves stranded packages to `CHECK_FAILED` so the existing retry
button reaches them, which is sound for one process.

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

### P16 — The indexes exist, but the volume that would size them does not

**Today.** Five indexes were added deliberately, each tied to a query that runs
(`backend/prisma/migrations/…_add_query_indexes`): `Package.workflowStatus` and
`Package(verdict, workflowStatus)` for the dashboard filters and the startup
recovery scan, `PackageImage(packageId, sequence)` for every read of a package's
photos, `TamperCheck.packageId` for the delete cascade, and `TamperCheck.status`
for the boot-time scan for `PENDING` — that table gains a row per attempt and is
never pruned, so it is the one scan here that grows without bound.
`Package.deliveryId` needs none — the `@@unique([deliveryId, label])` constraint
already leads with it.

Two candidates were deliberately *not* added, because nothing queries that way:
`Delivery.createdAt` (the list orders by `internalNumber`, not date) and
`Delivery.referenceNumber` (search is a leading-wildcard `ILIKE`, which no
B-tree can serve — that is P17).

**Breaks when.** The next index is chosen the way these were, by reading the
query — or is not chosen at all, because nobody has a dataset big enough for a
plan to look different from a sequential scan.

**Open question.** What is the real volume — deliveries per day, packages per
delivery, and how many years of history stay online? And is there an
environment with realistic data where `EXPLAIN` means anything (§8)?

**Once answered.** Re-check the plans for the two list queries against real
volume, and revisit P17–P20 with numbers rather than reasoning. One production
detail to remember when the tables are no longer small: `CREATE INDEX` locks
writes, and Prisma runs a migration inside a transaction, so a concurrent build
has to be run outside the normal migration path.

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

### P24 — Nothing collects the logs, and nothing watches the numbers

**Today.** The backend emits one JSON object per line on stdout, with a request
id on every line and an `x-request-id` echoed to the caller
(`src/middleware/requestId.ts`). Nothing collects those lines, and no metric is
derived from them.

**Breaks when.** An incident. The lines exist but live only in whatever
`kubectl logs` still holds, and nobody is told that anything is wrong in the
first place.

**Open question.** Splunk is the destination (answered 2026-09-05, §10). Does
it ingest container stdout directly on this platform, or does it want a
forwarder or a specific field naming? Is there a metrics system and an alerting
path alongside it?

**Once answered.** Match the field names the aggregator expects, then define
what is watched: upload latency and failure rate, check duration, verdict
distribution, queue depth, and the `CHECK_FAILED` rate. That last alert needs
its wording chosen carefully — a spike there means the vendor is down, not that
packages are being tampered with.

### P25 — Rate limits are keyed by address, and counted per instance

**Today.** `express-rate-limit` guards the two upload endpoints and the retry
endpoint, with a loose global backstop; `src/middleware/rateLimit.ts` holds the
key function. Photos and the health probes sit outside the global limiter on
purpose, since a delivery page polls every second and loads eight thumbnails at
a time. `TRUST_PROXY` decides what `req.ip` resolves to and is required in
production.

**Breaks when.** Two ways, both structural rather than sloppy:

- There is no authenticated user, so the key is an address. A warehouse behind
  one NAT puts every employee in one bucket — which is why the limits are
  currently loose enough to be a backstop rather than a policy.
- The counters live in the process, so the effective limit is multiplied by the
  instance count.

**Open question.** What is the platform's own ingress capable of — does it rate
limit already, making this redundant? Is a shared counter store (Redis)
available? And how are secrets delivered, since the same startup validation
should assert them (P22's config work covers the shape, not the source).

**Once answered.** Re-key on the Keycloak subject once P1 lands, tighten the
limits accordingly, and move the counters to a shared store or delete them in
favour of the ingress.

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
| 2026-09-05 | P24 | Where do logs go? | Splunk, wired up later. It reads container stdout, so the application's job is only to emit indexable lines — which it now does. | Project owner |
| 2026-09-05 | P25 | Rate limit before there is a user to key on? | Yes, keyed by address and deliberately loose, re-keyed to the Keycloak subject when auth lands. | Project owner |
