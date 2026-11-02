/**
 * STAFF · the Driver and Med Del (MAIS) cards of the Staff Profile. The parts are built by StaffProfiles.gs's own
 * functions (booted here over in-memory tabs that carry an SSN, a day of birth, a whole licence number and a DD ID),
 * carried as JSON, read by the page's readers and drawn whole: the points tint, the licence's standing, the masked
 * licence, one MAIS line per Cat level with its Certified / Expired pill, and every empty or unread state as a
 * sentence — never an SSN, a day of birth, a whole licence number or a DD ID.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { DriverCard, MedDelCard, ProfileView } from '@/pages/features/staffprofiles/sections/Profile'
import { DrivingView } from '@/pages/features/staffprofiles/sections/Driving'
import { drivingOf, maisWordNote, medDelOf, notesOf, overviewOf, pointsTint, rosterOf } from '@/pages/features/staffprofiles/staffModel'
import type { ReadState } from '@/pages/features/staffprofiles/useStaffRead'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const TODAY = '2026-09-22'
const draw = (node: ReactNode) => renderToString(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, '')
const noop = () => {}
const ready = <T,>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })
const failed = <T,>(error: string): ReadState<T> => ({ status: 'failed', data: null, error, refreshing: false })

/** What must never reach the page: the SSN however written, the day of birth, the licence whole, the DODD registry id. */
const NEVER = ['987-65-4323', '987654323', '1990-05-17', '05/17/1990', 'May 17, 1990', 'SV128707', '128707', 'MA00000001',
  'MA0000']

/* ---------- the door's own functions ---------- */

type Gs = Record<string, (...a: unknown[]) => unknown>

function boot(): Gs {
  const part = (o: Intl.DateTimeFormatOptions, date: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(date)
  const g: Record<string, unknown> = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN, isFinite, parseInt, Error,
    HUB_POLICY: {}, HUB_ACTIONS: {},
    Utilities: {
      formatDate: (date: Date, tz: string, pattern: string) => {
        if (pattern !== 'yyyy-MM-dd') throw new Error(`formatDate pattern ${pattern} is not stood in for`)
        return `${part({ year: 'numeric' }, date, tz)}-${part({ month: '2-digit' }, date, tz)}-${part({ day: '2-digit' }, date, tz)}`
      },
    },
    // ist_cert_source_fields and ist_cert_mais_statuses as shipped
    certSourceField_: (f: string) => ({ 'mais.name': 'name', 'mais.status': 'status', 'mais.expires': 'expiration',
      'mais.category': 'cert_type' } as Record<string, string>)[f] ?? '',
    certStateOf_: (_key: string, word: string, fallback: string) =>
      (/^certified$/i.test(word.trim()) ? 'certified' : /^error/i.test(word.trim()) ? 'skip' : fallback),
    // the scrape's tab as certReadTab_ reads one the book does not have: no rows
    certSourceTab_: (which: string) => (which === 'mais' ? 'Med Del Certs (MAIS)' : ''),
    certReadTab_: () => [],
  }
  const src = (file: string) => readFileSync(resolve(ROOT, 'apps-script', file), 'utf8')
  const lift = (file: string, name: string) => {
    const s = src(file)
    const at = s.indexOf(`\nfunction ${name}(`)
    assert.notEqual(at, -1, `${file} has no ${name}`)
    return s.slice(at + 1, s.indexOf('\n}', at + 1) + 2)
  }
  const ctx = vm.createContext(g)
  vm.runInContext([lift('Clients.gs', 'clientNameKey_'), lift('Certs.gs', 'certFieldOf_')].join('\n'), ctx)
  vm.runInContext(src('StaffProfiles.gs'), ctx)
  return ctx as unknown as Gs
}

const GS = boot()

