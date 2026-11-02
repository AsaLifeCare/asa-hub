/**
 * MY PROFILE · My Details, My Requirements, My Docs: the manifest, the three screens drawn whole, and the reads.
 *
 * Whose profile it is is decided by the relay and the ledger's own door; the screen is held to what it
 * promises with them — the three status pills in their colours, the dash and its sentence wherever a value
 * is missing, the person chooser only for a mass answer, an eye that always opens the version card with the
 * document fetched through certDocFile, an upload that files under the requirement id (a person only as the
 * relay's file_as) and then reads the paper, a status that follows a read date until the master confirms it,
 * and totals that stay the engine's. The card and the upload open in the right panel, never a modal.
 */
import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ComponentProps, ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import SidePanel, { PanelScrim } from '@/components/shared/SidePanel'
import { useAuthStore } from '@/auth/useAuthStore'
import { isAllowedWith } from '@/lib/appAccess'
import { isManifestVisible, visibleManifests } from '@/lib/audience'
import { badgeAllowsApp, useBadgeAccessStore } from '@/lib/badgeAccess'
import type { UploadRow } from '@/lib/certUploads'
import { useMemberStore } from '@/stores/useMemberStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { myProfileManifests } from '@/registry/apps-myprofile'
import { appManifests } from '@/registry/apps'
import {
  CONFIRMED_SUB, DOCS_NOT_CLIENT, DUE_TONE_CLASS, LEDGER_OTHER_ROW, OTHERS_PRIVATE, READING_DATES, REQS_NOT_CLIENT, STATUS_PILL,
  UPLOADS_IDLE, choiceAfter, choiceLabel, choiceOf, dayClass, docType, docsEmpty, docsFor, filedStatus, myProfilePath,
  readResult, requirementsEmpty, rowFor, unreadWords, uploadFor, versionFor,
  type Field, type MyProfileView, type RequirementRow, type UploadsState, type VersionRow,
} from '@/pages/features/myprofile/myProfileModel'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import {
  DetailsCard, DocsCard, MyProfileScreen, PersonBar, ProfileNav, ReadLine, RequirementsCard, VISIT_SENTENCE, VisitNotice,
  useMyProfilePage, useProfilePanel,
} from '@/pages/features/myprofile/MyProfilePage'
import ProfileUploadSheet, {
  ProfileUploadBody, UPLOAD_AND_READ, UPLOAD_PANEL_LABEL, fileAndRead, fileOwnVersion, type ProfileUploadAsk, type UploadStep,
} from '@/pages/features/myprofile/ProfileUploadSheet'
import VersionCard, {
  DOC_UNSHOWN, DocView, VERSION_PANEL_LABEL, VersionCardBody, confirmDate, recordOf, versionCardHead, type VersionAsk,
} from '@/pages/features/myprofile/VersionCard'
import { blobOf, docShapeOf, openCertDoc } from '@/pages/features/myprofile/certDocFile'
import {
  MY_PROFILE_IDLE, forgetHeld, saveAddress, useAddress, useMyProfile, useUploads, type MyProfileState,
} from '@/pages/features/myprofile/useMyProfile'
import AddressPanel, { ADDRESS_MAP_PAUSE_MS, ADDRESS_PANEL_LABEL, AddressBody } from '@/pages/features/myprofile/AddressPanel'
import { AddressMapFrame } from '@/components/shared/AddressMap'
import {
  ADDRESS_READING, ADDRESS_WORDS, US_STATES, addressAfter, addressAsk, addressBad, addressChanges, addressDraftLine,
  addressField, addressLine, addressOf, addressPencil, type AddressState, type AddressView,
} from '@/pages/features/myprofile/addressModel'
import { mountHook } from './react-host'
import { SHELL_SHOWN, primeShellHides } from '@/lib/myWorkHides'

// the sections Settings › My Work can hide are drawn as a session it shows them to sees them
primeShellHides(SHELL_SHOWN)

// the window's own listeners, kept so a test can press a key
const listeners = new Map<string, Set<(e: unknown) => void>>()
Object.defineProperty(globalThis, 'addEventListener', {
  value: (type: string, fn: (e: unknown) => void) => { (listeners.get(type) ?? listeners.set(type, new Set()).get(type))?.add(fn) },
  configurable: true, writable: true,
})
Object.defineProperty(globalThis, 'removeEventListener', {
  value: (type: string, fn: (e: unknown) => void) => { listeners.get(type)?.delete(fn) },
  configurable: true, writable: true,
})
const press = (key: string) => [...(listeners.get('keydown') ?? [])].forEach((fn) => fn({ key }))

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: React.ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const noop = () => {}

const f = (key: string, label: string, value: string, why = '', note = ''): Field => ({ key, label, value, why, note })

function row(id: string, over: Partial<RequirementRow> = {}): RequirementRow {
  return {
    id, req_id: id, requirement: `Req ${id}`, cert: `Req ${id}`, category: 'Training', category_why: '',
    status: { class: 'current', word: 'Current' }, state: 'Ok', due: '2027-06-30', due_tone: 'later', due_why: '',
    upload: { allowed: true, why: '' }, details: [], ...over,
  }
}

function view(over: Partial<MyProfileView> = {}): MyProfileView {
  return {
    scope: { mode: 'own', why: '', person: '' },
    person: { name: 'Maya Chen', key: 'mayachen', key_why: '', roster_id: 'PPL_MAYA', own: true, notes: [] },
    details: {
      state: 'ready', why: '', notes: [], as_of: '2026-09-25T12:00:00Z',
      fields: [
        f('employee_id', 'Employee ID', 'ASA-1041'), f('role', 'Role', 'Direct Support Professional'),
        f('start_date', 'Start date', '2024-05-12'), f('phone', 'Phone', '5550101100'),
        f('email', 'Email', 'maya.chen@example.invalid'),
        f('address', 'Address', 'Columbus, OH', '', 'City and state only — the staff roster keeps no street address.'),
      ],
    },
    requirements: {
      state: 'ready', why: '', note: '', as_of: '', copy_why: '', gap: '',
      totals: { current: 2, soon: 1, attention: 2, unknown: 0 }, on: '2026-09-25', window: 30,
      rows: [
        row('ist', { requirement: 'Client-specific training / IST', category: 'Assigned clients', status: { class: 'attention', word: 'Needs attention' }, due: '2026-09-22', due_tone: 'overdue' }),
        row('dodd', { requirement: 'DODD annual training', cert: 'DODD annual training', status: { class: 'soon', word: 'Due soon' }, due: '2026-10-15', due_tone: 'soon' }),
        row('cpr', { requirement: 'CPR / First Aid', cert: 'CPR / First Aid', category: 'Certification' }),
        row('med', { requirement: 'Medication delegation', due: '', due_tone: '', due_why: 'The requirement row carries no expiry date.' }),
        row('i9', { requirement: 'I-9 Form', category: 'Onboarding paperwork', status: { class: 'attention', word: 'Needs attention' }, due: '', due_tone: '', due_why: 'Nothing is on file, so there is no date to run out.', upload: { allowed: false, why: 'HR files this form.' } }),
      ],
    },
    read_at: '2026-09-25T12:00:00Z',
    ...over,
  }
}

const up = (id: string, person: string, cert: string, at: string, url = `https://drive.google.com/file/d/${id}/view`): UploadRow =>
  ({ id, person, cert, name: `${id}.pdf`, url, by: 'x@example.org', at })
/** A version filed through the new door: its requirement id and the decoder's reading on the ledger row. */
const filed = (id: string, reqId: string, cert: string, over: Partial<VersionRow> = {}): VersionRow =>
  ({ ...up(id, 'Maya Chen', cert, '2026-09-26T12:00:00Z'), req_id: reqId, file_id: `f-${id}`, ...over })
/** Maya's profile with DODD and CPR kept as dated in the record, and her own ledger plus `extra`. */
function dated(extra: VersionRow[] = []) {
  const v = view()
  v.requirements.rows = v.requirements.rows.map((r) => (r.id === 'dodd' || r.id === 'cpr' ? { ...r, dated: true } : r))
  return { v, docs: docsFor(v, readyUploads('own', [...MINE, ...extra])) }
}
const rowOf = (v: MyProfileView, id: string) => v.requirements.rows.find((r) => r.id === id) as RequirementRow
/** The first status pill after a row's anchor — the row's own. */
const pillOf = (html: string, id: string) => new RegExp(`data-row="${id}"[\\s\\S]*?data-status="(\\w+)">([^<]+)<`).exec(html)?.slice(1)
const LEDGER: UploadRow[] = [
  up('u1', 'Maya Chen', 'CPR / First Aid', '2026-09-16T12:00:00Z'),
  up('u2', 'Maya Chen', 'CPR / First Aid', '2025-06-01T12:00:00Z'),
  up('u3', 'Bob Bee', 'DODD annual training', '2026-01-01T12:00:00Z'),
  up('u4', 'Maya Chen', 'Employment information', ''),
]
// an own answer is what the ledger's door narrowed to the caller: Maya's rows alone
const MINE = LEDGER.filter((u) => u.person === 'Maya Chen')
const readyUploads = (scope: 'all' | 'own', rows = scope === 'own' ? MINE : LEDGER, self = scope === 'own' ? 'Maya Chen' : ''): UploadsState =>
  ({ status: 'ready', rows, scope, self, error: '', refused: false })
const refusedUploads = (error: string): UploadsState => ({ ...UPLOADS_IDLE, status: 'failed', error, refused: true })
const ready = (v: MyProfileView): MyProfileState => ({ ...MY_PROFILE_IDLE, status: 'ready', data: v, readAt: Date.parse('2026-09-25T12:00:00Z') })
const screen = (page: 'details' | 'requirements' | 'docs', s: MyProfileState, uploads: UploadsState = readyUploads('own')) =>
  draw(<MyProfileScreen page={page} state={s} uploads={uploads} person="" onPerson={noop} onRetry={noop} onUpload={noop} onView={noop} />)

describe('the app', () => {
  it('is "My Profile", id my-profile, with My Details, My Requirements and My Docs in that order', () => {
    const app = myProfileManifests[0]
    assert.equal(app.id, 'my-profile')
    assert.equal(app.name, 'My Profile')
    assert.deepEqual(app.pages.map((p) => [p.id, p.title]), [
      ['details', 'My Details'], ['requirements', 'My Requirements'], ['docs', 'My Docs'],
    ])
    assert.equal(appManifests.filter((m) => m.id === 'my-profile').length, 1)
  })

  it('ships no App Control row: staff with an empty matrix cannot open it, the master can', () => {
    const staff = { role: 'staff', types: ['STAFF'], isMaster: false }
    assert.equal(badgeAllowsApp('my-profile', staff, {}), false)
    assert.equal(badgeAllowsApp('my-profile', { ...staff, role: 'admin', types: ['ADMIN'] }, { crm: ['ADMIN'] }), false)
    assert.equal(badgeAllowsApp('my-profile', { role: 'admin', types: [], isMaster: true }, {}), true)
    const hits: string[] = []
    for (const dir of ['apps-script', 'tools', 'server']) {
      for (const name of readdirSync(resolve(ROOT, dir))) {
        if (!/\.(gs|py|mjs|js|json)$/.test(name) || name === 'test-my-profile.py') continue
        const text = readFileSync(join(resolve(ROOT, dir), name), 'utf8')
        if (/app_badge_access[^\n]{0,200}my-profile|my-profile[^\n]{0,200}app_badge_access/.test(text)) hits.push(name)
      }
    }
    assert.deepEqual(hits, [])
  })

  describe('a client-role login (a client, a guardian, or the master acting as one) reaches it through App Control alone', () => {
    const app = myProfileManifests[0]
    const JANE = { id: 'u-jane', name: 'Jane Doe', email: 'jane@example.invalid', role: 'client', types: [], isMaster: false }
    const rules = (r: Record<string, string[]>) => useBadgeAccessStore.setState({ rules: r, tenantRules: {}, configRules: {} })
    before(() => {
      useTenantStore.setState({ currentTenantId: 'hq', homeTenantId: 'hq', tenantsLoaded: true })
      useWorldStore.setState({ currentWorldId: '' })
      useMemberStore.setState({ currentMemberId: '' } as never)
      useAuthStore.setState({ user: JANE } as never)
    })
    after(() => {
      rules({})
      useAuthStore.setState({ user: null } as never)
    })

    it('the route guard\'s audience lets the client role through; the trainee and interviewer seats stay out', () => {
      assert.equal(isManifestVisible(app, { role: 'client' }), true)
      for (const role of ['admin', 'manager', 'staff'] as const) assert.equal(isManifestVisible(app, { role }), true)
      assert.equal(isManifestVisible(app, { role: 'onboarding' }), false)
      assert.equal(isManifestVisible(app, { role: 'interviewer' }), false)
    })

    it('with the my-profile row naming CLIENT the one checker opens it for a client; with no row, or a row without CLIENT, it stays shut', () => {
      rules({ 'my-profile': ['CLIENT', 'STAFF'] })
      assert.equal(isAllowedWith(appManifests, 'client', 'my-profile'), true)
      assert.ok(visibleManifests(appManifests, { role: 'client' }, (id) => isAllowedWith(appManifests, 'client', id))
        .some((a) => a.id === 'my-profile'), 'the tile is drawn for the client')
      rules({})
      assert.equal(isAllowedWith(appManifests, 'client', 'my-profile'), false, 'no row: the master\'s alone')
      rules({ 'my-profile': ['STAFF', 'ADMIN'] })
      assert.equal(isAllowedWith(appManifests, 'client', 'my-profile'), false, 'a row that does not name CLIENT')
    })

    it('a person focus draws the tile as it did before: a client focus hides it, a staff focus keeps it', () => {
      const focus = (type: 'client' | 'staff') => ({ type, id: 'x', name: 'X' })
      for (const role of ['admin', 'manager', 'staff'] as const) {
        assert.equal(isManifestVisible(app, { role, focus: focus('client') }), false)
        assert.equal(isManifestVisible(app, { role, focus: focus('staff') }), true)
      }
      assert.deepEqual(app.focusAudience, ['staff'])
    })
  })

  it('routes every page to the one screen', () => {
    const routes = readFileSync(resolve(ROOT, 'src/pages/AppRoutePage.tsx'), 'utf8')
    for (const p of ['details', 'requirements', 'docs']) assert.match(routes, new RegExp(`'my-profile/${p}': MyProfilePage`))
  })

  it('the rail lists the three pages in order, marks the one open, and keeps the chosen person', () => {
    const html = draw(<ProfileNav page="requirements" person="PPL_BOB" />)
    const order = ['My Details', 'My Requirements', 'My Docs'].map((t) => html.indexOf(t))
    assert.ok(order.every((i, n) => i > -1 && (n === 0 || i > order[n - 1])), 'in order')
    assert.match(html, /<a aria-current="page" class="[^"]*bg-primary\/10[^"]*" href="\/app\/my-profile\/requirements\?person=PPL_BOB"/)
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1)
    assert.ok(html.includes('href="/app/my-profile/details?person=PPL_BOB"') && html.includes('href="/app/my-profile/docs?person=PPL_BOB"'))
    assert.ok(!draw(<ProfileNav page="details" person="" />).includes('?person='))
  })
})

