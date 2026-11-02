#!/usr/bin/env node
/**
 * THE TWO HALVES OF THE LANES DOOR, FACING EACH OTHER.
 *
 * WHY THIS EXISTS. GET /hub-lanes/hotline/lanes shipped with the relay keying
 * its three lanes `calloffs` / `queue` / `incidents` and the Hotline screen
 * asking for `callOffs` / `supportQueue` / `uiIncidents`. Both halves were
 * green: the relay's suite asserted the relay's names, the SPA's build
 * asserted the SPA's, and the screen would have gone to production with three
 * lanes that could never be read — Call Offs, the Employee Support Queue and
 * Incidents all empty, with a sentence beside them. Nothing in the repository
 * asked the two halves the same question, which is the only question that
 * matters here.
 *
 * WHAT IS ASSERTED, and each half comes from the real thing:
 *
 *   THE DOOR'S HALF is tools/hotline-lanes-door.json — three answers built by
 *     server/hotline_lanes.py itself, run inside the relay's container against
 *     fake books (tools/emit-hotline-lanes-door.py). Nothing about the answer
 *     is typed here.
 *   THE SCREEN'S HALF is the reader the screen actually uses: hotlineApi.ts
 *     and vocabulary.ts, bundled with esbuild and run — the same recipe
 *     tools/test-snapshot-overlay.mjs uses. Nothing about the reading is
 *     reimplemented here.
 *   THE DECLARATION is read from server/hotline_lanes.py on every run, so the
 *     dump can never answer for a module that has since moved: a lane renamed
 *     or a column added there and not regenerated here is REFUSED as stale.
 *
 *   names    the lane keys the module declares, the keys the answer carries
 *            and the keys the screen asks for are ONE list
 *   health   every word the screen's reader reads off a lane — ok, stale,
 *            error, rows, count, at, read_at — is a word the door writes, and
 *            the three states are read as the door meant them: read / a copy
 *            after a failed re-read / never read
 *   stamp    a lane's `at` is the read the door named, and a copy is dated by
 *            the read the COPY came from, never by the read that failed
 *   cells    every cell the screen prints is a column the door may send, and
 *            every row carries the id the panel keys it by
 *   ?since   the answer to a version the door already holds keeps the rows on
 *            screen instead of blanking the lane
 *   it bites the same answer re-keyed the way round 1 keyed it is read as
 *            three unreadable lanes — the regression this file exists for,
 *            reproduced on every run rather than promised
 *
 *   node tools/test-hotline-lanes-contract.mjs
 *   node tools/test-hotline-lanes-contract.mjs --as-round1   (see it go red)
 *
 * Offline and in a second: the dump is a file. Rebuild it with
 * `npm run lanes:door` after changing what the door sends.
 */
import { build } from 'esbuild'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MODULE = 'server/hotline_lanes.py'
const DUMP = 'tools/hotline-lanes-door.json'
const READER = 'src/pages/features/smartcomms/hotline/hotlineApi.ts'
const WORDS = 'src/pages/features/smartcomms/hotline/vocabulary.ts'
const tmp = resolve(root, '.hotline-lanes-contract.mjs')

/** The names round 1 shipped, kept only to re-key an answer back onto them. */
const ROUND1 = { callOffs: 'calloffs', supportQueue: 'queue', uiIncidents: 'incidents' }
const asRound1 = process.argv.includes('--as-round1')

let failures = 0
const check = (name, ok, got) => {
  if (ok) {
    console.log(`   ok   ${name}`)
    return true
  }
  failures += 1
  console.log(`   FAIL ${name}${got === undefined ? '' : ` — ${JSON.stringify(got)}`}`)
  return false
}
const stop = (sentence) => {
  console.log(`\n${sentence}`)
  process.exit(1)
}
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

/* ------------------------------------------------------------------ */
/* the door's half: what the module declares, read from the module     */
/* ------------------------------------------------------------------ */

/**
 * The lanes as server/hotline_lanes.py declares them — its LANES tuple, read
 * rather than remembered. tools/check-relay-contract.mjs opens `server/` the
 * same way and for the same reason: a contract nobody reads from both sides
 * is a contract that drifts.
 */
