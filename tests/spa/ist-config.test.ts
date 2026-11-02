/**
 * THE IST SCREENS' COLUMNS, NOW THAT THEY COME FROM A SHEET.
 *
 * What this holds is the one thing moving configuration out of code can break:
 * a table whose columns arrive over the network renders as NOTHING the first
 * time the network does not answer — and no columns looks exactly like no
 * obligations. So every case runs against the real overlay, over the real
 * shipped schemas the registry exports, and the assertion is always the same
 * shape: the screen still has its columns, and it says when they are not the
 * ones in the tab.
 *
 *   sheet present        an edited cell reaches the columns
 *   sheet missing        the shipped columns, and `blind` is true
 *   sheet unreadable     the door throwing is the same answer, never a throw
 *                        that reaches the screen
 *   a row only in the    a column key the schema does not ship is drawn, so
 *   sheet                any column the tab carries can be put on screen
 *
 * The fetch door is answered here with the platform's own envelope. Nothing
 * about the modules under test is reimplemented.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  IST_CONFIG_FALLBACK, IST_CONFIG_KEYS, IST_CONFIG_SHIPPED, IST_CONFIG_SPEC, certMatrixConfig,
  certScreenColumns, certStateTints, cfgCheck, cfgInt, cfgList, cfgPairs, cfgText, cfgTints, cfgYes,
  dropIstConfigCache, expiringDays, fetchIstConfig, istRecordsConfig, istRowOwed, istRowsAsFiled,
  ohioDay, resolveIstValues, saveIstConfig, seedIstConfig, type IstConfig,
} from '@/lib/istConfig'
import { istPage } from '@/registry/apps-employeetracker'
import { certMatrixPage } from '@/registry/apps-compliance'
// The two LIVE screens' own floors. They are bespoke tables — they draw their
// columns themselves rather than from a schema — so the only way to hold them
// to the tab is to hold the overlay over the arrays they actually render.
import { MATRIX_COLS } from '@/pages/features/employeetracker/EmployeeTrackerPage'
import { COLS as DASHBOARD_COLS } from '@/pages/features/compliance/CertificationsDashboard'

type Col = { key?: string; label?: string; kind?: string; tintBy?: Record<string, string> }

/** A configuration as the reader hands it on, with some cells overridden. */
const asRead = (over: Record<string, string> = {}): IstConfig => ({
  values: { ...IST_CONFIG_SHIPPED, ...over },
  source: 'sheet',
  blind: false,
  reason: '',
  unknown: [],
  problems: {},
  tab: 'ist_config',
})

const colsOf = (cfg: Record<string, unknown>): Col[] => (cfg.columns ?? []) as Col[]
const keysOf = (cfg: Record<string, unknown>): string[] => colsOf(cfg).map((c) => String(c.key))

describe('the cells themselves', () => {
  it('a value in the sheet wins, and a blank one falls back to the shipped value', () => {
    const cfg = asRead({ ist_stale_marker: 'house closed', ist_gate_certification: '' })
    assert.equal(cfgText(cfg, 'ist_stale_marker'), 'house closed')
    assert.equal(cfgText(cfg, 'ist_gate_certification'), 'dodd')
  })

  it('a list that parses to nothing is not a list of nothing', () => {
    assert.deepEqual(cfgList(asRead({ ist_statuses: ' , ; ' }), 'ist_statuses'), ['owed', 'done'])
    assert.deepEqual(cfgList(asRead({ ist_statuses: 'owed' }), 'ist_statuses'), ['owed'])
  })

  it('a catalogue that parses to nothing keeps every shipped course', () => {
    assert.equal(cfgPairs(asRead({ ist_cert_labels: 'nonsense' }), 'ist_cert_labels').keys.length, 8)
    assert.deepEqual(
      cfgPairs(asRead({ ist_cert_labels: 'dodd=Eight Hour, cpr=First Aid' }), 'ist_cert_labels').keys,
      ['dodd', 'cpr'],
    )
  })

  it('a number that is not one, or is out of its range, keeps the shipped value', () => {
    assert.equal(cfgInt(asRead({ ist_page_size: 'twenty' }), 'ist_page_size', 5, 200), 25)
    assert.equal(cfgInt(asRead({ ist_page_size: '0' }), 'ist_page_size', 5, 200), 25)
    assert.equal(cfgInt(asRead({ ist_page_size: '9999' }), 'ist_page_size', 5, 200), 25)
    assert.equal(cfgInt(asRead({ ist_page_size: '40' }), 'ist_page_size', 5, 200), 40)
  })

  it('a colour the platform cannot paint keeps the shipped one', () => {
    const tints = cfgTints(asRead({ ist_status_tints: 'owed=fuchsia, done=mint' }), 'ist_status_tints')
    assert.equal(tints.owed, 'amber')
    assert.equal(tints.done, 'mint')
  })

  it('one stray entry in a hand-typed cell keeps the rest of the cell', () => {
    const tints = cfgTints(asRead({ ist_status_tints: 'owed=fuchsia, done=green' }), 'ist_status_tints')
    assert.equal(tints.done, 'green')
    assert.equal(tints.owed, 'amber')
    assert.deepEqual(cfgPairs(asRead({ ist_columns: 'staffName:Employee, oops, status:IST' }), 'ist_columns').keys,
      ['staffName', 'status'])
  })

  it('a number with its own unit reads as the number; one with a remark keeps the shipped value', () => {
    assert.equal(cfgInt(asRead({ ist_cert_expiring_days: '90 days' }), 'ist_cert_expiring_days'), 90)
    assert.equal(cfgInt(asRead({ ist_cert_expiring_days: '90 (renewal)' }), 'ist_cert_expiring_days'), 60)
    assert.equal(cfgInt(asRead({ ist_valid_days: '３０' }), 'ist_valid_days'), 0)
  })

  it('a gate refused by the course list takes its label back with it', () => {
    const cfg = asRead({ ist_gate_certification: 'cpr', ist_gate_certification_label: 'CPR', ist_cert_labels: 'dodd=D' })
    assert.equal(cfgText(cfg, 'ist_gate_certification'), 'dodd')
    assert.equal(cfgText(cfg, 'ist_gate_certification_label'), 'DODD')
  })
})

