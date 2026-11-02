/**
 * READ-YOUR-OWN-WRITE, asserted against the real module.
 *
 * WHY THIS EXISTS. `noteWrite` patches the held slice with the row that just
 * landed, and `markWritten` then marks that resource as written by this tab.
 * For a while those two did not know about each other, so the patched copy —
 * the CORRECT one — was refused, and every read after every save fell to the
 * live path: one Apps Script execution, on a backend that runs one at a time,
 * to fetch something the browser was already holding.
 *
 * The fix must do exactly one thing and no more. The marker's real job is the
 * RELOAD: memory is gone, the file on disk still predates the write, and the
 * card the person just created would vanish. So a copy off the WIRE must still
 * be refused, and only a copy this tab patched in memory may answer. A test
 * that proves the first half and not the second would bless a data-loss bug.
 *
 * HOW. The module is bundled with esbuild — the same recipe
 * tools/emit-snapshot-manifest.mjs uses — with Date.now, sessionStorage,
 * window and fetch shimmed, so time can be moved forward and the network can
 * be counted. Nothing about the decision logic is reimplemented here.
 *
 *   node tools/test-snapshot-overlay.mjs
 *
 * HUB_SNAPSHOT_CLIENT overrides the source path, so a mutation run can point
 * at a copy instead of editing the file the SPA is built from.
 */
import { build } from 'esbuild'
import { unlinkSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = process.env.HUB_SNAPSHOT_CLIENT || resolve(root, 'src/lib/snapshotClient.ts')
const tmp = resolve(root, '.snapshot-overlay-test.mjs')

/* ---------- the shims, installed before the module loads ---------------- */
let NOW = 1_000_000
const RealDate = Date
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [NOW])) }
  static now() { return NOW }
  static parse(s) { return RealDate.parse(s) }
}
const store = new Map()
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
globalThis.localStorage = globalThis.sessionStorage
globalThis.window ??= globalThis
globalThis.document ??= { addEventListener() {}, visibilityState: 'visible' }
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

const fetched = []
let builtAt = new RealDate(NOW - 5000).toISOString()
let fileRows = [{ id: '1', status: 'open' }]
/**
 * The index must name every resource the test reads, or readSlice never even
 * reaches the decision under test — it stops at "not in the index" and answers
 * null, which looks exactly like a correct refusal. Three mutations survived
 * behind that mistake, including one that served a derivation's stale count.
 */
const INDEXED = ['reminders', 'candidates', 'hiringAnalysis']
globalThis.fetch = async (url) => {
  fetched.push(String(url))
  const hdr = { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) }
  if (String(url).endsWith('/index.json')) {
    const slices = {}
    for (const r of INDEXED) slices[r] = { built_at: builtAt, rows: fileRows.length }
    return { ok: true, headers: hdr, json: async () => ({ slices }) }
  }
  return {
    ok: true, headers: hdr,
    json: async () => ({ built_at: builtAt, source_at: builtAt, rows: JSON.parse(JSON.stringify(fileRows)) }),
  }
}

await build({
  entryPoints: [entry],
  bundle: true, format: 'esm', platform: 'node', outfile: tmp, logLevel: 'error',
  define: { 'import.meta.env.DEV': 'false' },
  alias: { '@': resolve(root, 'src') },
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.jpg': 'empty' },
  external: ['react', 'react-dom', 'react-router', 'framer-motion', 'lucide-react', 'recharts'],
})
const m = await import(pathToFileURL(tmp).href)
unlinkSync(tmp)

let fails = 0
const chk = (label, cond, detail = '') => {
  console.log((cond ? '  OK    ' : '  FAIL  ') + label + (cond ? '' : `\n          ${detail}`))
  if (!cond) fails++
}
const wireReads = () => fetched.filter((u) => u.includes('reminders.json')).length

console.log('\nAFTER A SAVE — the copy that carries the write may answer')

let rows = await m.readSlice('reminders')
chk('a cold read serves the rows from the file',
    Array.isArray(rows) && rows[0].status === 'open', JSON.stringify(rows))

NOW += 1000
m.noteWrite('reminders', { id: '1', row: { id: '1', status: 'done' } })

