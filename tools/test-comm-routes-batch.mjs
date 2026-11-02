#!/usr/bin/env node
/**
 * THE ROUTES HAND-OFF LANDS THE WHOLE SET, proved by running it.
 *
 * WHAT WENT WRONG. `commRoutesIngest` wrote the relay's routes one row at a
 * time through `commRoutesUpsert_`, and each of those rows cost six round
 * trips to the Sheets service: findRowIndex_ (a header read and a read of the
 * whole id column), headerOf_ again, one getValue for createdAt,
 * ensureHeader_'s own header read, and one setValues. The relay hands over
 * 465 routes an hour with a 300-second budget; measured on the live house,
 * 414 rows carried the newest stamp and the other 51 carried stamps three and
 * nine days old. The pass ran out of seconds in the same place every hour and
 * the tail of the set was never written.
 *
 * WHAT THIS ASSERTS, against the real Apps Script source, with the real
 * SheetDb helpers extracted from their own file rather than reimplemented:
 *
 *   lands     every route in the payload is on the sheet after ONE call —
 *             the whole 465, not the first 414
 *   cheap     the number of Sheets round trips does not grow with the number
 *             of rows: a set ten times bigger costs the same handful
 *   again     a second pass over the same people updates in place and appends
 *             nothing, and `createdAt` still says the day each one appeared
 *   new       somebody the house has never seen is appended, in the same pass
 *   others    a row the hand-off does not carry is NOT rewritten
 *   refuses   a row with no id is refused and counted, and the rest still land
 *
 *   node tools/test-comm-routes-batch.mjs
 *
 * Offline: the sheet is an array in memory and every Sheets call is counted.
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import vm from 'node:vm'

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const results = { ok: 0, failed: [] }
function check (name, cond, detail) {
  if (cond) { results.ok++; console.log(`ok   ${name}`) } else {
    results.failed.push(name)
    console.log(`FAIL ${name}${detail === undefined ? '' : ' — ' + String(detail).slice(0, 400)}`)
  }
}

/* ── the real helpers, sliced out of their own file ──────────────────────── */
function fnSource (text, name) {
  const at = text.indexOf(`function ${name} (`) >= 0
    ? text.indexOf(`function ${name} (`)
    : text.indexOf(`function ${name}(`)
  if (at < 0) throw new Error(`${name} is not in the source any more`)
  let depth = 0
  let i = text.indexOf('{', at)
  const start = at
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  throw new Error(`${name} does not close`)
}

const sheetDb = fs.readFileSync(path.join(ROOT, 'apps-script/SheetDb.gs'), 'utf8')
const cortex = fs.readFileSync(path.join(ROOT, 'apps-script/CommCortex.gs'), 'utf8')
const helpers = ['headerOf_', 'ensureHeader_', 'findRowIndex_', 'serialize_',
  'cellText_', 'cellPad2_'].map((n) => fnSource(sheetDb, n)).join('\n\n')

/* ── the sheet, in memory, counting every call ─────────────────────────────
 *
 * getLastRow AND getLastColumn COUNT. In real Apps Script each of them is a
 * round trip to the Sheets service, exactly like getValues; in an in-memory
 * sheet they are two lines of arithmetic, and leaving them uncounted made the
 * measured figure far too flattering — the writer calls getLastRow twice and
 * getLastColumn once on every invocation. The number that matters is not the
 * absolute one anyway: it is that the count does not grow between 465 rows
 * and 4,650. */
function makeSheet (grid) {
  const cells = grid.map((row) => row.slice())
  const calls = { reads: 0, writes: 0 }
  const width = () => cells.reduce((w, r) => Math.max(w, r.length), 0)
  const sheet = {
    getName: () => 'comm_routes',
    getParent: () => ({ getId: () => 'BOOK' }),
    getLastRow: () => {
      calls.reads++
      let last = 0
      cells.forEach((row, i) => {
        if (row.some((c) => c !== '' && c !== null && c !== undefined)) last = i + 1
      })
      return last
    },
    getLastColumn: () => { calls.reads++; return width() },
    getDataRange: () => sheet.getRange(1, 1, Math.max(cells.length, 1), Math.max(width(), 1)),
    getRange: (row, col, rows = 1, cols = 1) => ({
      getValues: () => {
        calls.reads++
        const out = []
        for (let r = row; r < row + rows; r++) {
          const line = []
          for (let c = col; c < col + cols; c++) {
            const v = (cells[r - 1] || [])[c - 1]
            line.push(v === undefined ? '' : v)
          }
          out.push(line)
        }
        return out
      },
      getValue: () => {
        calls.reads++
        const v = (cells[row - 1] || [])[col - 1]
        return v === undefined ? '' : v
      },
      setValues: (values) => {
        calls.writes++
        values.forEach((line, r) => {
          const at = row - 1 + r
          while (cells.length <= at) cells.push([])
          line.forEach((v, c) => { cells[at][col - 1 + c] = v })
        })
      }
    }),
    appendRow: (line) => { calls.writes++; cells.push(line.slice()) }
  }
  return { sheet, cells, calls }
}