describe('the IST records table', () => {
  it('ships the columns it always had when the sheet says nothing new', () => {
    const out = istRecordsConfig(istPage.config, asRead())
    assert.deepEqual(keysOf(out), [
      'staffName', 'clientName', 'house', 'status', 'dueDate', 'certNote', 'notifiedAt', 'notifyCount',
    ])
    const labels = colsOf(out).map((c) => c.label)
    assert.deepEqual(labels, [
      'Employee', 'Client', 'House', 'IST', 'Needed by', 'Certification', 'Last notice', 'Notices',
    ])
  })

  it('keeps how a column is DRAWN even when the sheet renames it', () => {
    const out = istRecordsConfig(istPage.config, asRead({
      ist_columns: 'staffName:Caregiver, status:Training',
    }))
    assert.deepEqual(keysOf(out), ['staffName', 'status'])
    // the person keeps their avatar; a person is never a bare string here
    assert.equal(colsOf(out)[0].kind, 'avatar+text')
    assert.equal(colsOf(out)[0].label, 'Caregiver')
    assert.equal(colsOf(out)[1].kind, 'chip')
  })

  it('draws a column the screen does not ship, so any column the tab carries can be shown', () => {
    const out = istRecordsConfig(istPage.config, asRead({
      ist_columns: 'staffName:Employee, trainedBy:Trained by',
    }))
    assert.deepEqual(keysOf(out), ['staffName', 'trainedBy'])
    assert.equal(colsOf(out)[1].kind, 'text')
    assert.equal(colsOf(out)[1].label, 'Trained by')
  })

  it('carries the statuses and their colours through to the chip and the filter', () => {
    const out = istRecordsConfig(istPage.config, asRead({
      ist_statuses: 'owed, done, waived',
      ist_status_tints: 'owed=pink, done=mint, waived=lavender',
    }))
    const status = colsOf(out).find((c) => c.key === 'status')
    assert.equal(status?.tintBy?.owed, 'pink')
    assert.equal(status?.tintBy?.waived, 'lavender')
    const filter = ((out.filters ?? []) as { key?: string; options?: string[] }[])
      .find((f) => f.key === 'status')
    assert.deepEqual(filter?.options, ['owed', 'done', 'waived'])
  })

  it('takes the page size from the sheet', () => {
    const out = istRecordsConfig(istPage.config, asRead({ ist_page_size: '50' }))
    assert.equal((out.pagination as { pageSize?: number }).pageSize, 50)
  })

  it('NEVER hands the screen an empty column list', () => {
    for (const cell of ['', '   ', ',,,', 'nothing parseable here']) {
      const out = istRecordsConfig(istPage.config, asRead({ ist_columns: cell }))
      assert.ok(keysOf(out).length >= 8, `"${cell}" emptied the table`)
    }
  })

  it('a configuration that could not be read is the shipped table, unchanged', () => {
    const out = istRecordsConfig(istPage.config, IST_CONFIG_FALLBACK)
    assert.deepEqual(keysOf(out), keysOf(istPage.config))
    assert.equal(IST_CONFIG_FALLBACK.blind, true)
    assert.match(IST_CONFIG_FALLBACK.reason, /not a person without training/)
  })
})