describe('My Details', () => {
  it('draws My Info with the six fields in order, the phone as a link and the start date in words', () => {
    const html = draw(<DetailsCard view={view()} />)
    assert.ok(html.includes('>My Info<'))
    const labels = ['Employee ID', 'Role', 'Start date', 'Phone', 'Email', 'Address'].map((l) => html.indexOf(`>${l}<`))
    assert.ok(labels.every((i, n) => i > -1 && (n === 0 || i > labels[n - 1])), 'the six labels, in order')
    assert.ok(html.includes('>ASA-1041<') && html.includes('>Direct Support Professional<') && html.includes('May 12, 2024'))
    assert.match(html, /href="tel:\+15550101100"[^>]*>\(555\) 010-1100</)
    assert.ok(html.includes('City and state only — the staff roster keeps no street address.'))
  })

  it('a field the records do not hold is the dash and its sentence, never a blank or a guess', () => {
    const v = view()
    v.details.fields = v.details.fields.map((x) => x.key === 'employee_id' ? f('employee_id', 'Employee ID', '', 'No employee ID is on file.') : x)
    const html = draw(<DetailsCard view={v} />)
    assert.ok(html.includes('—<span class="block text-[11px] leading-[1.4] text-text-3">No employee ID is on file.</span>'))
  })

  it('an unreadable card says so in danger, and whose details they are', () => {
    const why = 'the staff roster did not answer, and your account row did not answer'
    const v = view({ details: { ...view().details, state: 'unreadable', why } })
    const html = draw(<DetailsCard view={v} />)
    assert.ok(html.includes('text-[var(--danger)]') && html.includes(`Your details could not be read: ${why}.`))
    const other = view({
      person: { ...view().person, own: false, name: 'Bob Bee' },
      details: { ...view().details, state: 'unreadable', why: 'the staff roster did not answer, so no account tied to this row was looked up' },
    })
    const theirs = draw(<DetailsCard view={other} />)
    assert.ok(theirs.includes('This person’s details could not be read: the staff roster did not answer'))
    assert.ok(!theirs.includes('Your details'))
  })

  it('a record that could not be read, or cannot be told to be the person\'s, is its own sentence under the dash', () => {
    const v = view()
    v.details.fields = v.details.fields.map((x) => x.key === 'employee_id'
      ? f('employee_id', 'Employee ID', '', 'The staff roster could not be read, so this is not known.')
      : x.key === 'address' ? f('address', 'Address', '', 'Which staff roster row is yours cannot be told, so this is not shown.') : x)
    const html = draw(<DetailsCard view={v} />)
    assert.ok(html.includes('—<span class="block text-[11px] leading-[1.4] text-text-3">The staff roster could not be read, so this is not known.</span>'))
    assert.ok(html.includes('Which staff roster row is yours cannot be told, so this is not shown.'))
    assert.ok(!html.includes('No employee ID is on file.'))
  })

  it('a role from the account\'s own title carries its note', () => {
    const v = view()
    v.details.fields = v.details.fields.map((x) => x.key === 'role'
      ? f('role', 'Role', 'Caregiver', '', 'As written on the account\'s own profile, not taken from the staff roster.') : x)
    const html = draw(<DetailsCard view={v} />)
    assert.ok(html.includes('>Caregiver<span class="block text-[11px] leading-[1.4] text-text-3">As written on the account&#x27;s own profile, not taken from the staff roster.</span>'))
  })

  it('a chosen person is named in the title, never drawn as "My"', () => {
    const v = view({ person: { ...view().person, own: false, name: 'Bob Bee' } })
    assert.ok(draw(<DetailsCard view={v} />).includes('>Info · Bob Bee<'))
  })
})

describe('My Requirements', () => {
  const docs = docsFor(view(), readyUploads('own'))
  const html = draw(<RequirementsCard view={view()} docs={docs} onUpload={noop} onView={noop} />)

  it('the pills: Due soon amber, Current green, Needs attention red — never the info blue', () => {
    assert.equal(STATUS_PILL.soon, 'bg-tint-amber text-tint-fg-amber')
    assert.equal(STATUS_PILL.current, 'bg-[var(--status-green-soft)] text-[var(--status-green)]')
    assert.equal(STATUS_PILL.attention, 'bg-tint-danger text-tint-fg-danger')
    assert.match(html, /bg-tint-amber text-tint-fg-amber" data-status="soon">Due soon</)
    assert.match(html, /text-\[var\(--status-green\)\]" data-status="current">Current</)
    assert.match(html, /bg-tint-danger text-tint-fg-danger" data-status="attention">Needs attention</)
    assert.ok(!/--info|text-info|bg-info|tint-blue/.test(html))
  })

  it('the columns are the screen\'s, and the due date is coloured by how near it is', () => {
    const heads = ['Status', 'Requirement', 'Category', 'Due date', 'Version'].map((h) => html.indexOf(`<span>${h}</span>`))
    assert.ok(heads.every((i, n) => i > -1 && (n === 0 || i > heads[n - 1])))
    assert.equal(DUE_TONE_CLASS.overdue, 'text-[var(--danger)]')
    assert.match(html, /text-\[var\(--danger\)\]">Sep 22, 2026</)
    assert.match(html, /text-\[var\(--warning\)\]">Oct 15, 2026</)
    assert.match(html, /text-\[var\(--success\)\]">Jun 30, 2027</)
  })

  it('a blank due date is the dash and its sentence', () => {
    assert.ok(html.includes('The requirement row carries no expiry date.') && html.includes('Nothing is on file, so there is no date to run out.'))
    assert.ok(html.includes('—<span'))
  })

  it('a check HR runs is listed like the rest, its upload shut with the reason', () => {
    const v = view()
    v.requirements.rows = [...v.requirements.rows, row('sam', {
      requirement: 'SAM', cert: 'SAM', category: 'Background check', status: { class: 'attention', word: 'Needs attention' },
      due: '', due_tone: '', due_why: 'Nothing is on file, so there is no date to run out.', upload: { allowed: false, why: 'HR records this one.' },
    })]
    const out = draw(<RequirementsCard view={v} docs={docs} onUpload={noop} onView={noop} />)
    assert.match(out, /data-row="sam"[\s\S]*data-status="attention">Needs attention<[\s\S]*>SAM<[\s\S]*>Background check</)
    assert.match(out, /disabled="" data-upload="sam" aria-label="Upload and read into My Requirements — HR records this one\."/)
  })

  it('an upload the certificate door would refuse is shut with the relay\'s sentence', () => {
    const v = view()
    const why = 'No name that is yours alone is on the staff roster to file the upload under — hand the document to HR.'
    v.requirements.rows = v.requirements.rows.map((r) => r.id === 'cpr' ? { ...r, upload: { allowed: false, why } } : r)
    const out = draw(<RequirementsCard view={v} docs={docs} onUpload={noop} onView={noop} />)
    assert.ok(out.includes(`disabled="" data-upload="cpr" aria-label="${UPLOAD_AND_READ} — ${why}"`))
  })

  it('the eye is always open; the second icon reads a paper into the row, shut with the row\'s why where it cannot take one', () => {
    for (const id of ['ist', 'dodd', 'cpr', 'med', 'i9']) {
      assert.match(html, new RegExp(`<button type="button" class="[^"]*" data-view="${id}" aria-label="View the current version of `))
    }
    assert.ok(!/disabled="" data-view=/.test(html), 'no eye is shut, whether or not a version is on file')
    assert.match(html, /<button type="button" class="[^"]*" data-upload="cpr" aria-label="Upload and read into My Requirements: CPR \/ First Aid" title="Upload and read into My Requirements"/)
    assert.match(html, /disabled="" data-upload="i9" aria-label="Upload and read into My Requirements — HR files this form\." title="HR files this form\."/)
    // the second icon is the scan, never the plain upload arrow
    assert.ok(html.includes('lucide-scan-text') && !html.includes('lucide-upload'))
  })

  it('the eye on a requirement with no version opens "Current version" saying none is attached, with what is owed', () => {
    const v = view()
    v.requirements.rows = v.requirements.rows.map((r) => r.id === 'dodd'
      ? { ...r, details: [{ label: 'Evidence', value: 'Certificate of completion' }] } : r)
    const own = docsFor(v, readyUploads('own'))
    assert.deepEqual(versionCardHead({ kind: 'requirement', id: 'dodd' }, v, own), { title: 'Current version', subtitle: 'DODD annual training' })
    const card = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'dodd' }} view={v} docs={own} onConfirmed={noop} />)
    assert.ok(card.includes('>DODD annual training<') || card.includes(' DODD annual training<'))
    assert.ok(card.includes('Due soon · due Oct 15, 2026') && card.includes('Evidence: Certificate of completion'))
    assert.ok(card.includes('No version file is attached to this requirement.'))
    assert.ok(!card.includes('Opening the document') && !card.includes('Confirm this date'))
    // a ledger still being read never claims there is no version
    const reading = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'dodd' }} view={v} docs={docsFor(v, UPLOADS_IDLE)} onConfirmed={noop} />)
    assert.ok(reading.includes('The submitted documents are still being read.') && !reading.includes('No version file is attached'))
    const down = docsFor(v, { ...UPLOADS_IDLE, status: 'failed', error: 'the ledger is down' })
    assert.ok(draw(<VersionCardBody ask={{ kind: 'requirement', id: 'dodd' }} view={v} docs={down} onConfirmed={noop} />)
      .includes('The submitted documents could not be read: the ledger is down'))
    assert.equal(versionCardHead({ kind: 'requirement', id: 'gone' }, v, own), null)
  })

  it('the eye on a filed version shows it, its upload day, its reading and the document itself', () => {
    const { v, docs: withRead } = dated([filed('r1', 'cpr', 'CPR / First Aid', { read_state: 'read', expires_on: '2028-06-30', read_how: 'paper' })])
    const card = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'cpr' }} view={v} docs={withRead} onConfirmed={noop} />)
    assert.ok(card.includes('data-version="r1"') && card.includes('>r1.pdf<') && card.includes('Uploaded Sep 26, 2026'))
    assert.ok(card.includes('Reads: expires Jun 30, 2028 (read from your document).'))
    assert.ok(card.includes('Current · due Jun 30, 2028') && card.includes('From your document · not yet confirmed'))
    assert.ok(card.includes('Opening the document…'), 'the preview is read on open')
    assert.ok(!card.includes('drive.google.com'), 'no Drive link is drawn')
  })

  it('the current version is matched by requirement id first, then an older row by its label', () => {
    const own = docsFor(view(), readyUploads('own'))
    assert.equal(versionFor(row('cpr', { cert: 'CPR / First Aid' }), own.rows)?.id, 'u1')
    assert.equal(versionFor(row('x', { cert: 'Nothing like it' }), own.rows), null)
    const byId = filed('n1', 'cpr', 'A label since renamed')
    const other = filed('n2', 'dodd', 'CPR / First Aid')
    const docs = [other, byId, ...MINE]
    // an id wins over a newer row matched by label; a row filed under another id is never taken by its label
    assert.equal(versionFor(row('cpr', { cert: 'CPR / First Aid' }), docs)?.id, 'n1')
    assert.equal(versionFor(row('cpr', { cert: 'CPR / First Aid' }), [other, ...MINE])?.id, 'u1')
    assert.equal(rowFor(other, view().requirements.rows)?.id, 'dodd')
    assert.equal(docType(byId, [row('cpr', { category: 'Training' })]), 'Training')
  })

  it('on the master\'s chosen profile a version is filed under the roster name the relay gives; a shared name files nothing', () => {
    const chosen = (rows: RequirementRow[]) => view({
      scope: { mode: 'mass', why: '', person: 'PPL_BOB', people: [], people_why: '' },
      person: { ...view().person, own: false, name: 'Bob Bee', key: 'bobbee', roster_id: 'PPL_BOB' },
      requirements: { ...view().requirements, rows },
    })
    const bob = chosen(view().requirements.rows.map((r) => r.upload.allowed ? { ...r, file_as: 'Bob Bee' } : r))
    const out = draw(<RequirementsCard view={bob} docs={docsFor(bob, readyUploads('all'))} onUpload={noop} onView={noop} />)
    assert.match(out, /<button type="button" class="[^"]*" data-upload="cpr" aria-label="Upload and read into My Requirements: CPR \/ First Aid"/)
    assert.match(out, /disabled="" data-upload="i9" aria-label="Upload and read into My Requirements — HR files this form\."/)
    assert.ok(out.includes('A version uploaded here is filed under Bob Bee’s record.') && out.includes('>Requirements · Bob Bee<'))
    assert.ok(!out.includes('A new version is filed by the person'))
    const noName = 'No name that is yours alone is on the staff roster to file the upload under — hand the document to HR.'
    const twin = chosen(view().requirements.rows.map((r) => r.upload.allowed ? { ...r, upload: { allowed: false, why: noName } } : r))
    const shut = draw(<RequirementsCard view={twin} docs={docsFor(twin, readyUploads('all'))} onUpload={noop} onView={noop} />)
    assert.ok(!/<button type="button" class="[^"]*" data-upload=/.test(shut), 'every upload is shut')
    assert.ok(shut.includes(`data-upload="cpr" aria-label="${UPLOAD_AND_READ} — ${noName}"`) && !shut.includes('is filed under'))
  })

  it('a part that could not be read, or tied, says so and never claims there are none', () => {
    const unread = view({ requirements: { ...view().requirements, state: 'unreadable', why: 'the mirror is down', rows: [] } })
    const out = draw(<RequirementsCard view={unread} docs={docs} onUpload={noop} onView={noop} />)
    assert.ok(out.includes('Requirements could not be read: the mirror is down') && !out.includes('No requirement is on record'))
    const untied = view({ requirements: { ...view().requirements, state: 'not_attributable', why: 'no requirement row carries your name', rows: [] } })
    assert.ok(draw(<RequirementsCard view={untied} docs={docs} onUpload={noop} onView={noop} />).includes('Requirements: no requirement row carries your name'))
    assert.equal(requirementsEmpty(untied), '')
    assert.equal(requirementsEmpty(view({ requirements: { ...view().requirements, rows: [] } })), 'No requirement is on record for you.')
    assert.equal(requirementsEmpty(view({ requirements: { ...view().requirements, rows: [], gap: 'another row carries this name' } })), '')
  })
})

