/**
 * Certificate submissions and the certification tracker are private: the
 * ledger and the tracker answer the master everyone's and any other account
 * only its own. The drawer must not count another person's records from an
 * 'own' answer, nor an unread one as zero. ComplianceDocs.gs and Certs.gs are
 * the gates; this holds the screen to their answers.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  TRACKER_VIEWS, nameFold, trackerCountable, trackerRowsOf, uploadsCountable, uploadsRefusalOf, uploadsViewOf,
  type Viewer,
} from '@/lib/certUploads'

const root = process.env.SPA_ROOT ?? process.cwd()
const gs = readFileSync(resolve(root, 'apps-script/ComplianceDocs.gs'), 'utf8')
const certsGs = readFileSync(resolve(root, 'apps-script/Certs.gs'), 'utf8')
const drawer = readFileSync(resolve(root, 'src/pages/features/compliance/PersonComplianceDrawer.tsx'), 'utf8')
const apiTs = readFileSync(resolve(root, 'src/lib/api.ts'), 'utf8')
const snapshotTs = readFileSync(resolve(root, 'src/lib/snapshot.ts'), 'utf8')
const complianceGs = readFileSync(resolve(root, 'apps-script/Compliance.gs'), 'utf8')
const compliancePage = readFileSync(resolve(root, 'src/pages/features/compliance/CompliancePage.tsx'), 'utf8')
const trackerPage = readFileSync(resolve(root, 'src/pages/features/employeetracker/EmployeeTrackerPage.tsx'), 'utf8')
const myCerts = readFileSync(resolve(root, 'src/pages/features/myasa/MyCertsCard.tsx'), 'utf8')

const staff = (name: string): Viewer => ({ name, filesForOthers: false })
const writer = (name: string): Viewer => ({ name, filesForOthers: true })

describe('what the drawer may count', () => {
  it("the master's answer counts anybody", () => {
    const view = uploadsViewOf({ uploads: [], scope: 'all', self: '' })
    assert.deepEqual(uploadsCountable(view, 'Ben Baker'), { countable: true, note: '', key: 'benbaker' })
  })

  it("an 'own' answer counts only the caller, matched by the server's fold", () => {
    const view = uploadsViewOf({ uploads: [], scope: 'own', self: 'Ann Able' })
    assert.equal(uploadsCountable(view, 'ann  ABLE').countable, true)
    const other = uploadsCountable(view, 'Ben Baker')
    assert.equal(other.countable, false)
    assert.match(other.note, /private to them/)
  })

  it("the viewer's own drawer under their shown name counts, matched by the roster name the server keyed", () => {
    const view = uploadsViewOf({ uploads: [], scope: 'own', self: 'Ann Able' })
    const mine = uploadsCountable(view, 'Annie', staff('Annie'))
    assert.deepEqual(mine, { countable: true, note: '', key: 'annable' })
    // another person under the viewer's own roster name is still the viewer
    assert.equal(uploadsCountable(view, 'Ann Able', staff('Annie')).key, 'annable')
    assert.equal(uploadsCountable(view, 'Ben Baker', staff('Annie')).countable, false)
  })

  it('an unread ledger is a sentence, never zero', () => {
    const blind = uploadsCountable({ state: 'unreadable', why: 'The staff roster could not be read.' }, 'Ann Able')
    assert.equal(blind.countable, false)
    assert.match(blind.note, /are not shown — The staff roster could not be read\./)
    assert.match(uploadsCountable({ state: 'unreadable', why: '' }, 'Ann Able').note, /could not be read — try again/)
  })

  it('a refused identity carries the server\'s reason, not "could not be read"', () => {
    const why = 'Your name is shared with another account, so no certificate can be matched to you by name.'
    const shared = uploadsCountable({ state: 'unreadable', why }, 'Ann Able')
    assert.equal(shared.countable, false)
    assert.equal(shared.note, `The submitted documents are not shown — ${why}`)
    assert.match(gs, /Your name is shared with another account/)
    assert.match(gs, /your name is not on the staff roster/)
  })

  it("a refusal about a viewer who is not the master is not shown in another person's drawer", () => {
    const why = 'Your account is not linked to a roster row and your name is not on the staff roster.'
    const other = uploadsCountable({ state: 'unreadable', why, scope: 'own' }, 'Ben Baker', writer('Ada Admin'))
    assert.equal(other.countable, false)
    assert.match(other.note, /^Another person's submitted documents are private to them/)
    assert.doesNotMatch(other.note, /roster row|not linked/)
    // an unreadable roster is about the viewer too
    const blind = uploadsCountable({ state: 'unreadable', why: 'The staff roster could not be read.', scope: 'own' },
      'Ben Baker', writer('Ada Admin'))
    assert.match(blind.note, /private to them/)
  })

  it('only a viewer who files for others is told a document filed here would show', () => {
    const view = uploadsViewOf({ uploads: [], scope: 'own', self: 'Ann Able' })
    assert.equal(uploadsCountable(view, 'Ben Baker', writer('Mia Manager')).note,
      "Another person's submitted documents are private to them — only a document filed here now is shown.")
    assert.equal(uploadsCountable(view, 'Ben Baker', staff('Annie')).note,
      "Another person's submitted documents are private to them.")
    assert.equal(uploadsCountable({ state: 'unreadable', why: 'x', scope: 'own' }, 'Ben Baker', staff('Annie')).note,
      "Another person's submitted documents are private to them.")
  })

  it("the same refusal in the viewer's own drawer carries the server's reason", () => {
    const why = 'Your name is shared with another account.'
    const mine = uploadsCountable({ state: 'unreadable', why, scope: 'own' }, 'ann  ABLE', staff('Ann Able'))
    assert.equal(mine.countable, false)
    assert.equal(mine.note, `Your submitted documents are not shown — ${why}`)
    // a name the server cannot fold is compared by its plain spelling
    assert.match(uploadsCountable({ state: 'unreadable', why, scope: 'own' }, ' 李明 ', staff('李明')).note, /^Your submitted/)
    assert.match(uploadsCountable({ state: 'unreadable', why, scope: 'own' }, '王芳', staff('李明')).note, /private to them/)
  })

  it("a refusal naming the viewer's own roster row is theirs in the drawer titled with it, whatever name they show", () => {
    const why = 'Two rows on the staff roster carry your name.'
    const mine = uploadsCountable({ state: 'unreadable', why, scope: 'own', self: 'Ann Able' }, 'Ann Able', staff('Annie'))
    assert.equal(mine.note, `Your submitted documents are not shown — ${why}`)
    const other = uploadsCountable({ state: 'unreadable', why, scope: 'own', self: 'Ann Able' }, 'Ben Baker', staff('Annie'))
    assert.match(other.note, /private to them/)
  })

  it("the master's unread ledger says so for anybody", () => {
    const why = 'The certificate submissions could not be read just now.'
    const all = uploadsCountable({ state: 'unreadable', why, scope: 'all' }, 'Ben Baker', writer('Platform'))
    assert.equal(all.note, `The submitted documents are not shown — ${why}`)
  })

  it("a failed read keeps the refusal's sentence, scope and own name from the envelope gasAction attaches", () => {
    const err = Object.assign(new Error('Your account has no name on file.'), {
      status: 403, envelope: { status: 403, message: 'Your account has no name on file.', scope: 'own' },
    })
    assert.deepEqual(uploadsRefusalOf(err), { state: 'unreadable', why: 'Your account has no name on file.', scope: 'own' })
    const named = Object.assign(new Error('Two rows.'), { envelope: { scope: 'own', self: ' Eve East ' } })
    assert.deepEqual(uploadsRefusalOf(named), { state: 'unreadable', why: 'Two rows.', scope: 'own', self: 'Eve East' })
    const odd = Object.assign(new Error('x'), { envelope: { scope: 'everyone', self: 'Eve East' } })
    assert.deepEqual(uploadsRefusalOf(odd), { state: 'unreadable', why: 'x' })
    assert.deepEqual(uploadsRefusalOf('timeout'), { state: 'unreadable', why: '' })
  })

  it('an answer from before the scope existed carried the whole ledger', () => {
    assert.equal(uploadsCountable(uploadsViewOf({ uploads: [] }), 'Ben Baker').countable, true)
  })

  it('the fold is the one ComplianceDocs.gs matches by (hubNameFold_)', () => {
    assert.equal(nameFold(" O'Brien-Smith  Jr "), 'obriensmithjr')
    assert.match(gs, /hubNameFold_\(r\.person\) !== self\.key/)
  })
})

describe('what the drawer may say about the tracker', () => {
  it("the master's tracker counts anybody; an own tracker only the viewer", () => {
    assert.equal(trackerCountable(uploadsViewOf({ rows: [], scope: 'all', self: '' }), 'Ben Baker').countable, true)
    const own = uploadsViewOf({ rows: [], scope: 'own', self: 'Ann Able' })
    assert.deepEqual(trackerCountable(own, 'Annie', staff('Annie')), { countable: true, note: '', key: 'annable' })
    assert.equal(trackerCountable(own, 'Ben Baker', staff('Annie')).note, "Another person's certifications are private to them.")
    assert.equal(trackerCountable(own, 'Ben Baker', writer('Mia Manager')).note,
      "Another person's certifications are private to them — the rows below still take a document filed for them.")
  })

  it('an unread tracker is a sentence, never zero', () => {
    assert.equal(trackerCountable({ state: 'unreadable', why: '' }, 'Ann Able').note,
      'The certifications could not be read — try again in a minute.')
    assert.equal(trackerCountable({ state: 'unreadable', why: 'The estate did not answer.', scope: 'own' }, 'Ann Able',
      staff('Ann Able')).note, 'Your certifications are not shown — The estate did not answer.')
    assert.equal(trackerCountable({ state: 'loading' }, 'Ann Able').countable, false)
  })

  it('the generic resources are read through the tracker door, and its rows are never assumed', () => {
    assert.deepEqual({ ...TRACKER_VIEWS }, { certMatrix: 'matrix', staffCerts: 'certs' })
    assert.deepEqual(trackerRowsOf({ rows: [{ id: 'x' }], scope: 'own', self: 'Ann Able' }), [{ id: 'x' }])
    assert.throws(() => trackerRowsOf([{ id: 'x' }]), /answered without its rows/)
    assert.throws(() => trackerRowsOf(null), /answered without its rows/)
  })
})

describe('the server answer and the screen agree', () => {
  it('certUploadsList says which scope it answered and whose name it matched', () => {
    assert.match(gs, /scope: all \? 'all' : 'own', self: self \? self\.name : ''/)
  })

  it('its refusals carry the scope too, and the own name only when the record was the caller\'s', () => {
    assert.match(gs, /if \(self && !self\.key\) return complianceDocsRefusal_\(self\)/)
    assert.match(gs, /var env = \{ status: self\.status, message: self\.why, scope: 'own' \};\n\s+if \(self\.found\) env\.self = self\.found;/)
    assert.match(gs, /rather than an empty list\.', scope: all \? 'all' : 'own' \}/)
  })

  it('certTrackerList answers the same shape, and the generic door refuses its list', () => {
    assert.match(certsGs, /return \{ status: 200, data: \{ rows: rows, scope: all \? 'all' : 'own', self: self \? self\.name : '' \} \}/)
    assert.match(certsGs, /if \(self && !self\.key\) return complianceDocsRefusal_\(self\)/)
    assert.match(certsGs, /The certification tracker is read through certTrackerList/)
  })

  it('the tracker is never a slice, and a plain list of it asks the tracker door', () => {
    const never = /export const NEVER_SNAPSHOT[^=]*=\s*\[([^\]]*)\]/.exec(snapshotTs)?.[1] ?? ''
    assert.match(never, /'certMatrix', 'staffCerts'/)
    assert.match(apiTs, /const view = TRACKER_VIEWS\[resource\]/)
    // a plain list counts everyone, so it refuses an own answer (cert-own-figures.test.tsx)
    assert.match(apiTs, /trackerRowsOfAll\(await gas\.call<unknown>\(resource, 'certTrackerList', \{ view \}\)\)/)
  })

  it('neither a slice nor its floor ever answers for the tracker, whatever an old index still lists', () => {
    // fromSnapshot and floorRead both: a refused tracker read errors, never an old file of everyone's rows
    assert.equal((apiTs.match(/if \(TRACKER_VIEWS\[resource\]\) return null/g) ?? []).length, 2)
    const snap = apiTs.slice(apiTs.indexOf('async function fromSnapshot'), apiTs.indexOf('export async function revalidateLive'))
    assert.ok(snap.indexOf('if (TRACKER_VIEWS[resource]) return null') < snap.indexOf('readSlice'))
    const floor = apiTs.slice(apiTs.indexOf('async function floorRead'))
    assert.ok(floor.indexOf('if (TRACKER_VIEWS[resource]) return null') < floor.indexOf('readSliceFloor'))
  })

  it('the compliance scorecard and matrix settle whose rows they answer before the Master is read, and say so', () => {
    for (const fn of ['complianceScorecard', 'complianceMatrix']) {
      const body = complianceGs.slice(complianceGs.indexOf(`HUB_ACTIONS.${fn} = function`))
      const whose = body.indexOf('complianceWhose_(user)')
      assert.ok(whose !== -1 && whose < body.indexOf('complianceActiveRows_()'), fn)
      assert.ok(body.indexOf('complianceOwnRows_(whose, got.rows)') !== -1, fn)
    }
    assert.equal((complianceGs.match(/scope: whose\.scope,\n\s+self: whose\.all \? '' : whose\.self\.name,\n\s+note: complianceOwnNote_\(whose, rows\)/g) ?? []).length, 2)
    assert.match(complianceGs, /if \(hubIsRealMaster_\(user\)\) return \{ all: true, scope: 'all', self: null \}/)
  })

  it('an own scorecard draws no tile over every employee — only whose it is and the caller\'s own items', () => {
    assert.match(compliancePage, /score\.scope === 'own' && \(/)
    assert.match(compliancePage, /score\.scope !== 'own' && \(/)
    assert.match(compliancePage, /<OwnScope answer=\{score\} what="scorecard" \/>/)
    assert.match(compliancePage, /<OwnScope answer=\{matrix\} what="matrix" \/>/)
  })

  it('the sheet view reads the tracker door, titles an own answer as the caller\'s, and draws no table when unread', () => {
    assert.match(compliancePage, /gasAction<TrackerAnswer>\('certTrackerList', \{ view: 'certs' \}\)/)
    assert.match(compliancePage, /certScope === 'own' \? 'staff_certs — your records' : 'staff_certs — every record'/)
    assert.match(compliancePage, /The certification records are not shown — \{certErr\}/)
    assert.doesNotMatch(compliancePage, /api\.list/)
  })

  it('the employee tracker reads whose certificates and documents answered, and draws another person\'s as private', () => {
    assert.match(trackerPage, /gasAction<TrackerAnswer>\('certTrackerList', \{ view: TRACKER_VIEWS\[resource\] \}\)/)
    assert.match(trackerPage, /if \(first\?\.scope === 'own'\) docsSelf = String\(first\.self \?\? ''\)/)
    assert.match(trackerPage, /certPrivate=\{certSelf !== null && nameFold\(p\.name\) !== nameFold\(certSelf\)\}/)
    assert.match(trackerPage, /docPrivate=\{docSelf !== null && nameFold\(p\.name\) !== nameFold\(docSelf\)\}/)
    assert.match(trackerPage, /Another person's certifications are private to them/)
    assert.match(trackerPage, /Another person's documents are private to them/)
    assert.doesNotMatch(trackerPage, /pull<MatrixRow>\('certMatrix'|pull<CertRow>\('staffCerts'/)
  })

  it('My asa. reads the tracker door and shows an own answer whole, whatever name the account shows', () => {
    assert.match(myCerts, /gasAction<TrackerAnswer>\('certTrackerList', \{ view: 'certs' \}\)/)
    assert.match(myCerts, /const mine = got\?\.scope === 'own'\n\s+\? rows/)
  })

  it('the drawer reads the scope of both, shows an em dash when it cannot count, and says why', () => {
    assert.match(drawer, /gasAction<TrackerAnswer>\('certTrackerList', \{ view: 'certs' \}\)/)
    assert.match(drawer, /setUpView\(uploadsViewOf\(upRes\.value\)\)/)
    assert.match(drawer, /setUpView\(uploadsRefusalOf\(upRes\.reason\)\)/)
    assert.match(drawer, /trackerCountable\(trackerView, person, me\)/)
    assert.match(drawer, /uploadsCountable\(upView, person, me\)/)
    assert.match(drawer, /\{upCount\.countable \? submittedCount : '—'\}/)
    assert.match(drawer, /\{trackerCount\.countable \? certs\.length : '—'\}/)
    assert.match(drawer, /\{trackerCount\.countable \? attention : '—'\}/)
    assert.match(drawer, /\{upCount\.note && \(/)
    assert.match(drawer, /\{trackerCount\.note && \(/)
    assert.doesNotMatch(drawer, /api\.list/)
  })
})
