# Sub-pass 5.2 — Zotero local API push-back (D30 layer b)

Status: **DRAFT — awaiting user sign-off** (logged 2026-09-30)
Predecessor: 5.1 web-API read-in (shipped 2026-09-28). This sub-pass is the desktop-only
write-back half of `D30`.

---

## 1. What the Zotero local API actually offers (honest survey)

Zotero 7 runs an HTTP server on `http://127.0.0.1:23119` while the desktop app is open.
Two distinct protocol families live on that port, and only one of them can *write*:

### 1.1 The `/api/` mirror — READ-ONLY

`/api/users/0/items`, `/api/users/0/collections`, … mirror the web API (same JSON shapes,
no auth needed on loopback). **Zotero 7 does not implement writes on this surface** — it
exists so local tools can read the library exactly like the web API. Our 5.1 client could
be re-pointed at it for offline reads, but it cannot push.

### 1.2 The connector server — the write path

`/connector/saveItems` (and friends: `/connector/ping`, `/connector/getSelectedCollection`,
`/connector/saveSnapshot`) is the protocol the Zotero **browser connector** uses to save
items from web pages. It is a documented, stable, JSON protocol:

- `POST /connector/ping` → liveness + Zotero version (also confirms "Zotero is running").
- `POST /connector/getSelectedCollection` → the collection currently selected in the Zotero
  UI; supports saving *directly to a chosen collection id*.
- `POST /connector/saveItems` with a JSON body: `{ items: [ { itemType, title, creators:
  [{creatorType, firstName, lastName}], … }, … ], uri }` → Zotero saves the items into the
  selected (or specified) collection, dedupes by DOI/title, and shows its own "item saved"
  popup. This is exactly the "Push to Zotero" primitive we want.

This is the same mechanism the official `Zotero Integration` plugin uses — so we are on the
widest-compatibility path, not a private hack.

### 1.3 What this means for `isDesktopOnly`

The plugin stays `isDesktopOnly: false` (per `D10`). The push path is **runtime-gated**:
every push action checks platform + Zotero reachability and hides/degrades gracefully on
mobile. This matches the research doc: "Sets `isDesktopOnly: true` **for the push-back path
only** — we keep the rest of the plugin mobile-safe."

---

## 2. Proposed scope

### 2.1 `ZoteroLocalClient` (new, `src/services/integrations/zotero/zotero-local-client.ts`)

Pure service, mirrors the `ZoteroClient` pattern (settings via getter closure):

- `ping(): Promise<boolean>` — `POST /connector/ping` with a short timeout (1.5 s). No
  throw-on-offline; boolean + reason is all callers need.
- `getSelectedCollection(): Promise<{ id: string; name: string } | null>`
- `pushItems(items: ConnectorItem[], collectionId?: string): Promise<{ saved: number }>` —
  wraps `/connector/saveItems`; maps our `Paper` → connector item shape
  (title, creators, DOI, year → `date`, abstractNote, url, tags).
- All calls are loopback-only, carry no identifiers beyond the item payload, and are
  opt-in per `D30`/`D12`/`D13` disclosure rules. **No new network surface beyond
  127.0.0.1** — README disclosure needed (loopback is not a third-party endpoint, but the
  guideline-compliant move is to still name it in the privacy section).

### 2.2 Settings (`zotero` block extension)

- `enableLocalPush: boolean` (default **off**) + one paragraph of disclosure in the
  existing Zotero settings section. No keys needed — loopback requires no auth.

### 2.3 Sidebar affordance

- A **"Push to Zotero"** button on each sidebar row — visible only when: desktop platform
  AND `enableLocalPush` AND `ping()` succeeded this session. Clicking pushes that single
  paper to the collection selected in the Zotero UI (with a fallback picker if none).
- A **"Zotero offline"** degraded state: if the probe fails, the button hides and the
  settings section shows a "Zotero desktop not detected" hint. No error notices ever
  forced on the user.
- Push results surface as a small Notice (`Saved to Zotero: <collection>`), never a modal.

### 2.4 Explicitly OUT of scope (v1)

- Attachments/PDF push (connector supports snapshots; ours is link-only per `D27`).
- Bidirectional sync / incremental tracking (that's 5.3 territory, still deferred).
- Collection management (create/rename) — we push *into* existing structure.
- Mobile push of any kind.

---

## 3. Phase plan

- **5.2.A** — `ZoteroLocalClient` + settings toggle + disclosure (no UI wiring).
- **5.2.B** — sidebar row button + probe/degrade logic + push flow + notices.
- **5.2.C** — README privacy paragraph + plan.md dated entry + `versions.json`-safe gates.
- Gates per phase: tsc 0 / lint 0 / build 0; manual smoke requires the user running Zotero
  desktop alongside Obsidian.

## 4. Bundle budget

Estimated ≤ 2 KB minified (one small client + one button + CSS). Connector payloads are
hand-rolled JSON — no new dependency.

## 5. Open questions for the user

1. Push target: always the collection currently selected in the Zotero window (fast,
   zero-config), or a small picker each time, or both (picker with "use selected" default)?
2. Single-paper push only, or also a "push whole project" action in v1?