describe('a filed version beside the record (D1)', () => {
  const reqs = (v: MyProfileView, d: ReturnType<typeof docsFor>) => draw(<RequirementsCard view={v} docs={d} onUpload={noop} onView={noop} />)

  it('a read version flips the pill to Current, due the read expiry, "From your document · not yet confirmed"', () => {
    const { v, docs } = dated([filed('r1', 'dodd', 'DODD annual training', { read_state: 'read', expires_on: '2027-10-15', read_how: 'paper' })])
    const html = reqs(v, docs)
    assert.deepEqual(pillOf(html, 'dodd'), ['current', 'Current'])
    assert.match(html, /data-due="dodd" class="[^"]*text-\[var\(--success\)\]">Oct 15, 2027</)
    assert.ok(html.includes('data-filed="dodd">From your document · not yet confirmed<'))
    // the rows it does not touch keep the engine's words
    assert.deepEqual(pillOf(html, 'ist'), ['attention', 'Needs attention'])
    assert.ok(!html.includes('data-filed="cpr"'))
  })

  it('a read date inside the window is Due soon, a past one Needs attention — the relay\'s own rule', () => {
    const { v } = dated()
    const dodd = rowOf(v, 'dodd')
    const soon = filedStatus({ ...dodd, due: '2026-10-01' }, filed('a', 'dodd', 'x', { read_state: 'read', expires_on: '2026-10-20' }), '2026-09-25', 30)
    assert.deepEqual([soon.status, soon.due, soon.due_tone, soon.fromDoc], [{ class: 'soon', word: 'Due soon' }, '2026-10-20', 'soon', true])
    const past = filedStatus({ ...dodd, due: '', due_why: 'Nothing is on file, so there is no date to run out.' },
      filed('b', 'dodd', 'x', { read_state: 'read', expires_on: '2026-09-20' }), '2026-09-25', 30)
    assert.deepEqual([past.status, past.due_tone], [{ class: 'attention', word: 'Needs attention' }, 'overdue'])
    // status_of: past is before the day; the window's last day is still due soon
    assert.deepEqual(dayClass('2026-09-25', '2026-09-25', 30), { cls: 'soon', tone: 'soon' })
    assert.deepEqual(dayClass('2026-10-25', '2026-09-25', 30), { cls: 'soon', tone: 'soon' })
    assert.deepEqual(dayClass('2026-10-26', '2026-09-25', 30), { cls: 'current', tone: 'later' })
    assert.deepEqual(dayClass('2026-09-24', '2026-09-25', 30), { cls: 'attention', tone: 'overdue' })
    assert.equal(dayClass('2026-10-26', undefined, 30), null)
    assert.equal(dayClass('2026-10-26', '2026-09-25', undefined), null)
  })

  it('an unread version keeps the engine pill and says why, in words', () => {
    const why = 'This paper names someone else.'
    const { v, docs } = dated([filed('r1', 'dodd', 'DODD annual training', { read_state: 'unread', read_why: why })])
    const html = reqs(v, docs)
    assert.deepEqual(pillOf(html, 'dodd'), ['soon', 'Due soon'])
    assert.match(html, /data-due="dodd" class="[^"]*text-\[var\(--warning\)\]">Oct 15, 2026</)
    assert.ok(html.includes('data-filed="dodd">A version was filed Sep 26, 2026 · no date could be read from it<'))
    const card = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'dodd' }} view={v} docs={docs} onConfirmed={noop} />)
    assert.ok(card.includes('We could not read a date from this file: this paper names someone else. Your status stays as it was; ' +
      'HR confirms the date from the document.'))
    assert.equal(unreadWords('The file could not be read after 3 tries — HR confirms the date from the document.'),
      'We could not read a date from this file: the file could not be read after 3 tries — HR confirms the date from the document. ' +
      'Your status stays as it was.')
  })

  it('an I-9 document row: a paper of another kind keeps the engine pill and says so; a licence\'s expiry reads', () => {
    const v = view()
    v.requirements.rows = [...v.requirements.rows, row('i9_type_1', { requirement: 'I-9 Type 1', cert: 'I-9 Type 1', category: 'Documents',
      dated: true, date_role: 'expires', status: { class: 'attention', word: 'Needs attention' }, due: '', due_tone: '',
      due_why: 'Nothing is on file, so there is no date to run out.' })]
    const wrong = filed('w1', 'i9_type_1', 'I-9 Type 1', { read_state: 'unread', read_kind: 'cpr_first_aid', expires_on: '2028-04-17',
      read_why: 'This reads as a CPR / First Aid card, not an I-9 Type 1.' })
    const withWrong = docsFor(v, readyUploads('own', [wrong, ...MINE]))
    const html = reqs(v, withWrong)
    assert.deepEqual(pillOf(html, 'i9_type_1'), ['attention', 'Needs attention'])
    assert.ok(!html.includes('Apr 17, 2028'), 'the CPR expiry is never the I-9 document\'s due date')
    const card = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'i9_type_1' }} view={v} docs={withWrong} onConfirmed={noop} />)
    assert.ok(card.includes('We could not read a date from this file: this reads as a CPR / First Aid card, not an I-9 Type 1.'))
    const licence = filed('l1', 'i9_type_1', 'I-9 Type 1', { read_state: 'read', read_kind: 'drivers_licence', expires_on: '2029-04-17' })
    const withLicence = reqs(v, docsFor(v, readyUploads('own', [licence, ...MINE])))
    assert.deepEqual(pillOf(withLicence, 'i9_type_1'), ['current', 'Current'])
    assert.ok(withLicence.includes('data-filed="i9_type_1">From your document · not yet confirmed<'))
  })

  it('a read date older than the record keeps the pill, and the card says so', () => {
    const { v, docs } = dated([filed('r1', 'dodd', 'DODD annual training', { read_state: 'read', expires_on: '2026-06-01' })])
    const html = reqs(v, docs)
    assert.deepEqual(pillOf(html, 'dodd'), ['soon', 'Due soon'])
    assert.match(html, /data-due="dodd" class="[^"]*">Oct 15, 2026</)
    assert.ok(!html.includes('data-filed="dodd"'))
    const card = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'dodd' }} view={v} docs={docs} onConfirmed={noop} />)
    assert.ok(card.includes('Your upload reads Jun 1, 2026, older than the record’s Oct 15, 2026.'))
    const same = filedStatus(rowOf(v, 'dodd'), filed('s', 'dodd', 'x', { read_state: 'read', expires_on: '2026-10-15' }), '2026-09-25', 30)
    assert.equal(same.fromDoc, false)
    assert.equal(same.reads, 'Your upload reads Oct 15, 2026, the day the record already holds.')
  })

  it('a reading still running, an undated requirement and a confirmed date each say what they are', () => {
    const { v } = dated()
    const dodd = rowOf(v, 'dodd')
    const pending = filedStatus(dodd, filed('p', 'dodd', 'x', { read_state: 'pending' }), '2026-09-25', 30)
    assert.deepEqual([pending.status, pending.sub], [dodd.status, READING_DATES])
    const retry = filedStatus(dodd, filed('p', 'dodd', 'x', { read_state: 'pending',
      read_why: 'The file could not be read just now — it is read again within minutes.' }), '2026-09-25', 30)
    assert.equal(retry.reads, 'The file could not be read just now — it is read again within minutes.')
    // a requirement the record keeps no date for: the engine's pill, and the filing said
    const mais = row('mais', { requirement: 'MAIS', cert: 'MAIS', dated: false, status: { class: 'attention', word: 'Needs attention' }, due: '' })
    const undated = filedStatus(mais, filed('m', 'mais', 'MAIS', { read_state: 'read' }), '2026-09-25', 30)
    assert.deepEqual([undated.status, undated.due, undated.sub], [mais.status, '', 'A version was filed Sep 26, 2026 · not yet confirmed'])
    // the master confirmed a later date: it stands until the engine's next check carries it
    const confirmed = filedStatus(dodd, filed('c', 'dodd', 'x', { read_state: 'unread', confirmed_on: '2027-10-15' }), '2026-09-25', 30)
    assert.deepEqual([confirmed.status.class, confirmed.due, confirmed.sub], ['current', '2027-10-15', CONFIRMED_SUB])
    const caughtUp = filedStatus({ ...dodd, due: '2027-10-15' }, filed('c', 'dodd', 'x', { confirmed_on: '2027-10-15' }), '2026-09-25', 30)
    assert.deepEqual([caughtUp.fromDoc, caughtUp.sub], [false, ''])
    // a version from before papers were read changes nothing
    const legacy = filedStatus(dodd, up('l', 'Maya Chen', 'DODD annual training', '2025-01-01T12:00:00Z'), '2026-09-25', 30)
    assert.deepEqual([legacy.status, legacy.sub, legacy.reads], [dodd.status, '', ''])
  })

  it('an abstract keeps the document\'s own date: it is never classed as a due date, and the card says the day read', () => {
    const abstract = row('drive_abstract', { requirement: 'Driver\'s Abstract', cert: 'Driver\'s Abstract', category: 'Documents',
      dated: false, date_role: 'issued', due: '', due_tone: '', due_why: 'The requirement row carries no expiry date.' })
    // the licence expiry an abstract prints never reaches the row: only the day it was drawn is read
    const read = filed('a', 'drive_abstract', 'Driver\'s Abstract', { read_state: 'read', issued_on: '2026-09-20', expires_on: '' })
    const got = filedStatus(abstract, read, '2026-09-25', 30)
    assert.deepEqual([got.status, got.due, got.fromDoc], [abstract.status, '', false])
    assert.equal(got.sub, 'A version was filed Sep 26, 2026 · not yet confirmed')
    assert.equal(got.reads, 'Reads: dated Sep 20, 2026 (read from your document).')
    // even a stray expiry on the row moves nothing
    const stray = filedStatus(abstract, { ...read, expires_on: '2029-04-17' }, '2026-09-25', 30)
    assert.deepEqual([stray.status, stray.due, stray.fromDoc], [abstract.status, '', false])
    const unread = filedStatus(abstract, filed('b', 'drive_abstract', 'x', { read_state: 'unread',
      read_why: 'No date of issue could be read from this file.' }), '2026-09-25', 30)
    assert.equal(unread.reads, 'We could not read a date from this file: no date of issue could be read from this file. ' +
      'Your status stays as it was; HR confirms the date from the document.')
    // a confirmed abstract date is the record's, and still never a due date
    const confirmed = filedStatus(abstract, filed('c', 'drive_abstract', 'x', { read_state: 'read', issued_on: '2026-09-20',
      confirmed_on: '2026-09-20' }), '2026-09-25', 30)
    assert.deepEqual([confirmed.status, confirmed.due, confirmed.fromDoc, confirmed.reads],
      [abstract.status, '', false, 'Confirmed Sep 20, 2026 into the record.'])
  })

  it('FAIL-CLOSED: without the day the part was classed on, a read date is not classed', () => {
    const { v } = dated()
    const read = filed('r', 'dodd', 'x', { read_state: 'read', expires_on: '2027-10-15' })
    const got = filedStatus(rowOf(v, 'dodd'), read, undefined, undefined)
    assert.deepEqual([got.status, got.due, got.fromDoc], [rowOf(v, 'dodd').status, '2026-10-15', false])
    assert.ok(got.reads.startsWith('Reads: expires Oct 15, 2027'))
    // a row the relay did not mark as dated is never moved by a read date
    const plain = filedStatus({ ...rowOf(v, 'dodd'), dated: undefined }, read, '2026-09-25', 30)
    assert.equal(plain.fromDoc, false)
  })

  it('the totals stay the engine\'s own counts: the overlay touches no row and no total', () => {
    const { v, docs } = dated([filed('r1', 'dodd', 'DODD annual training', { read_state: 'read', expires_on: '2027-10-15' })])
    const before = JSON.stringify(v.requirements)
    const html = reqs(v, docs)
    assert.deepEqual(pillOf(html, 'dodd'), ['current', 'Current'])
    assert.equal(JSON.stringify(v.requirements), before)
    assert.deepEqual(v.requirements.totals, { current: 2, soon: 1, attention: 2, unknown: 0 })
  })

  it('on the master\'s chosen profile the lines speak of the document, not "your"', () => {
    const { v } = dated()
    const got = filedStatus(rowOf(v, 'dodd'), filed('r', 'dodd', 'x', { read_state: 'read', expires_on: '2027-10-15' }), '2026-09-25', 30, false)
    assert.deepEqual([got.sub, got.reads], ['From the document · not yet confirmed', 'Reads: expires Oct 15, 2027 (read from the document).'])
    assert.equal(readResult(rowOf(v, 'dodd'), filed('r', 'dodd', 'x', { read_state: 'unread', read_why: 'No words could be read from this file.' }), '2026-09-25', 30, false),
      'We could not read a date from this file: no words could be read from this file. The status stays as it was; HR confirms the date from the document.')
  })
})

describe('the master\'s confirmation', () => {
  const chosen = () => {
    const v = view({
      scope: { mode: 'mass', why: '', person: 'PPL_MAYA', people: [], people_why: '' },
      person: { ...view().person, own: false },
    })
    v.requirements.rows = v.requirements.rows.map((r) => r.id === 'cpr'
      ? { ...r, dated: true, confirm: { allowed: true, why: '' } }
      : r.id === 'med' ? { ...r, confirm: { allowed: false, why: 'Med Delivery dates are written by the MAIS registry check, not here.' } } : r)
    return v
  }

  it('appears only in master mode, on a person the master chose: the record, a date, and "Confirm this date"', () => {
    const v = chosen()
    const read = filed('r1', 'cpr', 'CPR / First Aid', { read_state: 'read', expires_on: '2028-06-30' })
    const docs = docsFor(v, readyUploads('all', [read, ...LEDGER]))
    const html = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'cpr' }} view={v} docs={docs} onConfirmed={noop} />)
    assert.ok(html.includes('Record: reading…') && html.includes('Confirm this date'))
    assert.match(html, /type="date" [^>]*value="2028-06-30"/)
    // the button waits for the record it is checked against
    assert.match(html, /disabled="" data-confirm-button="cpr"/)
    // own profile — even the master's own — draws no confirmation at all
    const own = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'cpr' }} view={view()} docs={docsFor(view(), readyUploads('own', [read, ...MINE]))} onConfirmed={noop} />)
    assert.ok(!own.includes('Confirm this date') && !own.includes('Record:'))
    const mastersOwn = view({ scope: { mode: 'mass', why: '', person: '', people: [], people_why: '' } })
    const mine = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'cpr' }} view={mastersOwn} docs={docsFor(mastersOwn, readyUploads('all', [read, ...LEDGER]))} onConfirmed={noop} />)
    assert.ok(!mine.includes('Confirm this date'))
  })

  it('a version with no read date asks for the date typed from the document; a row the record takes no date for says why', () => {
    const v = chosen()
    const docs = docsFor(v, readyUploads('all', [filed('u9', 'cpr', 'CPR / First Aid', { read_state: 'unread', read_why: 'No words could be read from this file.' }),
      filed('m9', 'med', 'Req med', { read_state: 'read' }), ...LEDGER]))
    const html = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'cpr' }} view={v} docs={docs} onConfirmed={noop} />)
    assert.match(html, /type="date" [^>]*value=""/)
    assert.ok(html.includes('No date was read from this file — type the date shown on the document.') && html.includes('Confirm this date'))
    const med = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'med' }} view={v} docs={docs} onConfirmed={noop} />)
    assert.ok(med.includes('Med Delivery dates are written by the MAIS registry check, not here.') && !med.includes('Confirm this date'))
  })

  it('an abstract\'s confirmation carries the day it was drawn, never the licence expiry it prints', () => {
    const v = chosen()
    v.requirements.rows = [...v.requirements.rows, row('drive_abstract', { requirement: 'Driver\'s Abstract', cert: 'Driver\'s Abstract',
      dated: false, date_role: 'issued', due: '', due_tone: '', confirm: { allowed: true, why: '' } })]
    const read = filed('a1', 'drive_abstract', 'Driver\'s Abstract', { read_state: 'read', issued_on: '2026-09-20', expires_on: '2029-04-17' })
    const docs = docsFor(v, readyUploads('all', [read, ...LEDGER]))
    const html = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'drive_abstract' }} view={v} docs={docs} onConfirmed={noop} />)
    assert.match(html, /type="date" [^>]*value="2026-09-20"/)
    assert.ok(html.includes('Date of the document') && html.includes('Confirm this date') && !html.includes('2029-04-17'))
    const cpr = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'cpr' }} view={v}
      docs={docsFor(v, readyUploads('all', [filed('r1', 'cpr', 'CPR / First Aid', { read_state: 'read', expires_on: '2028-06-30' }), ...LEDGER]))} onConfirmed={noop} />)
    assert.ok(cpr.includes('Expiry date'))
  })
})