function declaredLanes(src) {
  const at = src.indexOf('LANES: tuple[Lane, ...] = (')
  if (at < 0) return null
  const end = src.indexOf('\n)\n', at)
  if (end < 0) return null
  const block = src.slice(at, end)
  const chunks = block.split(/^\s{4}Lane\(/m).slice(1)
  const lanes = {}
  for (const chunk of chunks) {
    const key = chunk.match(/^\s*"([A-Za-z0-9_]+)"/)
    // the fields map is the one brace group that maps a key to a header cell;
    // a lane's `dates` is a frozenset of bare names and has no colon in it
    const fields = chunk.match(/\{[^{}]*:[^{}]*\}/s)
    if (!key || !fields) return null
    lanes[key[1]] = [...fields[0].matchAll(/"([A-Za-z0-9_]+)"\s*:/g)].map((m) => m[1])
  }
  return Object.keys(lanes).length ? lanes : null
}

/** Every key the module writes into a payload — `"read_at":` and its kin. */
const declaredWords = (src) => new Set([...src.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]))

/* ------------------------------------------------------------------ */
/* the screen's half: what its reader reads, read from the reader      */
/* ------------------------------------------------------------------ */

function bodyOf(src, head) {
  const at = src.indexOf(head)
  if (at < 0) return ''
  const end = src.indexOf('\n}', at)
  return end < 0 ? '' : src.slice(at, end)
}

/**
 * The words the screen's reader takes off a lane and off the envelope, read
 * from readLane and readHotlineLanes themselves (`l.ok`, `d?.version`). Said
 * here by hand they would be a third copy of the contract, and a third copy is
 * how the first two drifted.
 */
function readerWords(src) {
  const lane = bodyOf(src, 'function readLane(')
  const answer = bodyOf(src, 'export async function readHotlineLanes(')
  if (!lane || !answer) return null
  const off = (body, held) =>
    new Set([...body.matchAll(new RegExp(`\\b${held}\\??\\.([a-z_]+)`, 'g'))].map((m) => m[1]))
  const laneWords = off(lane, 'l')
  const answerWords = off(answer, 'd')
  return laneWords.size && answerWords.size ? { laneWords, answerWords } : null
}

/* ------------------------------------------------------------------ */
/* the pieces                                                          */
/* ------------------------------------------------------------------ */

for (const rel of [MODULE, DUMP, READER, WORDS]) {
  if (!existsSync(resolve(root, rel))) {
    stop(`${rel} is not in this tree — the two halves of the lanes door ship together.`)
  }
}
const moduleSrc = readFileSync(resolve(root, MODULE), 'utf8')
const dump = JSON.parse(readFileSync(resolve(root, DUMP), 'utf8'))
for (const answer of ['full', 'unchanged', 'degraded']) {
  if (!dump.answers?.[answer]?.lanes) stop(`${DUMP} carries no \`${answer}\` answer. Rebuild it: npm run lanes:door`)
}
const declared = declaredLanes(moduleSrc)
if (!declared) stop(`the LANES declaration in ${MODULE} could not be read — teach this check its new shape.`)
const reader = readerWords(readFileSync(resolve(root, READER), 'utf8'))
if (!reader) stop(`readLane / readHotlineLanes in ${READER} could not be read — teach this check their new shape.`)

/* IS THE DUMP STILL THIS MODULE'S ANSWER? The digest only tells the reader
 * that the module moved; what makes the dump WRONG is the contract moving,
 * so that is what refuses it. */
const digest = createHash('sha256').update(moduleSrc).digest('hex')
const surface = dump.surface || {}
const renamed = !same(Object.keys(declared), surface.lane_keys || [])
const recolumned = Object.keys(declared).filter((k) => !same(declared[k], (surface.fields || {})[k] || []))
if (renamed || recolumned.length) {
  if (renamed) {
    console.log(`   the module declares: ${Object.keys(declared).join(', ')}`)
    console.log(`   the dump was built from: ${(surface.lane_keys || []).join(', ')}`)
  }
  // a lane whose NAME moved has every column "missing" too: only the name is news
  for (const key of renamed ? [] : recolumned) {
    const was = (surface.fields || {})[key] || []
    const moved = [...declared[key].filter((c) => !was.includes(c)).map((c) => `+${c}`),
      ...was.filter((c) => !declared[key].includes(c)).map((c) => `-${c}`)]
    console.log(`   ${key} columns: ${moved.join(', ')}`)
  }
  stop(`${DUMP} is stale — ${MODULE} has moved under it. Rebuild it: npm run lanes:door`)
}
if (digest !== dump.module?.sha256) {
  console.log(`   (${MODULE} has changed since the dump was built; the lanes it declares have not)`)
}

/* ------------------------------------------------------------------ */
/* the screen's reader, bundled and run                                */
/* ------------------------------------------------------------------ */