const DRIVER_TAB = [
  ['Employee', 'Status', 'First Name', 'Last Name', 'SSN#', 'Date of Birth', 'Driver', 'DL #', 'Points', 'License Exp Date',
    "Driver's Abstract (Original)", "Driver's Abstract (Latest)", 'Insurance Exp Date'],
  ['Noah Reed', 'Yes', 'Noah', 'Reed', '987-65-4323', '05/17/1990', 'Yes', 'SV128707', 2, '06/30/2027', 'n/a', '01/05/2026', '3/1/2027'],
  ['Ivy Six', 'Yes', 'Ivy', 'Six', '', '', 'Yes', '', 6, '', '', '', ''],
  ['Zoe Zero', 'Yes', 'Zoe', 'Zero', '', '', 'Yes', '', 0, '', '', '', ''],
  ['Twin Name', 'Yes', 'Twin', 'Name', '', '', 'Yes', '', 0, '', '', '', ''],
  ['Twin Name', 'No', 'Twin', 'Name', '', '', 'Suspended', '', 2, '', '', '', ''],
  ['Eve Past', 'Yes', 'Eve', 'Past', '', '', 'Suspended', '', 1, '8/1/2026', '9/23', '', '10/20/2026'],
  ['Dan Nope', 'Yes', 'Dan', 'Nope', '', '', 'No', '', '', '', 'n/a', '', 'n/a'],
  ['Tom Comp', 'Yes', 'Tom', 'Comp', '', '', 'Yes', '', 3, '', '', '', ''],
]
const COMPLIANCE_TAB = [
  ['Employee', 'Status', 'Driver', 'DL #', 'Drivers Abstract Latest', 'Insurance Expiration'],
  ['Noah Reed', 'Yes', 'Suspended', 'SV128707', '01/05/2026', '03/01/2027'],
  ['Zoe Zero', 'Yes', 'Yes', '', '', ''],
  ['Eve Past', 'Yes', 'Yes', '', '', ''],
  ['Tom Comp', 'Yes', 'Yes', '', '', ''],
  ['Tom Comp', 'Yes', 'Suspended', '', '', ''],
  ['Fay Two', 'Yes', 'Yes', '', '', ''],
  ['Fay Two', 'Yes', 'No', '', '', ''],
]
type MaisRow = Record<string, string>
const mais = (name: string, id: string, type: string, eff: string, exp: string, status: string, over: MaisRow = {}): MaisRow => ({
  timestamp: '2026-09-01 10:00:00', search_first: name.split(' ')[0], search_last: name.split(' ')[1], search_dob: '05/17/1990',
  dd_id: id, name, dob: '05/17/1990', cert_type: type, effective: eff, expiration: exp, status, ...over,
})
const MAIS_TAB = [
  mais('Noah Reed', 'MA00000001', 'Cat - II', '2/1/2024', '2/1/2026', 'Certified'),
  mais('Noah Reed', 'MA00000001', 'Cat - I', '1/5/2023', '1/5/2025', 'Expired'),
  mais('Noah Reed', 'MA00000001', 'Cat - I', '1/5/2025', '1/5/2027', 'Expired', { timestamp: '2026-08-01 09:00:00' }),
  mais('Noah Reed', 'MA00000001', 'Cat - I', '1/5/2025', '1/5/2027', 'Certified'),
  mais('Noah Reed', 'MA00000001', 'Cat - I', '1/5/2024', '1/5/2025', 'Expired'),
  mais('Noah Reed', 'MA00000001', 'Cat - III', '3/1/2025', '3/1/2027', 'Voluntary Withdrawal'),
  mais('Twin Name', 'MA00000002', 'Cat - I', '1/1/2025', '1/1/2027', 'Certified'),
  mais('Twin Name', 'MA00000003', 'Cat - I', '1/1/2025', '1/1/2027', 'Certified'),
  mais('Gus Soon', 'MA00000004', 'Cat - I', '10/20/2024', '10/20/2026', 'Certified'),
  // Rob Smith's own search finds the registry's "Rob J Smith"; another search's registry name is "Rob Smith"
  mais('Rob J Smith', 'MA00000005', 'Cat - I', '1/1/2025', '1/1/2027', 'Certified', { search_first: 'Rob', search_last: 'Smith' }),
  mais('Rob Smith', 'MA00000006', 'Cat - II', '1/1/2025', '1/1/2027', 'Certified', { search_first: 'Bobby', search_last: 'Smith' }),
]