describe('My Docs', () => {
  it('an own answer is the caller\'s own rows, newest first, and only on the caller\'s own profile', () => {
    // the ledger's door narrowed it: the screen never filters an own answer again
    assert.deepEqual(docsFor(view(), readyUploads('own', LEDGER)).rows.map((d) => d.id), ['u1', 'u3', 'u2', 'u4'])
    const other = view({ person: { ...view().person, own: false } })
    assert.deepEqual(docsFor(other, readyUploads('own')), { rows: [], landed: false, tone: 'warning', note: OTHERS_PRIVATE, uploadWhy: '' })
  })

  it('an own answer the ledger settled under another roster row than the relay\'s draws nothing, and says so', () => {
    const dana = [up('d1', 'Dana Old', 'CPR / First Aid', '2026-08-01T12:00:00Z')]
    const got = docsFor(view(), readyUploads('own', dana, 'Dana Old'))
    assert.deepEqual(got.rows, [])
    assert.equal(got.landed, false)
    assert.equal(got.note, LEDGER_OTHER_ROW)
    const html = draw(<DocsCard view={view()} docs={got} onView={noop} />)
    assert.ok(html.includes(LEDGER_OTHER_ROW) && !html.includes('data-doc=') && !html.includes('d1.pdf'))
    assert.ok(!html.includes('You have not submitted any documents yet.'))
    const reqs = draw(<RequirementsCard view={view()} docs={got} onUpload={noop} onView={noop} />)
    assert.match(reqs, /<button type="button" class="[^"]*" data-view="cpr" aria-label="View the current version of CPR \/ First Aid"/)
    assert.match(reqs, /disabled="" data-upload="cpr" aria-label="Upload and read into My Requirements — The certificate ledger knows this account by another staff roster row/)
    // the card says why no version is shown, never that none is attached, and draws none of that row's
    const card = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'cpr' }} view={view()} docs={got} onConfirmed={noop} />)
    assert.ok(card.includes(LEDGER_OTHER_ROW) && !card.includes('No version file is attached') && !card.includes('d1.pdf'))
    // an answer with no `self` at all is not taken as the relay's person either
    assert.deepEqual(docsFor(view(), readyUploads('own', MINE, '')).rows, [])
  })

  it('an own answer with no roster row settled by the relay draws nothing, in the relay\'s words', () => {
    const why = 'no staff roster row is settled as yours, so no submitted document can be matched to you'
    const v = view({ person: { ...view().person, key: '', key_why: why, roster_id: '' } })
    const got = docsFor(v, readyUploads('own', [up('d1', 'Dana Old', 'CPR / First Aid', '2026-08-01T12:00:00Z')], 'Dana Old'))
    assert.deepEqual(got.rows, [])
    assert.equal(got.note, 'No staff roster row is settled as yours, so no submitted document can be matched to you.')
    assert.equal(got.uploadWhy, got.note)
  })

  it('a ledger that refuses the caller\'s own record shuts the upload with the door\'s own words', () => {
    const door = 'Your sign-in e-mail is on one row of the staff roster and your name is on another, so which record is yours cannot be settled'
    const got = docsFor(view(), refusedUploads(door))
    assert.equal(got.tone, 'warning')
    assert.equal(got.note, `Your submitted documents are not shown — ${door}.`)
    assert.deepEqual(uploadFor(row('cpr'), got), { allowed: false, why: `${door}.` })
    // a relay refusal keeps its own words; a door that answered leaves the relay's verdict
    assert.deepEqual(uploadFor(row('i9', { upload: { allowed: false, why: 'HR files this form.' } }), got), { allowed: false, why: 'HR files this form.' })
    assert.deepEqual(uploadFor(row('cpr'), docsFor(view(), readyUploads('own'))), { allowed: true, why: '' })
    assert.deepEqual(uploadFor(row('cpr'), docsFor(view(), readyUploads('all'))), { allowed: true, why: '' })
    // a ledger still being read, or failing, offers nothing that may not land
    assert.equal(uploadFor(row('cpr'), docsFor(view(), { ...UPLOADS_IDLE, status: 'loading' })).allowed, false)
    const down = uploadFor(row('cpr'), docsFor(view(), { ...UPLOADS_IDLE, status: 'failed', error: 'the ledger is down' }))
    assert.deepEqual(down, { allowed: false, why: 'Whose record a new version is filed under could not be read: the ledger is down — try again in a minute.' })
  })

  it('the master\'s whole-ledger answer is cut to the profile\'s roster name; with no name, nothing, in words', () => {
    assert.deepEqual(docsFor(view(), readyUploads('all')).rows.map((d) => d.id), ['u1', 'u2', 'u4'])
    const nameless = view({ person: { ...view().person, key: '', key_why: 'no roster name that is this profile\'s alone is on file' } })
    const got = docsFor(nameless, readyUploads('all'))
    assert.equal(got.rows.length, 0)
    assert.equal(got.landed, false)
    assert.match(got.note, /^No roster name that is this profile's alone is on file\.$/)
  })

  it('the master\'s cut leaves out a paper stamped for another roster row under the same name — never its current version', () => {
    const v = view({
      scope: { mode: 'mass', why: '', person: 'PPL_MAYA', people: [], people_why: '' },
      person: { ...view().person, own: false },
    })
    v.requirements.rows = v.requirements.rows.map((r) => r.id === 'cpr' ? { ...r, dated: true, confirm: { allowed: true, why: '' } } : r)
    const earlier = filed('e1', 'cpr', 'CPR / First Aid', { roster_id: 'PPL_GONE', read_state: 'read', expires_on: '2029-01-01', at: '2026-09-27T12:00:00Z' })
    const hers = filed('h1', 'cpr', 'CPR / First Aid', { roster_id: 'people:PPL_MAYA', read_state: 'read', expires_on: '2028-06-30' })
    const docs = docsFor(v, readyUploads('all', [earlier, hers, ...LEDGER]))
    assert.deepEqual(docs.rows.map((d) => d.id), ['h1', 'u1', 'u2', 'u4'], 'a stamped row of her own and the older unstamped rows stay')
    assert.equal(versionFor(rowOf(v, 'cpr'), docs.rows)?.id, 'h1')
    const card = draw(<VersionCardBody ask={{ kind: 'requirement', id: 'cpr' }} view={v} docs={docs} onConfirmed={noop} />)
    assert.match(card, /type="date" [^>]*value="2028-06-30"/)
    assert.ok(!card.includes('2029') && !card.includes('data-version="e1"'))
  })

  it('an unreadable ledger is said in danger, never an empty list', () => {
    const got = docsFor(view(), { ...UPLOADS_IDLE, status: 'failed', error: 'Your name is shared with another account' })
    assert.equal(got.tone, 'danger')
    const html = draw(<DocsCard view={view()} docs={got} onView={noop} />)
    assert.ok(html.includes('The submitted documents could not be read: Your name is shared with another account'))
    assert.ok(!html.includes('You have not submitted any documents yet.'))
  })

  it('draws the eye, the document, its type and its upload date; a blank date is the dash and its sentence', () => {
    const docs = docsFor(view(), readyUploads('all'))
    const html = draw(<DocsCard view={view()} docs={docs} onView={noop} />)
    assert.ok(html.includes('>My Docs<'))
    const heads = ['Document', 'Doc type', 'Upload date'].map((h) => html.indexOf(`<span>${h}</span>`))
    assert.ok(heads.every((i, n) => i > -1 && (n === 0 || i > heads[n - 1])))
    assert.ok(html.includes('aria-label="View CPR / First Aid"') && html.includes('>u1.pdf<') && html.includes('Sep 16, 2026'))
    assert.ok(html.includes('>Certification<'), 'the type of the requirement it was filed for')
    assert.ok(html.includes('>Certificate<'), 'what the ledger is, for a document filed for no requirement listed')
    assert.ok(html.includes('The ledger keeps no readable date for it.'))
    assert.equal(docType(up('z', 'Maya Chen', 'Nothing', ''), view().requirements.rows), 'Certificate')
  })

  it('every eye opens the document\'s card, a row the ledger keeps no link for included', () => {
    const rows = [up('n1', 'Maya Chen', 'CPR / First Aid', '2026-09-20T12:00:00Z', ''), ...MINE]
    const html = draw(<DocsCard view={view()} docs={docsFor(view(), readyUploads('own', rows))} onView={noop} />)
    assert.ok(!/disabled=""/.test(html), 'no eye is shut')
    assert.match(html, /<button type="button" class="[^"]*" data-view-doc="n1" aria-label="View CPR \/ First Aid"/)
  })

  it('the card shows the document, "<Doc type> · Uploaded <day>", the requirement\'s status and the document inline', () => {
    const v = view()
    v.requirements.rows = v.requirements.rows.map((r) => r.id === 'cpr' ? { ...r, category: 'Training', dated: true } : r)
    const docs = docsFor(v, readyUploads('own'))
    assert.deepEqual(versionCardHead({ kind: 'doc', id: 'u1' }, v, docs), { title: 'CPR / First Aid', subtitle: 'Training · Uploaded Sep 16, 2026' })
    const card = draw(<VersionCardBody ask={{ kind: 'doc', id: 'u1' }} view={v} docs={docs} onConfirmed={noop} />)
    assert.ok(card.includes('Status: Current. This document is attached to your profile.'))
    assert.ok(card.includes('Opening the document…') && !card.includes('Confirm this date'))
    // a document filed for no requirement listed is attached, with no status claimed
    const loose = draw(<VersionCardBody ask={{ kind: 'doc', id: 'u4' }} view={v} docs={docs} onConfirmed={noop} />)
    assert.ok(loose.includes('This document is attached to your profile.') && !loose.includes('Status:'))
    assert.equal(versionCardHead({ kind: 'doc', id: 'u4' }, v, docs)?.subtitle, 'Certificate · Uploaded on a day not recorded')
    // a read document says its reading beside the status the row shows
    const read = filed('r1', 'cpr', 'CPR / First Aid', { read_state: 'read', expires_on: '2028-06-30' })
    const withRead = docsFor(v, readyUploads('own', [read, ...MINE]))
    const readCard = draw(<VersionCardBody ask={{ kind: 'doc', id: 'r1' }} view={v} docs={withRead} onConfirmed={noop} />)
    assert.ok(readCard.includes('Status: Current. Reads: expires Jun 30, 2028 (read from your document).'))
    assert.equal(versionCardHead({ kind: 'doc', id: 'gone' }, v, docs), null)
  })

  it('the empty sentence is earned only by a ledger that answered', () => {
    const none = docsFor(view(), readyUploads('own', []))
    assert.ok(draw(<DocsCard view={view()} docs={none} onView={noop} />).includes('You have not submitted any documents yet.'))
    assert.ok(!draw(<DocsCard view={view()} docs={docsFor(view(), UPLOADS_IDLE)} onView={noop} />).includes('You have not submitted'))
  })
})

describe('the right panel, never a modal', () => {
  const card = (ask: VersionAsk | null, v: MyProfileView | null = view()) =>
    draw(<VersionCard ask={ask} view={v} uploads={readyUploads('own')} onClose={noop} onConfirmed={noop} />)
  const MODAL = /aria-modal|role="dialog"|role="alertdialog"/

  it('the eye on My Requirements opens "Current version" in the right panel, the version and its document inside', () => {
    const html = card({ kind: 'requirement', id: 'cpr' })
    assert.match(html, new RegExp(`<aside aria-label="${VERSION_PANEL_LABEL.requirement}"`))
    assert.ok(html.includes('>Current version</h2>') && html.includes('data-card-subtitle="">CPR / First Aid</p>'))
    assert.ok(html.includes('data-card="cpr"') && html.includes('data-version="u1"') && html.includes('Uploaded Sep 16, 2026'))
    assert.ok(html.includes('Opening the document…'), 'the document is read into the panel')
    assert.ok(html.includes('data-panel-scrim') && html.includes('aria-label="Close requirement panel"'))
    assert.doesNotMatch(html, MODAL)
  })

  it('the eye on My Docs opens the document in the same panel', () => {
    const html = card({ kind: 'doc', id: 'u1' })
    assert.match(html, new RegExp(`<aside aria-label="${VERSION_PANEL_LABEL.doc}"`))
    assert.ok(html.includes('>CPR / First Aid</h2>') && html.includes('data-card-doc="u1"') && html.includes('Opening the document…'))
    assert.ok(html.includes('aria-label="Close document panel"'))
    assert.doesNotMatch(html, MODAL)
  })

  it('nothing is drawn with no ask, no answer, or an ask no longer on the profile', () => {
    assert.equal(card(null), '')
    assert.equal(card({ kind: 'requirement', id: 'cpr' }, null), '')
    assert.equal(card({ kind: 'doc', id: 'gone' }), '')
  })

  it('the master\'s Record, date and "Confirm this date" ride in the panel', () => {
    const v = view({
      scope: { mode: 'mass', why: '', person: 'PPL_MAYA', people: [], people_why: '' },
      person: { ...view().person, own: false },
    })
    v.requirements.rows = v.requirements.rows.map((r) => r.id === 'cpr' ? { ...r, dated: true, confirm: { allowed: true, why: '' } } : r)
    const read = filed('r1', 'cpr', 'CPR / First Aid', { read_state: 'read', expires_on: '2028-06-30' })
    const html = draw(<VersionCard ask={{ kind: 'requirement', id: 'cpr' }} view={v} uploads={readyUploads('all', [read, ...LEDGER])}
      onClose={noop} onConfirmed={noop} />)
    assert.match(html, /<aside aria-label="Requirement"/)
    assert.ok(html.includes('Reads: expires Jun 30, 2028') && html.includes('Record: reading…') && html.includes('Confirm this date'))
    assert.match(html, /type="date" [^>]*value="2028-06-30"/)
  })

  it('Escape closes the card, the scrim closes it, and a closed card listens to nothing', () => {
    let closed = 0
    const onClose = () => { closed++ }
    const uploads = readyUploads('own')
    type Panel = ReactElement<ComponentProps<typeof SidePanel>>
    type Tree = ReactElement<{ children: ReactElement<{ children: ReactElement<{ onClose: () => void }>[] }> | false }>
    // the card's own panel, run by real React with the props the card hands it
    const h = mountHook((p: { ask: VersionAsk | null }) => {
      const panel = VersionCard({ ask: p.ask, view: view(), uploads, onClose, onConfirmed: noop }) as Panel
      return { panel, tree: SidePanel(panel.props) as Tree }
    }, { ask: { kind: 'requirement', id: 'cpr' } })
    assert.equal(h.current.panel.type, SidePanel)
    assert.equal(h.current.panel.props.open, true)
    press('Enter')
    assert.equal(closed, 0)
    press('Escape')
    assert.equal(closed, 1)
    const open = h.current.tree.props.children
    assert.ok(open, 'the panel is drawn')
    const scrim = open.props.children.find((c) => c.type === PanelScrim) as ReactElement<{ onClose: () => void }>
    const shade = PanelScrim(scrim.props) as unknown as { props: { onClick: () => void } }
    shade.props.onClick()
    assert.equal(closed, 2)
    h.rerender({ ask: null })
    assert.equal(h.current.panel.props.open, false)
    press('Escape')
    assert.equal(closed, 2, 'a closed card listens to nothing')
    // what the card was opened for left the profile: the ask is let go
    h.rerender({ ask: { kind: 'doc', id: 'gone' } })
    assert.equal(closed, 3)
    h.unmount()
  })

  it('the scan opens in the same right panel, the upload flow whole inside', () => {
    const ask: ProfileUploadAsk = { row: rowOf(view(), 'cpr'), own: true, on: '2026-09-25', window: 30 }
    const html = draw(<ProfileUploadSheet ask={ask} onClose={noop} onFiled={noop} />)
    assert.match(html, new RegExp(`<aside aria-label="${UPLOAD_PANEL_LABEL}"`))
    assert.ok(html.includes(`>${UPLOAD_AND_READ}</h2>`) && html.includes('data-upload-for="cpr">CPR / First Aid</p>'))
    assert.ok(html.includes('against your own record') && html.includes('Choose a file'))
    assert.match(html, /<input type="file" accept="image\/\*,application\/pdf"/)
    assert.doesNotMatch(html, MODAL)
    assert.equal(draw(<ProfileUploadSheet ask={null} onClose={noop} onFiled={noop} />), '')
  })

  it('one panel at a time: the eye and the scan take turns in it, and a new page or person lets it go', () => {
    const upload: ProfileUploadAsk = { row: rowOf(view(), 'cpr'), own: true }
    type Where = { page: 'requirements' | 'docs'; person: string }
    const h = mountHook((p: Where) => useProfilePanel(p.page, p.person), { page: 'requirements', person: '' })
    assert.equal(h.current.card, null)
    assert.equal(h.current.upload, null)
    h.run(() => h.current.onView({ kind: 'requirement', id: 'cpr' }))
    assert.deepEqual(h.current.card, { kind: 'requirement', id: 'cpr' })
    h.run(() => h.current.onUpload(upload))
    assert.equal(h.current.card, null, 'the scan takes the panel from the card')
    assert.equal(h.current.upload, upload)
    h.run(() => h.current.onView({ kind: 'requirement', id: 'dodd' }))
    assert.equal(h.current.upload, null, 'and the eye takes it back')
    h.run(() => h.current.onClose())
    assert.equal(h.current.card, null)
    h.run(() => h.current.onView({ kind: 'requirement', id: 'cpr' }))
    h.rerender({ page: 'requirements', person: 'PPL_BOB' })
    assert.equal(h.current.card, null, 'another person closes it')
    h.rerender({ page: 'requirements', person: '' })
    assert.equal(h.current.card, null, 'coming back never reopens it')
    h.run(() => h.current.onView({ kind: 'doc', id: 'u1' }))
    h.rerender({ page: 'docs', person: '' })
    assert.equal(h.current.card, null, 'another page closes it')
    h.unmount()
  })

  it('no modal anywhere in My Profile: no Dialog or Sheet primitive and no aria-modal', () => {
    const dir = resolve(ROOT, 'src/pages/features/myprofile')
    for (const file of readdirSync(dir)) {
      const text = readFileSync(join(dir, file), 'utf8')
      assert.doesNotMatch(text, /from '@\/components\/ui\/(dialog|alert-dialog|sheet|drawer)'|from '@radix-ui\/react-(alert-)?dialog'|from 'vaul'/, file)
      assert.doesNotMatch(text, /<(Dialog|AlertDialog|Sheet|Drawer)\w*[\s>]/, file)
      assert.doesNotMatch(text, MODAL, file)
    }
  })
})