describe('the compliance matrix', () => {
  it('ships the six courses it always had, under the short headings it always used', () => {
    const out = certMatrixConfig(certMatrixPage.config, asRead())
    assert.deepEqual(keysOf(out), [
      'name', 'dodd', 'cpr', 'med1', 'med2', 'med3', 'mais', 'attention',
    ])
    assert.deepEqual(colsOf(out).map((c) => c.label), [
      'Employee', 'DODD 8-Hr', 'CPR/FA', 'Med Del 1', 'Med Del 2', 'Med Del 3', 'DODD MAIS',
      'Needs attention',
    ])
  })

  it('shows a course the sheet adds, with its name from the course list', () => {
    const out = certMatrixConfig(certMatrixPage.config, asRead({
      ist_matrix_columns: 'dodd, cpr, money',
    }))
    assert.deepEqual(keysOf(out), ['name', 'dodd', 'cpr', 'money', 'attention'])
    // no short heading for `money`, so the course list's own name is used
    assert.equal(colsOf(out).find((c) => c.key === 'money')?.label, 'Money Management')
    assert.equal(colsOf(out).find((c) => c.key === 'money')?.kind, 'chip')
  })

  it('takes a filter away with its column, and never leaves one pointing at nothing', () => {
    const out = certMatrixConfig(certMatrixPage.config, asRead({ ist_matrix_columns: 'dodd, cpr' }))
    const filters = (out.filters ?? []) as { key?: string }[]
    assert.deepEqual(filters.map((f) => f.key), ['dodd'])
  })

  it('keeps the spine: the employee and what needs attention are not courses', () => {
    const out = certMatrixConfig(certMatrixPage.config, asRead({ ist_matrix_columns: 'mais' }))
    assert.equal(colsOf(out)[0].key, 'name')
    assert.equal(colsOf(out)[0].kind, 'avatar+text')
    assert.equal(colsOf(out)[colsOf(out).length - 1].key, 'attention')
  })

  it('puts the same courses on the detail panel, so a date is never orphaned', () => {
    const out = certMatrixConfig(certMatrixPage.config, asRead({ ist_matrix_columns: 'dodd, money' }))
    const sections = ((out.detailPanel as { sections?: unknown[] }).sections ?? []) as
      { fields?: { label?: string; value?: string }[] }[]
    const fields = sections[0].fields ?? []
    assert.deepEqual(fields.map((f) => f.value), ['dodd_expires', 'money_expires'])
    assert.equal(fields[1].label, 'Money Management')
  })

  it('NEVER hands the screen a matrix with no courses in it', () => {
    for (const cell of ['', '   ', ',,,']) {
      const out = certMatrixConfig(certMatrixPage.config, asRead({ ist_matrix_columns: cell }))
      assert.ok(keysOf(out).length >= 8, `"${cell}" emptied the matrix`)
    }
  })

  it('a configuration that could not be read is the shipped matrix, unchanged', () => {
    const out = certMatrixConfig(certMatrixPage.config, IST_CONFIG_FALLBACK)
    assert.deepEqual(keysOf(out), keysOf(certMatrixPage.config))
  })
})

/**
 * THE TWO BESPOKE SCREENS — Workforce Compliance's roster and the
 * Certifications Dashboard.
 *
 * These are the ones people actually open: the IST app and the Compliance app
 * both ship put away, and their addresses redirect into the tracker. They draw
 * their own tables, so the overlay above does not reach them; `certScreenColumns`
 * does, and what it must never do is any of the three things a settings cell
 * could otherwise do to a compliance screen — empty a column, delete a course
 * out of the attention count, or rename a heading nobody asked to rename.
 */