const index = (grid: unknown[][]) => ({ index: GS.spDriverIndexFrom_(grid, 'America/New_York'), why: '' })
const drive = (key: string, main: unknown, comp: unknown) => JSON.parse(JSON.stringify(GS.spDrivingFrom_(key, main, comp, TODAY, 60)))

/** The two parts for one key, as staffProfileOverview carries them: built by the door, crossed as JSON. */
function partsFor(key: string) {
  const driving = GS.spDrivingFrom_(key, index(DRIVER_TAB), index(COMPLIANCE_TAB), TODAY, 60)
  const medDel = { ...(GS.spMaisFrom_(MAIS_TAB, key, TODAY, 60) as Record<string, unknown>), source: 'Med Del Certs (MAIS)' }
  return JSON.parse(JSON.stringify({ driving, med_del: medDel })) as { driving: unknown; med_del: unknown }
}

const ROW = rosterOf({ staff: [{ key: 'noahreed', name: 'Noah Reed', status: 'active' }] }).staff[0]
const NOTES = notesOf({ notes: [] })
// the Driving tab and the Staff Profile, drawn from one overview answer
const profile = (raw: Record<string, unknown>) => {
  const overview = ready(overviewOf({ person: { key: 'noahreed', name: 'Noah Reed' }, ...raw }))
  return draw(<><DrivingView overview={overview} onAsk={noop} onRetry={noop} />
    <ProfileView row={ROW} overview={overview} notes={ready(NOTES)} onAsk={noop} onRetryOverview={noop} onRetryNotes={noop} /></>)
}
const leaks = (text: string) => NEVER.filter((s) => text.includes(s))
/** One label's row of a drawn card: from its label to the end of its value. */
function pairOf(html: string, label: string): string {
  const at = html.indexOf(`>${label}</dt>`)
  assert.notEqual(at, -1, `no ${label} row`)
  return html.slice(at, html.indexOf('</dd>', at))
}

