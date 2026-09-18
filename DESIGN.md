# Package Protection — Design Doc

Living document, updated as we design. Decisions and open questions are both
tracked here so nothing lives only in chat history.

## 1. Overview

Internal web app used by Inventory Managers and Employees to determine whether
a package was opened in transit, by comparing photos taken at shipping time
against photos taken at receiving time via a third-party tamper-detection API.

A **Delivery** contains one or more **Packages**. Each Package needs 4+ photos
at shipping ("pre-ship") and 4+ photos at receiving ("post-receive").

## 2. Actors / Roles

- **Employee** — creates deliveries/packages, uploads photos (both pre-ship
  and post-receive).
- **Inventory Manager** — reviews delivery/package status and tamper-check
  verdicts, handles inconclusive cases.

Auth in production is via **Keycloak** (OIDC). Roles are expected to map from
Keycloak realm roles/groups.

## 3. Domain Model

### Delivery
| Field | Notes |
|---|---|
| id | |
| internal_number | System-generated, sequential, human-facing (e.g. `#1042`). Shown deliberately distinct from `reference_number` in the UI so users never mistake our own id for the ERP's — see §4.3. |
| direction | `EXPORT` \| `IMPORT` |
| reference_number | Shipment Number (export) or PO Number (import) — from the ERP, not us |
| status | `SUBMITTED` (only — see below) |
| created_by | |
| created_at | |

The reference number is validated live against the ERP — via a view the ERP
side exposes (shipment numbers for export, PO numbers for import). This is
currently the *only* ERP touchpoint.

Once `SUBMITTED`, a delivery is locked — no more packages can be added
(assumption; confirm).

**Settled (2026-09-04), after trying and reverting a "persist as draft
early" design: a delivery is only created in the backend at final Submit.**
Everything before that — direction, validated reference, packages, their
photos — lives purely as in-session client state on the create-delivery
flow. If the employee cancels or navigates away mid-way, it's simply gone;
there is no draft to resume, and that's fine by design. Nothing is shown in
"My Deliveries" (§4.3) until a delivery is actually `SUBMITTED`.

(We did briefly design a persisted-draft version — visible only to its
creator, resumable, with its own `DRAFT` status — reasoning that losing
in-progress work to a closed tab was bad. Reverted: not worth the added
complexity right now. Worth revisiting if lost-work turns out to be a real
problem in practice.)

### Package
| Field | Notes |
|---|---|
| id | |
| delivery_id | FK |
| label | **System-assigned**, sequential per delivery (`1`, `2`, `3`...) — auto-incremented as each package is saved during creation, not typed by the employee. The UI tells them the number to write on the box (e.g. "write 3 on this one"), so there's no free-text entry and no typo/mismatch risk. Unique **within the delivery**, not globally. No barcode/label printing for now — this is still a handwritten number, just app-assigned rather than app-recorded. **Numbers are never reused or renumbered** (settled 2026-09-04 while implementing): the next label is `max(existing) + 1`, so deleting package 2 of 1,2,3 leaves 1,3 and the next box is 4. Gaps are harmless; reuse is not, because the number is already written in marker on a carton, and renumbering would silently change what an existing box's number means. The mockup got this wrong — it used `count + 1`, which hands out a duplicate "3" after that delete. |
| workflow_status | `PRE_SHIP_UPLOADED` → `SHIPPED` → `CHECKING` → `RECEIVED` — `CHECKING` is the transient state while post-receive photos are submitted and the tamper-detection API call is in flight (UI shows "מבצע בדיקה…"); `verdict` is only meaningful once `RECEIVED`. `CHECKING` can also land on `CHECK_FAILED` instead of `RECEIVED` — the API call itself errored (timeout/service error), not a verdict — from which the only action is retrying the same call; the post-receive photos already collected are not lost or re-asked-for. |
| verdict | `INTACT` \| `OPENED` \| `INCONCLUSIVE` — starts as whatever the API/TamperCheck produced |
| verdict_source | `API` \| `MANUAL` |
| verdict_overridden_by / overridden_at / override_note | nullable — set when an Inventory Manager corrects the verdict after a real-world physical check |

`OPENED` (and `INCONCLUSIVE`) trigger an immediate real-world physical check.
An Inventory Manager then records the outcome in the app — `verdict_source`
flips to `MANUAL` so we keep an audit trail of API vs human-corrected
outcomes. This is deliberately two-directional, not just "correct false
positives to Intact": `INCONCLUSIVE` in particular only exists because the
algorithm couldn't decide, so the physical check has to be able to resolve it
either way (confirm `INTACT` or confirm `OPENED`), same for a false-positive
`OPENED`. A note (what the physical check found) is required either way —
see §4.4.

### PackageImage
| Field | Notes |
|---|---|
| id | |
| package_id | FK |
| phase | `PRE_SHIP` \| `POST_RECEIVE` |
| storage_path | Opaque handle returned by the storage client (§7) — never exposed over the API; clients fetch an image by its `id` |
| uploaded_by | |
| uploaded_at | |
| sequence | ordering within the set |

Minimum 4 images per phase per package. Client-side validation on upload:
image count, file type, file size. Deeper quality checks (blur, lighting,
angle coverage) are deferred until we know what the tamper-detection API
actually requires — see open questions.

**Accepted formats (settled 2026-09-04 while implementing): JPEG, PNG, WebP,
GIF**, and the format is determined by sniffing the file's magic bytes, not by
the `Content-Type` the browser sends (which the client controls). Two
deliberate exclusions:

- **SVG** — it can carry script, and serving it back from our own origin as
  `image/svg+xml` would be an XSS vector. Package photos are never vector art.
- **HEIC/HEIF** — see §9. It passes a naive "is it an image" check but Chrome
  and Firefox can't render it, so it would store happily and come back as
  unviewable evidence, which defeats the point of a tool built around visual
  comparison.

Rejecting rather than silently storing these is the point: a photo that can't
be displayed later is worse than one that was never accepted.

### TamperCheck
| Field | Notes |
|---|---|
| id | |
| package_id | FK |
| verdict | `INTACT` \| `OPENED` \| `INCONCLUSIVE` |
| confidence_score | nullable — unknown if the API exposes this yet |
| raw_response | jsonb, store whatever the API returns |
| status | `PENDING` \| `COMPLETE` \| `ERROR` |
| requested_at / completed_at | |

For now the API result is treated as effectively boolean (opened/not). If the
API later returns a confidence percentage, we'd define our own threshold to
map score → `INTACT` / `OPENED` / `INCONCLUSIVE` — `confidence_score` is kept
on the model for that future case. `INCONCLUSIVE` (and `OPENED`) trigger an
immediate real-world physical check; the outcome is recorded via the
Package's manual-override fields (see §3 Package) rather than on the
TamperCheck itself, since a package could in principle be re-checked.

## 4. Flows

### 4.1 Shipping (pre-ship)

**One continuous page, not a multi-step wizard.** Earlier drafts of this flow
gated package-adding behind a "Continue" button on its own step/screen —
reworked (2026-09-04) because it read as a page transition when it's really
one task. Now: delivery details and packages are two cards stacked on the
same page; the packages card is present from the start but its inputs stay
disabled (with an inline hint) until the reference validates — no navigation,
just a card unlocking in place. Submit sits at the bottom of the same page.