describe('the screens that are live', () => {
  const labelsOf = (cols: readonly { label: string }[]) => cols.map((c) => c.label)
  const keys = (cols: readonly { key: string }[]) => cols.map((c) => c.key)

  it('draws exactly what it always drew when nothing in the tab was edited', () => {
    assert.deepEqual(certScreenColumns(MATRIX_COLS, asRead()), [...MATRIX_COLS])
    assert.deepEqual(certScreenColumns(DASHBOARD_COLS, asRead()), [...DASHBOARD_COLS])
    // the two screens abbreviate differently on purpose, and still do
    assert.equal(certScreenColumns(MATRIX_COLS, asRead())
      .find((c) => c.key === 'money')?.label, 'Money Mgmt')
    assert.equal(certScreenColumns(DASHBOARD_COLS, asRead())
      .find((c) => c.key === 'money')?.label, 'Money Management')
  })

  it('a configuration that could not be read is the shipped list, unchanged', () => {
    assert.deepEqual(certScreenColumns(MATRIX_COLS, IST_CONFIG_FALLBACK), [...MATRIX_COLS])
    assert.deepEqual(certScreenColumns(DASHBOARD_COLS, IST_CONFIG_FALLBACK), [...DASHBOARD_COLS])
  })

  it('a course REMOVED from the catalogue keeps its column — a cell cannot hide a lapse', () => {
    const cfg = asRead({ ist_cert_labels: 'dodd=DODD 8-Hour, cpr=CPR / First Aid' })
    const cols = certScreenColumns(MATRIX_COLS, cfg)
    assert.equal(cols.length, MATRIX_COLS.length)
    assert.ok(keys(cols).includes('mandt'))
    // the backend keeps computing it and keeps counting it in `attention`, so a
    // screen that dropped the column would show attention with nothing to blame
    assert.equal(cols.find((c) => c.key === 'mandt')?.label, 'MANDT')
  })

  it('a course ADDED to the catalogue is drawn, with the name the tab gives it', () => {
    const cfg = asRead({
      ist_cert_labels: `${IST_CONFIG_SHIPPED.ist_cert_labels}, bbp=Bloodborne Pathogens`,
    })
    const cols = certScreenColumns(MATRIX_COLS, cfg)
    assert.equal(cols.length, MATRIX_COLS.length + 1)
    const added = cols.find((c) => c.key === 'bbp')
    assert.equal(added?.label, 'Bloodborne Pathogens')
    assert.equal(added?.certId, 'cert-bbp')
  })

  it('an EDITED heading reaches the screen; an untouched cell leaves it alone', () => {
    const short = certScreenColumns(MATRIX_COLS, asRead({
      ist_matrix_labels: 'dodd=8-Hr, cpr=CPR/FA, med1=Med Del 1, med2=Med Del 2, ' +
        'med3=Med Del 3, mais=DODD MAIS',
    }))
    assert.equal(short.find((c) => c.key === 'dodd')?.label, '8-Hr')
    assert.equal(short.find((c) => c.key === 'cpr')?.label, 'CPR/FA')
    // no short heading for `money`, so the course list is where an edit lands
    const long = certScreenColumns(MATRIX_COLS, asRead({
      ist_cert_labels: IST_CONFIG_SHIPPED.ist_cert_labels.replace('money=Money Management',
        'money=Client Funds'),
    }))
    assert.equal(long.find((c) => c.key === 'money')?.label, 'Client Funds')
    assert.equal(long.find((c) => c.key === 'dodd')?.label, 'DODD 8-Hr')
  })

  it('never hands either screen an empty column list', () => {
    for (const cell of ['', '   ', ',,,', 'nothing parseable here']) {
      assert.equal(certScreenColumns(MATRIX_COLS, asRead({ ist_cert_labels: cell })).length,
        MATRIX_COLS.length, `"${cell}" emptied the roster`)
      assert.equal(certScreenColumns(DASHBOARD_COLS, asRead({ ist_cert_labels: cell })).length,
        DASHBOARD_COLS.length, `"${cell}" emptied the dashboard`)
    }
  })

  it('keeps the certId join, which is never the label', () => {
    const cols = certScreenColumns(MATRIX_COLS, asRead({
      ist_matrix_labels: 'dodd=Whatever They Call It',
    }))
    assert.equal(cols.find((c) => c.key === 'dodd')?.certId, 'cert-dodd')
    assert.deepEqual(keys(cols), keys(MATRIX_COLS))
    assert.ok(labelsOf(cols).includes('Whatever They Call It'))
  })
})

describe('the expiring window', () => {
  it('is one number for the whole platform, and the shipped 60 when the cell is nonsense', () => {
    assert.equal(expiringDays(asRead()), 60)
    assert.equal(expiringDays(asRead({ ist_cert_expiring_days: '90' })), 90)
    assert.equal(expiringDays(asRead({ ist_cert_expiring_days: '0' })), 60)
    assert.equal(expiringDays(asRead({ ist_cert_expiring_days: 'soon' })), 60)
    assert.equal(expiringDays(IST_CONFIG_FALLBACK), 60)
  })
})

/* ---------------------------------------------------------------------- */
/* THE READ ITSELF, at the door                                            */
/* ---------------------------------------------------------------------- */