function load (sheet) {
  const sandbox = {
    HUB_POLICY: {},
    HUB_ACTIONS: {},
    console,
    str_: (v) => (v === null || v === undefined ? '' : String(v)).trim(),
    hubDenied_: () => ({ status: 403 }),
    hubTabEnsure_: () => sheet,
    hubSysLog_: () => {},
    depNote_: () => {},
    deserialize_: (v) => v
  }
  vm.createContext(sandbox)
  vm.runInContext(helpers, sandbox, { filename: 'SheetDb.gs' })
  vm.runInContext(cortex, sandbox, { filename: 'CommCortex.gs' })
  return sandbox
}

const HEADER = ['id', 'createdAt', 'updatedAt', 'person_key', 'name',
  'window_from', 'window_to', 'window_why',
  'supervisor', 'supervisor_key', 'supervisor_confidence', 'source_at']

function routes (n, from = 0) {
  const out = []
  for (let i = from; i < from + n; i++) {
    out.push({
      person_key: `person${i}`,
      name: `Person ${i}`,
      window_from: 9,
      window_to: 17,
      window_why: 'their own shifts',
      supervisor: '',
      supervisor_key: '',
      supervisor_confidence: ''
    })
  }
  return out
}

/* ── the set the relay really hands over ─────────────────────────────────── */
const SET = 465
let box = makeSheet([HEADER.slice()])
let env = load(box.sheet)
let answer = env.HUB_ACTIONS.commRoutesIngest(
  { rows: routes(SET), source_at: '2020-01-01T00:00:00Z' }, { is_service: true })
const firstCalls = box.calls.reads + box.calls.writes
check('lands: the whole set is written in one pass, not the first 414',
  answer.status === 200 && answer.data.wrote === SET && box.cells.length === SET + 1,
  JSON.stringify({ answer: answer.data, rows: box.cells.length - 1 }))
check('lands: every person of the set is on the sheet, by id',
  new Set(box.cells.slice(1).map((r) => r[0])).size === SET &&
  box.cells.slice(1).every((r) => String(r[0]).startsWith('RT_')))

/* ── the cost does not grow with the set ─────────────────────────────────── */
const big = makeSheet([HEADER.slice()])
const bigEnv = load(big.sheet)
bigEnv.HUB_ACTIONS.commRoutesIngest(
  { rows: routes(SET * 10), source_at: '2020-01-01T00:00:00Z' }, { is_service: true })
const bigCalls = big.calls.reads + big.calls.writes
check('cheap: a set ten times bigger costs the same handful of Sheets calls',
  bigCalls === firstCalls && firstCalls <= 12,
  `465 rows: ${firstCalls} call(s) · 4650 rows: ${bigCalls} call(s)`)
check('cheap: the one-at-a-time path would have cost thousands',
  firstCalls * 50 < SET * 6, `${firstCalls} against about ${SET * 6}`)
/* THE MOCK ITSELF, HELD TO THE THING IT IS STANDING IN FOR. getLastRow and
   getLastColumn are round trips to the Sheets service; a mock that answered
   them for free made the figure handed to anybody reading this suite far too
   flattering. */
const probe = makeSheet([HEADER.slice(), ['RT_x']])
const before = probe.calls.reads
probe.sheet.getLastRow()
probe.sheet.getLastColumn()
check('cheap: getLastRow and getLastColumn are counted — they are round trips too',
  probe.calls.reads === before + 2, `${before} → ${probe.calls.reads}`)
check('cheap: so the measured figure is the real handful, not a flattering one',
  firstCalls >= 5, `${firstCalls} call(s) for ${SET} rows`)
console.log(`     measured: ${firstCalls} Sheets call(s) for ${SET} rows,` +
  ` ${bigCalls} for ${SET * 10} — the cost is the set's shape, not its size`)

/* ── the second pass ─────────────────────────────────────────────────────── */
const madeBefore = box.cells.slice(1).map((r) => r[HEADER.indexOf('createdAt')])
answer = env.HUB_ACTIONS.commRoutesIngest(
  { rows: routes(SET), source_at: '2020-01-02T00:00:00Z' }, { is_service: true })
const madeAfter = box.cells.slice(1).map((r) => r[HEADER.indexOf('createdAt')])
check('again: the same people are updated in place, nothing is appended',
  answer.data.wrote === SET && box.cells.length === SET + 1)
check('again: createdAt still says the day each one appeared',
  JSON.stringify(madeBefore) === JSON.stringify(madeAfter))
check('again: source_at is the stamp this pass carried',
  box.cells.slice(1).every((r) => r[HEADER.indexOf('source_at')] === '2020-01-02T00:00:00Z'))