await build({
  stdin: {
    contents: [
      `export { LANE_KEYS, readHotlineLanes } from '${resolve(root, READER)}'`,
      `export { LANE_DOOR_KEY, LANE_FIELDS, SHEET_LANES } from '${resolve(root, WORDS)}'`,
    ].join('\n'),
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: tmp,
  logLevel: 'error',
  alias: { '@': resolve(root, 'src') },
  plugins: [{
    // the person is not what is under test: the reader only asks the store for
    // a token to put on the request
    name: 'stub-auth',
    setup(b) {
      b.onResolve({ filter: /useAuthStore$/ }, (a) => ({ path: a.path, namespace: 'stub' }))
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: "export const useAuthStore = { getState: () => ({ token: 't' }) }",
        loader: 'js',
      }))
    },
  }],
})

globalThis.window ??= globalThis
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }

/** The door, answering exactly what the real module built. */
let answering = null
const asked = []
globalThis.fetch = async (path) => {
  asked.push(String(path))
  return { status: 200, json: async () => ({ status: 200, data: answering }) }
}

const screen = await import(pathToFileURL(tmp).href)
try { unlinkSync(tmp) } catch { /* the bundle is scratch */ }

/** The same answer keyed the way round 1 keyed it — the negative control. */
const reKey = (answer) => ({
  ...answer,
  lanes: Object.fromEntries(
    Object.entries(answer.lanes).map(([k, lane]) => [ROUND1[k] ?? k, lane]),
  ),
})
const answers = asRound1
  ? Object.fromEntries(Object.entries(dump.answers).map(([k, a]) => [k, reKey(a)]))
  : dump.answers
if (asRound1) console.log('\n(the door’s answer re-keyed onto its round-1 names — this run is MEANT to fail)')

const read = async (answer, since = '') => {
  answering = answer
  return screen.readHotlineLanes(since)
}

/* ------------------------------------------------------------------ */
/* THE NAMES                                                           */
/* ------------------------------------------------------------------ */
console.log('\nONE LIST OF LANES, OR THREE LANES THAT CAN NEVER BE READ')
const declaredKeys = asRound1 ? Object.keys(declared).map((k) => ROUND1[k] ?? k) : Object.keys(declared)
const answered = Object.keys(answers.full.lanes)
const asksFor = [...screen.LANE_KEYS]
console.log(`   ${MODULE} declares: ${declaredKeys.join(', ')}`)
console.log(`   the door answers:  ${answered.join(', ')}`)
console.log(`   the screen asks:   ${asksFor.join(', ')}`)
check('the door answers the lanes the module declares', same(declaredKeys, answered),
  { declared: declaredKeys, answered })
check('the screen asks for the lanes the door answers', same(asksFor, answered),
  { screen: asksFor, door: answered })
check('every tab of the screen maps onto one of the names it asks for, and no two onto the same one',
  same(Object.values(screen.LANE_DOOR_KEY), asksFor)
  && screen.SHEET_LANES.every((id) => asksFor.includes(screen.LANE_DOOR_KEY[id])),
  screen.LANE_DOOR_KEY)

/* ------------------------------------------------------------------ */
/* THE WORDS                                                           */
/* ------------------------------------------------------------------ */
console.log('\nTHE WORDS THE SCREEN READS ARE THE WORDS THE DOOR WRITES')
const words = declaredWords(moduleSrc)
const laneSent = new Set(surface.lane_words || [])
const answerSent = new Set(surface.answer_words || [])
for (const word of reader.laneWords) {
  check(`a lane's \`${word}\` is a word the door writes`, words.has(word) && laneSent.has(word),
    { inTheModule: words.has(word), inTheAnswer: laneSent.has(word) })
}
for (const word of reader.answerWords) {
  check(`the answer's \`${word}\` is a word the door writes`, words.has(word) && answerSent.has(word),
    { inTheModule: words.has(word), inTheAnswer: answerSent.has(word) })
}