describe('the Driver card', () => {
  it('draws the door\'s part: Driver Yes, the points pill, the standing in red with its tab, the dates and the masked licence', () => {
    const raw = partsFor('noahreed')
    assert.deepEqual(leaks(JSON.stringify(raw)), [], 'the door built nothing secret into either part')
    const html = profile(raw)
    const card = html.slice(html.indexOf('data-driver-card'), html.indexOf('data-mais-card'))
    assert.ok(card.includes('>Driver<') && card.includes('>Yes<'))
    assert.ok(card.includes('data-points="amber"') && card.includes('data-pill="2 points"'), 'points above zero warn')
    assert.ok(card.includes('data-standing="invalid"') && card.includes('data-pill="Suspended"') && card.includes('bg-tint-danger'))
    assert.ok(card.includes('>Driver Compliance<'), 'the standing names the tab that said it')
    assert.ok(card.includes('Jun 30, 2027') && card.includes('Jan 05, 2026') && card.includes('Mar 01, 2027'))
    assert.ok(card.includes('data-masked="">•••• 8707<'), 'the licence shows its last four only, masked as HR Admin masks it')
    assert.equal(GS.spLicenceMask_('SV128707', ''), '•••• 8707')
    assert.ok(html.includes('From the Employee Database · employee driver'), 'the card names the tab its facts come from')
    assert.ok(!card.includes('data-day-state') && !card.includes('data-driver-standing'), 'current days and one standing: no extra pill')
    assert.deepEqual(leaks(html), [], 'no SSN, day of birth, whole licence or DD ID on the page')
  })

  it('a passed licence day is Expired and an insurance day inside the window Due Soon, as Staff Compliance says them; words stay words', () => {
    const html = draw(<DriverCard driving={drivingOf(drive('evepast', index(DRIVER_TAB), index(COMPLIANCE_TAB)))} />)
    assert.ok(pairOf(html, 'License expires').includes('Aug 01, 2026') && pairOf(html, 'License expires').includes('data-day-state="expired"') &&
      pairOf(html, 'License expires').includes('data-pill="Expired"') && pairOf(html, 'License expires').includes('bg-tint-danger'))
    assert.ok(pairOf(html, 'Insurance expires').includes('Oct 20, 2026') &&
      pairOf(html, 'Insurance expires').includes('data-day-state="due_soon"') && pairOf(html, 'Insurance expires').includes('data-pill="Due Soon"'))
    assert.ok(pairOf(html, 'Abstract (original)').includes('9/23') && !html.includes('2001'),
      'a cell that is no whole date is shown as written, never parsed into a guess')
  })

  it('the employee driver tab\'s own "Suspended" stays beside Driver Compliance\'s "Yes", in red with its tab', () => {
    const html = draw(<DriverCard driving={drivingOf(drive('evepast', index(DRIVER_TAB), index(COMPLIANCE_TAB)))} />)
    const driver = pairOf(html, 'Driver')
    assert.ok(driver.includes('>Yes<') && driver.includes('data-driver-standing="invalid"') && driver.includes('data-pill="Suspended"') &&
      driver.includes('>employee driver<'))
    assert.ok(pairOf(html, 'License standing').includes('data-pill="Valid"') && pairOf(html, 'License standing').includes('>Driver Compliance<'))
  })

  it('a row that says only "No" is one quiet line, never a grid of "Not on file"', () => {
    const html = draw(<DriverCard driving={drivingOf(drive('dannope', index(DRIVER_TAB), index(COMPLIANCE_TAB)))} />)
    assert.ok(html.includes('data-driver-no') && html.includes('Not a driver (the employee driver tab says No)'))
    assert.ok(!html.includes('data-driver=""') && !html.includes('Not on file') && !html.includes('Not a driver on file'))
  })

  it('an unread or doubled Driver Compliance leaves the standing "Not read", never "Not on file" or "not a driver"', () => {
    const shutComp = { index: null, why: 'the Driver Compliance tab could not be read (timed out)' }
    const unread = draw(<DriverCard driving={drivingOf(drive('noahreed', index(DRIVER_TAB), shutComp))} />)
    assert.ok(unread.includes('data-degraded') && pairOf(unread, 'License standing').includes('Not read') &&
      !pairOf(unread, 'License standing').includes('Not on file'))
    assert.ok(pairOf(unread, 'Points').includes('data-pill="2 points"'), 'what employee driver holds is still shown')
    const doubled = draw(<DriverCard driving={drivingOf(drive('tomcomp', index(DRIVER_TAB), index(COMPLIANCE_TAB)))} />)
    assert.ok(doubled.includes('two rows of the Driver Compliance tab carry this name') &&
      pairOf(doubled, 'License standing').includes('Not read') && pairOf(doubled, 'Points').includes('data-pill="3 points"'))
    const only = draw(<DriverCard driving={drivingOf(drive('faytwo', index(DRIVER_TAB), index(COMPLIANCE_TAB)))} />)
    assert.ok(only.includes('two rows of the Driver Compliance tab carry this name') && !only.includes('Not a driver on file'))
  })

  it('points: none is quiet, one to five warn, six or more is the strong tint', () => {
    assert.deepEqual([pointsTint(null), pointsTint(0), pointsTint(2), pointsTint(5), pointsTint(6), pointsTint(9)],
      ['slate', 'slate', 'amber', 'amber', 'danger', 'danger'])
    const six = profile(partsFor('ivysix'))
    assert.ok(six.includes('data-points="danger"') && six.includes('data-pill="6 points"'))
    const zero = profile(partsFor('zoezero'))
    assert.ok(zero.includes('data-points="slate"') && zero.includes('data-standing="valid"') && zero.includes('data-pill="Valid"'))
  })

  it('a name two rows share is said, never guessed; no row is "Not a driver on file"; an unread tab is a banner, never none', () => {
    const twin = profile(partsFor('twinname'))
    assert.ok(twin.includes('two rows of the employee driver tab carry this name'))
    assert.ok(!twin.includes('data-driver=""') && !twin.includes('Not a driver on file'))
    const nobody = profile(partsFor('nobodyhere'))
    assert.ok(nobody.includes('data-driver-none') && nobody.includes('Not a driver on file'))
    const shut = draw(<DriverCard driving={drivingOf({ found: false, degraded: true,
      why: 'the employee driver tab could not be read (Service Spreadsheets timed out)' })} />)
    assert.ok(shut.includes('data-degraded') && shut.includes('the employee driver tab could not be read'))
    assert.ok(!shut.includes('Not a driver on file'), 'an unread tab is not "not a driver"')
    const half = draw(<DriverCard driving={drivingOf(drive('noahreed',
      { index: null, why: 'the employee driver tab could not be read (timed out)' }, index(COMPLIANCE_TAB)))} />)
    assert.ok(half.includes('data-degraded') && half.includes('data-pill="Suspended"') && half.includes('•••• 8707'))
    for (const label of ['Points', 'License expires', 'Abstract (original)']) {
      assert.ok(pairOf(half, label).includes('Not read') && !pairOf(half, label).includes('Not on file'), `${label}: unread, not absent`)
    }
    assert.ok(pairOf(half, 'Abstract (latest)').includes('Jan 05, 2026'), 'what Driver Compliance holds is still shown')
  })

  it('a part the answer does not carry, or a read that failed, is never drawn as not a driver', () => {
    const old = profile({})
    assert.ok(old.includes('does not carry the driving record') && !old.includes('Not a driver on file'))
    const html = draw(<ProfileView row={ROW} overview={failed('Unknown action.')} notes={failed('Unknown action.')} onAsk={noop}
      onRetryOverview={noop} onRetryNotes={noop} />)
    assert.ok(!html.includes('Not a driver on file') && !html.includes('No MAIS record on file'))
    assert.ok(!html.includes('does not carry'), 'no answer is not an answer without the part')
  })

  it('reads only its own fields: an SSN, a birth day or a whole licence slipped into the part is never drawn', () => {
    const d = drivingOf({ found: true, driver: true, points: 1, dl_last4: 'SV128707', ssn: '987-65-4323', dob: '1990-05-17',
      date_of_birth: '05/17/1990', dl: 'SV128707', dd_id: 'MA00000001' })
    assert.equal(d?.dlLast4, '', 'more digits than a mask carries is not a mask')
    const html = draw(<DriverCard driving={d} />)
    assert.deepEqual(leaks(html), [])
    assert.ok(html.includes('data-masked') === false && html.includes('Not on file'))
  })
})