describe('a roster row the relay refused: its rows are never drawn as the caller\'s', () => {
  // the relay's own sentences (server/my_profile.py) for an own profile with no roster row settled
  const NOT_YOURS = 'a staff roster row under your name is not taken as yours — HR can settle which record is yours'
  const ONLY = 'your requirement rows are matched only through your own staff roster row, so none is shown'
  const SHARED = 'another row of the staff roster carries your name, so requirement rows filed under it cannot be told apart — HR can settle which row is yours'
  const NO_ROW_KEY = 'no staff roster row is settled as yours, so no submitted document can be matched to you'
  const TWIN_KEY = 'another row of the staff roster carries your name, so documents filed under it cannot be told apart'
  const refusedView = (name: string, why: string, keyWhy: string, rosterId = ''): MyProfileView => view({
    person: { name, key: '', key_why: keyWhy, roster_id: rosterId, own: true, notes: [] },
    requirements: { state: 'not_attributable', why, rows: [], note: '', as_of: '', copy_why: '', gap: '', totals: { current: 0, soon: 0, attention: 0, unknown: 0 } },
  })
  const probes: { label: string; v: MyProfileView; theirs: UploadRow[]; self: string; door: string }[] = [
    {
      label: 'Kim Lee — the row under the name is tied to another live account',
      v: refusedView('Kim Lee', `${NOT_YOURS} — ${ONLY}`, NO_ROW_KEY),
      theirs: [up('k1', 'Kim Lee', 'CPR / First Aid', '2026-09-01T12:00:00Z')], self: 'Kim Lee',
      door: 'Your name is shared with another account, so no certificate can be matched to you by name — an administrator settles which account is yours.',
    },
    {
      label: 'Nia New — the only row under the name is a departed employee\'s',
      v: refusedView('Nia New', `${NOT_YOURS} — ${ONLY}`, NO_ROW_KEY),
      theirs: [up('n1', 'Nia New', 'DODD annual training', '2025-08-21T12:00:00Z')], self: 'Nia New',
      door: 'The staff roster row that matches your account carries no staff status, so no certificate can be matched to you.',
    },
    {
      label: 'Cal New — the sign-in e-mail is on Dana Old\'s row',
      v: refusedView('Cal New', `no row of the staff roster is under your name — ${ONLY}`, NO_ROW_KEY),
      theirs: [up('d1', 'Dana Old', 'CPR / First Aid', '2026-08-01T12:00:00Z')], self: 'Dana Old',
      door: 'Your sign-in e-mail is on one row of the staff roster and your name is on another, so which record is yours cannot be settled.',
    },
    {
      label: 'Tia Twin — another roster row carries the same name',
      v: refusedView('Tia Twin', SHARED, TWIN_KEY, 'PPL_TIA1'),
      theirs: [up('t2', 'Tia Twin', 'Mandt', '2026-09-16T12:00:00Z')], self: 'Tia Twin',
      door: 'Two rows on the staff roster carry your name, so certificates filed under it cannot be told apart.',
    },
  ]
  for (const p of probes) {
    it(`${p.label}: the requirements carry the relay's sentence and no document of that row is drawn`, () => {
      for (const uploads of [readyUploads('own', p.theirs, p.self), refusedUploads(p.door)]) {
        const reqs = screen('requirements', ready(p.v), uploads)
        assert.ok(reqs.includes(`Requirements: ${p.v.requirements.why}`), 'the not-attributable sentence')
        assert.ok(!reqs.includes('data-row=') && !reqs.includes('No requirement is on record'))
        const docs = screen('docs', ready(p.v), uploads)
        for (const d of p.theirs) assert.ok(!docs.includes(`${d.id}.pdf`) && !docs.includes(`data-doc="${d.id}"`), `${d.id} is not drawn`)
        assert.ok(!docs.includes('You have not submitted any documents yet.'), 'never an empty list')
        assert.deepEqual(docsFor(p.v, uploads).rows, [])
      }
    })
  }
})

describe('the scope, as the screen draws it', () => {
  it('the person chooser appears only on a mass answer', () => {
    const own = screen('details', ready(view()))
    assert.ok(!own.includes('my-profile-person') && !own.includes('Your own profile'))
    const mass = view({ scope: { mode: 'mass', why: 'Signed in as the master account: your own profile, or any person\'s you choose.', person: '',
      people: [{ key: 'PPL_BOB', name: 'Bob Bee', status: 'Active' }], people_why: '' } })
    const html = screen('details', ready(mass))
    assert.ok(html.includes('id="my-profile-person"') && html.includes('>Your own profile<') && html.includes('>Bob Bee · Active<'))
    assert.ok(html.includes('any person&#x27;s you choose'))
  })

  it('while another person\'s read runs, the master keeps the chooser and the line names whose profile is read', () => {
    const chooser = { people: [{ key: 'PPL_BOB', name: 'Bob Bee', status: 'Active' }], people_why: '' }
    const loading: MyProfileState = { ...MY_PROFILE_IDLE, status: 'loading', refreshing: true }
    const html = draw(<MyProfileScreen page="details" state={loading} uploads={UPLOADS_IDLE} person="PPL_BOB" onPerson={noop}
      onRetry={noop} onUpload={noop} onView={noop} chooser={chooser} />)
    assert.ok(html.includes('id="my-profile-person"') && html.includes('>Bob Bee · Active<'))
    assert.ok(html.includes('Reading this person’s profile…') && !html.includes('Reading your profile'))
    const own = draw(<MyProfileScreen page="details" state={loading} uploads={UPLOADS_IDLE} person="" onPerson={noop}
      onRetry={noop} onUpload={noop} onView={noop} />)
    assert.ok(own.includes('Reading your profile…') && !own.includes('my-profile-person'))
    // an own answer decides: a held list is never drawn over it
    const ownAnswer = draw(<MyProfileScreen page="details" state={ready(view())} uploads={UPLOADS_IDLE} person="" onPerson={noop}
      onRetry={noop} onUpload={noop} onView={noop} chooser={chooser} />)
    assert.ok(!ownAnswer.includes('my-profile-person'))
  })

  it('a person list that could not be read says why no staff member can be chosen', () => {
    const mass = view({ scope: { mode: 'mass', why: '', person: '', people: [], people_why: 'the staff roster house is declared but not mirrored yet' } })
    assert.ok(screen('details', ready(mass)).includes('No staff member can be chosen: the staff roster house is declared but not mirrored yet.'))
  })

  it('a refusal is the relay\'s own words, never an empty profile', () => {
    const html = screen('details', { ...MY_PROFILE_IDLE, status: 'refused', reason: 'scope', error: 'My Profile shows only your own profile.' })
    assert.ok(html.includes('My Profile shows only your own profile.') && !html.includes('My Info'))
  })

  it('a failed first read says so and draws no field', () => {
    const html = screen('details', { ...MY_PROFILE_IDLE, status: 'failed', error: 'the relay answered 503' })
    assert.ok(html.includes('My Profile could not be read: the relay answered 503') && !html.includes('Employee ID'))
  })

  it('each page draws its own card under the rail', () => {
    assert.ok(screen('details', ready(view())).includes('>My Info<'))
    assert.ok(screen('requirements', ready(view())).includes('>My Requirements</h2>'))
    assert.ok(screen('docs', ready(view())).includes('>My Docs</h2>'))
  })

  it('the door is addressed by the person the relay honours or refuses; a refused one is let go', () => {
    assert.equal(myProfilePath(''), '/erp-lanes/my-profile')
    assert.equal(myProfilePath('PPL BOB'), '/erp-lanes/my-profile?person=PPL%20BOB')
    assert.equal(choiceAfter({ status: 'refused', reason: 'scope' }, 'PPL_BOB'), '')
    assert.equal(choiceAfter({ status: 'refused', reason: 'person' }, 'PPL_BOB'), '')
    assert.equal(choiceAfter({ status: 'refused', reason: 'badge' }, 'PPL_BOB'), 'PPL_BOB')
    assert.equal(formatPhoneDisplay('+1 (555) 010-1100'), '(555) 010-1100')
  })
})

// a client's profile as the relay answers it: the client record's fields, and the two staff parts said as such
function clientView(over: Partial<MyProfileView> = {}): MyProfileView {
  return {
    scope: { mode: 'own', why: '', person: '' },
    person: { name: 'Jane Doe', key: '', key_why: DOCS_NOT_CLIENT, roster_id: '', own: true, kind: 'client', notes: [] },
    details: {
      state: 'ready', why: '', notes: [], as_of: '2026-09-25T12:00:00Z',
      fields: [
        f('client_id', 'Client ID', '104233'), f('house', 'House', 'Maple House'), f('start_date', 'Start date', '2021-03-14'),
        f('phone', 'Phone', '(330) 555-0101'), f('email', 'Email', '', 'No e-mail is on file for the client.'),
        f('address', 'Address', '12 Maple St, Canton, OH 44709'), f('guardian', 'Guardian', 'Mary Doe', '', 'Relationship: Mother'),
        f('guardian_phone', 'Guardian phone', '330-555-0202'), f('guardian_email', 'Guardian email', '', 'No guardian e-mail is on file.'),
      ],
    },
    requirements: {
      state: 'not_applicable', why: REQS_NOT_CLIENT, note: '', as_of: '', copy_why: '', gap: '',
      totals: { current: 0, soon: 0, attention: 0, unknown: 0 }, rows: [],
    },
    documents: { state: 'not_applicable', why: DOCS_NOT_CLIENT },
    read_at: '2026-09-25T12:00:00Z',
    ...over,
  }
}

describe('a client\'s profile', () => {
  it('My Details draws the client record\'s fields under a client\'s labels, in order, with the dash where one is missing', () => {
    const html = draw(<DetailsCard view={clientView()} />)
    assert.ok(html.includes('>My Info<'))
    const labels = ['Client ID', 'House', 'Start date', 'Phone', 'Email', 'Address', 'Guardian', 'Guardian phone', 'Guardian email']
      .map((l) => html.indexOf(`>${l}<`))
    assert.ok(labels.every((i, n) => i > -1 && (n === 0 || i > labels[n - 1])), 'the nine labels, in order')
    assert.ok(html.includes('>104233<') && html.includes('>Maple House<') && html.includes('Mar 14, 2021'))
    assert.match(html, /href="tel:\+13305550101"[^>]*>\(330\) 555-0101</)
    assert.match(html, /href="tel:\+13305550202"[^>]*>\(330\) 555-0202</)
    assert.ok(html.includes('Relationship: Mother'))
    assert.ok(html.includes('—<span class="block text-[11px] leading-[1.4] text-text-3">No e-mail is on file for the client.</span>'))
    assert.ok(!html.includes('Employee ID') && !html.includes('>Role<'))
  })

  it('the master sees it titled as a client\'s, and an unreadable card names whose it is', () => {
    const theirs = clientView({ person: { ...clientView().person, own: false } })
    assert.ok(draw(<DetailsCard view={theirs} />).includes('>Client info · Jane Doe<'))
    const down = clientView({
      person: { ...clientView().person, own: false },
      details: { ...clientView().details, state: 'unreadable', why: 'the clients list did not answer' },
    })
    assert.ok(draw(<DetailsCard view={down} />).includes('This client’s details could not be read: the clients list did not answer.'))
  })

  it('My Requirements says plainly it applies to staff, not to clients — no table, not an empty list', () => {
    const html = draw(<RequirementsCard view={clientView()} docs={docsFor(clientView(), UPLOADS_IDLE)} onUpload={noop} onView={noop} />)
    assert.ok(html.includes(REQS_NOT_CLIENT))
    assert.ok(!html.includes('>Due date<') && !html.includes('No requirement is on record') && !html.includes('could not be read'))
    assert.equal(requirementsEmpty(clientView()), REQS_NOT_CLIENT)
  })

  it('My Docs says plainly it applies to staff, not to clients — never reading, never "none submitted"', () => {
    const docs = docsFor(clientView(), UPLOADS_IDLE)
    const html = draw(<DocsCard view={clientView()} docs={docs} onView={noop} />)
    assert.ok(html.includes(DOCS_NOT_CLIENT))
    assert.ok(!html.includes('Reading the submitted documents') && !html.includes('have not submitted') && !html.includes('>Doc type<'))
    assert.equal(docsEmpty(clientView(), docs), DOCS_NOT_CLIENT)
  })

  it('no ledger row is ever drawn on a client\'s profile, whatever the ledger answered', () => {
    const mastered = clientView({ person: { ...clientView().person, own: false, name: 'Maya Chen' } })
    for (const uploads of [readyUploads('all'), readyUploads('own'), refusedUploads('no')]) {
      const d = docsFor(mastered, uploads)
      assert.deepEqual(d.rows, [])
      assert.equal(d.na, DOCS_NOT_CLIENT)
      const html = draw(<DocsCard view={mastered} docs={d} onView={noop} />)
      assert.ok(!html.includes('u1.pdf') && !html.includes('data-doc='))
    }
  })

  it('the relay\'s own sentences win; the screen\'s are only for an answer that carried none', () => {
    const own = clientView({ requirements: { ...clientView().requirements, why: 'requirements are for staff only' }, documents: { state: 'not_applicable', why: 'documents are for staff only' } })
    assert.equal(requirementsEmpty(own), 'Requirements are for staff only.')
    assert.equal(docsFor(own, UPLOADS_IDLE).na, 'Documents are for staff only.')
    const bare = clientView({ documents: undefined, requirements: { ...clientView().requirements, why: '' } })
    assert.equal(docsFor(bare, UPLOADS_IDLE).na, DOCS_NOT_CLIENT)
    assert.equal(requirementsEmpty(bare), REQS_NOT_CLIENT)
  })

  it('each page draws the client\'s own card under the rail', () => {
    const s = ready(clientView())
    assert.ok(screen('details', s, UPLOADS_IDLE).includes('>Client ID<'))
    assert.ok(screen('requirements', s, UPLOADS_IDLE).includes(REQS_NOT_CLIENT))
    assert.ok(screen('docs', s, UPLOADS_IDLE).includes(DOCS_NOT_CLIENT))
  })

  it('the master\'s chooser lists clients apart from staff, each marked as a client, addressed by its client key', () => {
    const chooser = {
      people: [
        { key: 'PPL_BOB', name: 'Bob Bee', status: 'Active', kind: 'staff' as const },
        { key: 'jane_doe', name: 'Jane Doe', status: 'Active', kind: 'client' as const },
      ],
      people_why: '', clients_why: '',
    }
    const html = draw(<PersonBar chooser={chooser} person="client:jane_doe" onPerson={noop} onRetry={noop} busy={false} />)
    const staffAt = html.indexOf('<optgroup label="Staff">')
    const clientsAt = html.indexOf('<optgroup label="Clients">')
    assert.ok(staffAt > -1 && clientsAt > staffAt, 'a Staff group, then a Clients group')
    assert.ok(html.indexOf('>Bob Bee · Active<') > staffAt && html.indexOf('>Bob Bee · Active<') < clientsAt)
    assert.ok(html.indexOf('value="client:jane_doe"') > clientsAt && html.includes('>Jane Doe · Client · Active<'))
    assert.equal(choiceOf(chooser.people[1]), 'client:jane_doe')
    assert.equal(choiceOf(chooser.people[0]), 'PPL_BOB')
    assert.equal(choiceLabel(chooser.people[1]), 'Jane Doe · Client · Active')
    // a staff-only list keeps its flat shape
    const flatList = draw(<PersonBar chooser={{ people: [chooser.people[0]], people_why: '' }} person="" onPerson={noop} onRetry={noop} busy={false} />)
    assert.ok(!flatList.includes('<optgroup') && flatList.includes('>Bob Bee · Active<'))
  })

  it('a staff roster that could not be read draws no empty Staff group beside the clients, and says why', () => {
    const chooser = {
      people: [{ key: 'jane_doe', name: 'Jane Doe', status: 'Active', kind: 'client' as const }],
      people_why: 'the staff roster house is declared but not mirrored yet', clients_why: '',
    }
    const html = draw(<PersonBar chooser={chooser} person="" onPerson={noop} onRetry={noop} busy={false} />)
    assert.ok(!html.includes('<optgroup label="Staff">'))
    assert.ok(html.includes('<optgroup label="Clients">') && html.includes('>Jane Doe · Client · Active<'))
    assert.ok(html.includes('No staff member can be chosen: the staff roster house is declared but not mirrored yet.'))
  })

  it('client records the chooser leaves out are said in a line; a list that could not be read says only why', () => {
    const note = '2 client records carry no usable client key or name, so they cannot be chosen'
    const base = { people: [{ key: 'jane_doe', name: 'Jane Doe', status: 'Active', kind: 'client' as const }], people_why: '' }
    const html = draw(<PersonBar chooser={{ ...base, clients_why: '', clients_note: note }} person="" onPerson={noop} onRetry={noop} busy={false} />)
    assert.ok(html.includes('2 client records carry no usable client key or name, so they cannot be chosen.'))
    const down = draw(<PersonBar chooser={{ people: [], people_why: '', clients_why: 'the clients list has not been built on this server', clients_note: note }}
      person="" onPerson={noop} onRetry={noop} busy={false} />)
    assert.ok(down.includes('No client can be chosen: the clients list has not been built on this server.') && !down.includes('carry no usable'))
    // the mass answer carries the note through to the chooser
    const mass = view({ scope: { mode: 'mass', why: '', person: '', people: base.people, people_why: '', clients_why: '', clients_note: note } })
    assert.ok(screen('details', ready(mass)).includes(`${note}.`))
  })

  it('while a chosen client\'s profile is read, the line says it is a client\'s', () => {
    const loading: MyProfileState = { ...MY_PROFILE_IDLE, status: 'loading', refreshing: true }
    assert.ok(draw(<ReadLine state={loading} person="client:jane_doe" onRetry={noop} />).includes('Reading this client’s profile…'))
    assert.ok(draw(<ReadLine state={loading} person="PPL_BOB" onRetry={noop} />).includes('Reading this person’s profile…'))
    assert.ok(draw(<ReadLine state={loading} person="" onRetry={noop} />).includes('Reading your profile…'))
  })

  it('a clients list that could not be read says why no client can be chosen', () => {
    const mass = view({ scope: { mode: 'mass', why: '', person: '', people: [], people_why: '', clients_why: 'the clients list has not been built on this server' } })
    const html = screen('details', ready(mass))
    assert.ok(html.includes('No client can be chosen: the clients list has not been built on this server.'))
    assert.ok(!html.includes('No staff member can be chosen'))
  })

  it('a chosen client is addressed to the door as a client, never as a roster id', () => {
    assert.equal(myProfilePath('client:jane_doe'), '/erp-lanes/my-profile?client=jane_doe')
    assert.equal(myProfilePath('client:o’neil grant'), `/erp-lanes/my-profile?client=${encodeURIComponent('o’neil grant')}`)
    assert.equal(myProfilePath('client:'), '/erp-lanes/my-profile')
    assert.equal(choiceAfter({ status: 'refused', reason: 'person' }, 'client:gone'), '')
  })
})

