# The JSON deposit

One file per place, holding every routed tab as **that place** sees it. This is
the read path the operator asked for on 2026-08-18:

> a intranet funciona a partir de jsons com todas as sheets dentro … um json
> gigante com todas as sheets é gerado, e zipado no drive, e é ingerido pela
> plataforma … a cada 5 minutos a pasta é limpa e fica só o último json.

**Why the folder lives here, beside `src/` and `server/` and `apps-script/`**
(operator, 2026-08-19: *"pasta self-contained → qualquer lugar que eu levar o
projeto tudo vai junto"*): the deposit used to exist only in Drive and in a
sibling project's directory, so the platform's own read path was a thing you
had to remember to bring. Now it travels with the project.

## What is in here

```
bundles/
  home.json                 headquarters
  <tenant-id>.json          one per active place
  README.md                 this file
```

The relay's app packs (the private and Drive-only parts one Apps Script
execution gathers per house or client) are **never** kept here. This folder is
under `/opt/docker`, which a host file server exposes and several other
containers mount read-write, so nothing private may rest in it. The packs rest
in a volume of the relay's own (`HUB_APP_PACK_DIR`, `/srv/app-packs` by
default, used only once it is mounted). The relay refuses any pack folder that
is this deposit or lies under it, or under the served snapshot tree.

Each file is the answer `route()` would have given that place, for every
routed resource, at the moment it was built:

```json
{ "place": "…", "built_at": "…", "db_last_updated": "…",
  "unreadable": [], "revs": { "<workbook id>::<tab>": "<rows>:<length>:<md5>" },
  "resources": { "people": [ … ], "events": [ … ] } }
```

`revs` is what the next build is told it already has, so it can skip whatever
has not moved. Two kinds of key live in it, and only the first names a tab:

* `<workbook id>::<tab>` — the tab's fingerprint, `<rows>:<length of the last
  row>:<md5 of it>`, or `empty`, `absent`, `error`. Never `error` as an answer:
  it means *we could not look*, which is never *unchanged*.
* `<workbook id>::[book]` — the **workbook's** own Drive `lastUpdated`, taken
  before any of its tabs are asked about. When it has not moved, none of that
  book's tabs can have moved either, and the build skips the questions
  entirely. Square brackets are illegal in a sheet name, so this key can never
  collide with a tab somebody invents. A place split into parts keys it
  `[book]#0`, `[book]#1`, … — a stamp may only vouch for fingerprints taken
  after it, in the same execution.

## The laws it is built under

1. **It is a MIRROR, never a home.** The sheet stays the truth. Nothing decides
   anything from a bundle; deleting this whole folder costs one rebuild.
2. **The place is narrowed at BUILD time.** A franchise's file does not contain
   headquarters' rows — there is no filter downstream to forget.
3. **The newest is written whole before the previous one goes.** A crashed
   build leaves the last good file standing, never half of a new one.
4. **Identity is excluded by construction.** Only the routed `RESOURCES` tabs
   are bundled, so the users tab with its salts and password hashes, and the
   sessions tab, cannot be here. A bundle is a file that gets copied around.

## Why the payloads are not committed

They are regenerated on a short clock and the headquarters file alone is over
5MB, so committing them would add a multi-megabyte churn every cycle to a
repository — and law 1 says the copy is worthless the moment the sheet moves.
The FOLDER travels with the project; the contents rebuild themselves.