describe('the Med Del (MAIS) card', () => {
  it('one line per Cat level in level order: effective → expires, Certified green, Expired red, the older records counted', () => {
    const html = profile(partsFor('noahreed'))
    const card = html.slice(html.indexOf('data-mais-card'))
    const levels = [...card.matchAll(/data-mais-level="([^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(levels, ['Cat - I', 'Cat - II', 'Cat - III'])
    const line = (level: string) => {
      const at = card.indexOf(`data-mais-level="${level}"`)
      return card.slice(at, card.indexOf('</li>', at))
    }
    assert.ok(line('Cat - I').includes('Jan 05, 2025 → Jan 05, 2027') && line('Cat - I').includes('data-pill="Certified"') &&
      line('Cat - I').includes('bg-tint-mint') && line('Cat - I').includes('2 older records'),
      'the same record scraped twice is one record, and its newest scrape ("Certified") speaks')
    assert.ok(!line('Cat - I').includes('Registry says'))
    assert.ok(line('Cat - II').includes('data-pill="Expired"') && line('Cat - II').includes('bg-tint-danger') &&
      line('Cat - II').includes('Registry says Certified'), 'a Certified record past its day is expired, and the registry\'s word is kept')
    assert.ok(line('Cat - III').includes('data-pill="Expired"') && line('Cat - III').includes('Registry says Voluntary Withdrawal') &&
      !line('Cat - III').includes('older record'))
    assert.deepEqual(leaks(html), [])
  })

  it('two registry records under one name are said, never guessed; no record is "No MAIS record on file"; an unread tab is a banner', () => {
    const twin = profile(partsFor('twinname'))
    const card = twin.slice(twin.indexOf('data-mais-card'))
    assert.ok(card.includes('2 DODD registry records') && !card.includes('data-mais-level') && !card.includes('No MAIS record on file'))
    const nobody = profile(partsFor('nobodyhere'))
    assert.ok(nobody.includes('data-mais-none') && nobody.includes('No MAIS record on file'))
    const shut = draw(<MedDelCard medDel={medDelOf({ certs: [], degraded: true,
      why: 'the Med Del Certs (MAIS) tab could not be read (timed out)' })} />)
    assert.ok(shut.includes('data-degraded') && !shut.includes('No MAIS record on file'))
    assert.ok(profile({}).includes('does not carry the MAIS record'))
  })

  it('another person\'s registry name that folds to this name is never attached when this person\'s own search found another DD ID', () => {
    const rob = profile(partsFor('robsmith'))
    const card = rob.slice(rob.indexOf('data-mais-card'))
    assert.ok(card.includes('point at different DODD records') && !card.includes('data-mais-level') &&
      !card.includes('No MAIS record on file'))
    assert.deepEqual(leaks(rob), [])
  })

  it('a tab that reads no rows, or a scrape with no DD ID column, is a banner and never "No MAIS record on file"', () => {
    const empty = draw(<MedDelCard medDel={medDelOf(JSON.parse(JSON.stringify(GS.spMaisPart_('noahreed', TODAY, 60))))} />)
    assert.ok(empty.includes('data-degraded') && empty.includes('read no rows') && !empty.includes('No MAIS record on file'))
    const noId = MAIS_TAB.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'dd_id')))
    const blind = draw(<MedDelCard medDel={medDelOf(JSON.parse(JSON.stringify(GS.spMaisFrom_(noId, 'noahreed', TODAY, 60))))} />)
    assert.ok(blind.includes('data-degraded') && blind.includes('no column for dd_id') && !blind.includes('data-mais-level') &&
      !blind.includes('No MAIS record on file'))
  })

  it('a certification expiring inside the Staff Compliance window is Due Soon in amber, as Compliance says it', () => {
    const gus = profile(partsFor('gussoon'))
    const card = gus.slice(gus.indexOf('data-mais-card'))
    assert.ok(card.includes('data-pill="Due Soon"') && card.includes('bg-tint-amber') && !card.includes('data-pill="Certified"'))
    assert.ok(!card.includes('Registry says'), 'Due Soon is still certified: the registry\'s "Certified" is not repeated')
  })

  it('an answer that does not say expired is never drawn as certified; the registry\'s word shows only when the pill does not say it', () => {
    const m = medDelOf({ certs: [{ level: 'Cat - I', status: 'certified', word: 'Certified', effective: '2025-01-01', expires: '2027-01-01' }] })
    assert.equal(m?.certs[0].expired, true)
    assert.equal(maisWordNote({ word: 'Certified', expired: false }), '')
    assert.equal(maisWordNote({ word: 'Expired', expired: true }), '')
    assert.equal(maisWordNote({ word: 'DODD Review', expired: true }), 'Registry says DODD Review')
  })
})
