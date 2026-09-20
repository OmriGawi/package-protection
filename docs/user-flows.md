# User flows

What each screen is for and how a delivery moves through the system. The
reasoning behind these flows lives in DESIGN.md §4; this file is the map.

## Screens

| Route | Screen | DESIGN.md |
|---|---|---|
| `/deliveries` | My Deliveries — the landing page | §4.3 |
| `/deliveries/new` | Create Delivery | §4.1 |
| `/deliveries/:id` | Delivery packages — receive photos, verdicts | §4.2 |
| `/dashboard` | Inventory Manager dashboard (לוח בקרה) | §4.4 |

## A package's life

```mermaid
stateDiagram-v2
  [*] --> SHIPPED: delivery submitted<br/>with pre-ship photos
  SHIPPED --> CHECKING: receive photos uploaded
  CHECKING --> RECEIVED: verdict returned
  CHECKING --> CHECK_FAILED: call failed
  CHECK_FAILED --> CHECKING: retry
  RECEIVED --> RECEIVED: manager override<br/>INTACT or OPENED, note required
  RECEIVED --> [*]
```

A verdict is `INTACT`, `OPENED` or `INCONCLUSIVE`. `CHECK_FAILED` is not a
verdict — the call itself did not complete, so there is nothing to report and
the only way forward is a retry.

## Shipping (§4.1)

One continuous page, not a wizard. The packages card is present from the start
but disabled until the reference validates — a card unlocking in place, not a
navigation.

```mermaid
flowchart TD
  A["Pick direction<br/>Export / Import"] --> B["Type shipment / PO number"]
  B --> C{"Valid in ERP?"}
  C -->|no| B
  C -->|yes| D["Packages card unlocks<br/>Export: linked PO auto-fills"]
  D --> E["Add 4+ photos for package N"]
  E --> F["Save package"]
  F --> G{"More boxes?"}
  G -->|yes| E
  G -->|no| H{"Anything unsaved<br/>in the upload area?"}
  H -->|yes| I["Send blocked<br/>save the package, or cancel the edit"]
  I --> H
  H -->|no| J["Send delivery"]
  J --> K["Back to the list<br/>toast + the new row fades in green"]
```

Two guards worth knowing:

- **The reference is validated again on the server** when the delivery is
  created. The create endpoint originally trusted that the client had called
  validate-reference first, which a direct request could simply skip.
- **Send waits on unsaved work.** Photos picked but never saved belong to no
  package, so submitting would drop them silently. The block distinguishes a
  package never saved from one reopened for editing — different mistakes,
  different instructions.

## Receiving (§4.2)

```mermaid
sequenceDiagram
  participant U as Employee
  participant P as DeliveryPackagesPage
  participant A as API
  participant T as Tamper-check stand-in

  U->>P: opens a delivery, picks a SHIPPED package
  U->>P: uploads 4+ receive photos
  P->>A: POST /packages/:id/post-receive-photos
  A->>T: compare pre-ship vs post-receive
  Note over P,A: package is CHECKING;<br/>the page polls only while<br/>something is in flight
  T-->>A: verdict, or a failure
  A-->>P: next poll carries the result
  P->>P: the resolved package opens on its photos
```

The page opens the resolved package on its evidence, so the verdict and the
photos behind it land together. It never steals an upload panel that has
photos picked in it — a background event must not bin work in progress.

## My Deliveries (§4.3)

Every delivery the employee submitted, newest first, answering one question:
*do I need to act on this?*

```mermaid
flowchart LR
  subgraph ladder["attentionStatus — worst wins"]
    direction TB
    P1["1 · package opened"]
    P2["2 · check call failed"]
    P3["3 · inconclusive"]
    P4["4 · awaiting receipt"]
    P5["5 · complete"]
    P1 --> P2 --> P3 --> P4 --> P5
  end
```

Priorities 1 and 2 outrank 3 even mid-transit: an opened package does not wait
for the rest of the delivery to matter.

Search, status filter, sort and paging all run in Postgres and live in the URL,
so a filtered view survives a refresh and the back button steps through it.

Every table row can be opened two ways. Clicking anywhere on it works, and the
cell holding the number is a real control of its own — a link on this screen
and on the dashboard, a button on the delivery page, where the row expands a
panel instead of navigating. That second path is the only one a keyboard or a
screen reader has: a `<tr>` takes no focus and announces nothing. Filtering
also swaps the rows underneath without moving focus, so both tables hold a
polite live region carrying the result count.

## The dashboard (§4.4)

The mirror image of My Deliveries: that screen is one employee's deliveries,
this one is every package across every delivery, because triage happens across
the whole operation.

```mermaid
flowchart LR
  A["Dashboard<br/>every package, urgent first"] -->|"open a row"| B["/deliveries/:id<br/>?package=N&from=dashboard"]
  B --> C["That package's photo panel,<br/>already open"]
  C -->|"Back"| A
```

The dashboard is a router to the evidence, not a second photo viewer — the row
deep-links into the panel §4.2 already has. Both the package number and where
the visit came from ride in the query string, so a refresh keeps the panel open
and Back still returns to the dashboard rather than to the employee's own list.

Its stat cards are fixed: they count the whole operation and ignore the search
and filter below them.

## The manager's override (§4.4.5)

The dashboard routes to the evidence; the decision is made beside it, under the
photos on the §4.2 page.

```mermaid
flowchart TD
  A["Verdict is OPENED or INCONCLUSIVE,<br/>source is not MANUAL"] --> B["Review panel appears<br/>under the photos"]
  B --> C{"Note written?"}
  C -->|no| D["Both buttons disabled"]
  D --> C
  C -->|yes| E["אישור כתקינה"]
  C -->|yes| F["אישור כנפתחה"]
  E --> G["verdict + verdictSource=MANUAL<br/>note stored permanently"]
  F --> G
  G --> H["Panel becomes a read-only line;<br/>row leaves the review queue"]
```

Both outcomes, not one. `INCONCLUSIVE` exists because the algorithm could not
decide, so the physical check has to resolve it either way — an earlier
wireframe offered only "confirm intact", which assumed every override reverses
a false positive.

Confirming a verdict still ends the review: once a human has been through it
there is nothing left to do, whatever they concluded. A `CHECK_FAILED` package
gets no panel — there is no verdict to override, only a call to retry.