const realFetch = globalThis.fetch
let answer: () => Response

before(() => {
  globalThis.fetch = (async () => answer()) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => { dropIstConfigCache() })

const envelope = (data: unknown) =>
  new Response(JSON.stringify({ status: 200, data }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })

describe('reading the configuration', () => {
  it('resolves every declared key, taking the sheet where it speaks', async () => {
    answer = () => envelope({
      rows: [{ key: 'ist_page_size', value: '40' }, { key: 'ist_statuses', value: 'owed' }],
      unknown_rows: [], tab: 'ist_config', source: 'sheet', blind: false, blind_reason: '',
    })
    const cfg = await fetchIstConfig({ force: true })
    assert.equal(cfg.blind, false)
    assert.equal(cfg.values.ist_page_size, '40')
    // a key the answer did not carry is still the shipped one, not undefined
    assert.equal(cfg.values.ist_stale_marker, 'house no longer mapped')
  })

  it('a backend serving its own shipped copy is BLIND, and says why', async () => {
    answer = () => envelope({
      rows: [], unknown_rows: [], tab: 'ist_config', source: 'shipped', blind: true,
      blind_reason: 'The ist_config tab could not be read.',
    })
    const cfg = await fetchIstConfig({ force: true })
    assert.equal(cfg.blind, true)
    assert.equal(cfg.source, 'shipped')
    assert.match(cfg.reason, /could not be read/)
    // and the screen still has its columns
    assert.ok(keysOf(istRecordsConfig(istPage.config, cfg)).length >= 8)
  })

  it('a blank cell in the answer never blanks a column list', async () => {
    answer = () => envelope({
      rows: [{ key: 'ist_columns', value: '' }],
      unknown_rows: [], tab: 'ist_config', source: 'sheet', blind: false, blind_reason: '',
    })
    const cfg = await fetchIstConfig({ force: true })
    assert.equal(cfg.values.ist_columns, IST_CONFIG_SHIPPED.ist_columns)
  })

  it('a row only in the sheet comes back named, beside the rows that are read', async () => {
    answer = () => envelope({
      rows: [{ key: 'ist_page_size', value: '30' }],
      unknown_rows: [{ key: 'ist_invented', value: 'hello' }],
      tab: 'ist_config', source: 'sheet', blind: false, blind_reason: '',
    })
    const cfg = await fetchIstConfig({ force: true })
    assert.deepEqual(cfg.unknown, [{ key: 'ist_invented', value: 'hello' }])
    assert.equal(cfg.values.ist_page_size, '30')
  })

  it('a door that refuses is an answer, never a rejection the screen has to catch', async () => {
    answer = () => new Response(JSON.stringify({ status: 403, message: 'no' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
    const cfg = await fetchIstConfig({ force: true })
    assert.equal(cfg.source, 'unreachable')
    assert.equal(cfg.blind, true)
    assert.deepEqual(cfg.values, IST_CONFIG_SHIPPED)
  })

  it('a door that is not there at all is the same answer', async () => {
    answer = () => { throw new Error('offline') }
    const cfg = await fetchIstConfig({ force: true })
    assert.equal(cfg.source, 'unreachable')
    assert.ok(keysOf(certMatrixConfig(certMatrixPage.config, cfg)).length >= 8)
  })

  it('a door that refuses this role keeps the relay\'s copy already held, never the shipped floor', async () => {
    seedIstConfig({ values: { ...IST_CONFIG_SHIPPED, ist_valid_days: '30' } })
    answer = () => new Response(JSON.stringify({ status: 403, message: 'no' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
    const cfg = await fetchIstConfig({ force: true })
    assert.equal(cfg.source, 'mirror')
    assert.equal(cfg.blind, false)
    assert.equal(cfg.values.ist_valid_days, '30')
  })

  it('does not remember a failure — the next read tries the tab again', async () => {
    answer = () => { throw new Error('offline') }
    assert.equal((await fetchIstConfig({ force: true })).source, 'unreachable')
    answer = () => envelope({
      rows: [{ key: 'ist_page_size', value: '40' }],
      unknown_rows: [], tab: 'ist_config', source: 'sheet', blind: false, blind_reason: '',
    })
    const cfg = await fetchIstConfig()
    assert.equal(cfg.source, 'sheet')
    assert.equal(cfg.values.ist_page_size, '40')
  })

  it('answers a repeat from memory, and a forced read from the door', async () => {
    let calls = 0
    answer = () => {
      calls++
      return envelope({
        rows: [{ key: 'ist_page_size', value: String(20 + calls) }],
        unknown_rows: [], tab: 'ist_config', source: 'sheet', blind: false, blind_reason: '',
      })
    }
    await fetchIstConfig({ force: true })
    await fetchIstConfig()
    assert.equal(calls, 1)
    await fetchIstConfig({ force: true })
    assert.equal(calls, 2)
  })
})

/* ---------------------------------------------------------------------- */
/* EVERY KEY: absent → declared value; refused → declared value, reported  */
/* ---------------------------------------------------------------------- */

const NEW_KEYS = [
  'ist_trained_scope', 'ist_valid_days', 'ist_trainer_must_be_free', 'ist_trainer_when_no_hm',
  'ist_assigner_owns_training', 'ist_pair_requires_overlap', 'ist_roster_lookback_days',
  'ist_cert_tracker_statuses', 'ist_cert_mais_statuses', 'ist_cert_source_fields',
  'ist_requirements_window', 'ist_cert_status_tints', 'ist_matrix_page_size', 'ist_dashboard_months',
  'ist_notice_repeats',
]

describe('every key', () => {
  it('is declared, and an absent cell reads its declared value with no problem', () => {
    for (const k of NEW_KEYS) assert.ok(IST_CONFIG_KEYS.includes(k), `${k} is not declared`)
    const { values, problems } = resolveIstValues({})
    assert.deepEqual(values, IST_CONFIG_SHIPPED)
    assert.deepEqual(problems, {})
  })

  it('a cell the declaration refuses answers the declared value, and is reported', () => {
    const bad: Record<string, string> = {
      ist_valid_days: 'forever', ist_trained_scope: 'everyone', ist_trainer_must_be_free: 'maybe',
      ist_trainer_when_no_hm: 'director', ist_assigner_owns_training: 'true',
      ist_pair_requires_overlap: '1', ist_roster_lookback_days: '-5',
      ist_cert_tracker_statuses: '*=valid', ist_cert_mais_statuses: 'certified=ok',
      ist_cert_source_fields: 'master.name=Employee Name', ist_requirements_window: '30',
      ist_cert_status_tints: 'valid=gold', ist_matrix_page_size: '2', ist_dashboard_months: '99',
    }
    const { values, problems } = resolveIstValues(bad)
    for (const k of Object.keys(bad)) {
      assert.equal(values[k], IST_CONFIG_SHIPPED[k], `${k} did not fall back`)
      assert.ok(problems[k], `${k} was not reported`)
    }
  })

  it('every declared value passes its own check, and every type is drawn by the editor', () => {
    for (const k of IST_CONFIG_KEYS) assert.equal(cfgCheck(k, IST_CONFIG_SHIPPED[k]), '', k)
    for (const k of IST_CONFIG_KEYS) {
      assert.ok(['list', 'pairs', 'text', 'template', 'int', 'yesno', 'choice', 'course']
        .includes(IST_CONFIG_SPEC[k].type), k)
    }
  })

  it('a course added in the same map is a valid gate; one the list lacks is refused', () => {
    assert.equal(resolveIstValues({ ist_cert_labels: 'dodd=D, bbp=B', ist_gate_certification: 'bbp' })
      .values.ist_gate_certification, 'bbp')
    assert.ok(resolveIstValues({ ist_gate_certification: 'bbp' }).problems.ist_gate_certification)
  })
})

describe('the new keys change what the screens do', () => {
  const now = new Date('2026-09-01T12:00:00Z')

  it('ist_valid_days: 0 never lapses; a number lapses a dated row; an undated one stays done', () => {
    const old = { status: 'done', trainedAt: '2025-06-01' }
    assert.equal(istRowOwed(old, asRead(), now), false)
    assert.equal(istRowOwed(old, asRead({ ist_valid_days: '365' }), now), true)
    assert.equal(istRowOwed({ status: 'done', trainedAt: '' }, asRead({ ist_valid_days: '30' }), now), false)
    assert.equal(istRowOwed({ status: 'owed' }, asRead(), now), true)
    // a trainedAt alone is a completed training, as the relay reads it
    assert.equal(istRowOwed({ status: 'owed', trainedAt: '2026-08-30' }, asRead(), now), false)
    assert.equal(istRowOwed(old, asRead({ ist_valid_days: 'soon' }), now), false)
  })

  it('ist_valid_days: still counts on day N and lapses on day N+1, by the Ohio date like the gate', () => {
    const row = { status: 'done', trainedAt: '2026-01-01' }
    const cfg = asRead({ ist_valid_days: '30' })
    assert.equal(istRowOwed(row, cfg, new Date('2026-01-31T15:00:00Z')), false)
    assert.equal(istRowOwed(row, cfg, new Date('2026-02-01T15:00:00Z')), true)
    // 21:00 in Ohio on day 30 is already the next day in UTC — still current, as on the gate
    assert.equal(ohioDay(new Date('2026-02-01T02:00:00Z')), '2026-01-31')
    assert.equal(istRowOwed(row, cfg, new Date('2026-02-01T02:00:00Z')), false)
  })

  it('IST Records files a lapsed IST as owed, and leaves every other row as stored', () => {
    const rows = [{ id: 'a', status: 'done', trainedAt: '2020-01-01' }, { id: 'b', status: 'done', trainedAt: '' },
                  { id: 'c', status: 'owed', trainedAt: '' }]
    const filed = istRowsAsFiled(rows, asRead({ ist_valid_days: '30' }), now)
    assert.deepEqual(filed.map((r) => r.status), ['owed', 'done', 'owed'])
    assert.deepEqual(istRowsAsFiled(rows, asRead(), now).map((r) => r.status), ['done', 'done', 'owed'])
  })

  it('ist_cert_status_tints: an edited state wins, an untouched one keeps the screen its own', () => {
    const own = { valid: 'own-valid', expiring: 'own-expiring', expired: 'own-expired', missing: 'own-grey' }
    assert.deepEqual(certStateTints(asRead(), own, (t) => `tint-${t}`), own)
    const edited = certStateTints(asRead({ ist_cert_status_tints: 'valid=mint, expiring=peach, expired=pink, missing=pink' }),
      own, (t) => `tint-${t}`)
    assert.equal(edited.expiring, 'tint-peach')
    assert.equal(edited.missing, 'own-grey')
    assert.equal(edited.valid, 'own-valid')
    // a refused colour leaves every screen its own
    assert.deepEqual(certStateTints(asRead({ ist_cert_status_tints: 'valid=gold' }), own, (t) => t), own)
  })

  it('the standalone matrix takes its page size and certification colours from the tab', () => {
    const shipped = certMatrixConfig(certMatrixPage.config, asRead())
    assert.equal((shipped.pagination as { pageSize?: number }).pageSize, 12)
    const out = certMatrixConfig(certMatrixPage.config, asRead({
      ist_matrix_page_size: '40', ist_cert_status_tints: 'expired=lavender',
    }))
    assert.equal((out.pagination as { pageSize?: number }).pageSize, 40)
    const dodd = colsOf(out).find((c) => c.key === 'dodd')
    assert.equal(dodd?.tintBy?.expired, 'lavender')
    assert.equal(dodd?.tintBy?.valid, 'mint')
  })

  it('the dashboard reach and the yes/no cells read inside the declaration', () => {
    assert.equal(cfgInt(asRead(), 'ist_dashboard_months'), 12)
    assert.equal(cfgInt(asRead({ ist_dashboard_months: '6' }), 'ist_dashboard_months'), 6)
    assert.equal(cfgInt(asRead({ ist_dashboard_months: '30' }), 'ist_dashboard_months'), 12)
    assert.equal(cfgYes(asRead(), 'ist_trainer_must_be_free'), true)
    assert.equal(cfgYes(asRead({ ist_trainer_must_be_free: 'no' }), 'ist_trainer_must_be_free'), false)
    assert.equal(cfgYes(asRead({ ist_trainer_must_be_free: 'nah' }), 'ist_trainer_must_be_free'), true)
  })
})

/* ---------------------------------------------------------------------- */
/* THE BUNDLE'S COPY, AND A SAVE READ BACK                                 */
/* ---------------------------------------------------------------------- */

describe('the bundle seeds the reader', () => {
  it('a seeded copy answers without asking Apps Script, named mirror', async () => {
    let calls = 0
    answer = () => { calls++; throw new Error('should not be asked') }
    assert.equal(seedIstConfig({ values: { ...IST_CONFIG_SHIPPED, ist_page_size: '60' }, problems: {} }), true)
    const cfg = await fetchIstConfig()
    assert.equal(calls, 0)
    assert.equal(cfg.source, 'mirror')
    assert.equal(cfg.blind, false)
    assert.equal(cfg.values.ist_page_size, '60')
  })

  it('a refused cell in the bundle is resolved again here and reported', async () => {
    seedIstConfig({ values: { ist_valid_days: 'x' } })
    const cfg = await fetchIstConfig()
    assert.equal(cfg.values.ist_valid_days, '0')
    assert.ok(cfg.problems.ist_valid_days)
  })

  it('a fresher answer from the door is not overwritten by the mirror', async () => {
    answer = () => envelope({
      rows: [{ key: 'ist_page_size', value: '45' }],
      unknown_rows: [], tab: 'ist_config', source: 'sheet', blind: false, blind_reason: '',
    })
    await fetchIstConfig({ force: true })
    assert.equal(seedIstConfig({ values: { ist_page_size: '20' } }), false)
    assert.equal((await fetchIstConfig()).values.ist_page_size, '45')
  })
})

describe('saving from Settings', () => {
  type Sent = { action: string; payload: Record<string, unknown> }
  const sentOf = (init?: RequestInit): Sent => {
    const body = decodeURIComponent(String(init?.body ?? '').replace(/^body=/, ''))
    return JSON.parse(body) as Sent
  }

  it('refuses a bad cell before any round trip, naming the key and why', async () => {
    let calls = 0
    answer = () => { calls++; return envelope({}) }
    await assert.rejects(saveIstConfig({ ist_valid_days: 'forever' }), /ist_valid_days/)
    await assert.rejects(saveIstConfig({ ist_cert_status_tints: 'valid=gold' }), /gold/)
    assert.equal(calls, 0)
  })

  it('a good cell is written, then read back from the door — the round trip', async () => {
    const sent: Sent[] = []
    let stored = '0'
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const s = sentOf(init)
      sent.push(s)
      if (s.action === 'istConfigSet') {
        stored = String((s.payload.values as Record<string, string>).ist_valid_days)
        return envelope({ saved: 1 })
      }
      return envelope({
        rows: [{ key: 'ist_valid_days', value: stored }],
        unknown_rows: [], tab: 'ist_config', source: 'sheet', blind: false, blind_reason: '',
      })
    }) as typeof fetch
    try {
      const cfg = await saveIstConfig({ ist_valid_days: '365' })
      assert.deepEqual(sent.map((s) => s.action), ['istConfigSet', 'istConfigGet'])
      assert.deepEqual(sent[0].payload, { values: { ist_valid_days: '365' } })
      assert.equal(cfg.values.ist_valid_days, '365')
      assert.equal(istRowOwed({ status: 'done', trainedAt: '2020-01-01' }, cfg), true)
      // a reset sends the DECLARED value as a real cell — never a blank that quietly means it
      await saveIstConfig({ ist_valid_days: IST_CONFIG_SHIPPED.ist_valid_days })
      assert.deepEqual(sent[2].payload, { values: { ist_valid_days: '0' } })
    } finally {
      globalThis.fetch = (async () => answer()) as typeof fetch
    }
  })

  it('checks a save against the cells the tab holds, not a stale copy: a course added earlier is a valid gate', async () => {
    const sent: Sent[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent.push(sentOf(init))
      return envelope({ saved: 1, rows: [], unknown_rows: [], tab: 'ist_config', source: 'sheet',
        blind: false, blind_reason: '' })
    }) as typeof fetch
    try {
      await assert.rejects(saveIstConfig({ ist_gate_certification: 'fa' }, {}), /not a course/)
      assert.equal(sent.length, 0)
      await saveIstConfig({ ist_gate_certification: 'fa' },
        { ist_cert_labels: `${IST_CONFIG_SHIPPED.ist_cert_labels}, fa=First Aid` })
      assert.equal(sent[0].action, 'istConfigSet')
      assert.deepEqual(sent[0].payload, { values: { ist_gate_certification: 'fa' } })
      // and a course list that would orphan the gate never leaves the screen
      await assert.rejects(saveIstConfig({ ist_cert_labels: 'cpr=CPR' }, {}), /ist_gate_certification/)
    } finally {
      globalThis.fetch = (async () => answer()) as typeof fetch
    }
  })

  it('adding a course and pointing the gate at it is one save the door accepts', async () => {
    const sent: Sent[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent.push(sentOf(init))
      return envelope({ saved: 2, rows: [], unknown_rows: [], tab: 'ist_config', source: 'sheet',
        blind: false, blind_reason: '' })
    }) as typeof fetch
    try {
      const labels = `${IST_CONFIG_SHIPPED.ist_cert_labels}, bbp=Bloodborne Pathogens`
      await saveIstConfig({ ist_cert_labels: labels, ist_gate_certification: 'bbp' }, {})
      assert.deepEqual(sent.map((s) => s.action), ['istConfigSet', 'istConfigGet'])
      assert.deepEqual(sent[0].payload, { values: { ist_cert_labels: labels, ist_gate_certification: 'bbp' } })
    } finally {
      globalThis.fetch = (async () => answer()) as typeof fetch
    }
  })
})
