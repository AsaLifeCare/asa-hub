# ASA Hub — Apps Script Backend (`apps-script/`)

The Google Apps Script web-app backend for **ASA Hub**, the modular SPA work
platform. One file (`Code.gs`) turns a Google Spreadsheet into a JSON API
("SheetDB") that the frontend's `apps-script` API driver talks to.

Pure Apps Script (V8) — no external libraries, no npm, nothing to build.

## Architecture

- **Routing** — everything is one endpoint:
  - `GET {exec}?resource=…&action=…&id=…&limit=…&offset=…&q=…`
  - `POST {exec}` with body `{ "resource": …, "action": …, "payload": { … } }`
  - `doGet`/`doPost` normalize the input and call `route(resource, action, payload)`,
    a plain `switch`. Unknown resource → `404`, unknown action → `400`.
- **Envelope** — every response is JSON with the same shape:
  - success: `{ "status": 200, "data": … }`
  - error: `{ "status": 4xx | 5xx, "message": "…" }`
  - The router is wrapped in try/catch, so even an unexpected exception comes
    back as a parseable `500` envelope, never an HTML error page.
- **SheetDB** — one spreadsheet, one tab per resource, header row = field
  names. Generic helpers `readAll_`, `createRow_`, `updateRowById_`,
  `deleteRowById_` work for every resource. IDs are `Utilities.getUuid()` on
  create; `createdAt`/`updatedAt` are ISO timestamps. New payload fields are
  appended to the header automatically; arrays/objects are stored as JSON
  strings and parsed back on read.
- **Resources** — `people`, `candidates`, `documents`, `videos`, `events`,
  `notifications`, `apps`, `activity`, `questionnaireResponses` (consolidated
  questionnaire answers pushed from the frontend's "Send to backend", feeding
  the onboarding pipeline; tab is created on first write), `potentialClients`
  (referrals & prospects pipeline rows pushed from the "Potential Clients"
  app; tab is created on first write).
  - Actions: `list` (supports `limit`, `offset`, `q` — case-insensitive
    substring search across all fields), `get`, `create`, `update`, `delete`.
  - `apps` and `notifications` are **read/update-only**: `create`/`delete`
    return `405`.

## How apps connect

The platform can run MANY apps against the SAME backend — one deployed `/exec`
URL serves every app. The contract per app:

1. **Deploy once** — publish `Code.gs` as a web app (see [Deploy](#deploy));
   you get exactly one `/exec` URL for the whole platform.
2. **Paste once** — ASA Hub → **Settings → Backend sync** (`#backendsync`).
   Every app reads the URL from the persisted sync store; nothing else to
   configure per app.
3. **Apps POST one envelope** —
   `POST {exec}` with body `{ "resource": "<name>", "action": "create", "payload": { … } }`.
   Reads use GET with query params (`?resource=…&action=list|get`); writes
   (`create` / `update` / `delete`) use POST. Each resource lands in its OWN
   Google Sheet tab, auto-created on first write — the header row grows to
   match whatever fields the payload carries.
4. **Register a new resource** — add ONE line to `RESOURCES` in `Code.gs`
   (mirror the existing entries):
   ```js
   myResource: { sheet: 'myResource', readOnly: false }
   ```
   then push a **new deployment version**. The frontend helper
   `src/lib/backendApi.ts` (`postToBackend(resource, action, payload)` /
   `testConnection(resource)`) works for any registered resource immediately.
   Registered today: `questionnaireResponses`, `potentialClients` (+ the
   seeded core resources above). The "Potential Clients" app
   (`/app/potential-clients/pipeline`) demonstrates the full loop with a live
   Test-connection probe and a Demo POST button.

## Deploy

### Option A — clasp (CLI)

```bash
npm install -g @google/clasp
clasp login
clasp create --type standalone --title "ASA Hub API"
# place Code.gs and appsscript.json in the project folder, then:
clasp push
clasp open            # run seed() once from the editor (see below)
clasp deploy          # or deploy from the editor UI for full control
```

### Option B — manual copy/paste

1. Go to <https://script.google.com> → **New project**.
2. Paste `Code.gs` into the editor.
3. Project Settings → enable **Show "appsscript.json" manifest file**, then
   paste `appsscript.json` (manifest also editable via `clasp push`).
4. **Run `seed()`** once from the editor toolbar (▶ → authorize). It creates
   the spreadsheet, all tabs and the demo dataset, and logs the spreadsheet
   URL. (Re-running `seed()` replaces all data.)
5. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Note: some Google Workspace domains block `ANYONE` in the manifest/UI by
     admin policy — in that case deploy via the editor UI and pick the widest
     access your domain allows.
6. Copy the **`/exec` URL**.

> **Every code change requires a new deployment version**
> (Deploy → Manage deployments → ✎ → Version: *New version*). The `/exec` URL
> stays the same but keeps serving the old code otherwise.

## Connect the frontend

ASA Hub → **Settings → API** → paste the `/exec` URL (stored in
`localStorage("asa-api-url")`). The app switches its API driver from `mock`
(default, in-memory demo data) to `apps-script` automatically. `seed()` writes
the same dataset as the mock driver (48 people, 23 candidates, 9 documents,
12 videos, 19 events, 14 notifications, 8 apps, 12 activity rows), so live
mode matches demo mode.

## Endpoint examples

```
# List with pagination + search
GET {exec}?resource=people&action=list&limit=12&offset=0&q=maya

# Get one record
GET {exec}?resource=people&action=get&id=p-01

# Create
POST {exec}
{ "resource": "people", "action": "create",
  "payload": { "name": "Ada Lovelace", "role": "Engineer", "department": "Engineering" } }

# Update (merge by id; also how notifications are marked read / apps toggled)
POST {exec}
{ "resource": "notifications", "action": "update", "payload": { "id": "n-01", "read": true } }

# Delete
POST {exec}
{ "resource": "candidates", "action": "delete", "payload": { "id": "c-09" } }
```

## CORS — why the frontend posts `text/plain`

Apps Script web apps **cannot answer CORS preflight (OPTIONS) requests** —
`doGet`/`doPost` are the only routed entry points, and a `doOptions` handler
would be ignored. The frontend therefore only sends CORS *simple requests*:

- `GET` with query params, and
- `POST` with `Content-Type: text/plain;charset=utf-8` (the JSON body as plain
  text — `doPost` parses it with `JSON.parse(e.postData.contents)`).

Simple requests skip the preflight entirely, and browsers follow Apps Script's
302 redirect to the `googleusercontent.com` content host without complaint.
That is the whole trick; do not "fix" the content type to `application/json`.

## Files

| File | Purpose |
|---|---|
| `Code.gs` | Entire backend: routing, envelope, SheetDB layer, `seed()`, deploy notes |
| `appsscript.json` | Manifest: V8, `America/New_York` (Sao_Paulo until 2026-08-15), Stackdriver logging, webapp `ANYONE`/`USER_DEPLOYING` |
| `README.md` | This file |

Dev helper: after seeding, run `whereIsMyData()` from the editor to print the
spreadsheet URL and per-tab row counts.