/* ------------------------------------------------------------------ */
/* THE WHOLE ANSWER, READ BY THE SCREEN                                */
/* ------------------------------------------------------------------ */
console.log('\nTHE ANSWER, READ BY THE SCREEN THAT WILL READ IT')
const full = await read(answers.full)
check('the door answer is read as an answer', full.ok === true, full.ok ? '' : full)
if (full.ok) {
  check('the version rides with it', !!full.data.version, full.data.version)
  check('a full answer is not an unchanged one', full.data.unchanged === false, full.data.unchanged)
  for (const key of screen.LANE_KEYS) {
    const book = full.data.lanes[key]
    console.log(`   ${key}: state=${book.health.state} rows=${book.rows === null ? 'null' : book.rows.length} at="${book.at}"`)
    check(`${key} arrives readable, with its rows`,
      book.health.state === 'ok' && (book.rows?.length ?? 0) > 0,
      { state: book.health.state, why: book.health.why })
    const sent = answers.full.lanes[key]
    check(`${key} is dated by the read the door named`,
      !!book.at && Number.isFinite(Date.parse(book.at)) && book.at === sent?.read_at,
      { screen: book.at, door: sent?.read_at })
  }
  for (const laneId of screen.SHEET_LANES) {
    const key = screen.LANE_DOOR_KEY[laneId]
    const row = full.data.lanes[key].rows?.[0] ?? {}
    const may = surface.fields[asRound1 ? Object.keys(ROUND1).find((k) => ROUND1[k] === key) ?? key : key] ?? []
    const printed = screen.LANE_FIELDS[laneId].map((f) => f.key)
    check(`every cell the ${laneId} tab prints is a column the door may send`,
      printed.every((k) => may.includes(k)), printed.filter((k) => !may.includes(k)))
    check(`every cell the ${laneId} tab prints is on the rows it sent`,
      printed.every((k) => k in row), printed.filter((k) => !(k in row)))
    check(`${laneId} rows carry the id the panel keys them by`, 'id' in row, Object.keys(row))
  }
}

/* ------------------------------------------------------------------ */
/* THE THREE HEALTH WORDS                                              */
/* ------------------------------------------------------------------ */
console.log('\nA LANE IS READ, A COPY, OR NOTHING — NEVER A COPY DRAWN AS CURRENT')
const degraded = await read(answers.degraded)
check('a degraded answer is still an answer', degraded.ok === true, degraded.ok ? '' : degraded)
if (degraded.ok) {
  for (const key of screen.LANE_KEYS) {
    const sent = answers.degraded.lanes[key]
    const book = degraded.data.lanes[key]
    if (!sent) {
      check(`the door sent a ${key} lane at all`, false, Object.keys(answers.degraded.lanes))
      continue
    }
    const meant = sent.rows === null ? 'unreadable' : (sent.ok === false || sent.stale === true) ? 'stale' : 'ok'
    console.log(`   ${key}: door ok=${sent.ok} stale=${sent.stale} rows=${sent.rows === null ? 'null' : sent.rows.length} → screen ${book.health.state}`)
    check(`the lane the door sent as ${meant} is read as ${meant}`, book.health.state === meant,
      { state: book.health.state, why: book.health.why })
    if (meant !== 'ok') {
      check(`and it says why, in the door's own sentence`, book.health.why === sent.error,
        { screen: book.health.why, door: sent.error })
    }
    if (meant === 'stale') {
      check('a copy keeps its rows and is dated by the read the copy came from',
        (book.rows?.length ?? 0) > 0 && book.at === sent.read_at, { at: book.at, door: sent.read_at })
    }
  }
}

/* ------------------------------------------------------------------ */
/* THE ANSWER TO A ?since THE DOOR ALREADY HOLDS                       */
/* ------------------------------------------------------------------ */
console.log('\nTHE NEWS WITHOUT THE WEIGHT')
asked.length = 0
const held = await read(answers.unchanged, 'the-version-on-screen')
check('the screen names the version it holds', asked.some((p) => p.includes('since=the-version-on-screen')), asked)
check('an unchanged answer is an answer, not a failure', held.ok === true, held.ok ? '' : held)
if (held.ok) {
  check('it says it is one', held.data.unchanged === true, held.data.unchanged)
  for (const key of screen.LANE_KEYS) {
    const book = held.data.lanes[key]
    check(`${key} is kept, not blanked`, book.rows === null && book.health.state === 'ok',
      { rows: book.rows, state: book.health.state, why: book.health.why })
  }
}

/* ------------------------------------------------------------------ */
/* AND IT BITES                                                        */
/* ------------------------------------------------------------------ */
if (!asRound1) {
  console.log('\nTHE SAME ANSWER, KEYED THE WAY ROUND 1 KEYED IT')
  const renamed = await read(reKey(answers.full))
  const states = screen.LANE_KEYS.map((k) => renamed.ok ? renamed.data.lanes[k].health.state : 'refused')
  console.log(`   ${Object.keys(reKey(answers.full).lanes).join(', ')} → ${states.join(', ')}`)
  check('a renamed lane is unreadable to this screen, never a quietly empty one',
    renamed.ok === true && states.every((s) => s === 'unreadable'), states)
  check('and this check can see it', !same(Object.keys(reKey(answers.full).lanes), asksFor))
}

console.log(`\n${failures ? `${failures} failure(s) — the two halves of the lanes door do not agree`
  : 'the two halves of the lanes door agree'}`)
process.exit(failures ? 1 : 0)
