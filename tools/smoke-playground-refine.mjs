#!/usr/bin/env node
/**
 * SMOKE TEST — the playground draft refiner (src/pages/features/playground/refine.ts).
 *
 * Standalone on purpose: NOT wired into `npm run check` (that suite is another
 * agent's surface). Bundles refine.ts + its imports with the project's esbuild
 * (the `@/` alias resolved to src/) and asserts the guarantees the module
 * makes: standard sizes, keys that agree, values in the right shape, semantic
 * tints, the finishing pieces, and idempotence.
 *
 *   node tools/smoke-playground-refine.mjs
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const esbuild = require('esbuild')

let passed = 0
let failed = 0
const ok = (cond, name) => {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`  FAIL ${name}`)
  }
}

/* ------------------------------ the fixture ------------------------------ */

/** The messiest draft a weak model would plausibly answer with. */
const MESSY = {
  name: 'Fleet Tracker',
  tagline: 'Vans and repairs.',
  icon: 'truck',
  accent: 'ultraviolet', // not a tint
  category: 'Operations',
  pages: [
    {
      id: 'main',
      type: 'sheet',
      title: 'Vehicles',
      config: {
        columns: [
          { key: 'name', label: 'Vehicle', kind: 'text' },
          { key: 'status', label: 'Status', kind: 'chip' }, // no tintBy
          { key: 'due', label: 'Due', kind: 'date' },
          { key: 'done', label: 'Progress', kind: 'progress' },
          { key: 'miles', label: 'Miles', kind: 'number' },
          { key: 'ghost', label: 'Ghost', kind: 'text' }, // no row carries it
          { key: 'weird', label: 'Weird', kind: 'sparkle' }, // unknown kind
        ],
        futureOption: { keep: 'me' }, // unknown key — must survive byte-identical
      },
      rows: [
        { id: 'a', name: 'Van 1', status: 'Active', due: 'next Friday', done: 72, miles: '12,300', driver: 'Sam' },
        { id: 'a', name: 'Van 2', status: 'In shop', due: '2026-09-01', done: 0.4, miles: 8300, driver: 'Jo' },
        { id: 'b', name: 'Van 3', status: 'Retired', due: 'Mar 4, 2026', done: 100, miles: '$9,999', driver: 'Pat' },
        { id: 'z', name: '{clientes.total}', status: 'Active', due: '2026-08-01', done: 0.5, miles: 100, driver: 'Lee' },
      ],
    },
    {
      id: 'tasks',
      type: 'board',
      title: 'Tasks',
      config: {
        stages: [{ id: 'todo', label: 'To do' }], // < 2 stages
        cardFields: { title: 'phantom', subtitle: 'nope', tags: { key: 'priority' }, meta: ['ghost'] },
      },
      rows: [
        { id: 'c1', title: 'Fix gate', column: 'doing', priority: 'high' }, // undeclared stage
        { id: 'c2', title: 'Buy bulbs', column: 'todo', priority: 'low' },
      ],
    },
    {
      id: 'dash',
      type: 'dashboard',
      title: 'Overview',
      config: {
        widgets: [
          { kind: 'stat', label: 'Vans', value: '12' },
          { kind: 'ring', percent: 140 },
          { kind: 'donut', slices: [{ label: 'A', value: '3' }, { value: 2 }] },
          { kind: 'teleporter' }, // unknown kind
          { kind: 'note' }, // no text
        ],
      },
      rows: [],
    },
    {
      id: 'leader',
      type: 'dashboard',
      title: 'Visão Geral',
      config: {
        greeting: { name: '{app.name}', subtitle: 'Dados de {clientes.total} clientes' },
        widgets: [
          // the weak-model failure mode from production: expressions, not values
          { kind: 'stat', label: 'Total de clientes', value: '{clientes.total}' },
          { kind: 'stat', label: 'Ativos', value: '{status.Active,count}', delta: '{clientes.delta}' },
          { kind: 'ring', percent: '{clientes.ativos,percent}%', caption: '{clientes.ativos} ativos' },
          { kind: 'ring', percent: '{status.Active,percent}' },
          { kind: 'note', text: 'Meta: {meta.semanal}' },
        ],
      },
      rows: [],
    },
    {
      id: 'health',
      type: 'dashboard',
      title: 'Health',
      config: {
        widgets: [
          { kind: 'stat', label: 'Overdue', value: 3, delta: '-NaN%' }, // the production screenshot
          { kind: 'stat', label: 'Kept', value: 7, delta: '+2.0%' },
          {
            kind: 'donut', title: 'Donut',
            slices: [
              { label: 'Active', value: '{clientes.active,count}' },
              { label: 'Paused', value: '{clientes.paused,count}' },
              { label: 'At Risk', value: '{clientes.risk,count}' },
            ],
          },
          {
            kind: 'bars',
            bars: [
              { label: 'Q1', value: '{revenue.q1}' },
              { label: 'Q2', value: '{revenue.q2}' },
            ],
          },
        ],
      },
      rows: [],
    },
    {
      id: 'sched',
      type: 'schedule',
      title: 'Rota',
      config: {
        resources: [{ id: 'r-1', name: 'Alex' }], // < 2
        eventTypes: { shift: { label: 'Shift', tint: 'neon' } },
      },
      rows: [
        { id: 'e1', personId: 'nobody', date: 'tomorrow', start: '9am', durationMin: '2h', type: 'visit' },
      ],
    },
  ],
}