1. Employee opens **Create Delivery**.
   - Picks direction (Export/Import).
   - Enters Shipment Number or PO Number → validated against ERP view
     **automatically** a beat after they stop typing — no separate "check"
     button. An earlier version required an explicit click; removed
     (2026-09-04) since it read as a redundant extra step for something that
     should just happen as a consequence of typing.
   - **Export only**: once validated, the linked PO Number is auto-populated
     read-only from the ERP (Oracle links a shipment to the PO that generated
     it). Not symmetric — import → auto-populated shipment isn't done, since
     one PO can spawn multiple shipments, so there's no single correct value
     to fill in automatically.
   - The packages card below unlocks as soon as this validates.
2. Employee adds a package: the app shows the next sequential number (§3 —
   they write that number on the box), uploads 4+ photos (client validates
   file type for now; a size/quality floor was tried and dropped — it
   rejected real small files unpredictably with no real basis behind the
   threshold), then saves it — it joins a running list on the same page and
   the app advances to the next number. Repeat for every package.
   - **Editing a saved package**: clicking any package already in the list
     (while still in the create flow, before Submit) reopens its photos in
     the same upload area — add, remove, or replace, then "עדכון חבילה"
     (update) writes the changes back to that same package without touching
     its number. This only exists pre-submit; once a delivery is `SUBMITTED`
     its packages are locked (see below) — editing here is about fixing a
     mistake while still assembling the delivery, not correcting history.
3. Employee clicks **Submit** at the bottom of the page → delivery
   `SUBMITTED`, its packages → `SHIPPED`.
   - **Submit waits on unsaved work** (2026-09-05). Photos picked into the
     upload area but never saved belong to no package, so submitting used to
     send the delivery without them and say nothing. Submit is now disabled
     while the upload area holds anything, and says which of the two states
     it is waiting on: a package never saved, or a saved package reopened for
     editing. They are different mistakes and need different instructions.
   - **The delivery is confirmed on arrival** (2026-09-05). Submitting
     returned to the list with no sign anything had happened. The new
     delivery sorts to the top row, but nothing said which row it was — so a
     toast names it (internal number first, since that is what identifies it
     to the employee and what is written on the boxes) and its row fades from
     green. The two run on independent clocks, the toast held long enough to
     read and the row's wash short enough not to leave the table coloured.

### 4.2 Receiving (post-receive)

Current reality: this only happens on the company's internal network. Photos
are typically taken on a personal phone at the dock and sent (e.g. via
WhatsApp) to whoever has access to a machine on the internal network — so
today it's usually the same person who did the pre-ship upload, but the app
does not need to enforce or verify that.

**Implemented inline on the delivery's package list (2026-09-04), not a
separate "pick a delivery, pick a package" screen** — that standalone Receive
view was the original wireframe concept; once the packages-of-a-delivery
list existed (§4.3), receiving is just an action *on* the package you're
already looking at, one less screen and one less place to search for the
right package.

1. User opens a delivery (from "My Deliveries", §4.3) and sees its packages.
2. On a package still `SHIPPED`, clicks "העלאת תמונות קבלה" — its row expands
   in place into an upload panel (same dropzone/thumbnail pattern as
   pre-ship). No navigation, no picking the delivery/package again — this is
   necessarily the right one, since it's the row they clicked.
3. Uploads 4+ photos, clicks "שליחה לבדיקה" (submit for check).
4. The package's workflow moves to a transient `CHECKING` state — badge
   reads **"מבצע בדיקה…"** with a spinner, replacing the verdict column,
   while the (real, future) tamper-detection API call is in flight. This is
   the answer to "what does the user see while the API is thinking": a
   named in-progress state, not a spinner with no label or a frozen row.
5. Once the check resolves, workflow → `RECEIVED` and verdict is set
   (`INTACT` / `OPENED` / `INCONCLUSIVE`) — the real call is obviously async
   over the network, of unknown real latency (§9); the mock stands in with a
   flat ~1.8s delay and a weighted-random outcome, not a real integration.
6. `INCONCLUSIVE` (and `OPENED`) packages get manually inspected in real life
   (outside the app, for now).

A delivery can end up with packages in a mix of these terminal states.

**API-failure handling (2026-09-04, mocked)** — the check can also resolve to
`CHECK_FAILED` instead of a verdict: the API call itself errored, not a
"the package looks suspicious" result. The row shows a red "שגיאה בבדיקה"
badge in place of the verdict and a "ניסיון חוזר" (retry) button in place of
the upload button — retrying re-runs the same check against the
already-submitted photos, no re-upload needed. This is deliberately left as a
raw retry with no visible path beyond that for the mock; a real error state
(what a repeated failure means operationally, whether it needs escalating to
a manager) is real work still to design once the actual API's error modes are
known (§9), not before.

**Viewing photos (2026-09-04)** — clicking anywhere on a package's row
(not the upload button) toggles an inline panel showing that package's
`PRE_SHIP` and `POST_RECEIVE` photo grids side by side, whatever state it's
in — this was a real gap: until now the app captured photos but gave no way
to look back at them, which defeats the point of a tool built around visual
comparison. The moment a check resolves, the panel opens on this view
automatically (no extra click) so the verdict and the photos that produced
it land together. Mock/seed deliveries that predate this session get
generated, clearly-labelled placeholder images ("תמונה 1", "תמונה 2"...) —
not real photos, but enough for the viewing UI to have something honest to
render for every package, not only ones created live.

### 4.3 Employee home — "My Deliveries"

The Employee's landing page is a table of every delivery *they* have
submitted (see §3 — nothing before `SUBMITTED` is ever persisted, so there's
no draft state to show here). Design intent, learned from building the UI:

