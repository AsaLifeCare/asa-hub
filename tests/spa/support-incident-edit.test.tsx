/**
 * SUPPORT REQUESTS › INCIDENTS · the pencil in a report's panel.
 *
 * App Control's own row (support-desk.incidentsEdit, the operator's "from ADMIN up") opens the edit; the master always,
 * everyone else only where the row names a badge they wear. The pencil is drawn only where the page hands the panel
 * its door (`via`) — the Incident Log's own panel never edits — and only on a report the door can find and witness.
 * A saved field shows at once in the list, until the incidents slice reads it back.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { featureAllowsWith } from '@/lib/featureAccess'
import type { PanelVia } from '@/pages/features/locations/ApplyStrip'
import { LOCATIONS_WHERE } from '@/pages/features/locations/locationApply'
import { IncidentPanelContent, editableIncident, reportIdent } from '@/pages/features/supportdesk/IncidentPanel'
import {
  INCIDENT_EDIT_FEATURE, patchedRows, savedFields, settledPatches, withSaved,
} from '@/pages/features/supportdesk/SupportIncidentsPage'

const ROW: Record<string, string> = {
  id: 'r42', timestamp: '10/24/2026 09:26:00', your_name: 'Test Reporter', client_name: 'Test Client',
  incident_category: 'Unusual Behavior (general)', incident_location: 'Client Home', incident_date: '10/24/2026',
  summary_of_incident: 'What happened.',
}
// the row as step 2 of the operator's sheet writes it: ADMIN and above
const LEADS = ['PLATFORMLEAD', 'DIRECTOR', 'SUPERVISOR', 'ADMINISTRATOR', 'ADMIN']
const RULES = { [INCIDENT_EDIT_FEATURE]: LEADS }

const VIA: PanelVia = {
  client: '', rereads: [], edit: async () => ({}),
  target: { where: LOCATIONS_WHERE, overlaid: () => {}, wrote: () => {}, written: () => {}, reread: async () => {} },
}

describe('support-desk.incidentsEdit — who edits', () => {
  it('is the master\'s alone while App Control names no badge', () => {
    assert.equal(featureAllowsWith(INCIDENT_EDIT_FEATURE, { isMaster: true }, {}), true)
    assert.equal(featureAllowsWith(INCIDENT_EDIT_FEATURE, { types: ['DIRECTOR'], role: 'admin' }, {}), false)
  })

  it('opens from ADMIN up once the row names them, and never below', () => {
    for (const b of LEADS) assert.equal(featureAllowsWith(INCIDENT_EDIT_FEATURE, { types: [b], role: 'staff' }, RULES), true, b)
    for (const b of ['HM', 'TEAMLEAD', 'STAFF', 'GUARDIAN']) {
      assert.equal(featureAllowsWith(INCIDENT_EDIT_FEATURE, { types: [b], role: 'staff' }, RULES), false, b)
    }
    assert.equal(featureAllowsWith(INCIDENT_EDIT_FEATURE, { isMaster: true }, RULES), true)
  })
})

describe('the pencil in the panel', () => {
  const draw = (via?: PanelVia) => renderToString(createElement(IncidentPanelContent, {
    row: ROW, category: ROW.incident_category, via, editing: false, onEdit: () => {}, onDone: () => {},
  }))

  it('is drawn where the page hands the panel its door, above the report', () => {
    const html = draw(VIA)
    assert.match(html, /data-edit-open/)
    assert.ok(html.indexOf('data-edit-open') < html.indexOf('data-incident-panel'))
  })

  it('is never drawn without the door — the Incident Log\'s own panel, or a person the row does not name', () => {
    assert.doesNotMatch(draw(undefined), /data-edit-open/)
    assert.match(draw(undefined), /data-incident-panel="r42"/)
  })

  it('is handed only on a report the door can find and witness', () => {
    assert.equal(editableIncident(ROW), true)
    assert.equal(editableIncident({ ...ROW, id: 'INC-7' }), false)
    assert.equal(editableIncident({ ...ROW, timestamp: '' }), false)
    assert.equal(editableIncident({ ...ROW, client_name: '' }), false)
  })
})

describe('a saved edit in the list', () => {
  const changes = [
    { field: 'summary_of_incident', value: 'Rewritten.', expected: 'What happened.' },
    { field: 'incident_location', value: 'Day program', expected: 'Client Home' },
  ]

  it('keeps only the fields the door says it wrote, each with the cell it replaced', () => {
    assert.deepEqual(savedFields(changes, { written: ['summary_of_incident'], refused: [] }),
      { summary_of_incident: { value: 'Rewritten.', was: 'What happened.' } })
    assert.deepEqual(savedFields(changes, { written: [], refused: [{ field: 'incident_location', why: 'x' }] }), {})
  })

  const KEY = reportIdent(ROW)

  it('shows at once, and goes once a read moves past the cell it replaced — ours, or a newer one', () => {
    const patches = { [KEY]: { summary_of_incident: { value: 'Rewritten.', was: 'What happened.' } } }
    assert.equal(patchedRows([ROW], patches)[0].summary_of_incident, 'Rewritten.')
    assert.deepEqual(settledPatches([ROW], patches), patches)
    assert.deepEqual(settledPatches([{ ...ROW, summary_of_incident: 'Rewritten.' }], patches), {})
    assert.deepEqual(settledPatches([{ ...ROW, summary_of_incident: 'Someone else wrote this later.' }], patches), {})
  })

  it('a field saved twice keeps the cell it first replaced, so the held copy does not undo it', () => {
    const once = withSaved({}, KEY, { summary_of_incident: { value: 'First.', was: 'What happened.' } })
    const twice = withSaved(once, KEY, { summary_of_incident: { value: 'Second.', was: 'First.' } })
    assert.deepEqual(twice[KEY].summary_of_incident, { value: 'Second.', was: 'What happened.' })
    assert.equal(patchedRows([ROW], settledPatches([ROW], twice))[0].summary_of_incident, 'Second.')
  })

  it('another report that moved under the same row number never shows the saved fields', () => {
    const patches = { [KEY]: { prevention_plan: { value: 'Double check.', was: '' } } }
    const moved = { ...ROW, timestamp: '10/25/2026 08:00:00', client_name: 'Another Client' }
    assert.equal(patchedRows([moved], patches)[0].prevention_plan, undefined)
    assert.deepEqual(settledPatches([moved], patches), {})
  })

  it('the report is its row number, filing instant and client: another report under the same number is another', () => {
    assert.notEqual(reportIdent(ROW), reportIdent({ ...ROW, timestamp: '10/25/2026 08:00:00', client_name: 'Other' }))
    assert.equal(reportIdent(ROW), reportIdent({ ...ROW, summary_of_incident: 'Edited.' }))
  })
})