const clone = (v) => JSON.parse(JSON.stringify(v))

/* --------------------------------- run ----------------------------------- */

const outfile = path.join(root, 'node_modules', '.cache', 'smoke-playground-refine.mjs')
await esbuild.build({
  entryPoints: [path.join(root, 'src/pages/features/playground/refine.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': path.join(root, 'src') },
  logLevel: 'silent',
})
const { refineDraft } = await import(`${outfile}?t=${Date.now()}`)

const { draft: d, notes } = refineDraft(clone(MESSY))

/* ---- cross-page ---- */
ok(notes.length > 0, 'notes describe the interventions')
ok(d.pages.length === 6, 'all six pages survive')
for (const p of d.pages) {
  ok(p.rows.length >= 5 && p.rows.length <= 8, `"${p.id}" rows clamped to 5–8 (got ${p.rows.length})`)
  const ids = p.rows.map((r) => r.id)
  ok(new Set(ids).size === ids.length && ids.every((x) => typeof x === 'string' && x), `"${p.id}" ids unique strings`)
}

/* ---- sheet ---- */
const sheet = d.pages[0]
const cols = sheet.config.columns
ok(cols.length <= 6, 'sheet columns capped at 6')
ok(!cols.some((c) => c.key === 'ghost'), 'phantom column dropped')
ok(cols.some((c) => c.key === 'driver'), 'row-carried key declared as a column')
ok(cols.find((c) => c.key === 'weird')?.kind !== 'sparkle' || !cols.some((c) => c.key === 'weird'), 'unknown kind gone')
ok(JSON.stringify(sheet.config.futureOption) === JSON.stringify({ keep: 'me' }), 'unknown config key preserved byte-identical')
const statusCol = cols.find((c) => c.key === 'status')
ok(statusCol.tintBy?.Active === 'mint', 'semantic tint: Active → mint')
ok(statusCol.tintBy?.['In shop'] !== undefined, 'every observed chip value tinted')
for (const r of sheet.rows) {
  ok(/^\d{4}-\d{2}-\d{2}$/.test(r.due), 'dates coerced to ISO')
  ok(typeof r.miles === 'number', 'numbers coerced to numbers')
  ok(typeof r.done === 'number' && r.done >= 0 && r.done <= 1, 'progress clamped to 0–1')
}
ok(sheet.rows[0].done === 0.72, 'a 0–100 answer is read as a percent')
ok(sheet.rows[0].miles === 12300, '"12,300" parses')
ok(sheet.rows[2].due === '2026-03-04', '"Mar 4, 2026" parses')
ok(Array.isArray(sheet.config.stats) && sheet.config.stats.length > 0 && sheet.config.stats.length <= 4, 'stat tiles added (≤4)')
ok(sheet.config.stats[0].label === 'Total', 'first stat tile is the total')
ok(sheet.config.detailPanel?.header?.title === 'name', 'detail panel added, titled by the primary column')
ok(sheet.config.searchable === true && sheet.config.selectable === true && sheet.config.densityToggle === true, 'standard sheet toggles')
const markDone = (sheet.config.rowActions ?? []).find((a) => a.id === 'mark-done')
ok(Boolean(markDone), 'status column gains a quick mark-done action')
ok(markDone?.kind === 'patch', 'the added action is a patch (never a call)')
ok((sheet.config.rowActions ?? []).length <= 3, 'row actions capped at 3')

/* ---- board ---- */
const board = d.pages[1]
ok(board.config.stages.length >= 2 && board.config.stages.length <= 5, 'board stages restored to the standard set')
const stageIds = board.config.stages.map((s) => s.id)
ok(board.rows.every((r) => stageIds.includes(r.column)), 'every card lands on a declared stage')
ok(board.config.cardFields?.title === 'title', 'cardFields.title re-pointed at a real key')
ok(board.config.cardFields?.subtitle === undefined, 'phantom subtitle dropped')
ok(board.config.cardFields?.meta === undefined, 'phantom meta dropped')
ok(board.config.cardFields?.tags?.tintBy?.high === 'pink', 'tag tintBy derived (high → pink)')

/* ---- dashboard ---- */
const dash = d.pages[2]
ok(dash.config.greeting?.name === 'Fleet Tracker', 'greeting filled from the app name')
ok(dash.config.widgets.length <= 6, 'widgets capped')
ok(!dash.config.widgets.some((w) => w.kind === 'teleporter'), 'unknown widget dropped')
ok(!dash.config.widgets.some((w) => w.kind === 'note' && !w.text), 'empty note dropped')
ok(dash.config.widgets.find((w) => w.kind === 'stat').value === 12, 'stat value coerced to number')
ok(dash.config.widgets.find((w) => w.kind === 'ring').percent === 1, 'ring percent clamped to 1')
const donut = dash.config.widgets.find((w) => w.kind === 'donut')
ok(donut.slices.every((s) => typeof s.value === 'number' && typeof s.label === 'string'), 'donut slices coerced')
ok(dash.rows.length >= 5, 'dashboard sample rows topped up')
ok(!sheet.rows.some((r) => r.name === '{clientes.total}'), 'whole-placeholder row cell removed')

/* ---- placeholders: expressions the model left instead of values ---- */
const leader = d.pages[3]
const leaderJson = JSON.stringify(leader)
ok(!leaderJson.includes('{clientes') && !leaderJson.includes('{status.') && !leaderJson.includes('{meta'), 'no raw placeholder reaches the screen')
const totalStat = leader.config.widgets.find((w) => w.label === 'Total de clientes')
ok(typeof totalStat.value === 'number', 'unanswerable "{clientes.total}" becomes a real number')
ok(totalStat.value === leader.rows.length, 'the honest fallback is the page row count')
const activeStat = leader.config.widgets.find((w) => w.label === 'Ativos')
ok(typeof activeStat.value === 'number' && activeStat.value >= 0, '"{status.Active,count}" computed from the rows')
ok(activeStat.delta === undefined, 'placeholder delta scrubbed')
const rings = leader.config.widgets.filter((w) => w.kind === 'ring')
ok(rings.every((r) => typeof r.percent === 'number' && r.percent >= 0 && r.percent <= 1), 'ring percents resolved into 0–1')
ok(rings[0].caption === 'ativos', 'caption placeholder scrubbed, real words kept')
ok(rings[1].percent === leader.rows.filter((r) => String(r.status ?? '').toLowerCase().includes('active')).length / leader.rows.length, '"{status.Active,percent}" computed exactly')
const metaNote = leader.config.widgets.find((w) => w.kind === 'note')
ok(metaNote.text === 'Meta', 'note text scrubbed to its real words')
ok(notes.some((n) => /expression/.test(n)), 'the placeholder sweep is named in the notes')
ok(leader.config.greeting.name === 'Fleet Tracker', 'greeting placeholder falls back to the app name')
ok(!leader.config.greeting.subtitle.includes('{'), 'greeting subtitle scrubbed')

/* ---- NaN deltas and all-zero charts ---- */
const health = d.pages[4]
const overdue = health.config.widgets.find((w) => w.label === 'Overdue')
ok(overdue.delta === undefined, '"-NaN%" delta never reaches the screen')
ok(health.config.widgets.find((w) => w.label === 'Kept').delta === '+2.0%', 'a real delta survives')
const healthDonut = health.config.widgets.find((w) => w.kind === 'donut')
ok(Boolean(healthDonut), 'repairable donut kept')
ok(healthDonut.slices.some((s) => s.value > 0), 'donut counts computed from the sample rows')
ok(healthDonut.slices.find((s) => s.label === 'Active').value === health.rows.filter((r) => String(r.status) === 'Active').length, 'each slice counts its rows exactly')
ok(healthDonut.title === 'By Status', 'a generic title names the field the chart now reads')
ok(!health.config.widgets.some((w) => w.kind === 'bars'), 'an all-zero chart with no matching field is dropped')
ok(notes.some((n) => /computed the .* chart/.test(n)), 'the chart repair is named in the notes')

/* ---- schedule ---- */
const sched = d.pages[5]
ok(sched.config.resources.length >= 2, 'rota resources restored to the standard team')
const resIds = sched.config.resources.map((r) => r.id)
ok(sched.rows.every((r) => resIds.includes(r.personId)), 'every event assigned to a declared person')
ok(sched.rows.every((r) => /^\d{2}:\d{2}$/.test(r.start)), 'event starts are HH:MM')
ok(sched.rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date)), 'event dates are ISO')
ok(sched.rows.every((r) => Object.keys(sched.config.eventTypes).includes(r.type)), 'event types declared')
ok(sched.config.eventTypes.shift.tint === 'blue', 'invalid event tint replaced')

/* ---- idempotence: refining a refined draft changes nothing ---- */
const once = refineDraft(clone(MESSY))
const twice = refineDraft(clone(once.draft))
ok(JSON.stringify(twice.draft) === JSON.stringify(once.draft), 'refine(refine(x)) ≡ refine(x)')

/* ---- the empty case never throws ---- */
const empty = refineDraft({ name: '', tagline: '', icon: '', accent: '', category: '', pages: [] })
ok(empty.draft.name === 'Custom app' && Array.isArray(empty.draft.pages), 'empty input never throws')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