NOW += 1000
const before = wireReads()
rows = await m.readSlice('reminders')
chk('the read after the save serves the NEW value, not null',
    Array.isArray(rows) && rows[0].status === 'done',
    `got ${JSON.stringify(rows)} — null here is what sends the caller to the live path`)
chk('and it does not go back to the wire for it',
    wireReads() === before, `${wireReads() - before} extra fetch(es)`)

const floor = await m.readSliceFloor('reminders')
chk('the floor serves the patched copy too',
    !!floor && floor.rows[0].status === 'done', JSON.stringify(floor))

console.log('\nTHE GUARD THAT MUST SURVIVE — the reload case')

NOW += 61_000
rows = await m.readSlice('reminders')
chk('a copy off the WIRE that predates the write is still REFUSED',
    rows === null,
    'this is the reload: memory is gone and the file is older than the save — ' +
    'serving it makes the card the person just created vanish')

/* THE CASE THAT SEPARATES "MY PATCH" FROM "A COPY THAT ARRIVED".
 *
 * After the refusal above, the tab is HOLDING the copy it just fetched off the
 * wire — and `fetchedAt` is now, so the next read within sixty seconds takes
 * the held branch instead of refetching. That held copy still predates the
 * write, and it is NOT patched. It must still be refused.
 *
 * This is the scenario three separate mutations survived without: making
 * carriesOwnWrites always true, making storeSlice forget to clear the patch
 * mark, and dropping the `!fresh` guard. Each of them serves the person the
 * state from before their own save, and every earlier assertion here passed
 * anyway. */
NOW += 1000
rows = await m.readSlice('reminders')
chk('and the held WIRE copy is refused again on the next read, not served',
    rows === null,
    `got ${JSON.stringify(rows)} — this copy came off the wire; only a copy this ` +
    'tab patched in memory may answer for a write')

console.log('\nAND THE MARKER STILL CLEARS ITSELF')

builtAt = new RealDate(NOW).toISOString()
fileRows = [{ id: '1', status: 'done' }]
NOW += 61_000
rows = await m.readSlice('reminders')
chk('once a build newer than the write lands, the file serves again',
    Array.isArray(rows) && rows[0].status === 'done', JSON.stringify(rows))
chk('and the marker is gone — the tab is not pinned to the slow path',
    !JSON.parse(store.get('asa-slice-writes-v1') || '{}').reminders,
    store.get('asa-slice-writes-v1') || '{}')

console.log('\nWHAT A PATCH DOES NOT COVER')

/* A write we cannot describe drops the slice — and must NOT leave a patch mark
 * behind. If it did, the refetched file (which predates the write) would be
 * served as though it carried it, and the person would see the state from
 * before their own save. The honest answer is null: go live.
 *
 * This assertion was written the other way round first, expecting rows back,
 * and the test failed. The test was wrong: `noteWrite` with nothing it can
 * describe says so in its own comment — "we stop claiming to know". */
NOW += 1000
m.noteWrite('reminders', {})
NOW += 1000
rows = await m.readSlice('reminders')
chk('a write it cannot describe refuses the file rather than pretending',
    rows === null,
    `got ${JSON.stringify(rows)} — serving a file older than the write shows the ` +
    'state from before the person saved')

/* And the derivation of a patched resource is DROPPED, never patched: its rows
 * are counts, and a count cannot be patched with the row that changed. Marking
 * it written is not enough — the held copy must stop answering, or the funnel
 * keeps the old number while the board shows the new stage. */
builtAt = new RealDate(NOW).toISOString()
fileRows = [{ id: 'c1', stage: 'new' }]
NOW += 1000
await m.readSlice('hiringAnalysis')          // the tab now HOLDS a derivation
NOW += 1000
m.noteWrite('candidates', { id: 'c1', row: { id: 'c1', stage: 'hired' } })
chk('writing a source marks its derivation written too',
    !!JSON.parse(store.get('asa-slice-writes-v1') || '{}').hiringAnalysis,
    'hiringAnalysis must be marked written when candidates is')
NOW += 1000
rows = await m.readSlice('hiringAnalysis')
chk('and the derivation stops answering from the copy it held',
    rows === null,
    `got ${JSON.stringify(rows)} — a count cannot be patched with the row that ` +
    'changed, so the held copy must be dropped, not marked')

console.log(`\nsnapshot overlay: ${fails} failed\n`)
process.exit(fails ? 1 : 0)