/* ── somebody new, and somebody the hand-off does not carry ──────────────── */
box.cells.push(['RT_byhand', 'made', 'then', 'byhand', 'By Hand', '', '', '', '', '', '', ''])
const mine = box.cells[box.cells.length - 1].slice()
answer = env.HUB_ACTIONS.commRoutesIngest(
  { rows: routes(3, SET), source_at: '2020-01-03T00:00:00Z' }, { is_service: true })
check('new: somebody the house has never seen is appended',
  answer.data.wrote === 3 && box.cells.length === SET + 1 + 1 + 3)
check('others: a row this hand-off does not carry is not rewritten',
  JSON.stringify(box.cells[SET + 1]) === JSON.stringify(mine),
  JSON.stringify(box.cells[SET + 1]))

/* ── a row that proposes nothing, and a row with no person ───────────────── */
const small = makeSheet([HEADER.slice()])
const smallEnv = load(small.sheet)
answer = smallEnv.HUB_ACTIONS.commRoutesIngest({
  rows: [{ person_key: '', name: 'nobody' },
    { person_key: 'nowindow', name: 'No Window' },
    ...routes(2)],
  source_at: '2020-01-01T00:00:00Z'
}, { is_service: true })
check('refuses: a row with no person and a row proposing nothing are refused, the rest land',
  answer.data.wrote === 2 && answer.data.refused === 2 && small.cells.length === 3,
  JSON.stringify(answer.data))

/* ── ONE BAD ROW COSTS ONE ROW, NOT THE SET ──────────────────────────────
 *
 * The loop this writer replaced wrapped every upsert in its own try/catch, so
 * a row the Sheets service would not accept cost that row and the pass went
 * on. A block setValues with nothing around it would have turned that into
 * the whole hand-off landing nothing — against a brief that asks for the
 * whole set to land, a worse failure than the one being fixed. */
function poisoned (n, badId) {
  const box = makeSheet([HEADER.slice()])
  const e = load(box.sheet)
  /* a clean pass first, so the one under test writes a contiguous BLOCK */
  e.HUB_ACTIONS.commRoutesIngest(
    { rows: routes(n), source_at: '2020-01-01T00:00:00Z' }, { is_service: true })
  const real = box.sheet.getRange
  box.sheet.getRange = (row, col, rows = 1, cols = 1) => {
    const range = real(row, col, rows, cols)
    const setValues = range.setValues
    range.setValues = (values) => {
      /* any write that carries the bad row refuses — the block AND the
         single-row retry the fallback makes for it */
      if (values.some((line) => String(line[0]) === badId)) {
        throw new Error('a cell this sheet will not take')
      }
      return setValues(values)
    }
    return range
  }
  const got = e.HUB_ACTIONS.commRoutesIngest(
    { rows: routes(n), source_at: '2020-01-09T00:00:00Z' }, { is_service: true })
  return { box, got }
}

const AT = HEADER.indexOf('source_at')
const poison = poisoned(20, 'RT_person9')
check('blast: a block the sheet refuses costs ONE row, not the whole set',
  poison.got.status === 200 && poison.got.data.wrote === 19 && poison.got.data.refused === 1,
  JSON.stringify(poison.got.data))
check('blast: the nineteen carry the new pass, only the bad one is left behind',
  poison.box.cells.slice(1).filter((r) => r[AT] === '2020-01-09T00:00:00Z').length === 19 &&
  poison.box.cells.slice(1).filter((r) => String(r[0]) === 'RT_person9')
    .every((r) => r[AT] === '2020-01-01T00:00:00Z'),
  poison.box.cells.slice(1).filter((r) => r[AT] !== '2020-01-09T00:00:00Z').length)

/* and a header the sheet will not take sends the WHOLE set down the slow
   path rather than losing it */
const headless = makeSheet([[]])
const realRange = headless.sheet.getRange
let headerTries = 0
headless.sheet.getRange = (row, col, rows = 1, cols = 1) => {
  const range = realRange(row, col, rows, cols)
  const setValues = range.setValues
  range.setValues = (values) => {
    if (row === 1 && values.length === 1 && String(values[0][0]) === 'id' && headerTries++ === 0) {
      throw new Error('the header would not go')
    }
    return setValues(values)
  }
  return range
}
const headlessEnv = load(headless.sheet)
const headlessGot = headlessEnv.HUB_ACTIONS.commRoutesIngest(
  { rows: routes(4), source_at: '2020-01-01T00:00:00Z' }, { is_service: true })
check('blast: a header the sheet refuses falls back to the slow path, not to nothing',
  headlessGot.status === 200 && headlessGot.data.wrote === 4 &&
  headless.cells.filter((r) => String(r[0]).startsWith('RT_')).length === 4,
  JSON.stringify(headlessGot.data))

console.log(`\n${results.ok} ok, ${results.failed.length} failed`)
results.failed.forEach((n) => console.log('  FAILED:', n))
process.exit(results.failed.length ? 1 : 0)