- **First column (rightmost, in RTL reading order) is `internal_number`**
  (`#1042`), not the ERP reference — deliberately different visual shape
  (bare number vs. the ERP's `SHP-`/`PO-` coded string) so the two are never
  confused for one another.
- **No `direction` column** in the list itself (still shown once you open a
  delivery) — not needed for the at-a-glance view.
- **Single status column, not two.** An earlier draft of this design split
  "workflow state" and "package health" into two badges — dropped, because it
  forces the reader to mentally combine them ("partially received + needs
  review — is that worse than shipped + all good?"). One column, always the
  single most urgent true thing about the delivery, answers "do I need to act
  on this" in under a second. Priority order (worst wins, checked top to
  bottom):

  | Priority | Hebrew | Trigger | Meaning |
  |---|---|---|---|
  | 1 | **חבילה נפתחה** | any package `OPENED` | go inspect now |
  | 2 | **שגיאה בבדיקה** | any package `CHECK_FAILED`, none opened | tamper-check API call itself failed — retry, not a verdict (§4.2) |
  | 3 | **דורש בדיקה** | any `INCONCLUSIVE`, none opened/failed | manual check needed |
  | 4 | **ממתין לתמונות קבלה** | not every package received yet, nothing flagged | upload once packages arrive |
  | 5 | **הושלם** | every package checked, all `INTACT` | nothing to do |

  Priority 1–2 outrank priority 3 even if the delivery isn't fully received
  yet — an opened package doesn't wait for the rest to arrive before it
  matters.
- **No breakdown subtitle under the badge** — an earlier version added a
  counts line ("3 חבילות · 1 נפתחו · 1 ממתינות") under the status; dropped
  for being noisy. The single badge is the whole point; exact counts are one
  click away.
- **Search + status filter** (2026-09-04) — sorted newest-first by
  `internal_number`. Search matches `internal_number` or `reference_number`;
  the status filter is the same 4-value priority list above as filter chips
  (plus "הכל"). Added once we pictured this list after real usage — a flat
  table stops working once it's not 3 rows, and search/filter answers the
  same question the status badge does: find the one thing that needs
  attention, fast.
- **Pagination** (2026-09-04) — 20 rows/page, applied after search/filter
  narrow the list. Prev/next + "עמוד X מתוך Y" rather than numbered page
  links; simpler, and correct regardless of how many pages a very long
  history produces. Mocked against ~500 generated rows to check it actually
  reads right at that volume, not just in principle.

Clicking a row opens that delivery's package list (label, workflow status,
verdict badge) — receiving, retrying a failed check, and viewing photos all
happen from there (§4.2).

### 4.4 Inventory Manager — "לוח בקרה" (Dashboard)

**Implemented 2026-09-04.** Where §4.3 is one Employee's own deliveries, the
dashboard is the opposite scope: every package, across every delivery,
flattened into one list — because the Manager's job (§2) is triage across the
whole operation, not any one delivery.

1. **Stat cards** — total packages, opened, inconclusive, check-failed,
   pending — a fixed overview, not filtered by the search/filter state below
   them.
2. **Search + filter chips**, same pattern as §4.3 (search by internal number
   or ERP reference; filter by result). Deliberately *not* a new "needs
   attention" concept — reusing the same search/filter/paginate shape already
   validated on the Employee table, rather than inventing a second one.
3. **Default sort is priority, not date**: unreviewed `OPENED` first, then
   `CHECK_FAILED`, then unreviewed `INCONCLUSIVE`, then pending, then anything
   already resolved (reviewed or `INTACT`) sinks to the bottom regardless of
   verdict — once a package has been through review there's nothing left to
   do, whatever the outcome. This is what makes "הכל" (all) a usable default
   view instead of noise at 1700+ rows.
4. **Row action ("סקיה")** appears only when `needsManagerReview` is true —
   verdict is `OPENED` or `INCONCLUSIVE` **and** `verdict_source` isn't
   already `MANUAL`. Clicking it (or the row) deep-links into that package's
   existing photo-comparison panel on the Delivery Packages page (§4.2) — the
   dashboard is a router to the evidence, not a duplicate photo viewer. "Back"
   from there returns to the dashboard, not the Employee's own delivery list,
   tracked via which nav item sent the user in.
5. **Manual override** lives on the Delivery Packages page itself (not the
   dashboard row), directly beneath the photos it's a decision about: a
   required note ("what did the physical check find?") plus two outcomes —
   **confirm תקינה** or **confirm נפתחה** — both set `verdict_source =
   MANUAL` and store the note. This is a deliberate change from the earlier
   wireframe concept (§10), which only offered "confirm Intact." That was
   wrong once `INCONCLUSIVE` is considered: the whole reason it exists is
   that the algorithm couldn't decide, so the physical check has to be able
   to resolve it *either* way, not just correct false positives. Once
   reviewed, the note becomes a permanent read-only line under the photos —
   whichever verdict it confirmed.
6. **`CHECK_FAILED` packages get no review action** — there's no verdict to
   override, only a failed API call. Retrying (§4.2) already lives on the
   Employee's package row; the dashboard just makes the failure visible
   across the whole operation, which is arguably more the Manager's problem
   operationally than the Employee's.

**Not implemented, by design, for this mockup**: nothing here is role-gated.
Both nav items are reachable regardless of who's "logged in" (there's no
login — §6, §9), same scope call already made for the rest of the app. Real
Employee/Inventory-Manager access control is a Keycloak realm-role concern
for production, not something a no-auth mockup can meaningfully simulate.

## 5. ERP Integration

Only two touchpoints, both validation-only (read):
- Export delivery → Shipment Number must validate against an ERP-provided view.
- Import delivery → PO Number must validate against an ERP-provided view.

No write-back to ERP planned currently.

**Shipment ↔ PO linkage (2026-09-04):** in Oracle, a shipment record links
back to the PO that generated it. So on export, once the Shipment Number
validates, the ERP view should also return its associated PO Number — the UI
surfaces this automatically (read-only) rather than asking the employee to
look it up and type it separately. This needs to be confirmed with whoever
owns the ERP view (does the view actually expose this linkage, 1:1, always
present?) — flagged in §9. The reverse (import → auto-populate a shipment
number from the PO) is *not* planned: a PO can spawn multiple shipments, so
there's no single correct value to fill in.

## 6. Auth

- Production: Keycloak (OIDC). Node backend validates bearer JWTs against the
  Keycloak realm; React frontend uses an OIDC/Keycloak adapter.
- Local/dev auth strategy while working off-network: **open question** — likely
  a mock/stub auth layer until you're on a machine that can reach Keycloak.

## 7. Storage

