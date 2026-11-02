/**
 * INCIDENTS · the edit made in the New Incident form, and Support Requests' Incidents page.
 *
 * The Edit incident panel (Locations › Incidents and a client's Incidents) is the New Incident form opened with the
 * report's values. Its cells come in several spellings (a Google form's M/D/YYYY and "2:23:00 PM", the Hub's
 * yyyy-MM-dd and 15:43, a place typed by hand), so the form must open each one as its inputs read it, send nothing
 * the person did not move, and write a moved cell back in the spelling that cell already used, witnessed by the cell
 * as read. Support Requests › Incidents lists the Incident Log's rows in Support Requests' table: searched, sorted
 * newest first, and counted as the Incident Log's MUI Watch counts them.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  incidentEditChanges, incidentFormClock, incidentFormDay, incidentFormValues, incidentNames,
} from '@/pages/features/locations/locationModel'
import {
  categoryTint, incidentCounts, incidentMatches, visibleIncidents,
} from '@/pages/features/supportdesk/SupportIncidentsPage'
import { IncidentBody, incidentFacts } from '@/pages/features/supportdesk/IncidentPanel'
import { ownPanelOf } from '@/components/shell/DetailPanel'
import { appManifests } from '@/registry/apps'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

const FORM_ROW: Record<string, string> = {
  timestamp: '10/27/2026 14:23:25', your_name: 'Tonisha Clark', client_name: 'Martha Sites',
  incident_category: 'Medication related error', incident_location: 'Client Home', incident_date: '10/27/2026',
  incident_time: '2:10:00 PM', incident_reported_date: '10/27/2026', incident_reported_time: '2:23:00 PM',
  employees_involved: 'Tonisha Clark; Shylah Walker', summary_of_incident: 'Missed the 2 PM dose.',
  immediate_action_taken: 'Called the nurse.', cause_and_contributing_factors: '', prevention_plan: 'Double check.',
}

describe('the edit form opens each cell as its input reads it', () => {
  it('reads both day spellings and leaves anything else blank', () => {
    assert.equal(incidentFormDay('10/27/2026'), '2026-10-27')
    assert.equal(incidentFormDay('2026-10-08'), '2026-10-08')
    assert.equal(incidentFormDay('3/4/2025 9:00:00'), '2025-03-04')
    assert.equal(incidentFormDay('last Tuesday'), '')
  })
  it('reads 12- and 24-hour times', () => {
    assert.equal(incidentFormClock('2:10:00 PM'), '14:10')
    assert.equal(incidentFormClock('12:05 AM'), '00:05')
    assert.equal(incidentFormClock('6:10 PM'), '18:10')
    assert.equal(incidentFormClock('15:43'), '15:43')
    assert.equal(incidentFormClock('13:05:40'), '13:05')
    assert.equal(incidentFormClock('around noon'), '')
  })
  it('splits a place the paper form does not list into Other and its words', () => {
    assert.deepEqual(
      [incidentFormValues({ incident_location: 'Workshop' }).incident_location,
        incidentFormValues({ incident_location: 'Workshop' }).incident_location_other],
      ['Other', 'Workshop'])
    const other = incidentFormValues({ incident_location: 'Other: the van' })
    assert.equal(other.incident_location, 'Other')
    assert.equal(other.incident_location_other, 'the van')
    assert.equal(incidentFormValues({ incident_location: 'Community' }).incident_location, 'Community')
  })
  it('ticks the employees the report names, in the list order, whatever separated them', () => {
    assert.deepEqual(incidentNames('Tonisha Clark; Shylah Walker,\nAna'), ['Tonisha Clark', 'Shylah Walker', 'Ana'])
    const v = incidentFormValues(FORM_ROW, ['Ana', 'Shylah Walker', 'Tonisha Clark'])
    assert.equal(v.employees_involved, 'Shylah Walker, Tonisha Clark')
  })
})

describe('the edit sends only what moved, in the cell’s own spelling', () => {
  const employees = ['Shylah Walker', 'Tonisha Clark']
  const opened = incidentFormValues(FORM_ROW, employees)

  it('sends nothing when nothing moved', () => {
    assert.deepEqual(incidentEditChanges(FORM_ROW, opened, opened), [])
    const odd = { ...FORM_ROW, incident_location: 'Workshop', incident_date: 'unknown' }
    const o = incidentFormValues(odd)
    assert.deepEqual(incidentEditChanges(odd, o, o), [])
  })
  it('writes a moved day and time back as the Google form spelt them, witnessed by the cell as read', () => {
    const got = incidentEditChanges(FORM_ROW, opened, { ...opened, incident_date: '2026-10-26', incident_time: '09:05' })
    assert.deepEqual(got, [
      { field: 'incident_date', value: '10/26/2026', expected: '10/27/2026' },
      { field: 'incident_time', value: '9:05:00 AM', expected: '2:10:00 PM' },
    ])
  })
  it('keeps the Hub’s own spelling for a cell the Hub filed', () => {
    const hub = { ...FORM_ROW, incident_date: '2026-10-08', incident_time: '15:43' }
    const o = incidentFormValues(hub)
    assert.deepEqual(incidentEditChanges(hub, o, { ...o, incident_date: '2026-10-09', incident_time: '16:00' }), [
      { field: 'incident_date', value: '2026-10-09', expected: '2026-10-08' },
      { field: 'incident_time', value: '16:00', expected: '15:43' },
    ])
  })
  it('files Other with what was filled in, and a text field as typed', () => {
    const got = incidentEditChanges(FORM_ROW, opened, {
      ...opened, incident_location: 'Other', incident_location_other: 'Day program', prevention_plan: 'Two staff check.',
    })
    assert.deepEqual(got, [
      { field: 'incident_location', value: 'Other: Day program', expected: 'Client Home' },
      { field: 'prevention_plan', value: 'Two staff check.', expected: 'Double check.' },
    ])
  })
  it('sends a ticked employee as the list the checks keep', () => {
    const got = incidentEditChanges(FORM_ROW, opened, { ...opened, employees_involved: 'Tonisha Clark' })
    assert.deepEqual(got, [{ field: 'employees_involved', value: 'Tonisha Clark', expected: 'Tonisha Clark; Shylah Walker' }])
  })
})

describe('Support Requests › Incidents', () => {
  const rows: Record<string, string>[] = [
    { id: 'r1', incident_date: '9/4/2026', timestamp: '9/4/2026 21:03:52', client_name: 'Nakita Wade', your_name: 'Wanda',
      incident_category: 'Minor injury or illness (rash, bruise, small cut, burn, slight cold, etc.)', incident_location: 'Client Home' },
    { id: 'r2', incident_date: '10/27/2026', timestamp: '10/27/2026 14:23:25', client_name: 'Martha Sites',
      your_name: 'Tonisha Clark', incident_category: 'Medication related error', summary_of_incident: 'Missed dose' },
    { id: 'r3', incident_date: '2026-10-08', timestamp: '2026-10-08T15:19:17Z', client_name: 'Lori Schmucker',
      your_name: 'Natasia Lakey', incident_category: 'MUI — Major Unusual Incident' },
  ]
  it('sorts by the incident’s day, whatever its spelling, newest first by default', () => {
    assert.deepEqual(visibleIncidents(rows, '', 'desc').map((r) => r.id), ['r2', 'r3', 'r1'])
    assert.deepEqual(visibleIncidents(rows, '', 'asc').map((r) => r.id), ['r1', 'r3', 'r2'])
  })
  it('searches the client, the reporter, the category, the place and the summary', () => {
    assert.ok(incidentMatches(rows[1], 'missed'))
    assert.ok(incidentMatches(rows[2], 'natasia'))
    assert.ok(!incidentMatches(rows[0], 'martha'))
  })
  it('counts the reports, the MUIs and this month as the Incident Log’s MUI Watch', () => {
    const c = Object.fromEntries(incidentCounts(rows, new Date(2026, 9, 29)).map((x) => [x.key, x.n]))
    assert.deepEqual(c, { reports: 3, muis: 1, month: 2 })
  })
  it('opens a report in Support Requests’ own panel: chips, who filed it, the summary, the facts in the grey grid', () => {
    const r: Record<string, string> = { ...FORM_ROW, id: 'r750', incident_reported_date: '10/27/2026' }
    const facts = incidentFacts(r)
    assert.deepEqual(facts.map((f) => f.label), ['Client', 'Location', 'Incident date', 'Incident time', 'Reported on',
      'Employees involved', 'Immediate action', 'Cause and contributing factors', 'Prevention plan'])
    assert.equal(facts[0].value, 'Martha Sites')
    assert.equal(facts[4].value, 'Oct 27, 2026 2:23:00 PM')
    assert.equal(facts[7].value, '', 'an empty fact stays empty and is drawn as a dash')
    const html = renderToString(createElement(IncidentBody, { row: r, category: r.incident_category, tint: 'danger' }))
    assert.match(html, /data-status-word="">Incident filed</)
    assert.match(html, /data-category-pill="danger"[^>]*>Medication related error</)
    assert.match(html, /Tonisha Clark/)
    assert.match(html, /Missed the 2 PM dose\./)
    assert.match(html, /bg-surface-2[^"]*" data-details=""/)
    assert.doesNotMatch(html, /bg-(black|text-1|ink)|text-white/, 'no dark header, as in Support Requests')
    const mui = renderToString(createElement(IncidentBody, { row: { id: 'm' }, category: 'MUI — Major Unusual Incident', tint: 'blue' }))
    assert.match(mui, /MUI filed/)
    assert.match(mui, /No summary was filed\./)
    assert.match(mui, /Reporter not named/)
  })
  it('the Incident Log opens its reports in the same panel (its detailPanel names ownPanel incident)', () => {
    const log = appManifests.find((a) => a.id === 'incidents')?.pages.find((p) => p.id === 'log')
    const detail = (log?.config as { detailPanel?: Record<string, unknown> } | undefined)?.detailPanel
    assert.equal(ownPanelOf(detail), 'incident')
    assert.equal(ownPanelOf({ ...detail, resource: 'uiIncidents' }), 'incident', 'the Log and Board views add the resource')
    assert.equal(ownPanelOf({}), '')
    assert.equal(ownPanelOf({ ownPanel: 'toString' }), '', 'an unknown name keeps the template')
    assert.equal(ownPanelOf(undefined), '')
  })
  it('tints a category by the words the form uses', () => {
    assert.equal(categoryTint('Medication related error'), 'danger')
    assert.equal(categoryTint('Unusual Behavior (general)'), 'lavender')
    assert.equal(categoryTint('MUI'), 'blue')
  })
})