describe('the reads and the upload', () => {
  const realFetch = globalThis.fetch
  let calls: { url: string; auth: string; body: string }[] = []
  let answer: (url: string, body: string) => Response = () => new Response(JSON.stringify({ status: 200, data: view() }))
  before(() => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      const body = typeof init?.body === 'string' ? init.body : ''
      calls.push({ url: String(url), auth: headers.Authorization ?? '', body })
      return answer(String(url), body)
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })
  afterEach(() => {
    calls = []
    forgetHeld()
    useAuthStore.setState({ user: null, token: null } as never)
    useMemberStore.setState({ currentMemberId: '', memberName: '', memberRole: '', memberTypes: [] } as never)
  })
  const gasBody = (body: string) => JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: Record<string, unknown> }

  it('reads its one door with the Bearer token; a person is encoded into the address', async () => {
    useAuthStore.setState({ user: { id: 'u-ann', name: 'Ann Roe', role: 'staff', types: [] }, token: 'tok-ann' } as never)
    const h = mountHook(() => useMyProfile(true, ''), {})
    await h.settle(() => h.current.state.status === 'ready')
    assert.equal(calls[0].url, '/erp-lanes/my-profile')
    assert.equal(calls[0].auth, 'Bearer tok-ann')
    h.unmount()
    calls = []
    const p = mountHook(() => useMyProfile(true, 'PPL_BOB'), {})
    await p.settle(() => p.current.state.status === 'ready')
    assert.equal(calls[0].url, '/erp-lanes/my-profile?person=PPL_BOB')
    p.unmount()
  })

  it('a new choice never draws the person before it, and the master keeps the chooser while it is read', async () => {
    useAuthStore.setState({ user: { id: 'u-boss', name: 'The Boss', role: 'admin', types: [], isMaster: true }, token: 'tok-boss' } as never)
    const people = [{ key: 'PPL_BOB', name: 'Bob Bee', status: 'Active' }]
    const mine = view({ scope: { mode: 'mass', why: '', person: '', people, people_why: '' } })
    const bob = view({ scope: { mode: 'mass', why: '', person: 'PPL_BOB', people, people_why: '' },
      person: { name: 'Bob Bee', key: 'bobbee', key_why: '', roster_id: 'PPL_BOB', own: false, notes: [] } })
    let open: (r: Response) => void = () => {}
    answer = ((url: string) => url.includes('?person=')
      ? new Promise<Response>((r) => { open = r })
      : new Response(JSON.stringify({ status: 200, data: mine }))) as unknown as typeof answer
    const seen: [string, string | null][] = []
    const h = mountHook((p: { person: string }) => {
      const got = useMyProfile(true, p.person)
      seen.push([p.person, got.state.data?.person.name ?? null])
      return got
    }, { person: '' })
    await h.settle(() => h.current.state.status === 'ready')
    assert.deepEqual(h.current.chooser?.people.map((x) => x.key), ['PPL_BOB'])
    h.rerender({ person: 'PPL_BOB' })
    // read through a call, so one assertion's narrowing never outlives the render it looked at
    const now = () => h.current.state
    assert.equal(now().data, null)
    assert.equal(now().status, 'loading')
    assert.deepEqual(h.current.chooser?.people.map((x) => x.key), ['PPL_BOB'], 'the chooser stays while the read runs')
    assert.ok(!seen.some(([p, name]) => p === 'PPL_BOB' && name === 'Maya Chen'), 'the previous person is never drawn under the new choice')
    open(new Response(JSON.stringify({ status: 200, data: bob })))
    await h.settle(() => now().data?.person.name === 'Bob Bee')
    h.rerender({ person: '' })
    assert.equal(now().data?.person.name, 'Maya Chen', 'the held own answer is drawn at once')
    h.unmount()
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('an own answer holds no chooser for the session', async () => {
    useAuthStore.setState({ user: { id: 'u-ann', name: 'Ann Roe', role: 'staff', types: [] }, token: 'tok-ann' } as never)
    const h = mountHook(() => useMyProfile(true, ''), {})
    await h.settle(() => h.current.state.status === 'ready')
    assert.equal(h.current.chooser, null)
    h.unmount()
  })

  it('a 403 is refused with the relay\'s own reason and words', async () => {
    useAuthStore.setState({ user: { id: 'u-ann', name: 'Ann Roe', role: 'staff', types: [] }, token: 'tok-ann' } as never)
    answer = () => new Response(JSON.stringify({ status: 403, reason: 'scope', message: 'My Profile shows only your own profile.' }))
    const h = mountHook(() => useMyProfile(true, 'PPL_BOB'), {})
    await h.settle(() => h.current.state.status === 'refused')
    assert.equal(h.current.state.reason, 'scope')
    assert.equal(h.current.state.data, null)
    h.unmount()
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('a person the door refuses is dropped from the address', async () => {
    useAuthStore.setState({ user: { id: 'u-ann', name: 'Ann Roe', role: 'staff', types: [] }, token: 'tok-ann' } as never)
    answer = (url) => url.includes('?person=')
      ? new Response(JSON.stringify({ status: 404, reason: 'person', message: 'No row of the staff roster carries that person.' }))
      : new Response(JSON.stringify({ status: 200, data: view() }))
    const dropped: string[] = []
    const h = mountHook(() => useMyProfilePage('PPL_GONE', (k) => dropped.push(k)), {})
    await h.settle(() => dropped.length > 0)
    assert.deepEqual(dropped.slice(0, 1), [''])
    h.unmount()
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('the documents are read through certUploadsList, which narrows them itself', async () => {
    useAuthStore.setState({ user: { id: 'u-ann', name: 'Ann Roe', role: 'staff', types: [] }, token: 'tok-ann' } as never)
    answer = (_url, body) => body.startsWith('body=')
      ? new Response(JSON.stringify({ status: 200, data: { uploads: [LEDGER[0]], scope: 'own', self: 'Maya Chen' } }))
      : new Response(JSON.stringify({ status: 200, data: view() }))
    const h = mountHook(() => useUploads(true), {})
    await h.settle(() => h.current.uploads.status === 'ready')
    const gas = calls.map((c) => c.body).filter((b) => b.startsWith('body=')).map(gasBody)
    assert.equal(gas[0].action, 'certUploadsList')
    assert.equal(h.current.uploads.scope, 'own')
    assert.equal(h.current.uploads.self, 'Maya Chen', 'the roster name the door settled is kept, to be checked against the relay\'s')
    assert.deepEqual(h.current.uploads.rows.map((r) => r.id), ['u1'])
    h.unmount()
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('an own-scope refusal from the ledger is kept as the door refusing; a 503 is a failed read', async () => {
    useAuthStore.setState({ user: { id: 'u-tia', name: 'Tia Twin', role: 'staff', types: [] }, token: 'tok-tia' } as never)
    const door = 'Two rows on the staff roster carry your name, so certificates filed under it cannot be told apart.'
    answer = (_url, body) => body.startsWith('body=')
      ? new Response(JSON.stringify({ status: 403, message: door, scope: 'own', self: 'Tia Twin' }))
      : new Response(JSON.stringify({ status: 200, data: view() }))
    const h = mountHook(() => useUploads(true), {})
    await h.settle(() => h.current.uploads.status === 'failed')
    assert.equal(h.current.uploads.refused, true)
    assert.equal(h.current.uploads.error, door)
    assert.deepEqual(h.current.uploads.rows, [])
    h.unmount()
    forgetHeld()
    answer = (_url, body) => body.startsWith('body=')
      ? new Response(JSON.stringify({ status: 503, message: 'The accounts could not be read.', scope: 'own' }))
      : new Response(JSON.stringify({ status: 200, data: view() }))
    const d = mountHook(() => useUploads(true), {})
    await d.settle(() => d.current.uploads.status === 'failed')
    assert.equal(d.current.uploads.refused, false)
    d.unmount()
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  const PDF = { base64: 'QUJD', filename: 'card.pdf', mime: 'application/pdf' }
  const cprAsk = (over: Partial<RequirementRow> = {}, own = true): ProfileUploadAsk =>
    ({ row: { ...rowOf(view(), 'cpr'), dated: true, ...over }, own, on: '2026-09-25', window: 30 })
  /** certDocUpload files `id` as pending; certDocRead answers `read`, or the door's own refusal. */
  const doors = (read: (payload: Record<string, unknown>) => Response, person = 'Maya Chen') => (_url: string, body: string) => {
    const g = gasBody(body)
    if (g.action === 'certDocUpload') {
      return new Response(JSON.stringify({ status: 200, data: { id: 'new1', person, cert: 'CPR / First Aid', name: 'card.pdf',
        url: 'https://drive.google.com/file/d/x/view', by: 'x@example.org', at: '2026-09-26T12:00:00Z', shared: false,
        req_id: 'cpr', read_state: 'pending' } }))
    }
    if (g.action === 'certDocRead') return read(g.payload)
    return new Response(JSON.stringify({ status: 200, data: view() }))
  }

  it('the upload files under the requirement id with no person, reads the paper, then refreshes — the row follows the reading', async () => {
    useAuthStore.setState({ user: { id: 'u-maya', name: 'Maya Chen', role: 'staff', types: [] }, token: 'tok-maya' } as never)
    answer = doors((p) => new Response(JSON.stringify({ status: 200, data: { ...filed(String(p.id), 'cpr', 'CPR / First Aid'),
      read_state: 'read', expires_on: '2028-06-30', read_how: 'paper', read_confidence: 92 } })))
    const steps: UploadStep[] = []
    let refreshed = 0
    let readFirst = false
    await fileAndRead(cprAsk(), PDF, (s) => steps.push(s), () => {
      refreshed++
      readFirst = calls.some((c) => c.body.startsWith('body=') && gasBody(c.body).action === 'certDocRead')
    })
    const gas = calls.filter((c) => c.body.startsWith('body=')).map((c) => gasBody(c.body))
    assert.deepEqual(gas.map((g) => g.action), ['certDocUpload', 'certDocRead'])
    assert.equal(gas[0].payload.req_id, 'cpr')
    assert.ok(!('person' in gas[0].payload), 'no person rides an own upload')
    assert.deepEqual(gas[1].payload, { id: 'new1' })
    assert.equal(refreshed, 1)
    assert.ok(readFirst, 'the ledger is re-read after the reading, so the row re-classes at once')
    assert.deepEqual(steps.map((s) => s.phase), ['reading', 'done'])
    assert.equal(steps[0].line, 'card.pdf was filed. Reading the dates on your document…')
    assert.equal(steps[1].line, 'card.pdf was filed. Reads: expires Jun 30, 2028 (read from your document). ' +
      'Your status now reads Current, due Jun 30, 2028 — not yet confirmed.')
    assert.equal(steps[1].tone, 'success')
    const body = draw(<ProfileUploadBody ask={cprAsk()} busy={false} step={steps[1]} error="" onPick={noop} />)
    assert.ok(body.includes('filed against your own record') && body.includes('then read for its dates') && body.includes('Choose a file'))
    assert.ok(body.includes('Your status now reads Current'))
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('on the master\'s chosen profile the upload names the person only as the relay\'s file_as', async () => {
    useAuthStore.setState({ user: { id: 'u-boss', name: 'The Boss', role: 'admin', types: [], isMaster: true }, token: 'tok-boss' } as never)
    answer = doors((p) => new Response(JSON.stringify({ status: 200, data: { ...filed(String(p.id), 'cpr', 'CPR / First Aid'),
      read_state: 'unread', read_why: 'This reads as a DODD certificate, not a CPR / First Aid.' } })), 'Bob Bee')
    const steps: UploadStep[] = []
    await fileAndRead(cprAsk({ file_as: 'Bob Bee' }, false), PDF, (s) => steps.push(s), noop)
    const sent = gasBody(calls.find((c) => c.body.startsWith('body='))!.body)
    assert.equal(sent.action, 'certDocUpload')
    assert.equal(sent.payload.person, 'Bob Bee')
    assert.equal(sent.payload.req_id, 'cpr')
    assert.equal(steps[0].line, 'card.pdf was filed under Bob Bee. Reading the dates on the document…')
    assert.equal(steps[1].line, 'card.pdf was filed under Bob Bee. We could not read a date from this file: this reads as a DODD ' +
      'certificate, not a CPR / First Aid. The status stays as it was; HR confirms the date from the document.')
    assert.equal(steps[1].tone, 'warning')
    // the payload builder itself: a person only when the relay gave file_as
    calls = []
    await fileOwnVersion({ req_id: 'cpr', cert: 'CPR / First Aid', file_as: '' }, PDF)
    assert.ok(!('person' in gasBody(calls[0].body).payload))
    // an onboarding form the person holds is filed under its label alone: the door takes an id for the dated ones only
    calls = []
    await fileOwnVersion({ req_id: 'i9_form', cert: 'I-9 Form', file_as: '',
      upload: { allowed: true, why: '', by_label: true } }, PDF)
    assert.equal(gasBody(calls[0].body).payload.req_id, '')
    assert.equal(gasBody(calls[0].body).payload.cert, 'I-9 Form')
    const body = draw(<ProfileUploadBody ask={cprAsk({ file_as: 'Bob Bee' }, false)} busy={false} step={null} error="" onPick={noop} />)
    assert.ok(body.includes('filed under Bob Bee’s record'))
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('a reading that fails still refreshes the filed paper; a filing that fails reads nothing and refreshes nothing', async () => {
    useAuthStore.setState({ user: { id: 'u-maya', name: 'Maya Chen', role: 'staff', types: [] }, token: 'tok-maya' } as never)
    answer = doors(() => new Response(JSON.stringify({ status: 503,
      message: 'The reading could not be kept on the ledger just now — the document is read again within minutes.' })))
    const steps: UploadStep[] = []
    let refreshed = 0
    await fileAndRead(cprAsk(), PDF, (s) => steps.push(s), () => { refreshed++ })
    assert.equal(refreshed, 1)
    assert.equal(steps[steps.length - 1].tone, 'warning')
    assert.match(steps[steps.length - 1].line, /^card\.pdf was filed, but its dates could not be read just now: The reading could not be kept/)
    calls = []
    answer = () => new Response(JSON.stringify({ status: 400, message: 'HR files this form. Nothing was filed.' }))
    refreshed = 0
    await assert.rejects(fileAndRead(cprAsk(), PDF, noop, () => { refreshed++ }), /HR files this form\. Nothing was filed\./)
    assert.equal(refreshed, 0)
    assert.deepEqual(calls.map((c) => gasBody(c.body).action), ['certDocUpload'])
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('the preview asks certDocFile for the row\'s id and frames a blob URL — never the ledger\'s link', async () => {
    useAuthStore.setState({ user: { id: 'u-maya', name: 'Maya Chen', role: 'staff', types: [] }, token: 'tok-maya' } as never)
    answer = () => new Response(JSON.stringify({ status: 200, data: { id: 'u1', name: 'u1.pdf', mime: 'application/pdf', size: 3, b64: 'QUJD' } }))
    const doc = await openCertDoc('u1')
    const sent = gasBody(calls[calls.length - 1].body)
    assert.equal(sent.action, 'certDocFile')
    assert.deepEqual(sent.payload, { id: 'u1' })
    assert.match(doc.src, /^blob:/)
    assert.equal(doc.mime, 'application/pdf')
    assert.equal(doc.shape, 'pdf')
    doc.revoke()
    doc.revoke()
    assert.equal(await blobOf({ b64: 'QUJD', mime: 'application/pdf' })?.text(), 'ABC')
    assert.equal(blobOf({ b64: 'QUJD', mime: 'image/png' })?.type, 'image/png')
    answer = () => new Response(JSON.stringify({ status: 403, message: 'This document is not on your record.' }))
    await assert.rejects(openCertDoc('someone-elses'), /This document is not on your record\./)
    for (const file of ['VersionCard.tsx', 'certDocFile.ts', 'MyProfilePage.tsx']) {
      const src = readFileSync(resolve(ROOT, 'src/pages/features/myprofile', file), 'utf8')
      assert.ok(!/\.url\b|drive\.google\.com|openFile\(|window\.open\(/.test(src), `${file} opens no ledger link`)
      assert.ok(!/window\.(confirm|alert|prompt)\b|\b(confirm|alert|prompt)\(/.test(src), `${file} uses no browser dialog`)
    }
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('a file that is not a PDF or a picture is never made into a URL, and nothing is framed or drawn', async () => {
    useAuthStore.setState({ user: { id: 'u-boss', name: 'The Boss', role: 'admin', types: [], isMaster: true }, token: 'tok-boss' } as never)
    const realCreate = URL.createObjectURL
    let made = 0
    URL.createObjectURL = ((b: Blob) => { made++; return realCreate(b) }) as typeof URL.createObjectURL
    try {
      for (const mime of ['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', '', 'IMAGE/SVG+XML']) {
        assert.equal(blobOf({ b64: 'PHNjcmlwdD4=', mime }), null, `${mime || 'no type'} makes no blob`)
        answer = () => new Response(JSON.stringify({ status: 200, data: { id: 'x', name: 'card.pdf', mime, size: 8, b64: 'PHNjcmlwdD4=' } }))
        const doc = await openCertDoc('x')
        assert.deepEqual([doc.src, doc.shape], ['', ''], `${mime || 'no type'} is not opened`)
        const html = draw(<DocView doc={doc} name="card.pdf" />)
        assert.ok(!/<iframe|<img|<object|<embed/.test(html), `${mime || 'no type'} is neither framed nor drawn`)
        assert.ok(html.includes(DOC_UNSHOWN))
      }
      assert.equal(made, 0, 'no blob URL was made for any of them')
    } finally {
      URL.createObjectURL = realCreate
    }
    // the two shapes the eye draws, and only from a blob URL
    assert.match(draw(<DocView doc={{ src: 'blob:x/1', shape: 'pdf' }} name="card.pdf" />), /<iframe src="blob:x\/1"/)
    assert.match(draw(<DocView doc={{ src: 'blob:x/2', shape: 'image' }} name="card.jpg" />), /<img src="blob:x\/2"/)
    for (const src of ['https://drive.google.com/file/d/1/view', 'javascript:alert(1)', 'data:text/html,x']) {
      assert.ok(!/<iframe|<img/.test(draw(<DocView doc={{ src, shape: 'pdf' }} name="x" />)), `${src} is never framed`)
    }
    assert.equal(docShapeOf('application/pdf'), 'pdf')
    assert.deepEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/heif'].map(docShapeOf),
      ['image', 'image', 'image', 'image', 'image', 'image'])
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('the confirmation is never sent twice: an answer that cannot be read is said as unknown, not resent', async () => {
    useAuthStore.setState({ user: { id: 'u-boss', name: 'The Boss', role: 'admin', types: [], isMaster: true }, token: 'tok-boss' } as never)
    answer = () => new Response('<html>not the envelope</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
    const before = calls.length
    const err = await confirmDate('r1', '2028-06-30', '06/30/2027').then(() => null, (e: unknown) => e)
    assert.equal(calls.length - before, 1, 'one send only')
    assert.ok(err instanceof Error && /not safe to send again/.test(err.message))
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('the master\'s confirmation reads the record, then writes only against the value it was shown', async () => {
    useAuthStore.setState({ user: { id: 'u-boss', name: 'The Boss', role: 'admin', types: [], isMaster: true }, token: 'tok-boss' } as never)
    answer = (_url, body) => gasBody(body).action === 'certUploadRecord'
      ? new Response(JSON.stringify({ status: 200, data: { id: 'r1', person: 'Maya Chen', req_id: 'cpr', date_source: 'CPR Exp Date',
        record: '06/30/2027', record_why: '', confirm: { allowed: true, why: '' } } }))
      : new Response(JSON.stringify({ status: 409, message: 'The record now holds "07/01/2027", not what was shown — nothing was written.',
        data: { current: '07/01/2027' } }))
    const rec = await recordOf('r1')
    assert.equal(rec.record, '06/30/2027')
    const asked = gasBody(calls[calls.length - 1].body)
    assert.equal(asked.action, 'certUploadRecord')
    assert.deepEqual(asked.payload, { id: 'r1' })
    const err = await confirmDate('r1', '2028-06-30', rec.record).then(() => null, (e: unknown) => e)
    const sent = gasBody(calls[calls.length - 1].body)
    assert.equal(sent.action, 'certUploadConfirm')
    assert.deepEqual(sent.payload, { id: 'r1', date: '2028-06-30', expected: '06/30/2027' })
    assert.ok(err instanceof Error && /nothing was written/.test(err.message))
    assert.equal((err as { envelope?: { data?: { current?: string } } }).envelope?.data?.current, '07/01/2027')
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('a chosen client is read through the door\'s client address', async () => {
    useAuthStore.setState({ user: { id: 'u-boss', name: 'The Boss', role: 'admin', types: [], isMaster: true }, token: 'tok-boss' } as never)
    answer = () => new Response(JSON.stringify({ status: 200, data: clientView({ person: { ...clientView().person, own: false } }) }))
    const h = mountHook(() => useMyProfile(true, 'client:jane_doe'), {})
    await h.settle(() => h.current.state.status === 'ready')
    assert.equal(calls[0].url, '/erp-lanes/my-profile?client=jane_doe')
    assert.equal(h.current.state.data?.person.kind, 'client')
    h.unmount()
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('a client-role session asks the door with nothing but its token, and never reads the staff ledger', async () => {
    useAuthStore.setState({ user: { id: 'u-jane', name: 'Jane Doe', role: 'client', types: [], clientKey: 'jane_doe' }, token: 'tok-jane' } as never)
    answer = () => new Response(JSON.stringify({ status: 200, data: clientView() }))
    const h = mountHook(() => useMyProfilePage('', noop), {})
    await h.settle(() => h.current.state.status === 'ready')
    // StrictMode mounts twice: every read is the one door, with no person and no client key from the browser
    assert.ok(calls.length > 0 && calls.every((c) => c.url === '/erp-lanes/my-profile' && c.auth === 'Bearer tok-jane'),
      JSON.stringify(calls.map((c) => c.url)))
    assert.ok(!calls.some((c) => c.body.startsWith('body=')), 'certUploadsList is not asked')
    assert.equal(h.current.uploads.status, 'idle')
    h.unmount()
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('an open member visit draws the sentence and reads nothing', async () => {
    useAuthStore.setState({ user: { id: 'u-boss', name: 'The Boss', role: 'admin', types: [], isMaster: true }, token: 'tok-boss' } as never)
    useMemberStore.setState({ currentMemberId: 'u-sam', memberName: 'Sam Staff', memberRole: 'staff', memberTypes: [] } as never)
    const h = mountHook(() => useMyProfilePage('', noop), {})
    await h.settle(() => false)
    assert.equal(h.current.visiting, true)
    assert.equal(calls.length, 0)
    h.unmount()
    assert.ok(draw(<VisitNotice />).includes(VISIT_SENTENCE.replace(/'/g, '&#x27;')))
    const page = readFileSync(resolve(ROOT, 'src/pages/features/myprofile/MyProfilePage.tsx'), 'utf8')
    assert.match(page, /const \{ visiting, [^}]*\} = useMyProfilePage\([^)]*\)[\s\S]*if \(visiting\) return <VisitNotice \/>/)
  })
})

/* ---------- the Address on My Info: the Employee Database's, changed by its own person ---------- */

const ADDR: AddressView = {
  staff_key: 'mayachen', name: 'Maya Chen', own: true, read: true,
  address: { address: '12 Maple St', city: 'Columbus', state: 'OH', zip: '43004' },
  edit: { address: '12 Maple St', city: 'Columbus', state: 'OH', zip: '43004' },
  locked: {}, allowed: true, why: '',
}
const addrReady = (over: Partial<AddressView> = {}): AddressState => ({ status: 'ready', data: { ...ADDR, ...over }, error: '' })
const BRIDGED = 'Your account reaches your roster row only through an e-mail written on the roster, so your address is not ' +
  'shown or changed from this session — HR updates it, or an administrator gives your account the exact name on your roster row.'
type El = ReactElement<Record<string, unknown>>
/** Every element of a drawn tree the test can reach (a component's own children, never what it draws). */
function els(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => els(n, out))
  else if (node && typeof node === 'object' && 'props' in node) {
    out.push(node as El)
    els((node as El).props.children, out)
  }
  return out
}
const by = (tree: unknown, attr: string, value = '') => els(tree).filter((e) => e.props[attr] === value)

describe('the Address on My Info', () => {
  it('draws the Employee Database\'s whole address over the roster\'s city and state, its pencil beside the label', () => {
    const html = draw(<DetailsCard view={view()} address={addrReady()} onAddress={noop} />)
    assert.ok(html.includes('>12 Maple St, Columbus, OH 43004<'))
    assert.ok(!html.includes('City and state only'), 'the roster\'s note goes with its value')
    assert.match(html, /data-field="address"><dt class="[^"]*flex[^"]*">Address<button type="button" data-edit-address="" aria-label="Edit the address"/)
    // no pencil without the panel to open, and the roster's words while the door has not answered
    const bare = draw(<DetailsCard view={view()} />)
    assert.ok(!bare.includes('data-edit-address') && bare.includes('>Columbus, OH<'))
  })

  it('a pencil the door shuts is drawn shut, its reason under the value; reading is not a reason', () => {
    const refused: AddressState = { status: 'refused', data: null, error: BRIDGED }
    const html = draw(<DetailsCard view={view()} address={refused} onAddress={noop} />)
    assert.match(html, /<button type="button" disabled="" data-edit-address=""/)
    assert.ok(html.includes(`data-address-why="">${BRIDGED.replace(/'/g, '&#x27;')}<`) && html.includes('>Columbus, OH<'))
    const reading = draw(<DetailsCard view={view()} address={{ status: 'loading', data: null, error: '' }} onAddress={noop} />)
    assert.match(reading, /<button type="button" disabled="" data-edit-address="" aria-label="Edit the address — Reading the address…"/)
    assert.ok(!reading.includes('data-address-why'))
    // a Master row with no address part leaves the roster's words, and a part locked everywhere shuts the pencil
    const blank = addrReady({ address: { address: '', city: '', state: '', zip: '' } })
    assert.ok(draw(<DetailsCard view={view()} address={blank} onAddress={noop} />).includes('>Columbus, OH<'))
    const none = addrReady({ read: false, address: { address: '', city: '', state: '', zip: '' }, edit: {}, allowed: false,
      why: 'No Employee Database row is read for this person.' })
    const shut = draw(<DetailsCard view={view()} address={none} onAddress={noop} />)
    assert.ok(shut.includes('disabled="" data-edit-address=""') && shut.includes('No Employee Database row is read for this person.'))
  })

  it('a client\'s or a guardian\'s card never carries the pencil, and asks no address door', () => {
    const html = draw(<DetailsCard view={clientView()} address={addrReady()} onAddress={noop} />)
    assert.ok(!html.includes('data-edit-address') && html.includes('>12 Maple St, Canton, OH 44709<'))
    const guardian = clientView({ person: { ...clientView().person, viewer: 'guardian' } })
    assert.equal(addressAsk(clientView()), null)
    assert.equal(addressAsk(guardian), null)
    assert.equal(addressPencil(guardian, addrReady()).show, false)
  })

  it('whose address is asked: nobody named for one\'s own, the chosen staff key only from the master\'s own session', () => {
    assert.equal(addressAsk(view()), '')
    const chosen = view({ scope: { mode: 'mass', why: '', person: 'PPL_BOB', people: [], people_why: '' },
      person: { name: 'Bob Bee', key: 'bobbee', key_why: '', roster_id: 'PPL_BOB', own: false, notes: [] } })
    assert.equal(addressAsk(chosen), 'bobbee')
    assert.equal(addressAsk({ ...chosen, scope: { ...chosen.scope, mode: 'own' } }), null)
    const twin = { ...chosen, person: { ...chosen.person, key: '', key_why: 'another row of the staff roster carries this name' } }
    assert.equal(addressAsk(twin), null)
    assert.deepEqual(addressPencil(twin, undefined),
      { show: true, allowed: false, why: 'Another row of the staff roster carries this name.' })
    assert.equal(addressAsk(null), null)
  })

  it('the model: the line, the answer read tolerantly, the overlay, the pencil and what a save sends', () => {
    assert.equal(addressLine(ADDR.address), '12 Maple St, Columbus, OH 43004')
    assert.equal(addressLine({ address: '', city: 'Akron', state: 'OH', zip: '' }), 'Akron, OH')
    assert.equal(addressOf({ status: 'x' }), null)
    const got = addressOf({ staff_key: 'mayachen', own: true, read: true, allowed: true, address: { city: 'Akron', zip: 44301 },
      edit: { city: 'Akron', zip: 44301, state: null }, locked: { state: 'The Employee Database has no column for this field.', zip: '' } })
    assert.deepEqual(got?.address, { address: '', city: 'Akron', state: '', zip: '44301' })
    assert.deepEqual(got?.edit, { city: 'Akron', zip: '44301' })
    assert.deepEqual(got?.locked, { state: 'The Employee Database has no column for this field.' })
    const relay = f('address', 'Address', 'Columbus, OH', '', 'City and state only — the staff roster keeps no street address.')
    assert.equal(addressField(relay, undefined), relay)
    assert.equal(addressField(relay, { status: 'refused', data: null, error: 'no' }), relay)
    assert.deepEqual(addressField(relay, addrReady()), { ...relay, value: '12 Maple St, Columbus, OH 43004', note: '' })
    assert.deepEqual(addressPencil(view(), addrReady()), { show: true, allowed: true, why: '' })
    assert.deepEqual(addressPencil(view(), undefined), { show: true, allowed: false, why: ADDRESS_READING })
    assert.match(addressPencil(view(), { status: 'failed', data: null, error: 'timeout' }).why, /could not be read just now: timeout/)
    // only the parts that changed, trimmed, the state in capitals, each witnessed by its raw cell; a locked part never
    const v = { ...ADDR, edit: { ...ADDR.edit, zip: '43004.0' }, locked: { address: 'Protected.' } }
    assert.deepEqual(addressChanges(v, { address: '1 Other Rd', city: ' Columbus ', state: 'pa', zip: '43004.0' }),
      [{ field: 'state', value: 'PA', expected: 'OH' }])
    assert.deepEqual(addressChanges(ADDR, { city: 'Canton', zip: '44709' }),
      [{ field: 'city', value: 'Canton', expected: 'Columbus' }, { field: 'zip', value: '44709', expected: '43004' }])
    const after = addressAfter(ADDR, [{ field: 'city', value: 'Canton', expected: 'Columbus' },
      { field: 'zip', value: '44709', expected: '43004' }], ['city'])
    assert.deepEqual([after.address.city, after.address.zip, after.edit.city], ['Canton', '43004', 'Canton'])
  })

  it('a value is judged in the door\'s own words, and the words and the states are StaffProfiles.gs\'s', () => {
    assert.deepEqual([addressBad('address', '12 Maple St'), addressBad('address', '12345'), addressBad('address', '  ')],
      ['', ADDRESS_WORDS.address, ADDRESS_WORDS.blank])
    assert.deepEqual([addressBad('city', 'O\'Fallon'), addressBad('city', 'Winston-Salem'), addressBad('city', 'Akron 2')],
      ['', '', ADDRESS_WORDS.city])
    assert.deepEqual([addressBad('state', 'oh'), addressBad('state', 'XX')], ['', ADDRESS_WORDS.state])
    assert.deepEqual([addressBad('zip', '44301'), addressBad('zip', '44301-1234'), addressBad('zip', '4430')],
      ['', '', ADDRESS_WORDS.zip])
    const gs = readFileSync(resolve(ROOT, 'apps-script/StaffProfiles.gs'), 'utf8')
    const words = gs.slice(gs.indexOf('var SP_ADDRESS_WORDS'), gs.indexOf('function spAddressBad_')).replace(/' \+\s+'/g, '')
    for (const w of Object.values(ADDRESS_WORDS)) assert.ok(words.includes(`'${w}'`), w)
    const states = /var SP_US_STATES = \('([^']+)' \+\s+'([^']+)'\)/.exec(gs)
    assert.deepEqual(`${states?.[1]}${states?.[2]}`.split(' '), US_STATES)
  })

  it('opens in the right panel, never a modal: the four parts, Save and Cancel grey until something changes', () => {
    const html = draw(<AddressPanel open ask="" own name="Maya Chen" address={addrReady()} onClose={noop} onSaved={noop} onReread={noop} />)
    assert.match(html, new RegExp(`<aside aria-label="${ADDRESS_PANEL_LABEL}"`))
    assert.ok(html.includes('>Your address</h2>') && html.includes('aria-label="Close address panel"'))
    for (const k of ['address', 'city', 'state', 'zip']) assert.ok(html.includes(`data-address-field="${k}"`), k)
    assert.match(html, /<button type="button" disabled="" data-address-cancel=""/)
    assert.match(html, /<button type="button" disabled="" data-address-save=""/)
    assert.doesNotMatch(html, /aria-modal|role="dialog"|role="alertdialog"/)
    const theirs = draw(<AddressPanel open ask="bobbee" own={false} name="Bob Bee" address={addrReady({ own: false })}
      onClose={noop} onSaved={noop} onReread={noop} />)
    assert.ok(theirs.includes('>Address · Bob Bee</h2>') && theirs.includes('Saved on this person’s record in the Employee Database.'))
    const locked = draw(<AddressPanel open ask="" own name="Maya Chen" onClose={noop} onSaved={noop} onReread={noop}
      address={addrReady({ locked: { zip: 'The Employee Database has no column for this field.' } })} />)
    assert.ok(locked.includes('data-address-locked="zip"') && !locked.includes('data-address-field="zip"'))
    assert.equal(draw(<AddressPanel open={false} ask="" own name="" address={addrReady()} onClose={noop} onSaved={noop} onReread={noop} />), '')
    assert.equal(draw(<AddressPanel open ask={null} own name="" address={addrReady()} onClose={noop} onSaved={noop} onReread={noop} />), '')
  })

  it('one panel at a time: the address takes the panel from the card, and another person lets it go', () => {
    type Where = { page: 'details' | 'requirements'; person: string }
    const h = mountHook((p: Where) => useProfilePanel(p.page, p.person), { page: 'details', person: '' })
    h.run(() => h.current.onView({ kind: 'requirement', id: 'cpr' }))
    h.run(() => h.current.onAddress())
    assert.equal(h.current.address, true)
    assert.equal(h.current.card, null)
    h.rerender({ page: 'details', person: 'PPL_BOB' })
    assert.equal(h.current.address, false)
    h.unmount()
  })
})

describe('the Address door and its save', () => {
  const realFetch = globalThis.fetch
  let sent: { action: string; payload: Record<string, unknown> }[] = []
  let answer: (action: string, payload: Record<string, unknown>) => unknown = () => ({ status: 200, data: ADDR })
  before(() => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: Record<string, unknown> }
      sent.push({ action: env.action, payload: env.payload })
      return new Response(JSON.stringify(answer(env.action, env.payload)))
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })
  afterEach(() => {
    sent = []
    forgetHeld()
    answer = () => ({ status: 200, data: ADDR })
    useAuthStore.setState({ user: null, token: null } as never)
  })
  const staff = () => useAuthStore.setState({ user: { id: 'u-maya', name: 'Maya Chen', role: 'staff', types: [] }, token: 'tok-maya' } as never)

  it('one\'s own address is asked with nobody named; the master\'s chosen person by the staff key; null asks nothing', async () => {
    staff()
    const own = mountHook(() => useAddress(''), {})
    await own.settle(() => own.current.address.status === 'ready')
    assert.deepEqual(sent.map((s) => [s.action, s.payload]).slice(0, 1), [['staffProfileAddress', {}]])
    assert.equal(own.current.address.data?.address.address, '12 Maple St')
    own.unmount()
    sent = []
    const theirs = mountHook(() => useAddress('bobbee'), {})
    await theirs.settle(() => theirs.current.address.status === 'ready')
    assert.deepEqual(sent[0], { action: 'staffProfileAddress', payload: { key: 'bobbee' } })
    // the panel's witness is the engine's: asked fresh, past every kept copy
    const before = sent.length
    theirs.run(() => { void theirs.current.refreshAddress(true) })
    await theirs.settle(() => sent.length > before && theirs.current.address.status === 'ready')
    assert.deepEqual(sent[sent.length - 1].payload, { key: 'bobbee', edit: true })
    theirs.unmount()
    sent = []
    const none = mountHook(() => useAddress(null), {})
    await none.settle(() => false)
    assert.equal(sent.length, 0)
    assert.equal(none.current.address.status, 'idle')
    none.unmount()
  })

  it('a refusal keeps the door\'s words and draws no address; a save landed is drawn at once', async () => {
    staff()
    answer = () => ({ status: 403, message: BRIDGED })
    const h = mountHook(() => useAddress(''), {})
    // read through a call, so one assertion's narrowing never outlives the render it looked at
    const now = () => h.current.address
    await h.settle(() => now().status === 'refused')
    assert.equal(now().error, BRIDGED)
    assert.equal(now().data, null)
    answer = () => ({ status: 200, data: ADDR })
    h.run(() => { void h.current.refreshAddress() })
    await h.settle(() => now().status === 'ready')
    h.run(() => h.current.savedAddress({ ...ADDR, address: { ...ADDR.address, city: 'Canton' } }))
    assert.equal(now().data?.address.city, 'Canton')
    h.unmount()
  })

  it('the save sends only the changes, nobody named for one\'s own record, once', async () => {
    staff()
    await saveAddress('', [{ field: 'city', value: 'Canton', expected: 'Columbus' }])
    assert.deepEqual(sent[0], { action: 'staffProfileAddressEdit',
      payload: { changes: [{ field: 'city', value: 'Canton', expected: 'Columbus' }] } })
    await saveAddress('bobbee', [{ field: 'zip', value: '44709', expected: '43004' }])
    assert.deepEqual(sent[1].payload, { key: 'bobbee', changes: [{ field: 'zip', value: '44709', expected: '43004' }] })
  })

  it('typing lights Save and Cancel; Cancel returns the inputs; Save sends the change witnessed, draws it and closes', async () => {
    staff()
    let saved: AddressView | null = null
    let done = 0
    let reread = 0
    answer = (action) => (action === 'staffProfileAddressEdit'
      ? { status: 200, data: { written: ['city'], refused: [], staff_key: 'mayachen' } } : { status: 200, data: ADDR })
    const props = { ask: '', own: true, address: addrReady(), onDone: () => { done++ }, onSaved: (v: AddressView) => { saved = v },
      onReread: () => { reread++ } }
    const h = mountHook((p: typeof props) => AddressBody(p), props)
    assert.ok(reread > 0, 'the panel reads the engine\'s witness as it opens')
    const button = (attr: string) => by(h.current, attr)[0]
    const input = (k: string) => els(by(h.current, 'data-address-field', k)[0]).find((e) => e.type === 'input' || e.type === 'select') as El
    assert.equal(button('data-address-save').props.disabled, true)
    assert.equal(button('data-address-cancel').props.disabled, true)
    h.run(() => (input('city').props.onChange as (e: unknown) => void)({ target: { value: 'Canton' } }))
    assert.equal(input('city').props.value, 'Canton')
    assert.equal(button('data-address-save').props.disabled, false)
    assert.equal(button('data-address-cancel').props.disabled, false)
    h.run(() => (button('data-address-cancel').props.onClick as () => void)())
    assert.equal(input('city').props.value, 'Columbus')
    assert.equal(button('data-address-save').props.disabled, true)
    // a value the door would refuse never leaves
    h.run(() => (input('zip').props.onChange as (e: unknown) => void)({ target: { value: '443' } }))
    assert.equal(button('data-address-save').props.disabled, true)
    assert.equal(by(h.current, 'data-address-bad', 'zip')[0]?.props.children, ADDRESS_WORDS.zip)
    h.run(() => (input('zip').props.onChange as (e: unknown) => void)({ target: { value: '43004' } }))
    h.run(() => (input('city').props.onChange as (e: unknown) => void)({ target: { value: 'Canton' } }))
    h.run(() => { void (button('data-address-save').props.onClick as () => void)() })
    await h.settle(() => done > 0)
    const save = sent.find((s) => s.action === 'staffProfileAddressEdit')
    assert.deepEqual(save?.payload, { changes: [{ field: 'city', value: 'Canton', expected: 'Columbus' }] })
    assert.equal((saved as AddressView | null)?.address.city, 'Canton')
    assert.equal(done, 1)
    h.unmount()
  })

  it('the panel shows the address on its map; a new address reaches the map once the typing pauses', async () => {
    staff()
    const props = { ask: '', own: true, address: addrReady(), onDone: noop, onSaved: noop, onReread: noop }
    const h = mountHook((p: typeof props) => AddressBody(p), props)
    const frame = () => els(h.current).find((e) => e.type === AddressMapFrame)
    const input = (k: string) => els(by(h.current, 'data-address-field', k)[0]).find((e) => e.type === 'input') as El
    assert.equal(frame()?.props.address, '12 Maple St, Columbus, OH 43004', 'the map opens on the address on file')
    h.run(() => (input('address').props.onChange as (e: unknown) => void)({ target: { value: '400 Market Ave N' } }))
    h.run(() => (input('city').props.onChange as (e: unknown) => void)({ target: { value: 'Canton' } }))
    assert.equal(frame()?.props.address, '12 Maple St, Columbus, OH 43004', 'the map waits while the address is typed')
    assert.equal(by(h.current, 'data-address-map-waiting').length, 1)
    await new Promise((r) => setTimeout(r, ADDRESS_MAP_PAUSE_MS + 100))
    await h.settle(() => frame()?.props.address === '400 Market Ave N, Canton, OH 43004')
    assert.equal(frame()?.props.address, '400 Market Ave N, Canton, OH 43004', 'then shows the new address')
    assert.equal(by(h.current, 'data-address-map-waiting').length, 0)
    h.unmount()
  })

  it('the map says it is loading until a new address\'s map arrives', () => {
    const h = mountHook((p: { address: string }) => AddressMapFrame(p), { address: '12 Maple St, Columbus, OH 43004' })
    assert.equal(by(h.current, 'data-address-map-loading').length, 1)
    h.run(() => (by(h.current, 'data-address-frame')[0].props.onLoad as () => void)())
    assert.equal(by(h.current, 'data-address-map-loading').length, 0)
    h.rerender({ address: '400 Market Ave N, Canton, OH 43004' })
    assert.equal(by(h.current, 'data-address-map-loading').length, 1, 'a new address loads again')
    h.unmount()
  })

  it('the line the map is drawn from: what is typed over what the Master keeps, a locked part as kept', () => {
    assert.equal(addressDraftLine(ADDR, { city: 'Canton' }), '12 Maple St, Canton, OH 43004')
    assert.equal(addressDraftLine({ ...ADDR, locked: { city: 'HR keeps it.' } }, { city: 'Canton' }),
      '12 Maple St, Columbus, OH 43004')
  })

  it('a part changed since the panel opened: nothing is drawn as saved, the engine is read again, the reason is said', async () => {
    staff()
    let saved = 0
    let reread = 0
    answer = (action) => (action === 'staffProfileAddressEdit'
      ? { status: 409, message: 'Changed since the panel was opened — reloaded, nothing was written.',
          data: { written: [], refused: [], current: { city: 'Kent' }, staff_key: 'mayachen' } }
      : { status: 200, data: ADDR })
    const props = { ask: '', own: true, address: addrReady(), onDone: noop, onSaved: () => { saved++ }, onReread: () => { reread++ } }
    const h = mountHook((p: typeof props) => AddressBody(p), props)
    const opened = reread
    const input = (k: string) => els(by(h.current, 'data-address-field', k)[0]).find((e) => e.type === 'input') as El
    h.run(() => (input('city').props.onChange as (e: unknown) => void)({ target: { value: 'Canton' } }))
    h.run(() => { void (by(h.current, 'data-address-save')[0].props.onClick as () => void)() })
    await h.settle(() => by(h.current, 'data-address-note').length > 0)
    assert.equal(saved, 0)
    assert.ok(reread > opened, 'read again from the engine')
    assert.match(String(by(h.current, 'data-address-note')[0].props.children), /Changed since the panel was opened.*Check the address and save again\./)
    assert.equal(input('city').props.value, 'Canton', 'what was typed stays to be saved again')
    h.unmount()
  })
})