In production, the backend does **not** mount NAS/network storage directly —
it calls an internal storage service to persist and retrieve images. Backend
should treat this behind a small storage-client abstraction so the actual
transport (whatever that service's API turns out to be) is swappable. Contract
details are TBD — see open questions.

**Implemented 2026-09-04** as a `StorageClient` interface (`save` / `read` /
`delete`) with a local-disk implementation for development. Two consequences
worth keeping when the real service arrives: images are served through the
client by image `id` (`GET /api/images/:id`) rather than from a static
directory, so swapping the backend changes no URL the frontend uses; and
`storage_path` never leaves the API, so nothing outside the client depends on
how the store lays files out.

## 8. Tech Stack

- Frontend: React
- Backend: Node.js
- Database: PostgreSQL
- Containerized, deployed to VMware Tanzu via existing company CI/CD.
- Dev path: local machine now → company laptop → company internal network.

Filled in 2026-09-04 when implementation started, all in **TypeScript**:

| Choice | Notes |
|---|---|
| Prisma (ORM) | Pinned to 6.x — 7.x moves datasource config out of `schema.prisma` into a separate config format with driver adapters, more moving parts than this needs. |
| Express 5 + multer 2 | multer 1.x is deprecated. |
| Vite + React Router | Real URLs (`/deliveries/:id`) rather than the mockup's view-switching, because §4.4's dashboard has to deep-link into a specific package. |
| Vitest (both sides) + supertest + React Testing Library | |
| Postgres 16 in Docker Compose locally | Backend runs natively for now; containerizing it is a later step. |
| `timestamptz` for datetime columns | A bare `timestamp` stores a wall-clock with no zone attached, so anything reading the DB directly (psql, a BI tool) can't tell it's UTC. Storage stays UTC; conversion to Israel time happens at display, via locale formatting rather than a hardcoded +3 — Israel is UTC+3 in summer but UTC+2 in winter. |

**Code-level documentation** lives in `docs/` — `architecture.md` for module
layout, API surface, request lifecycle, data model and seams; `user-flows.md`
for the screens and state machines. This file stays the source of truth for
what is being built and why.

**UI prototyping note**: layout, flow and RTL Hebrew copy were iterated in a
standalone Tailwind-CDN mockup (`ui/index.html`) opened as a file rather than
through a build, and each screen was rebuilt in React once its design settled.
Removed 2026-09-16, along with `ui/user-flow.html` and `ui/open-questions.html`:
all four screens exist in React now (§4.1–§4.4), so the mockup could only
disagree with them. The flows it illustrated live in `docs/user-flows.md`.

## 9. Open Questions

Questions about the *third parties* live here. Questions about running the
application for real — auth, the upload path, the background job, storage,
indexes, deployment, retention — live in `docs/production-readiness.md`, one
numbered item each, and reference this section rather than repeating it.

### Third-party tamper-detection API (to raise with whoever owns/provides it)
- Input format: raw image files, URLs, or base64? Any size/resolution/format
  constraints (JPEG/PNG, max MB)?
- How are "before" and "after" images paired — exact positional matching
  (e.g. front-before ↔ front-after), or does it accept two unordered sets and
  figure out correspondence itself?
- Sync (call and wait) or async (submit job, poll or webhook for result)?
  Typical latency?
- Output format: boolean? confidence score? per-image detail? annotated
  images?
- What, if anything, does the API itself flag as "inconclusive" vs is that a
  confidence threshold we define ourselves?
- Auth mechanism for calling the API (API key, OAuth, mTLS)?
- Rate limits / cost per call / max batch size?
- Retry/idempotency semantics if a call errors out? (UI now mocks a generic
  "call failed, retry" state — §4.2 — but the real retry/idempotency contract
  is still unknown)
- **Does it accept HEIC/HEIF?** Surfaced 2026-09-04 while implementing uploads,
  and it's the one open question likely to bite in real use rather than in
  theory. §4.2 says photos are typically taken on a personal phone, and iPhones
  shoot HEIC by default — but Chrome and Firefox can't display it, so we
  currently reject it (§3) rather than store evidence nobody can look at. That
  leaves a real gap for anyone photographing on an iPhone with default
  settings. Three possible answers, and which one we pick depends on this API:
  convert HEIC → JPEG server-side on upload; require employees to switch their
  phone camera to "Most Compatible"; or accept HEIC for the API's benefit and
  additionally store a converted copy for viewing. Worth asking early, since
  conversion means a new backend dependency.

### ERP view (to raise with whoever owns it)
- Does the ERP view actually expose the shipment → PO linkage described in
  §5, and is it always 1:1 and always present, or can a shipment lack a
  linked PO?

### Internal storage service (to raise with whoever owns it)
- Upload contract: how do we send an image, and what do we get back (an id?
  a URL?) to store on `PackageImage`?
- Retrieval contract: how do we fetch/display an image for history viewing?
- Auth mechanism for calling the service?
- Size/format limits, retention policy, delete support?

### Other
- Does a `SUBMITTED` delivery ever need to be reopened (e.g. to add a missed
  package)?
- Local/off-network dev auth strategy (Keycloak stand-in) — and dev-time
  stand-ins for the tamper-detection API and storage service, since none of
  the three are available yet.

## 10. Wireframes

Early clickable wireframes covering the Create Delivery → Add Package flow,
Delivery Detail, Receive Photos, and the Inventory Manager Dashboard — fully
superseded by the real mockup (`ui/index.html`, §8) and removed
(2026-09-04), source and all; the hosted link was already taken down
earlier the same day. The mockup that replaced them is itself gone as of
2026-09-16, once every screen existed in React. Kept only as a historical note here: several of their
concepts (the Dashboard's one-directional override, in particular) were
deliberately changed once actually built — see §4.4 and the 2026-09-04
changelog entries.

## 11. Changelog

- 2026-09-03: Initial domain model, shipping/receiving flow, ERP touchpoints,
  Keycloak auth, NAS storage, stack decided (React/Node/Postgres/Tanzu).
- 2026-09-03: ERP confirmed read-only (no write-back). Added manual
  verdict-override model for Inventory Managers correcting API results after
  a physical check. Storage revised: production goes through an internal
  storage service, not a direct NAS mount.
- 2026-09-03: Published clickable wireframes for the 4 core screens (see
  §10) since backend contracts (tamper API, storage service) are still
  undefined and UI/flow was the actionable next step.
- 2026-09-04: Switched to building UI in Hebrew/RTL directly as a standalone
  `ui/index.html` (Tailwind CDN, no build step) instead of the wireframe
  canvas, so it can be opened and iterated on like a real page. Added
  `internal_number` to Delivery (§3) — a system id shown deliberately
  distinct from the ERP reference. Defined the Employee home screen (§4.3):
  submitted-only deliveries list, led by the internal number, with a
  package-verdict health indicator as the primary signal instead of
  workflow status.
- 2026-09-04: Reworked the above after further discussion. Delivery
  persistence moved earlier — a delivery now saves as `DRAFT` as soon as its
  reference validates (§3), instead of only at final submit, so in-progress
  work is never silently lost; drafts are visible only to their creator, and
  resuming one reopens the same create flow rather than a different screen.
  Collapsed the two-badge design (workflow status + package health) in §4.3
  into one priority-ordered status column, since two badges forced the
  reader to mentally combine them — the table's whole job is to answer "do I
  need to act on this" at a glance. Also dropped the page subtitle, the
  column-header captions, and the counts-breakdown line under the status
  badge — all noise once the single status badge does the real work.
- 2026-09-04: Reverted the draft-persistence decision from earlier the same
  day. A delivery is only created at Submit again — draft state is purely
  in-session on the create-delivery flow, lost on cancel/navigate-away by
  design, never shown anywhere. Removed the `DRAFT`/"בעריכה" row from the
  §4.3 status priority table (now 4 states, not 5) and the mock draft row
  from `ui/index.html`.
- 2026-09-04: Added the real logo (shield + box mark, option 3C) and its
  Hebrew wordmark/tagline to the home page; restyled primary buttons to a
  solid navy pill (`var(--navy)`, reused from the existing heading color)
  after trying a blue/purple gradient and a flat-black pill, neither of
  which read as this brand. Reworked the create-delivery flow (§4.1) from a
  step-gated wizard into one continuous page — the packages card unlocks in
  place once the reference validates, instead of navigating to a new step.
  Added the ERP shipment→PO auto-populate behavior (§5).
- 2026-09-04: Widened the create-delivery page to a two-column layout
  (details + packages side by side) to match the table page's full width —
  the single narrow column read as unfinished next to it. Changed Package
  `label` (§3) from employee-typed to system-assigned sequential numbering —
  the app now tells the employee which number to write on the box instead of
  asking them to type it, removing a typo/mismatch failure mode. Dropped the
  photo minimum-file-size validation entirely after it turned out to reject
  legitimate small files with no real basis for the threshold — file-type
  checking only for now, real quality requirements are still TBD (§9).
- 2026-09-04: Made ERP validation automatic (debounced on typing, no "check"
  button) and dropped the English parenthetical from the reference-number
  label (§4.1) — both were unnecessary friction. Added the ability to edit a
  saved package's photos before submit (§4.1) — click it in the list, its
  photos reopen in the upload area, "עדכון חבילה" writes the change back in
  place without renumbering anything. Fixed the small header logo, which was
  still the old placeholder icon instead of the real mark. Added search +
  status-filter chips to the deliveries table (§4.3) and populated ~18 mock
  rows to see how it reads at real volume, not just 3 hand-picked examples.
- 2026-09-04: Added pagination to the deliveries table (§4.3) and bulk-seeded
  ~500 mock rows to actually test it at that volume. Implemented receiving
  photos (§4.2) for real — inline on the delivery's package list rather than
  the standalone Receive view originally sketched in the wireframes: click
  upload on a `SHIPPED` package, its row expands into the same upload
  pattern used pre-ship, submit moves it into a new transient `CHECKING`
  workflow state ("מבצע בדיקה…" with a spinner) representing the
  tamper-detection API call in flight, then a verdict lands and it becomes
  `RECEIVED`. Mocked with a flat delay and random outcome — the real API's
  actual latency and contract are still open (§9).
- 2026-09-04: Closed a real gap flagged after a "what's still missing"
  review — the app captured photos but never let anyone look at them again.
  Clicking a package row now opens an inline pre-ship/post-receive photo
  comparison (§4.2); resolving a check auto-opens it so the verdict and the
  photos behind it land together. Also fixed photos actually being discarded
  after upload instead of kept on the package (`submitDelivery` and
  `submitReceivePhotos` now persist them), and added generated placeholder
  images for the mock/seed deliveries so viewing works for all of them, not
  only ones created live in a session.
- 2026-09-04: Suppressed browser password-manager icon injection
  (`autocomplete`/`data-lpignore`/`data-1p-ignore`/`data-bwignore` etc.) on
  the reference-number and search inputs after a user screenshot showed a
  1Password/LastPass-style extension icon overlapping the app's own
  validation checkmark — not an app bug, just two icons occupying the same
  spot. Removed the "כיוון המשלוח" field label (§4.1, the export/import
  toggle is self-explanatory) and the "סגירה" close button on the
  package-view expansion (§4.2) — clicking the row again already closes it,
  so the button was a redundant second control for the same action.
- 2026-09-04: Simulated the tamper-detection API call failing outright
  (§3, §4.2), distinct from an `INCONCLUSIVE` verdict — a red "שגיאה בבדיקה"
  badge and a retry button that re-runs the check against the already-
  submitted photos. `INCONCLUSIVE` itself needed no new work; its amber
  "דורש בדיקה" badge and status-filter chip already existed and were judged
  sufficient for the mock. Checked the empty-deliveries-table case (§4.3): no
  dedicated empty-state screen needed, the plain table + "משלוח חדש" button
  above it is enough — but the placeholder message was wrong for it ("no
  matching deliveries," which reads as an active filter hid everything);
  swapped in a real first-time message ("no deliveries yet, click 'New
  Delivery'...") specifically for the zero-deliveries-ever case, keeping the
  old message for an active filter/search that matches nothing. Explicitly
  deferred: mobile/responsive layout (desktop-only, on-network use for now)
  and a login screen (won't exist in the real app — Keycloak SSO per §6).
- 2026-09-04: Added header navigation ("המשלוחים שלי" / "לוח בקרה") ahead of
  building the Inventory Manager dashboard, since there was previously
  nowhere in the UI to reach a second view — skipped a logout control (real
  app has none of this chrome anyway, Keycloak SSO owns it, §6). Built the
  Manager dashboard itself (§4.4): every package across every delivery,
  flattened, sorted by urgency (unreviewed opened → check-failed →
  unreviewed inconclusive → pending → resolved), reusing the same
  search/filter/paginate shape as §4.3 rather than a new pattern. Moved the
  manual verdict-override control off the dashboard row and onto the actual
  photo-comparison panel on the Delivery Packages page (§4.2) — the decision
  belongs next to the evidence, not on a triage list — and made the override
  explicitly two-directional (confirm תקינה *or* confirm נפתחה, both requiring
  a note), correcting the original wireframe's Dashboard.dc.html concept
  (§10) which only handled "false positive, mark Intact" and had no path for
  `INCONCLUSIVE` to resolve as genuinely opened. Nav and dashboard access are
  not role-gated in this mockup, matching the no-auth scope already set
  elsewhere (§9).
- 2026-09-04: Recolored `CHECK_FAILED` (§3, §4.2) from red to a new
  purple/`--purple-soft` token — it read as identical to `OPENED` everywhere
  it appears (stat card, table badge, retry button), a real ambiguity since
  an API call failing is an operational hiccup, not evidence of tampering.
  Moved its dashboard stat card (§4.4) to the end of the row (lowest visual
  weight) since it's expected to be both rare and unrelated to package
  condition, unlike opened/inconclusive which are what a manager should see
  first. Left the dashboard's default sort order and filter-chip order
  unchanged — this was specifically about the stat-card row's visual weight,
  not review-priority ranking.
- 2026-09-04: Mockup declared feature-complete for the initial round of
  stakeholder review. Updated `ui/user-flow.html`, which had gone stale since
  its creation (predated `CHECK_FAILED`/retry and the entire Manager
  dashboard) — added the retry loop to the existing employee diagram and a
  second diagram for the Inventory Manager's manual-review flow (dashboard →
  review → photos → physical check → confirm תקינה/נפתחה → status updates),
  explicitly two-directional to match the §4.4/§3 decision. Compiled the
  open-questions in §9 into a stakeholder-facing summary (business/product
  vs. the tamper-detection API's developer) for the review meeting — content
  unchanged from §9, just organized by audience.
- 2026-09-04: **Started building the real application**, replacing the mockup
  screen by screen. Filled in the concrete stack (§8) and set the working
  method: one vertical slice at a time, each going all the way through Docker
  Postgres → Prisma → Express → React rather than finishing a whole layer at
  a time, so the pieces are proven to fit early.
  **Slice 1 — Create Delivery**: direction, ERP reference validation (mocked
  locally, §5), and the delivery row. Learned that server-side re-validation
  of the reference matters: the create endpoint originally trusted that the
  client had called validate-reference first, which a direct request could
  simply skip.
  **Slice 2 — Packages + pre-ship photos**: the `Package`/`PackageImage`
  models (§3), the storage client (§7), and the create flow rebuilt as the
  mockup actually specifies it — separate My Deliveries and Create Delivery
  screens, since Slice 1 had collapsed them onto one page. A delivery and all
  of its packages are created in a single request, keeping §3's rule that
  nothing is persisted before Submit. Two decisions came out of building it
  rather than designing it: package numbers now skip gaps instead of being
  reused (§3 — the mockup's `count + 1` hands out duplicates after a delete,
  which matters because the number is written on a physical box), and photo
  formats are restricted and sniffed from the file's bytes (§3), which is
  what surfaced the HEIC problem now recorded in §9.
- 2026-09-05: **Slice 3 — Receiving + tamper-check API**: closed the
  ship-then-receive loop (§4.2). A shipped package takes post-receive
  photos and gets a verdict from a stand-in service that fills in for the
  third-party API of §9, kept behind a `TamperCheckClient` seam so the
  real one swaps in at a single file rather than through the routes. The
  `TamperCheck` model (§3) records the verdict per package. Added
  `TAMPER_CHECK_OUTCOME` so a demo can pin the stand-in's answer instead
  of taking whatever it invents. One process lesson, not a product one:
  the build was broken for most of a slice while the test suite stayed
  green, because Vitest strips types without checking them — the build
  now has its own tsconfig, and typecheck is a required step alongside
  tests before any slice counts as done.
  **Slice 4 — Deliveries list that can be acted on**: the landing page
  (§4.3) rendered every delivery ever created and could not answer the
  question it exists for — "do I need to act on this". Each row now
  carries a derived `attentionStatus`: the §4.3 priority ladder computed
  in SQL from the delivery's packages, where an opened or failed-call
  package outranks awaiting-receipt even while the rest of the delivery
  is still in transit. Deliberately not called `status`, since
  `Delivery.status` already persists `SUBMITTED` and means something
  else. Search, filter, sort and paging all run in Postgres, so a page
  is 20 rows whatever the history grows to. Two things surfaced by
  building it: the page total has to be counted separately rather than
  with `COUNT(*) OVER()`, because a window function rides on the
  returned rows and would report 0 for a page past the end — exactly
  when the pager still needs the total to get back; and search has to
  escape LIKE wildcards, since bound parameters stop SQL injection but
  not pattern injection, and an unescaped `%` returns the whole table.
  Also deleted 10 package-less deliveries left over from Slice 1, before
  packages existed — nothing can create one now, and hiding them with an
  INNER JOIN would have dropped rows from the list without saying so.
- 2026-09-05: **Deliveries list polish**, closing the gap between §4.3 as
  built and the `ui/index.html` mockup it was drawn from: secondary text in
  the reference and package-count cells, the mockup's row height, the row
  chevron that marks a row as clickable (also added to the packages table,
  §4.2), and the search field's magnifier. Alongside it, the create flow got
  the two behaviors now recorded in §4.1 — Submit waiting on unsaved work,
  and the confirmation that a delivery landed. Three bugs surfaced by review
  rather than by use: a page past the end reported a row range it did not
  have, the router's own history state was being destroyed when clearing the
  hand-off, and a running CSS animation silently outranks `:hover`, leaving
  the newest row the only one that ignored the pointer.
- 2026-09-05: **Documentation split** (`docs/`). This file stays the source of
  truth for what is being built and why; `docs/architecture.md` and
  `docs/user-flows.md` describe how the current code is arranged — module
  layout, API surface, request lifecycle, data model, and the three seams for
  systems this project does not own. They are separated because they go stale
  for different reasons: a design decision is settled once, while the shape of
  the code changes with every slice. Keeping documentation current is now a
  step of the `dev-workflow` skill rather than something remembered after the
  fact — this changelog had already fallen two merges behind when the split
  was made.
- 2026-09-05: **Slice 5a — Inventory Manager dashboard**, the §4.4 screen the
  mockup had and the real app did not. Every package across every delivery,
  flattened and ordered by urgency rather than date: an unreviewed `OPENED`
  first, then a failed call, then `INCONCLUSIVE`, with anything already
  reviewed sinking below packages still waiting for a verdict — once a human
  has been through it there is nothing left to do, whatever the outcome, and
  that is what keeps "הכל" usable as the default view. The five stat cards
  count every package and deliberately ignore the search and filter beneath
  them, since they describe the operation rather than the page. A row
  deep-links into that package's existing photo panel on the §4.2 page, with
  the package number and the origin both in the query string so a refresh
  keeps the panel open and Back returns to the dashboard.

  Two things the building surfaced. `needsManagerReview` came back as SQL
  `NULL` rather than `false` for a package with no verdict yet — `verdict IN
  (…)` is three-valued, so the API was promising a boolean and sending null.
  And the filters cannot all read one column: `CHECK_FAILED` is a workflow
  state while the rest are verdicts, so a failed call is excluded from the
  verdict filters rather than being allowed to appear under a stale one.

  The manual override (§4.4.5) is deliberately not in this slice — it is the
  Manager writing to a verdict rather than reading one, and it lands next as
  Slice 5b.
- 2026-09-05: **Slice 5b — the manual verdict override** (§4.4.5), the last
  screen behavior the design specified and the code did not have. The schema
  had carried `verdictSource`, `overrideNote`, `verdictOverriddenBy` and
  `overriddenAt` since Slice 3 with nothing writing them. `POST
  /api/packages/:id/review` now does, behind a required note — the only record
  of what the physical check actually found, and it outlives everyone who
  remembers the package. Two outcomes, never one: confirming תקינה and
  confirming נפתחה are both available, since the whole reason `INCONCLUSIVE`
  exists is that the algorithm could not decide. Confirming a verdict rather
  than reversing it still ends the review — a human has been through it, so the
  row leaves the dashboard's queue either way. A `CHECK_FAILED` package gets no
  panel at all: there is no verdict to override, only a call to retry.

  The panel sits under the photos rather than on the dashboard row, so the
  decision is made beside the evidence it is about, and once reviewed the note
  becomes a permanent read-only line rather than a confirmation that
  disappears.
- 2026-09-05: **CI and a project brief.** Both suites, typecheck and build now
  run on every push and pull request, the backend job against a real Postgres —
  the priority ladders and the paging are SQL, so mocking the database would
  test nothing that ships. Build is its own gate because Vitest strips types
  without checking them. Prompted by this session finding two tests that passed
  locally three times and then failed roughly half the time; a pipeline catches
  that class of thing and a person does not. Added `CLAUDE.md` as a pointer to
  DESIGN.md, `docs/` and the two skills rather than a description that would
  drift, and pushed the repository to a private GitHub remote.
- 2026-09-05: **Production-readiness audit.** Wrote
  `docs/production-readiness.md`: 30 numbered gaps between what runs today and
  what survives the company network, each with what the code does now, the
  condition that turns it into an incident, the open question that decides the
  fix, and the work that follows once it is answered. Blockers are the ones
  with no user behind them — every row is attributed to `local-dev-user`, no
  route checks a role, the tamper-check mock can ship, and the startup recovery
  that is correct on one instance silently marks a second instance's in-flight
  checks as failed. The upload path is the other theme: one multipart request
  per delivery, buffered in memory, not idempotent, with no client-side queue
  behind it. Deliberately a separate file rather than more of §9 — §9 asks
  third parties for contracts, this asks our own platform team and business for
  decisions, and the two get answered by different people at different times.
- 2026-09-05: **Runtime hardening.** The backend now validates its whole
  environment at boot and refuses to start on a bad one, answers `/api/health`
  and `/api/ready` separately, drains on SIGTERM — waiting for in-flight tamper
  checks, which outlive their own response and so are invisible to a socket
  drain — and answers errors through its own handler rather than Express's,
  which had been putting stack traces in response bodies and turning an
  oversized photo into a 500. Logs are one JSON object per line with a request
  id threaded through async context, ready for Splunk to collect later; helmet
  sets security headers; CORS takes an explicit origin list in production.
  Rate limits guard the two upload endpoints and the retry button, keyed by
  address until there is a user to key on — deliberately loose, since a
  warehouse behind one NAT is a single key, and with photos and probes outside
  the global backstop because a delivery page polls every second and loads eight
  thumbnails at once. Most of this closes items catalogued the same day in
  `docs/production-readiness.md` (P5, P22, P23, and part of P3, P24 and P25);
  the one thing deliberately left out is the actor seam, whose shape depends on
  which Keycloak claim carries identity.
- 2026-09-05: **Query indexes.** The schema had none beyond its keys, and
  Prisma creates no index for a foreign key on PostgreSQL, so every read of a
  package's photos and every cascade delete was a sequential scan. Added four,
  each chosen by reading the query that needs it rather than by indexing every
  column: `Package.workflowStatus` and `Package.verdict` for the dashboard
  filters and the startup recovery scan, `PackageImage(packageId, sequence)`
  because those reads always filter by package and order by sequence, and
  `TamperCheck.packageId` for the delete cascade. Two obvious-looking candidates
  were left out on the same evidence — `Delivery.createdAt`, since the list
  orders by internal number rather than date, and `Delivery.referenceNumber`,
  since search is a leading-wildcard ILIKE that no B-tree serves. The dashboard's
  priority ordering is a CASE expression and stays unindexable by construction;
  sizing any of this properly still waits on knowing real volume
  (`docs/production-readiness.md` P16–P20).
- 2026-09-05: **Bounded uploads, and a submit that can be retried.** A delivery
  submit now carries an `Idempotency-Key`: the SPA mints one per attempt and
  keeps it across retries, and a repeat answers 200 with the delivery already
  created rather than filing the same physical boxes twice. That failure was
  not hypothetical — a slow upload can commit on the server and still fail on
  the way back, and the only thing an employee can do is press שליחה again. Two
  simultaneous duplicates are decided by a unique constraint rather than by a
  read, the same pattern the manager override already used. Uploads also gained
  a whole-request cap of 150MB, checked before anything is buffered: multer's
  per-file and per-count limits multiplied out to roughly 3GB held in memory
  ahead of validation. What is still open is the shape rather than the bounds —
  the delivery goes up as one request with no resume, and fixing that waits on
  the storage service's contract (`docs/production-readiness.md` P6, P7).
- 2026-09-07: **A bounded tamper-detection call.** The call now has a deadline
  (`TAMPER_CHECK_TIMEOUT_MS`, 30s until the vendor names a real one): the client
  is handed an `AbortSignal` so a real implementation can drop its socket, and
  the caller also races the deadline so the bound holds even if a client ignores
  the signal. A timeout is recorded as a failed call rather than a verdict, so
  it reaches the retry the UI already offers — before this, a call that hung
  rather than failed left the package in `CHECKING`, which offers nothing, and
  only a restart recovered it. The dashboard also shows how many attempts a
  package has burned, from the second failure onward. Deliberately a count and
  not a cap: a `CHECK_FAILED` package has no verdict for a manager to override
  (§4.4.4), so refusing further retries would strand it, and how many attempts
  are affordable is a vendor-cost question nobody has answered
  (`docs/production-readiness.md` P12).
- 2026-09-07: **Quality gates on both packages.** The backend had no linter at
  all; it has oxlint now, and both packages fail on a warning rather than
  printing one, since the three warnings this slice cleared had been sitting
  there unnoticed. Two were the same thing — a ref written during render — and
  the third was `DeliveryDetailsCard` resetting its validation state from an
  effect whenever the reference changed, which meant a render still showing the
  previous reference's tick before the reset landed. That one is now derived:
  the result is tagged with the input it describes, so "is this answer still
  about what is on screen" is computed rather than stored, and the parent is
  told the reference went invalid by the event that invalidated it rather than
  by an effect watching the prop. CI gained the backend lint step and an
  `npm audit` report per package, reported and not enforced for the same reason
  coverage is. The first audit run has something in it: `deepmerge-ts` reaches
  the tree through the `prisma` CLI, which is a devDependency and not part of
  what ships, and the offered fix is a downgrade to 6.12.0 — worth knowing, not
  worth taking.
- 2026-09-07: **A running check now has an owner.** Recovery used to be a
  boot-time sweep that moved every package in `CHECKING` to `CHECK_FAILED`,
  which is right with one instance — nothing else could be running a check —
  and silently wrong with two: a starting instance declared a live check dead,
  and the instance still running it then wrote a verdict onto a package already
  marked failed. Each attempt is now leased to the process running it, with an
  expiry; any instance picks up an attempt whose lease has run out and finishes
  it, claiming the row with the owner it just read in the WHERE clause so two
  sweeps cannot both win. A crash therefore recovers itself instead of leaving
  an employee a package to retry by hand, and `recoveryAttempts` caps the
  reclaiming so a check that takes its process down every time ends up in
  `CHECK_FAILED` for a human rather than circulating. Deliberately a lease on
  the existing `TamperCheck` row rather than a job queue: the row is already one
  durable record per attempt (§3), a queue would add a second one free to
  disagree with it, and the automatic retry a queue exists to provide is wanted
  only for interrupted work — a *failed call* still waits for a human (§4.2).
  A result is also written only by the instance that still holds the lease,
  since a process paused past its own lease would otherwise wake with an answer
  and bury a manager's override behind `verdictSource: "API"`. Verified by
  killing a process mid-check and watching the next start finish the job, and by
  starting a second instance mid-check and watching it leave the first alone
  (`docs/production-readiness.md` P9, P10).
- 2026-09-10: **A storage key is now the same string on every OS.**
  `LocalDiskStorage.save` built the key it returns with `path.join`, so a photo
  uploaded from a Windows machine was recorded in `PackageImage.storagePath` as
  `delivery\package\uuid.jpg`. That string is persisted and read back later,
  possibly from a Linux container, where those backslashes are not separators
  but part of one long filename — the photo would have been unreadable, and
  nothing would have said so until someone opened the comparison view. Keys are
  built with `path.posix.join` and translated back to native separators only at
  the moment a file is actually touched, which is the only place the host's
  convention is anyone's business. `resolve` now also rejects a key that isn't
  shaped like one the app generates — absolute, empty, `.`/`..` or
  backslash-bearing — before the containment check rather than after: those used
  to be caught by accident as traversal, and once keys were split on `/` they
  would instead have resolved to some arbitrary path *inside* the root and
  failed later as a confusing "file not found". Found by the suite failing on
  Windows, which is the second machine this project is now developed on; the
  storage seam (§7) is still a stand-in for the internal storage service, but
  the key format is the part of it that outlives the stand-in.
- 2026-09-16: **The development process moved out of one vendor's tooling.**
  It used to live in `CLAUDE.md` and two skills under `.claude/skills/`, which
  exactly one assistant reads. It now lives in `CONTRIBUTING.md` (setup, the
  gates and why each exists, the six-step loop, branch and commit rules) and
  `AGENTS.md` (the same rules addressed to an agent), with a new root
  `README.md` and a PR template prefilling the Summary/Test plan/Docs
  checklist. `CLAUDE.md` and `.github/copilot-instructions.md` are now thin
  pointers at `AGENTS.md`, which in turn points at `CONTRIBUTING.md` rather
  than restating it: one copy of each rule, and any agent that reads a repo at
  all finds it. The skills and `skills-lock.json` are deleted — their content
  survived the move, minus the tool-specific parts (plan mode, the review-
  comment format, the commit-message delegation). Two rules got *stronger* on
  the way: the safety rules the old tool enforced ambiently (never force-push
  `main`, never `--no-verify`) and the no-AI-attribution policy, which was a
  silent setting, are both written down now. `frontend/README.md` was still
  stock Vite template text.

  The immediate reason was a change of assistant, but the durable one is that
  a process enforced only by a tool is a process that leaves when the tool
  does — and this repository is about to have other developers on it.
- 2026-09-16: **The deployment target is a real Kubernetes cluster**, which
  turned several theoretical items concrete. Recorded in `README.md`, for the
  platform team: migrations run as their own Job, never at pod boot and never
  as an initContainer, since that runs once per pod and replicas would race;
  `VITE_API_URL` is inlined at build time, so one Ingress host serving both is
  what makes the frontend image portable and closes P3 as a side effect;
  `TRUST_PROXY` must be a hop count behind an Ingress or the whole deployment
  shares one rate-limit bucket; `terminationGracePeriodSeconds` must exceed
  `SHUTDOWN_GRACE_MS`, because the drain waits for running tamper checks and
  not only for open sockets. P13 was revised rather than re-tiered: photos on
  local disk was already a blocker, but it breaks on the first rolling deploy
  rather than at scale, so the stop-gap until the storage service exists is one
  replica with a PersistentVolumeClaim. Worth restating because it is easy to
  read as a bug: `NODE_ENV=production` refuses to start while the tamper client
  is the mock (§9), so a test cluster runs as `development` on purpose.
- 2026-09-16: **Made the repo legible to any coding agent, not just a
  well-briefed human.** `CLAUDE.md` now `@`-imports `AGENTS.md` rather than
  linking to it: Claude Code does not read `AGENTS.md` natively, so a prose
  pointer was a hope and the import is mechanical. `AGENTS.md` was rewritten
  against what the published guidance actually finds effective — literal
  commands instead of descriptions of commands, a table saying where new code
  goes rather than a paragraph about layering, and an explicit *do not touch*
  list (`.env`, applied migrations, generated Prisma output, `package-lock.json`,
  `ui/index.html`, past changelog entries). It is 99 lines; the research
  consensus is that these files stop paying for themselves past roughly 150.
  Both packages gained `npm run verify` — typecheck, lint, test, build, cheapest
  failure first — so "run the gates" is one command in every doc that mentions
  it, rather than four that can be run partially. CI still runs the four steps
  separately on purpose: it reports everything wrong in one go instead of
  stopping at the first. Also `.nvmrc` and `engines: node >=24`, which nothing
  declared before although CI had always used it; `.editorconfig`; and
  `private: true` with `license: UNLICENSED` on the backend package, which was
  still carrying npm's default `ISC` and could have been published by accident.
- 2026-09-16: **A fresh clone now has a database it can reach and data to look
  at.** `npm run setup` migrates and then seeds four deliveries covering the
  states the screens are built around — in transit, checked and intact, opened,
  a manager's override with its note, and a failed call waiting for a human —
  with real photos, so the galleries are populated rather than empty frames.
  The seed is re-runnable because it owns its rows: every seeded reference
  number contains `SEED`, and a re-run deletes those and their stored files
  before writing new ones. Photos are generated as solid-colour PNGs by
  `lib/solidPng.ts` rather than kept as a checked-in base64 blob, because bytes
  nobody can read are bytes nobody can review.

  The occasion was finding out that Docker is blocked on the company laptops,
  so the only Postgres available there is one on the Kubernetes cluster reached
  by port-forward, shared rather than throwaway. That makes a habit dangerous
  that was previously merely untidy: the suite writes to whatever
  `DATABASE_URL` names, and there was no separate test database — so running it
  would have meant running it against the same rows being used for development.
  `vitest.config.ts` now loads `backend/.env.test` ahead of `.env` when the
  file exists, making the separation a file instead of something to remember.
  Where Postgres *is* a throwaway container, nothing changes and the file is
  unnecessary. CI is untouched either way: it starts its own container and
  stays the impartial answer to whether the suite passes.

  `README.md` gained an environments table, because "a schema named after me"
  and "the test environment" had started to sound like the same thing and are
  not: the schema is a local-development convenience that exists only because
  a laptop cannot run Docker, while the deployed environments take their
  configuration from a ConfigMap and a Secret and never read a `.env` file at
  all. Typechecking also now covers `prisma/`, which the seed runner lives in —
  it was outside `tsconfig.json`'s `include`, which is exactly the gap that
  once let a type error sit undetected across a whole slice.
- 2026-09-16: **Removed the `ui/` mockup and `.nvmrc`.** All four screens now
  exist in React (§4.1–§4.4), so `ui/index.html` had stopped being a place to
  design and become a second, diverging description of screens that already
  work — the failure mode §10's wireframes were removed for, one layer up.
  `ui/user-flow.html` and `ui/open-questions.html` went with it: both are
  covered by `docs/user-flows.md` and §9 respectively, in files that are
  actually maintained. The live references in `AGENTS.md`, `README.md`,
  `docs/architecture.md` and `frontend/README.md` went at the same time, since a
  doc pointing at a deleted file is worse than one that never mentioned it.
  `.nvmrc` went because it only does anything for someone running `nvm use`,
  and `engines: ">=24"` in both packages already states the requirement in a
  form npm enforces. `.editorconfig` stays: line endings are a real problem the
  moment a second machine touches the repo, and it is the file that prevents it.
- 2026-09-18: **Renamed to Package Protection**, in all sixteen places the old
  name appeared: the wordmark in `AppHeader`, the browser title, the two doc
  titles, and the Postgres user, password and database name in
  `docker-compose.yml`, CI and both `.env.example` files. The local volume had
  to be recreated rather than renamed — `POSTGRES_DB` only applies to an empty
  data directory, so a running database keeps whatever name it was born with —
  which is worth knowing before anyone tries the same on a database that holds
  something. Nothing in the running system depends on the name: no test
  asserted it, and the Hebrew UI never carried it outside the header.

  Deliberately unchanged: the cluster's `appdb` and the `package-management`
  namespace on the Windows workstation. Those are DevOps's names, not ours, and
  renaming our half to match a name we don't own would only invent a
  disagreement. Git history keeps the old name in commit messages and paths,
  which is correct — it is what the project was called at the time.
