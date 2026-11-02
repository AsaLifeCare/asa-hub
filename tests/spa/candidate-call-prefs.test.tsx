/**
 * STAFF CANDIDATES · PREFERENCES HEARD ON A CALL: a line the phone screen leaves empty and a call answered is drawn
 * with "From the call" beside it, a line a filed paper answers with "Paper on file"; filing a paper from Documents
 * opens to the master and to a holder of the documents edition.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { formOpen, interviewsOf, mayUpload, preferencesOf } from '@/pages/features/staffcandidates/candidateModel'

const ROOT = process.env.SPA_ROOT ?? process.cwd()

describe('candidate preferences heard on a call', () => {
  it('marks the lines the call filled, and only those', () => {
    const v = interviewsOf({
      plan: [],
      preferences: { shifts: ['Day', 'Night'], hours: ['Part time'], every_other_weekend: 'yes', male_care: 'no',
        drivers_license: 'yes', certificates: { dodd: 'yes', cpr_first_aid: '', med_del: '' }, availability: 'Weekends',
        earliest_start: 'Immediately', preferred_location: '' },
      from_call: ['shifts', 'drivers_license', 'availability', 'preferred_location'],
    })
    const by = Object.fromEntries(v.preferences.map((p) => [p.label, p]))
    assert.equal(by.Shifts.value, 'Day, Night')
    assert.equal(by.Shifts.heard, true)
    assert.equal(by['Driver\'s license'].value, 'Yes')
    assert.equal(by['Driver\'s license'].heard, true)
    assert.equal(by.Availability.heard, true)
    assert.equal(by.Hours.heard, undefined, 'the record held it')
    assert.equal(by['Preferred location'].heard, undefined, 'an empty line is never marked')
    assert.equal(preferencesOf({ male_care: 'no' }).find((p) => p.label === 'Male care')?.heard, undefined)
  })

  it('a paper filed in Documents answers its line, and says so over the call', () => {
    const v = interviewsOf({
      plan: [], preferences: { drivers_license: 'yes', certificates: { dodd: 'yes', cpr_first_aid: 'yes', med_del: '' } },
      from_call: ['drivers_license'], on_file: ['drivers_license', 'certificates'],
    })
    const by = Object.fromEntries(v.preferences.map((p) => [p.label, p]))
    assert.equal(by['Driver\'s license'].onFile, true)
    assert.equal(by['Driver\'s license'].heard, undefined, 'the paper says it, not the call')
    assert.equal(by.Certificates.value, 'DODD, CPR / First Aid')
    assert.equal(by.Certificates.onFile, true)
  })

  it('the card draws each mark beside the value', () => {
    const card = readFileSync(resolve(ROOT, 'src/pages/features/staffcandidates/sections/Interviews.tsx'), 'utf8')
    assert.match(card, /\{p\.heard && \(\s*<span data-from="call"[^>]*>\s*From the call\s*<\/span>/)
    assert.match(card, /\{p\.onFile && \(\s*<span data-from="paper"[^>]*>\s*Paper on file\s*<\/span>/)
  })

  it('filing a paper from Documents opens to the master and to a holder of the documents edition', () => {
    assert.equal(mayUpload({ write: true, narrow: false }), true)
    assert.equal(mayUpload({ write: false, narrow: false, editions: ['candidates.documents'] }), true)
    assert.equal(mayUpload({ write: false, narrow: false, editions: ['candidates.pipeline'] }), false)
    assert.equal(mayUpload({ write: false, narrow: true, editions: ['candidates.documents'] }), false)
    assert.equal(formOpen({ kind: 'upload', doc: 'cjis' }, { write: false, narrow: false, editions: ['candidates.documents'] }), true)
    const page = readFileSync(resolve(ROOT, 'src/pages/features/staffcandidates/StaffCandidatesPage.tsx'), 'utf8')
    assert.match(page, /<DocumentsSection [^>]*canWrite=\{mayUpload\(reach\)\}/)
  })
})
