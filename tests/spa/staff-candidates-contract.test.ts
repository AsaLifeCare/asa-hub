/**
 * Staff Candidates · the contract between the page and its doors. Every call the page makes is caught at `fetch` —
 * the candidates slice, the relay's pack and each Apps Script door — and answered in the shapes CandidateProfiles.gs
 * builds; the names, the pack parts, the Hiring doors and the relay's receipts are read from the backend's own files,
 * and the lane-1 roster is held to the backend's own roster row, run here. A name, a part, a door or a field that one
 * side renames breaks here, not on the screen.
 *
 * The app ships master-only: no App Control row, mounted only through CUSTOM_PAGES. Nothing in it is a dialog, and
 * every change is a Hiring door.
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import { createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { badgeAllowsApp, useBadgeAccessStore } from '@/lib/badgeAccess'
import { isAllowedWith } from '@/lib/appAccess'
import { PREFETCH_GAP_MS, forgetPack } from '@/lib/appPack'
import { forgetSnapshot } from '@/lib/snapshotClient'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { appManifests } from '@/registry/apps'
import { staffCandidatesManifests } from '@/registry/apps-staff-candidates'
import AppRoutePage, { CUSTOM_PAGES } from '@/pages/AppRoutePage'
import { textsOf, transcriptsOf } from '@/pages/features/staffprofiles/staffModel'
import StaffCandidatesPage, { CandidatesScreen, lookupRead } from '@/pages/features/staffcandidates/StaffCandidatesPage'
import CandidatePanel from '@/pages/features/staffcandidates/CandidatePanel'
import { DocumentBody, PaperVerdict } from '@/pages/features/staffcandidates/CandidateForms'
import { ActionsMenu } from '@/pages/features/staffcandidates/CandidateActions'
import { SwitcherList } from '@/pages/features/staffcandidates/CandidateSwitcher'
import { NarrowOverviewView, OverviewView } from '@/pages/features/staffcandidates/sections/Overview'
import { ActionsView } from '@/pages/features/staffcandidates/sections/Actions'
import { NextStepCell, PipelineView } from '@/pages/features/staffcandidates/sections/Pipeline'
import { InformationView } from '@/pages/features/staffcandidates/sections/Information'
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import { InterviewsView } from '@/pages/features/staffcandidates/sections/Interviews'
import { DocumentsView } from '@/pages/features/staffcandidates/sections/Documents'
import { ActivityView } from '@/pages/features/staffcandidates/sections/Activity'
import { TextsView } from '@/pages/features/staffcandidates/sections/Texts'
import { TranscriptsView } from '@/pages/features/staffcandidates/sections/Transcripts'
import {
  CANDIDATES_PATH, DOOR_WORDS, NOTE_MAX, NOT_OPEN, NO_FIELDS, PAPER_EXTS, actionsOf, activityOf, cjisResultWords, doorReady,
  documentsOf, interviewsOf, noteBody, overviewOf, panelLabel, panelOf, panelParam, panelTitle, paperAccept, paperExtsWords,
  paperFileRefusal, paperReadingOf, paperVerdictWords, pipelineOpen, readRefusal, readingLines, resumeFilled, resumeOf, rosterFrom,
  rosterOf, sharePayloadFor, tabFor, tabsFor, type CandidateAsk, type Door, type PipelineOpen, type RosterRow,
} from '@/pages/features/staffcandidates/candidateModel'
import { mayBeNarrowed } from '@/pages/features/staffcandidates/candidateReads'
import { ReadLine } from '@/pages/features/staffcandidates/CandidateParts'
import { FileDropZone } from '@/features/hiring/shared'
import {
  DOORS_OPENED, addDocument, addNote, candidateWrote, forgetCandidateReads, openDoor, openSignedPacket, pressUnlogged, readActions,
  readActivity, readDocuments, readInterviews, readKey, readOverview, readResume, readRoster, readTexts, readTranscript,
  readTranscripts, useCandidateDocs, useCandidateRead, type ReadState,
} from '@/pages/features/staffcandidates/useCandidateRead'
import { mountHook } from './react-host'
import { SHELL_SHOWN, primeShellHides } from '@/lib/myWorkHides'

// the parts Settings › My Work can hide are drawn as the master's own session sees them
primeShellHides(SHELL_SHOWN)

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const FEATURE = 'src/pages/features/staffcandidates'
const KEY = 'CAN_maria01'
const OTHER = 'CAN_benc0002'
const OFF_BOARD = 'CAN_gone0003'
const SOURCE_AT = '2026-09-28T14:00:00.000Z'
const noop = () => {}
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(createElement(MemoryRouter, null, node)))
const ready = <T>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })
const noModal = (html: string, what: string) => {
  assert.ok(!html.includes('aria-modal'), `${what}: no aria-modal`)
  assert.ok(!html.includes('role="dialog"') && !html.includes('role="alertdialog"'), `${what}: no dialog role`)
}

type Row = Record<string, unknown>
type Policy = { file: string; lane: string; idempotent?: boolean; params?: Record<string, unknown> }

const gsText = (file: string) => readFileSync(resolve(ROOT, 'apps-script', file), 'utf8')

/** One top-level function or var of a .gs file, exactly as written there. */
function lift(file: string, name: string): string {
  const src = `\n${gsText(file)}`
  const fn = src.indexOf(`\nfunction ${name}(`)
  if (fn !== -1) return src.slice(fn + 1, src.indexOf('\n}', fn + 1) + 2)
  const v = src.indexOf(`\nvar ${name} =`)
  assert.notEqual(v, -1, `${file} has no ${name}`)
  return src.slice(v + 1, src.indexOf(';\n', v) + 1)
}

/** Every HUB_POLICY declaration written as a literal, across the backend. */
function policies(): Record<string, Policy> {
  const out: Record<string, Policy> = {}
  for (const f of readdirSync(resolve(ROOT, 'apps-script')).filter((n) => n.endsWith('.gs'))) {
    for (const m of gsText(f).matchAll(/^HUB_POLICY\.(\w+) = (\{[\s\S]*?\n\});/gm)) {
      try { out[m[1]] = vm.runInNewContext(`(${m[2]})`) as Policy } catch { /* not a literal */ }
    }
  }
  return out
}

const POLICY = policies()

/** The backend's own lists and the roster row it builds, run as written. */
const GS = (() => {
  const g: Record<string, unknown> = {
    String, Number, Boolean, Array, Object, RegExp, Date, JSON, Math, isNaN,
    Utilities: {
      formatDate: (d: Date, tz: string) => {
        const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(d)
        return `${part({ year: 'numeric' })}-${part({ month: '2-digit' })}-${part({ day: '2-digit' })}`
      },
    },
    hubSheetTz_: () => 'America/New_York',
  }
  const ctx = vm.createContext(g)
  const parts = [
    ['Talent.gs', 'str_'], ['Talent.gs', 'talentIsoDay_'], ['Locations.gs', 'locationsText_'],
    ['CandidateProfiles.gs', 'CND_ACTIONS'], ['CandidateProfiles.gs', 'CND_PACK_PARTS'], ['CandidateProfiles.gs', 'CND_NOTE_MAX'],
    ['CandidateProfiles.gs', 'CND_STAGE_LABELS'], ['CandidateProfiles.gs', 'CND_DOORS'], ['CandidateProfiles.gs', 'cndStageLabel_'],
    ['CandidateProfiles.gs', 'cndBy_'], ['CandidateProfiles.gs', 'cndOpen_'], ['CandidateProfiles.gs', 'cndNextSteps_'],
    ['CandidateProfiles.gs', 'cndAttention_'], ['CandidateProfiles.gs', 'cndStatusWord_'], ['CandidateProfiles.gs', 'cndRosterRow_'],
    ['CandidateProfiles.gs', 'CND_DOOR_TITLES'], ['CandidateProfiles.gs', 'CND_DOOR_FIELDS'],
    ['ComplianceDocs.gs', 'CERT_READ_KIND_WORDS'], ['ComplianceDocs.gs', 'CERT_READ_WORDS'], ['ComplianceDocs.gs', 'certReadA_'],
    ['ComplianceDocs.gs', 'complianceDocsDay_'], ['CandidateProfiles.gs', 'CND_KIND_WORDS'], ['CandidateProfiles.gs', 'CND_PAPER_FLOOR'],
    ['CandidateProfiles.gs', 'cndKindWords_'], ['CandidateProfiles.gs', 'cndPaperVerdict_'],
    ['CandidateProfiles.gs', 'CND_CJIS_STATUSES'], ['CandidateProfiles.gs', 'cndCjisKept_'], ['CandidateProfiles.gs', 'cndCjisSuggested_'],
    ['CandidateProfiles.gs', 'CND_PAPER_EXTS'], ['CandidateProfiles.gs', 'CND_WORD_TYPES'],
  ]
  vm.runInContext(parts.map(([f, n]) => lift(f, n)).join('\n'), ctx)
  vm.runInContext('this.__out = { actions: CND_ACTIONS, parts: CND_PACK_PARTS, noteMax: CND_NOTE_MAX, doors: CND_DOORS, ' +
    'rosterRow: cndRosterRow_, titles: CND_DOOR_TITLES, fields: CND_DOOR_FIELDS, verdict: cndPaperVerdict_, ' +
    'statuses: CND_CJIS_STATUSES, kept: cndCjisKept_, suggested: cndCjisSuggested_, paperExts: CND_PAPER_EXTS, ' +
    'wordTypes: CND_WORD_TYPES }', ctx)
  type Verdict = { verified: boolean; reason: string; read_as: string; why: string; reading: Row }
  return (ctx as unknown as { __out: {
    actions: string[]; parts: string[]; noteMax: number; doors: Record<string, { action: string }>; rosterRow: (r: Row) => Row
    titles: Record<string, string>; fields: Record<string, Record<string, string>>
    verdict: (found: Row, read: Row, who: string) => Verdict
    statuses: string[]; kept: (onFile: string, v: Verdict, taken: boolean) => string
    suggested: (onFile: string, v: Verdict, taken: boolean) => string
    paperExts: string[]; wordTypes: Record<string, string>
  } }).__out
})()

/* ---------- the stores: the board's rows, and each door's answer ---------- */

const checklist = (items: [string, string, string, string, string][]) =>
  items.map(([id, label, status, owner, stage]) => ({ id, label, status, owner, stage }))

function boardRows(): Row[] {
  return [
    { id: KEY, name: 'Maria Lopez', role: '', stage: 'interview', city: 'Canton', state: 'OH', source: 'Indeed',
      owner: 'asa-hub:recruiter@example.org at 2026-09-01T10:00:00Z', appliedAt: '2026-09-01T14:00:00Z', phone: '3305550111',
      email: 'maria@example.org', avatar: '',
      checklist: checklist([
        ['resume', 'Resume', 'done', 'Candidate', 'new'], ['cjis', 'CJIS', 'missing', 'HR', 'new'],
        ['interview-scheduled', 'Interview scheduled', 'pending', 'Recruiter', 'interview'],
        ['interview-scorecard', 'Interview scorecard', 'pending', 'Interviewer', 'interview'],
      ]) },
    { id: OTHER, name: 'Ben Carter', role: 'House Manager', stage: 'onboarding', city: 'Akron', state: 'OH', owner: 'Ann Lee',
      appliedAt: '2026-08-20', phone: '', email: '',
      checklist: checklist([['new-hire-packet', 'New Hire packet', 'pending', 'Candidate', 'onboarding']]) },
    { id: 'CAN_ada00004', name: 'Ada Nguyen', role: '', stage: 'new', city: '', state: '', owner: '', appliedAt: '', checklist: [] },
  ]
}

const door = (action: string, form: string, payload: Row) => ({ action, form, payload })

function answers(key: string): Record<string, Row> {
  const name = key === KEY ? 'Maria Lopez' : key === OFF_BOARD ? 'Gone Person' : 'Ben Carter'
  const actions = {
    stage: 'interview', stage_label: 'Interview', archived: key === OFF_BOARD,
    items: [
      { id: 'resume', label: 'Resume', status: 'done', open: false, owner: 'Candidate', stage: 'new', in_phase: false, is_next: false,
        due: '', due_state: '', complete: null, complete_why: '' },
      { id: 'cjis', label: 'CJIS', status: 'missing', open: true, owner: 'HR', stage: 'new', in_phase: false, is_next: false,
        due: '', due_state: '', complete: door('tableDocUpload', 'upload', { candidate_id: key, item_id: 'cjis' }), complete_why: '',
        paper: { asks: 'Background check (BCI)', expects: 'a background check', where: 'the Hiring record', pdf_only: true,
          exts: ['pdf'], statuses: ['Pending', 'Clear', 'Verified', 'Disqualified'], choices: [] } },
      { id: 'interview-scheduled', label: 'Interview scheduled', status: 'pending', open: true, owner: 'Recruiter', stage: 'interview',
        in_phase: true, is_next: true, due: '2026-09-20', due_state: 'overdue',
        complete: door('hiringScheduleCreate', 'schedule', { candidate_id: key, event_type: 'in_person_interview' }), complete_why: '' },
      { id: 'application', label: 'Application', status: 'pending', open: true, owner: 'Candidate', stage: 'new', in_phase: false,
        is_next: false, due: '', due_state: '', complete: null, complete_why: 'The platform does this by itself.' },
    ],
    next: null, open: 3, attention: ['Resume on file and not scored'], status: 'needs_you',
    gate: { from: 'interview', to: 'onboarding', ok: false, reasons: ['interview scorecard'] },
    stages: [
      { id: 'new', label: 'New', current: false, reachable: false, door: null, why: 'The Hiring pipeline moves one stage at a time.' },
      { id: 'interview', label: 'Interview', current: true, reachable: false, door: null, why: '' },
      { id: 'onboarding', label: 'Onboarding', current: false, reachable: true,
        door: door('moveStage', '', { candidate_id: key, to_stage: 'onboarding' }), why: '' },
      { id: 'not-hiring', label: 'Not hiring', current: false, reachable: true, door: door('hiringDiscard', 'reason', { candidate_id: key }),
        why: 'Takes them out of the process; the reason is required and the team is told.' },
    ],
    why: [], degraded: false,
  }
  const activity = {
    items: [
      { id: 'jrn_2', at: '2026-09-22T15:00:00Z', kind: 'note', step: 'note', title: 'Note', body: 'Prefers mornings', channel: 'note',
        ok: true, rehearsal: false, by: 'boss@example.org' },
      { id: 'jrn_1', at: '2026-09-21T15:00:00Z', kind: 'step', step: 'interview_invite', title: 'Interview invite', body: 'Sent the slots',
        channel: 'sms', ok: false, rehearsal: false, by: 'asa-hub' },
      { id: 'stage_0_2026', at: '2026-09-10T12:00:00Z', kind: 'stage', step: 'stage', title: 'Stage: Phone Screen → Interview', body: '',
        channel: '', ok: true, rehearsal: false, by: 'recruiter@example.org' },
    ],
    total: 3, why: [], degraded: false,
  }
  return {
    overview: {
      candidate: { key, name, position: 'Direct Support Professional', stage: 'interview', stage_label: 'Interview',
        status_label: key === OFF_BOARD ? 'Not Hiring' : 'Interview', archived: key === OFF_BOARD,
        archived_reason: key === OFF_BOARD ? 'Declined the offer' : '', location: 'Canton, OH', recruiter: 'recruiter@example.org',
        source: 'Indeed', applied_at: '2026-09-01', phone: '3305550111', email: 'maria@example.org', avatar: '', days_at_stage: 4 },
      information: { full_name: name, stage_label: 'Interview', phone: '3305550111', email: 'maria@example.org', source: 'Indeed',
        applied_at: '2026-09-01', position: 'Direct Support Professional', availability: 'Weekdays after 3pm',
        experience: '4 years caregiving', preferred_location: 'NW4045', earliest_start: '2026-10-06', recruiter: 'recruiter@example.org' },
      summary: 'Four years in residential care, CPR current.',
      tiles: { stage_label: 'Interview', open_actions: 3, docs_on_file: 1, docs_total: 3 },
      next: { id: 'interview-scheduled', label: 'Interview scheduled', owner: 'Recruiter', status: 'pending', due: '2026-09-20',
        due_state: 'overdue' },
      attention: ['Resume on file and not scored'],
      recent: activity.items,
      why: [], degraded: false,
    },
    actions,
    interviews: {
      plan: [
        { id: 'phone_screen', title: 'Phone screen', date: '2026-09-05', owner: 'Ann Lee', status: 'completed',
          result: 'Advance · Qualified', comments: 'Clear and warm on the phone.' },
        key === OTHER ? SIGNED_INTERVIEW : { id: 'interview', title: 'Structured interview', date: '2026-09-24', owner: '',
          status: 'awaiting_confirmation', detail: 'The slot is not confirmed yet.', result: '', comments: '', with_name: 'Ivy Interviewer' },
        { id: 'onboarding', title: 'Onboarding handoff', date: '', owner: '', status: 'pending', result: '', comments: '' },
      ],
      preferences: { shifts: ['Day', 'Night'], hours: ['Full time'], every_other_weekend: 'yes', male_care: 'no', behavioral_care: '',
        drivers_license: 'yes', vehicle: 'yes', insurance: '', certificates: { dodd: 'yes', cpr_first_aid: 'yes', med_del: 'no' },
        best_in_person: 'Tuesday 10am', availability: 'Weekdays after 3pm', earliest_start: '2026-10-06', preferred_location: 'NW4045' },
      why: [], degraded: false,
    },
    documents: {
      docs: [
        { id: 'resume', title: 'Resume', group: 'application', status: 'on_file', date: '2026-09-02', expires: '',
          file_id: 'resumefile0001', mime: '', source: 'Hiring', verified: false, upload: null },
        { id: 'interview_notes', title: 'Interview notes', group: 'interview', status: 'on_file', date: '2026-09-24', expires: '',
          file_id: '', mime: '', source: 'Interview scorecard', verified: false, upload: null,
          record: { interviewer: 'Ann Lee', score: '8', recommendation: 'Advance', comments: 'Calm, kind, careful.', interviewed_at: '' } },
        { id: 'cjis', title: 'Background check (CJIS)', group: 'screening', status: 'pending', result: '', date: '', expires: '',
          file_id: '', mime: '', source: 'Hiring', verified: false,
          upload: door('tableDocUpload', 'upload', { candidate_id: key, item_id: 'cjis' }) },
        ...(key === OTHER ? [{ id: 'doc_dropbox_packet', doc_id: 'dropbox_packet', title: 'New Hire Packet', group: 'onboarding',
          status: 'on_file', date: '2026-09-20', expires: '', file_id: 'packetfile0001', mime: 'application/pdf',
          source: 'Onboarding documents', verified: false, upload: null }] : []),
        ...(key === 'CAN_ada00004' ? [{ id: 'doc_dropbox_packet', doc_id: 'dropbox_packet', title: 'New Hire Packet',
          group: 'onboarding', status: 'on_file', date: '', expires: '', file_id: '', mime: '', source: 'Dropbox Sign',
          verified: false, upload: null }] : []),
      ],
      counts: { total: 3, on_file: 1, with_file: 1 }, why: [], degraded: false,
    },
    activity,
    texts: {
      counterparts: [{ id: 'PN_main', label: 'Main line', owner: 'Ann Lee', count: 2, first_at: '2026-09-20T12:00:00Z',
        last_at: '2026-09-21T12:00:00Z' }],
      with: 'PN_main',
      messages: [
        { id: 'M2', at: '2026-09-21T12:00:00Z', dir: 'out', body: 'Your interview is Tuesday at 10', by: 'Ann Lee' },
        { id: 'M1', at: '2026-09-20T12:00:00Z', dir: 'in', body: 'Hi, is there an update?', by: '' },
      ],
      more: false, coverage: { from: '2026-01-01', to: '2026-09-28', gaps: [] }, phones_matched: 1, why: '', degraded: false,
    },
    transcripts: key === OTHER ? {
      calls: [{ call_id: 'AC9other', at: '2026-09-12T15:00:00Z', secs: '40', direction: 'outgoing', line: '+13309197595', turns: '4',
        kind: '', categories: ['Scheduling'] }],
      categories: [{ name: 'Scheduling', count: 1 }], gaps: [], why: '', degraded: false,
    } : {
      calls: [{ call_id: 'screen', at: '2026-09-05T14:00:00Z', secs: '', direction: '', line: '', turns: '', kind: 'Phone screen',
        categories: ['Phone screen'] }],
      categories: [{ name: 'Phone screen', count: 1 }], gaps: [], why: '', degraded: false,
    },
  }
}

/** The phone screen's words, as the Hiring record filed them: every turn, its speaker and its stamp. */
const SCREEN_WORDS = [
  '[0:00] +13307544040: Thanks for calling the ASA screening line. Can you tell me your name?',
  '[0:05] +13305550111: Hi, this is Maria Lopez.',
  '[0:09] +13305550111: I applied for the DSP opening in Canton.',
  '[0:15] +13307544040: Tell me about your caregiving experience.',
  '[0:21] +13305550111: Four years in residential care, CPR current.',
].join('\n')

/** The interview a completed scorecard answers, and the one still waiting on it. */
const SIGNED_INTERVIEW = {
  id: 'interview', title: 'Structured interview', date: '2026-09-18', owner: 'Ivy Interviewer', status: 'completed', detail: '',
  result: 'Advance · score 8/10', comments: 'Calm, kind, careful with the residents.', day: '2026-09-18', time: '14:30',
  interviewed_at: '2026-09-18T19:10:00Z', score: '8', score_max: 10, recommendation: 'Advance', with_name: 'Ivy Interviewer',
  location: 'Main office, Canton',
}

/** Information's resume, as candidateProfileResume answers it. */
const RESUME = {
  on_file: true, file_read: true, analyzed_at: '2026-09-02T10:00:00Z',
  fields: { experience: '3 jobs listed since 2014 — latest: DSP at Bright Path', availability: 'Weekdays and evenings',
    preferred_location: 'Canton or North Canton', preferred_basis: 'stated', earliest_start: 'October 6, 2026' },
  summary: 'Compassionate DSP with 7 years of residential care.',
  work: [
    { role: 'Direct Support Professional', employer: 'Bright Path Residential Services', place: 'Canton, OH', from: 'June 2019', to: 'Present' },
    { role: 'Home Health Aide', employer: 'Comfort Keepers', place: '', from: '03/2016', to: '05/2019' },
  ],
  education: [{ school: 'Canton South High School', degree: 'Diploma', year: '2012', place: 'Canton, OH' }],
  certifications: ['CPR / First Aid (American Red Cross)', 'STNA', "Driver's license"],
  skills: ['Personal care', 'Meal preparation'], languages: ['English', 'Spanish'],
  analysis: { highest_responsibility: 'Lead DSP', dsp_agencies: '2', avg_tenure: '', months_since_last: '0' },
  why: [], degraded: false,
}

const S = { slicesServed: true, packOpen: true, master: true }
const ROSTER_ANSWER = () => ({ candidates: boardRows().map((r) => GS.rosterRow(r)), why: [], degraded: false })

/** The doors: the reads as CandidateProfiles.gs answers them, the note, and the Hiring doors' own envelopes. */
function answer(action: string, payload: Row): { status: number; data?: unknown; message?: string } {
  if (!S.master && (action.startsWith('candidateProfile') || action === 'candidatePack')) return { status: 404, message: 'Unknown action.' }
  if (action === 'candidateProfileRoster') return { status: 200, data: ROSTER_ANSWER() }
  const key = String(payload.candidate ?? '')
  const known = [KEY, OTHER, 'CAN_ada00004', OFF_BOARD].includes(key)
  const part: Record<string, string> = {
    candidateProfileOverview: 'overview', candidateProfileActions: 'actions', candidateProfileInterviews: 'interviews',
    candidateProfileDocuments: 'documents', candidateProfileActivity: 'activity', candidateProfileTexts: 'texts',
    candidateProfileTranscripts: 'transcripts',
  }
  if (part[action]) return known ? { status: 200, data: answers(key)[part[action]] } : { status: 400, message: `No candidate "${key}" is on file.` }
  if (!known && action.startsWith('candidateProfile')) return { status: 400, message: `No candidate "${key}" is on file.` }
  if (action === 'candidateProfileResume') return { status: 200, data: key === KEY ? RESUME : { ...RESUME, on_file: false, work: [] } }
  if (action === 'candidateProfileTranscript') {
    const listed = (answers(key).transcripts as { calls: { call_id: string }[] }).calls.some((c) => c.call_id === payload.id)
    if (!listed) return { status: 404, message: 'This candidate has no such call.' }
    return { status: 200, data: { call_id: payload.id, at: '2026-09-05T14:00:00Z', line: '+13307544040', line_name: 'ASA screening line',
      direction: '', duration_sec: '312', full_transcript: SCREEN_WORDS, speaker_transcript: SCREEN_WORDS, has_words: true,
      kind: 'Phone screen' } }
  }
  if (action === 'candidateProfileDocFile') {
    const docs = (answers(key).documents as { docs: { file_id: string }[] }).docs
    if (!docs.some((d) => d.file_id && d.file_id === payload.file_id)) return { status: 404, message: 'This candidate names no such document.' }
    return { status: 200, data: { id: payload.file_id, name: 'packet.pdf', mime: 'application/pdf', size: 4, exported: false,
      b64: Buffer.from('%PDF').toString('base64') } }
  }
  if (action === 'candidateProfileNoteAdd') {
    if (!String(payload.body ?? '').trim()) return { status: 400, message: 'body: what the note says.' }
    return { status: 200, data: { note: { id: 'jrn_9', at: SOURCE_AT, by: 'boss@example.org', body: payload.body }, candidate: key } }
  }
  if (action === 'candidateProfileDoor' && payload.press === 'document') return { status: 200, data: paperAnswer(key, payload) }
  return { status: 200, data: { ok: true } }
}

/** The step a paper is for, as cndPaperFind_ answers it for CJIS. */
const CJIS_PAPER = { label: 'Background check (BCI)', kinds: ['background_check'] }

/** What the decoder read, as cndPaperRead_ hands it to the verdict: a background check, or a CPR card. */
const readOf = (name: string): Row => name === 'cpr.pdf'
  ? { paper: { state: 'read', chars: 200, kind: 'cpr_first_aid', kind_score: 29, issued_on: '2026-04-17', expires_on: '2028-04-17' },
      named: 'match', result: '' }
  : { paper: { state: 'read', chars: 200, kind: 'background_check', kind_score: 36, issued_on: '2026-09-10' }, named: 'match', result: 'clear' }

/**
 * Add document's answer, its reading built by the backend's own verdict (cndPaperVerdict_) and its background result by
 * the backend's own rules: suggested on a check, the person's pick on a filing, else what a filing keeps.
 */
function paperAnswer(key: string, payload: Row): Row {
  const f = (payload.fields ?? {}) as Row
  const v = GS.verdict(CJIS_PAPER, readOf(String(f.filename ?? '')), 'Maria Lopez')
  const check = f.check === true
  const filed = !check && (v.verified || f.confirm_mismatch === true)
  const taken = v.verified && !(f.confirm_mismatch === true && !v.verified)
  const status = check ? GS.suggested('', v, taken) : String(f.cjis_status ?? '') || GS.kept('', v, taken)
  return { candidate: key, item: payload.item, doc_id: 'background_check', asks: CJIS_PAPER.label, expects: 'a background check',
    where: 'the Hiring record', file_name: f.filename, verified: v.verified, reason: v.reason, read_as: v.read_as,
    why: filed || check || v.verified ? v.why : `${v.why} Nothing was written.`, reading: v.reading, check, filed,
    override: filed && !v.verified, filing_why: '', cjis_status: status, cjis_on_file: '',
    closes: status === 'Clear' || status === 'Verified', closes_why: '' }
}

let seen: { kind: 'slice' | 'pack' | 'gas'; name: string; payload?: Row; url?: string }[] = []
const realFetch = globalThis.fetch
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

before(() => {
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/snapshot/')) {
      const name = url.slice('/snapshot/'.length).replace(/\.json$/, '')
      seen.push({ kind: 'slice', name })
      const slices: Record<string, Row[]> = S.slicesServed ? { candidates: boardRows() } : {}
      if (name === 'index') return json({ slices: Object.fromEntries(Object.keys(slices).map((k) => [k, { built_at: SOURCE_AT }])) })
      const rows = slices[name]
      return rows ? json({ resource: name, built_at: SOURCE_AT, source_at: SOURCE_AT, rows }) : new Response('no', { status: 404 })
    }
    // the pack door is the Hub's own route (appPack.packPath)
    if (url.startsWith('/hub-lanes/app-pack/')) {
      const app = decodeURIComponent(url.slice('/hub-lanes/app-pack/'.length).split('?')[0])
      const key = decodeURIComponent(new Headers(init?.headers).get('X-App-Pack-Key') ?? '')
      seen.push({ kind: 'pack', name: `${app}:${key}`, url })
      if (!S.packOpen || app !== 'staff-candidates') return json({ status: 404, reason: 'unknown' }, 404)
      if (!S.master) return json({ status: 403, message: 'Not here.' }, 403)
      const a = answers(key)
      const parts = Object.fromEntries(GS.parts.map((p) => [p, a[p]]))
      return json({ status: 200, data: { candidate: key, built_at: SOURCE_AT, parts,
        part_status: Object.fromEntries(GS.parts.map((p) => [p, { status: 200 }])), read_age_s: 1 } })
    }
    const body = typeof init?.body === 'string' ? init.body : ''
    const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action?: string; payload: Row }
    if (!env.action) return json({ status: 200, data: {} })
    seen.push({ kind: 'gas', name: env.action, payload: env.payload ?? {} })
    return json(answer(env.action, env.payload ?? {}))
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => {
  S.slicesServed = true
  S.packOpen = true
  S.master = true
  seen = []
  forgetSnapshot()
  forgetPack()
  forgetCandidateReads()
  useMemberStore.setState({ currentMemberId: '' } as never)
})
afterEach(async () => {
  // a neighbour's prefetch waits for an idle moment: let it drop, and its turn end, before the next case
  await new Promise((r) => setTimeout(r, 100))
  forgetPack()
  await new Promise((r) => setTimeout(r, PREFETCH_GAP_MS + 400))
})

const gasCalls = () => seen.filter((s) => s.kind === 'gas').map((s) => s.name)
const packAsks = () => seen.filter((s) => s.kind === 'pack').map((s) => s.name)

function walk(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n)
    return statSync(resolve(ROOT, p)).isDirectory() ? walk(p) : [p]
  })
}

const rosterRows = (): RosterRow[] => rosterOf(ROSTER_ANSWER()).candidates
const maria = (): RosterRow => rosterRows().find((r) => r.key === KEY) as RosterRow

/* ---------- the app ---------- */

describe('the app', () => {
  after(() => useAuthStore.setState({ user: null } as never))

  it('is "Staff Candidates", id staff-candidates, in the Hiring app\'s category, one page "profile" on the houses slice', () => {
    const app = staffCandidatesManifests[0]
    assert.deepEqual([app.id, app.name, app.icon, app.accent, app.category, app.isNew, app.enabled],
      ['staff-candidates', 'Staff Candidates', 'user-plus', 'blue', 'Manage', true, true])
    assert.equal(app.tagline, 'One candidate at a time — stage, actions, interviews, documents and every conversation')
    assert.equal(app.category, appManifests.find((m) => m.id === 'hiring')?.category)
    assert.deepEqual([app.audience, app.focusAudience], [['admin', 'manager', 'client'], []])
    assert.deepEqual(app.pages.map((p) => [p.id, p.title, (p as { dataSource?: { resource?: string } }).dataSource?.resource]),
      [['profile', 'Candidate', 'houses']])
    assert.equal(appManifests.filter((m) => m.id === 'staff-candidates').length, 1)
  })

  it('is mounted only through CUSTOM_PAGES, never on a static route', async () => {
    // a lazy chunk (lib/lazyPage): the entry resolves to the screen itself
    assert.equal(await CUSTOM_PAGES['staff-candidates/profile'].load(), StaffCandidatesPage)
    assert.ok(!readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8').includes('staff-candidates'), 'no static route in App.tsx')
  })

  it('ships no App Control row: a non-master admin is refused, the master passes', async () => {
    // the screen's chunk is in before the render, so the master's render draws it rather than a fallback
    await CUSTOM_PAGES['staff-candidates/profile'].load()
    const director = { id: 'u-dir', name: 'Dee Rector', email: 'dee@example.org', role: 'admin', types: ['DIRECTOR'], isMaster: false }
    const master = { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true }
    assert.equal(badgeAllowsApp('staff-candidates', director as never, {}), false)
    assert.equal(badgeAllowsApp('staff-candidates', { ...director, role: 'manager' } as never, { houses: ['DIRECTOR'] }), false)
    assert.equal(badgeAllowsApp('staff-candidates', master as never, {}), true)
    const hits: string[] = []
    for (const dir of ['apps-script', 'tools', 'server']) {
      for (const name of readdirSync(resolve(ROOT, dir))) {
        if (!/\.(gs|py|mjs|js|json)$/.test(name)) continue
        const text = readFileSync(join(resolve(ROOT, dir), name), 'utf8')
        if (/app_badge_access[^\n]{0,200}['"]staff-candidates['"]|['"]staff-candidates['"][^\n]{0,200}app_badge_access/.test(text)) hits.push(name)
      }
    }
    assert.deepEqual(hits, [])

    useRegistryStore.setState({ apps: appManifests })
    useBadgeAccessStore.setState({ rules: {}, tenantRules: {}, configRules: {} } as never)
    const open = () => flat(renderToString(createElement(MemoryRouter, { initialEntries: [`/app/staff-candidates/profile?candidate=${KEY}`] },
      createElement(Routes, null, createElement(Route, { path: '/app/:appId/:pageId', element: createElement(AppRoutePage) })))))
    useAuthStore.setState({ user: director } as never)
    assert.equal(isAllowedWith(appManifests, 'admin', 'staff-candidates'), false)
    assert.ok(!open().includes('data-staff-candidates'), 'a director sees nothing of it')
    useAuthStore.setState({ user: master } as never)
    assert.equal(isAllowedWith(appManifests, 'admin', 'staff-candidates'), true)
    assert.ok(open().includes('data-staff-candidates'), 'the master gets the screen')
  })

  it('the Hiring candidate page links here for whoever the app is open to, and nothing else in the Hiring app does', () => {
    const page = readFileSync(resolve(ROOT, 'src/pages/features/hiring/CandidateProfilePage.tsx'), 'utf8')
    assert.match(page, /isAllowedWith\(apps, effRole, CANDIDATES_APP_ID\)/)
    assert.match(page, /\{staffCandidates && \(\s*<Link to=\{candidateHref\(cid\)\}/)
    assert.ok(page.includes('Open in Staff Candidates'))
    const others = walk('src/pages/features/hiring').filter((f) => !f.endsWith('CandidateProfilePage.tsx'))
      .filter((f) => readFileSync(resolve(ROOT, f), 'utf8').includes('staffcandidates'))
    assert.deepEqual(others, [])
  })
})

/* ---------- the names ---------- */

describe('the names', () => {
  it('every door the page names is a CandidateProfiles.gs action or a Hiring door, each in the catalogue, and every action has a caller', () => {
    const named = new Set<string>()
    for (const f of walk(FEATURE)) {
      for (const m of readFileSync(resolve(ROOT, f), 'utf8').matchAll(/gasAction(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) named.add(m[1])
    }
    // an edition's panel read, its edits and a document's review are Python's alone (app/doors.json)
    const py: Record<string, { file: string }> = JSON.parse(readFileSync(resolve(ROOT, 'app/doors.json'), 'utf8'))
    const pyCandidates = [...named].filter((n) => n.startsWith('candidateProfile') && py[n]).sort()
    assert.deepEqual(pyCandidates, ['candidateProfileDocReview', 'candidateProfileEdit', 'candidateProfileEditRead', 'candidateProfileNoteEdit'])
    for (const n of pyCandidates) {
      assert.equal(py[n].file, 'app/candidate_writes.py', `${n} is the writes module's`)
      assert.ok(!POLICY[n] && !GS.actions.includes(n), `${n} has no Apps Script declaration nor handler`)
    }
    assert.equal(POLICY.editionsMine?.file, 'Editions.gs', 'the editions this viewer makes, asked of the editions door')
    const own = [...named].filter((n) => POLICY[n]?.file === 'CandidateProfiles.gs')
    assert.deepEqual(own.sort(), [...GS.actions].sort(), 'every CandidateProfiles.gs action is read or written here, and no other')
    for (const n of named) {
      if (POLICY[n]?.file === 'CandidateProfiles.gs' || pyCandidates.includes(n) || n === 'editionsMine') continue
      assert.ok((DOORS_OPENED as readonly string[]).includes(n), `${n} is a Hiring door this screen opens`)
      assert.ok(POLICY[n] && POLICY[n].file !== 'CandidateProfiles.gs', `${n} is declared by the Hiring app`)
    }
    const catalogue = readFileSync(resolve(ROOT, 'src/lib/actions.generated.ts'), 'utf8')
    for (const n of [...named, ...DOORS_OPENED]) assert.ok(catalogue.includes(`"${n}"`), `${n} is in the generated catalogue`)
  })

  it('every Hiring door CandidateProfiles.gs names is one this screen opens', () => {
    const named = new Set([...gsText('CandidateProfiles.gs').matchAll(/action: '(\w+)'/g)].map((m) => m[1]))
    for (const d of Object.values(GS.doors)) named.add(d.action)
    for (const n of named) assert.ok((DOORS_OPENED as readonly string[]).includes(n), `${n} opens from the panel`)
    // the one door Add document presses by itself, after the step's own: the Onboarding Documents deposit
    const deposit = String(vm.runInNewContext(`${lift('CandidateProfiles.gs', 'CND_DEPOSIT_DOOR')}\nCND_DEPOSIT_DOOR`))
    assert.equal(POLICY[deposit]?.file, 'Files.gs', 'the deposit is the Files.gs door the Hiring app\'s onboarding documents upload with')
    assert.ok(!(DOORS_OPENED as readonly string[]).includes(deposit) && !named.has(deposit), 'no answer names it; the screen never presses it')
  })

  it('the doors a press opens are the ones the panel opens, each called the same on both sides and on the journey', () => {
    assert.deepEqual(Object.keys(GS.fields).sort(), [...DOORS_OPENED].sort())
    for (const a of DOORS_OPENED) assert.equal(DOOR_WORDS[a]?.title, GS.titles[a], a)
  })

  it('the pack parts the page reads are the ones candidatePack gathers', () => {
    const reads = readFileSync(resolve(ROOT, FEATURE, 'candidateReads.ts'), 'utf8')
    const parts = [...reads.matchAll(/candidatePackOr\(\w+, '([a-z_]+)'/g)].map((m) => m[1]).sort()
    assert.deepEqual(parts, [...GS.parts].sort())
  })

  it('the note keeps inside what the hiring journey keeps', () => {
    assert.equal(NOTE_MAX, GS.noteMax)
  })

  it('a session the app is not open to gets "Unknown action.", which the page says plainly as not open to them', async () => {
    S.packOpen = false
    S.master = false
    await assert.rejects(readOverview(KEY), (err: Error) => readRefusal(err.message) === NOT_OPEN)
  })
})

/* ---------- the lanes ---------- */

describe('the lanes: the candidates slice, then the relay\'s pack, then the door', () => {
  it('the roster comes from the candidates slice with no execution, and says what the backend\'s own roster row says', async () => {
    const lane1 = rosterOf(await readRoster(false))
    assert.deepEqual(gasCalls(), [])
    assert.deepEqual(packAsks(), [])
    const shown = (r: RosterRow) => [r.key, r.name, r.position, r.stage, r.location, r.next_step, r.next_id, r.packet, r.recruiter,
      r.applied, r.avatar]
    assert.deepEqual(lane1.candidates.map(shown), rosterRows().map(shown))
    const m = lane1.candidates.find((r) => r.key === KEY) as RosterRow
    assert.deepEqual([m.next_step, m.recruiter, m.position, m.location, m.applied],
      ['Interview scheduled', 'recruiter@example.org', 'Direct Support Professional', 'Canton, OH', '2026-09-01'])
  })

  it('with no candidates slice here the roster reads its action', async () => {
    S.slicesServed = false
    const r = rosterOf(await readRoster(false))
    assert.deepEqual(gasCalls(), ['candidateProfileRoster'])
    assert.equal(r.candidates.length, 3)
  })

  it('every section reads the relay\'s pack first — the key in the header, never the address — one pack for all', async () => {
    const got = await Promise.all([readOverview(KEY), readActions(KEY), readInterviews(KEY), readDocuments(KEY), readActivity(KEY),
      readTexts(KEY), readTranscripts(KEY)])
    assert.deepEqual(gasCalls(), [], 'no section read its door')
    assert.equal(packAsks().filter((p) => p === `staff-candidates:${KEY}`).length, 1, 'one pack serves every section')
    assert.ok(seen.every((s) => !(s.url ?? '').includes(KEY)), 'the key rides the header, never the address')
    assert.deepEqual(overviewOf(got[0]), overviewOf(answers(KEY).overview))
    assert.deepEqual(actionsOf(got[1]), actionsOf(answers(KEY).actions))
  })

  it('when the relay has no pack door, each section reads its own action', async () => {
    S.packOpen = false
    await Promise.all([readOverview(KEY), readActions(KEY), readInterviews(KEY), readDocuments(KEY), readActivity(KEY),
      readTexts(KEY), readTranscripts(KEY)])
    assert.deepEqual(gasCalls().sort(), ['candidateProfileActions', 'candidateProfileActivity', 'candidateProfileDocuments',
      'candidateProfileInterviews', 'candidateProfileOverview', 'candidateProfileTexts', 'candidateProfileTranscripts'])
  })

  it('a candidate the board does not carry is never asked of the relay; another conversation or an earlier page is the action\'s', async () => {
    await readOverview(OFF_BOARD)
    assert.deepEqual(packAsks(), [])
    assert.deepEqual(gasCalls(), ['candidateProfileOverview'])
    seen = []
    await readTexts(KEY, 'PN_other')
    await readTexts(KEY, '', '2026-09-20T00:00:00Z')
    assert.deepEqual(gasCalls(), ['candidateProfileTexts', 'candidateProfileTexts'])
    assert.deepEqual(seen.filter((s) => s.kind === 'gas').map((s) => s.payload),
      [{ candidate: KEY, with: 'PN_other' }, { candidate: KEY, before: '2026-09-20T00:00:00Z' }])
  })

  it('every call carries only the parameters its door declares', async () => {
    S.packOpen = false
    await Promise.all([readRoster(true), readOverview(KEY), readActions(KEY), readInterviews(KEY), readDocuments(KEY),
      readActivity(KEY), readTexts(KEY, 'PN_main', '2026-09-21T00:00:00Z'), readTranscripts(KEY), readTranscript(KEY, 'screen'),
      readResume(KEY)])
    await addNote(KEY, 'One more')
    const bad = seen.filter((s) => s.kind === 'gas').filter((c) => {
      const declared = Object.keys(POLICY[c.name]?.params ?? {})
      return Object.keys(c.payload ?? {}).some((k) => !declared.includes(k))
    })
    assert.deepEqual(bad, [])
  })
})

/* ---------- the sections, drawn ---------- */

describe('the sections', () => {
  const row = () => maria()

  it('the screen: the breadcrumb names the section, the nine sections are the rail, the switcher is a listbox', () => {
    const html = draw(createElement(CandidatesScreen, { roster: ready(null), onRetry: noop, candidates: rosterRows(), wanted: KEY, row: row(),
      tab: 'documents', details: null, actionsCount: 3, onCandidate: noop, onTab: noop, onAsk: noop }))
    assert.ok(html.includes('Staff Candidates') && html.includes('›') && html.includes('>Documents<'), 'Staff Candidates › Documents')
    for (const t of ['overview', 'actions', 'pipeline', 'information', 'interviews', 'documents', 'activity', 'sms', 'transcripts']) {
      assert.ok(html.includes(`data-tab="${t}"`), t)
    }
    for (const w of ['Activity Log', 'SMS', 'Transcripts', 'Pipeline']) assert.ok(html.includes(w), w)
    assert.ok(html.includes('data-actions-count=""'))
    const list = draw(createElement(SwitcherList, { candidates: rosterRows(), current: KEY, query: '', onQuery: noop, onPick: noop }))
    assert.match(list, /role="listbox"/)
    assert.ok(list.includes('Maria Lopez') && list.includes('Interview · Direct Support Professional'))
    noModal(html, 'screen')
  })

  it('overview: at a glance, contact, the summary with its three tiles, the next step with its due pill, recent activity, quick actions', () => {
    const html = draw(createElement(OverviewView, { row: row(), overview: ready(overviewOf(answers(KEY).overview)),
      actions: ready(actionsOf(answers(KEY).actions)), onRetry: noop, onAsk: noop, onTab: noop, canWrite: true }))
    for (const w of ['At a glance', 'Position', 'Direct Support Professional', 'Stage', 'Location', 'Canton, OH', 'Recruiter',
      'recruiter@example.org', 'Source', 'Indeed', 'Applied', 'Sep 01, 2026', 'Contact', 'href="tel:3305550111"',
      'href="mailto:maria@example.org"', 'View information', 'Candidate overview', 'Four years in residential care',
      'Open actions', 'Documents on file', '1 of 3', 'Next step', 'Overdue', 'Interview scheduled', 'Recruiter · due Sep 20, 2026',
      'View actions', 'Recent activity', 'Prefers mornings', 'Quick actions', 'Add note', 'Update stage', 'View all candidates',
      'Resume on file and not scored']) {
      assert.ok(html.includes(w), w)
    }
    noModal(html, 'overview')
  })

  it('actions: STATUS | ACTION | OWNER | DUE | NEXT STEP, Mark complete and Add note on every row, a closed step closes nothing', () => {
    const a = actionsOf(answers(KEY).actions)
    const html = draw(createElement(ActionsView, { name: 'Maria Lopez', actions: ready(a), query: '', onQuery: noop, onAsk: noop, onRetry: noop,
      canWrite: true }))
    for (const h of ['Status', 'Action', 'Owner', 'Due', 'Next step']) assert.ok(html.includes(`>${h}<`), h)
    assert.equal((html.match(/data-row-action="complete"/g) ?? []).length, 4)
    assert.equal((html.match(/data-row-action="note"/g) ?? []).length, 4)
    assert.match(html, /data-action-row="resume"[\s\S]*?disabled=""[\s\S]*?data-row-action="complete"/)
    for (const w of ['Completed', 'Missing', 'Pending', 'Schedule the interview', 'Upload the file', 'The platform does this by itself.',
      'Resume on file and not scored']) {
      assert.ok(html.includes(w), w)
    }
    assert.equal(a.next?.id, 'interview-scheduled')
  })

  it('pipeline: every candidate by stage, a search and the stage filter; a name switches the screen', () => {
    const html = draw(createElement(PipelineView, { candidates: rosterRows(), current: KEY, query: '', onQuery: noop, stage: '',
      onStage: noop, onCandidate: noop }))
    for (const h of ['Candidate', 'Position', 'Stage', 'Location', 'Next step']) assert.ok(html.includes(`>${h}<`), h)
    assert.equal((html.match(/data-open-candidate="/g) ?? []).length, 3)
    assert.ok(html.indexOf('Ada Nguyen') < html.indexOf('Maria Lopez') && html.indexOf('Maria Lopez') < html.indexOf('Ben Carter'),
      'in the board\'s stage order')
    assert.ok(html.includes('All · 3') && html.includes('Interview · 1'))
    const one = draw(createElement(PipelineView, { candidates: rosterRows(), current: KEY, query: '', onQuery: noop, stage: 'onboarding',
      onStage: noop, onCandidate: noop }))
    assert.equal((one.match(/data-open-candidate="/g) ?? []).length, 1)
  })

  it('information: the twelve lines the record holds', () => {
    const html = draw(createElement(InformationView, { row: row(), overview: ready(overviewOf(answers(KEY).overview)), onRetry: noop }))
    for (const w of ['Full name', 'Stage', 'Phone', 'E-mail', 'Source', 'Applied', 'Position', 'Availability', 'Weekdays after 3pm',
      'Experience', '4 years caregiving', 'Preferred location', 'NW4045', 'Earliest start', 'Oct 06, 2026', 'Recruiter']) {
      assert.ok(html.includes(w), w)
    }
  })

  it('interviews: the three steps with their pills and results, and the candidate\'s preferences', () => {
    const html = draw(createElement(InterviewsView, { row: { name: 'Maria Lopez' }, interviews: ready(interviewsOf(answers(KEY).interviews)),
      onRetry: noop }))
    for (const w of ['Interview &amp; onboarding plan', 'Phone screen', 'Structured interview', 'Onboarding handoff', '>Completed<',
      '>Awaiting Confirmation<', '>Pending<', 'Advance · Qualified', 'Clear and warm on the phone.', 'The slot is not confirmed yet.',
      'Candidate preferences', 'Day, Night', 'Full time', 'DODD, CPR / First Aid', 'Tuesday 10am']) {
      assert.ok(html.includes(w), w)
    }
  })

  it('documents: grouped, On File or Pending; a file opens centred, a pending paper offers Upload, the scorecard shows its words', () => {
    const html = draw(createElement(DocumentsView, { row: { key: KEY, name: 'Maria Lopez' }, docs: ready(documentsOf(answers(KEY).documents)),
      doc: { opening: '', open: noop }, onAsk: noop, onRetry: noop, canWrite: true }))
    for (const w of ['1 of 3 on file', 'Application &amp; resume', 'Interview notes', 'Background check', '>On File<', '>Pending<',
      'Ann Lee · 8/10 · Advance', 'Calm, kind, careful.']) {
      assert.ok(html.includes(w), w)
    }
    assert.equal((html.match(/data-open-doc="/g) ?? []).length, 1)
    assert.equal((html.match(/data-upload="/g) ?? []).length, 1)
  })

  it('activity log, SMS and transcripts: the steps (a failed one says so), the threads and the calls', () => {
    const act = draw(createElement(ActivityView, { row: { name: 'Maria Lopez' }, activity: ready(activityOf(answers(KEY).activity)), onRetry: noop }))
    assert.ok(act.includes('Activity Log') && act.includes('did not land') && act.includes('Stage: Phone Screen → Interview'))
    const texts = draw(createElement(TextsView, { name: 'Maria Lopez', texts: ready(textsOf(answers(KEY).texts)), older: [], more: false,
      olderBusy: false, olderError: '', onPick: noop, onOlder: noop, onRetry: noop }))
    assert.ok(texts.includes('>SMS<') && texts.includes('Your interview is Tuesday at 10') && texts.includes('Main line'))
    const calls = draw(createElement(TranscriptsView, { name: 'Maria Lopez', transcripts: ready(transcriptsOf(answers(KEY).transcripts)),
      category: '', onCategory: noop, onOpen: noop, onRetry: noop }))
    assert.ok(calls.includes('data-call="screen"') && calls.includes('Phone screen'))
  })
})

/* ---------- the panel ---------- */

describe('the one right panel', () => {
  const settled = async (key: string, load: () => Promise<unknown>) => {
    const h = mountHook(() => useCandidateRead(key, load, (raw) => raw), {})
    await h.settle(() => h.current.status === 'ready')
    h.unmount()
  }

  it('every mode is the SidePanel aside; share carries who and where, never a phone or an e-mail', () => {
    const r = maria()
    const share = sharePayloadFor(r, 'overview')
    const asks: CandidateAsk[] = [{ kind: 'share' }, { kind: 'note', about: '' }, { kind: 'stage' }, { kind: 'complete', item: 'cjis' },
      { kind: 'upload', doc: 'cjis' }, { kind: 'document', item: 'cjis' }, { kind: 'transcript', id: 'screen' }, { kind: 'screen' },
      { kind: 'interview' }, { kind: 'packet' }]
    for (const ask of asks) {
      const html = draw(createElement(CandidatePanel, { ask, row: r, share, onClose: noop, canWrite: true }))
      assert.match(html, /<aside aria-label="/, ask.kind)
      noModal(html, ask.kind)
      assert.deepEqual(panelOf(panelParam(ask)), ask, `${ask.kind} rides the address`)
    }
    assert.equal(draw(createElement(CandidatePanel, { ask: null, row: r, share, onClose: noop })), '')
    const html = draw(createElement(CandidatePanel, { ask: { kind: 'share' }, row: r, share, onClose: noop, canWrite: true }))
    assert.ok(html.includes(`${CANDIDATES_PATH}?candidate=${KEY}`))
    assert.ok(!html.includes('3305550111') && !html.includes('maria@example.org'))
  })

  it('Update stage: every stage and Not hiring, the note that the records keep their statuses, and the Hiring door behind Apply', async () => {
    S.packOpen = false
    await settled(readKey('candidateProfileActions', KEY), () => readActions(KEY))
    const html = draw(createElement(CandidatePanel, { ask: { kind: 'stage' }, row: maria(), share: sharePayloadFor(maria(), 'overview'),
      onClose: noop, canWrite: true }))
    for (const w of ['data-stage-select=""', '>New<', 'Interview (current)', '>Onboarding<', '>Not hiring<',
      'Existing interview, intake and document records keep their own statuses.', 'data-door="moveStage"', '>Apply']) {
      assert.ok(html.includes(w), w)
    }
  })

  it('Mark complete opens the step\'s own Hiring form, or says why no press here closes it', async () => {
    S.packOpen = false
    await settled(readKey('candidateProfileActions', KEY), () => readActions(KEY))
    const r = maria()
    const share = sharePayloadFor(r, 'overview')
    const schedule = draw(createElement(CandidatePanel, { ask: { kind: 'complete', item: 'interview-scheduled' }, row: r, share,
      onClose: noop, canWrite: true }))
    assert.ok(schedule.includes('data-door="hiringScheduleCreate"') && schedule.includes('Location') && schedule.includes('Interviewer'))
    const machine = draw(createElement(CandidatePanel, { ask: { kind: 'complete', item: 'application' }, row: r, share,
      onClose: noop, canWrite: true }))
    assert.ok(machine.includes('data-door-why=""') && machine.includes('The platform does this by itself.') && machine.includes('Open in Hiring'))
    const done = draw(createElement(CandidatePanel, { ask: { kind: 'complete', item: 'resume' }, row: r, share, onClose: noop, canWrite: true }))
    assert.ok(done.includes('already complete'))
  })

  it('Actions is a menu — Add note, Update stage, Copy e-mail, Call, View all candidates, Open in Hiring', () => {
    const menu = draw(createElement(ActionsMenu, { candidate: KEY, details: { email: 'maria@example.org', phone: '3305550111' },
      onPick: noop, onTab: noop, onDone: noop, reach: { write: true, narrow: false } }))
    assert.match(menu, /role="menu"/)
    assert.equal((menu.match(/role="menuitem"/g) ?? []).length, 6)
    for (const w of ['Add note', 'Update stage', 'Copy e-mail', 'Call', 'View all candidates', 'Open in Hiring']) assert.ok(menu.includes(w), w)
    assert.ok(menu.includes('href="tel:3305550111"') && menu.includes(`href="/app/hiring/candidate?id=${KEY}"`))
    const none = draw(createElement(ActionsMenu, { candidate: KEY, details: { email: '', phone: '' }, onPick: noop, onTab: noop, onDone: noop }))
    assert.equal((none.match(/disabled=""/g) ?? []).length, 2, 'an item with nothing behind it does nothing')
  })
})

/* ---------- the Pipeline's NEXT STEP ---------- */

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } }

/** Every element a component's own JSX creates, depth first (children of elements it only names are not drawn). */
function elements(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) elements(n, out)
    return out
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return out
  const el = node as El
  out.push(el)
  elements(el.props.children, out)
  return out
}

const pipeRow = (key: string, name: string, stage: string, next_step: string, next_id: string, packet = ''): RosterRow =>
  rosterOf({ candidates: [{ key, name, stage, next_step, next_id, packet, position: 'Direct Support Professional',
    location: 'Canton, OH' }] }).candidates[0]

/** The slice of the drawn table that is one candidate's NEXT STEP cell. */
const cellOf = (html: string, key: string) => {
  const at = html.indexOf(`data-next-cell="${key}"`)
  return at === -1 ? '' : html.slice(at, html.indexOf('</td>', at))
}

describe('the Pipeline\'s NEXT STEP', () => {
  const SAM = pipeRow('CAN_sam00005', 'Sam Screen', 'phone-screen', 'Transcript', 'transcript')
  const MARIA = pipeRow(KEY, 'Maria Lopez', 'interview', 'Interview scorecard', 'interview-scorecard')
  const BEN = pipeRow(OTHER, 'Ben Carter', 'onboarding', 'Onboarding open (Tutorials)', 'onboarding-complete', 'signed')
  const NIA = pipeRow('CAN_nia00006', 'Nia New', 'new', 'Resume', 'resume')
  const share = sharePayloadFor(maria(), 'pipeline')
  const settled = async (key: string, load: () => Promise<unknown>) => {
    const h = mountHook(() => useCandidateRead(key, load, (raw) => raw), {})
    await h.settle(() => h.current.status === 'ready' || h.current.status === 'failed')
    h.unmount()
  }

  it('what each step opens: a Phone Screen step the transcript, an Interview step the interview, a complete packet the ' +
    'signed file; any other step nothing', () => {
    assert.deepEqual([SAM, MARIA, BEN, NIA].map((r) => pipelineOpen(r)?.kind ?? null), ['screen', 'interview', 'packet', null])
    for (const id of ['ai-report', 'screen-details', 'advance-decision']) assert.equal(pipelineOpen({ ...SAM, next_id: id })?.kind, 'screen', id)
    assert.equal(pipelineOpen({ ...SAM, next_id: '' })?.kind, 'screen', 'an answer without the id reads the stage')
    assert.equal(pipelineOpen({ ...MARIA, next_id: '', next_step: '' })?.kind, 'interview', 'at Interview with nothing open')
    assert.equal(pipelineOpen({ ...BEN, packet: 'waived' })?.kind, 'packet', 'a packet attested by hand is complete too')
    assert.equal(pipelineOpen({ ...BEN, packet: 'unsigned' }), null, 'an unsigned packet opens nothing')
    assert.deepEqual([rosterRows().find((r) => r.key === KEY)?.next_id, rosterRows().find((r) => r.key === OTHER)?.next_id],
      ['interview-scheduled', 'new-hire-packet'], 'the backend\'s roster row names the step\'s id')
  })

  it('a cell with something to open is a keyboard-reachable button that says what it opens; the others stay words', () => {
    const html = draw(createElement(PipelineView, { candidates: [SAM, MARIA, BEN, NIA], current: KEY, query: '', onQuery: noop, stage: '',
      onStage: noop, onCandidate: noop, onNext: noop }))
    for (const kind of ['screen', 'interview', 'packet']) {
      assert.equal((html.match(new RegExp(`data-next-open="${kind}"`, 'g')) ?? []).length, 1, kind)
      assert.match(html, new RegExp(`<button type="button"[^>]*data-next-open="${kind}"`), `${kind} is a native button`)
    }
    assert.match(cellOf(html, SAM.key), /aria-label="Open Sam Screen[^"]*phone screen transcript"[\s\S]*>Transcript</)
    assert.match(cellOf(html, KEY), /aria-label="Open Maria Lopez[^"]*interview"[\s\S]*>Interview scorecard</)
    assert.match(cellOf(html, OTHER), /Onboarding open \(Tutorials\)[\s\S]*aria-label="Open Ben Carter[^"]*signed New Hire packet"[\s\S]*>Signed New Hire packet</)
    assert.ok(cellOf(html, NIA.key).includes('>Resume<') && !cellOf(html, NIA.key).includes('<button'), 'nothing to open: words')
    const bare = draw(createElement(PipelineView, { candidates: [SAM, MARIA, BEN, NIA], current: KEY, query: '', onQuery: noop, stage: '',
      onStage: noop, onCandidate: noop }))
    assert.ok(!bare.includes('data-next-open'), 'with no panel to open, no cell is a button')
    const busy = draw(createElement(PipelineView, { candidates: [BEN], current: KEY, query: '', onQuery: noop, stage: '', onStage: noop,
      onCandidate: noop, onNext: noop, opening: OTHER }))
    assert.ok(cellOf(busy, OTHER).includes('aria-busy="true"') && cellOf(busy, OTHER).includes('animate-spin'))
  })

  it('a click hands the row and what it opens to the section; the name still switches the screen to that candidate', () => {
    const got: [string, string][] = []
    const onNext = (r: RosterRow, o: PipelineOpen) => { got.push([r.key, o.kind]) }
    for (const r of [SAM, MARIA, BEN]) {
      const button = elements(NextStepCell({ row: r, onNext })).find((e) => e.props['data-next-open'])
      ;(button?.props.onClick as () => void)()
    }
    assert.deepEqual(got, [[SAM.key, 'screen'], [KEY, 'interview'], [OTHER, 'packet']])
    assert.equal(elements(NextStepCell({ row: NIA, onNext })).find((e) => e.props['data-next-open']), undefined)
    const picked: string[] = []
    const view = elements(PipelineView({ candidates: [SAM, MARIA], current: KEY, query: '', onQuery: noop, stage: '', onStage: noop,
      onCandidate: (k) => { picked.push(k) }, onNext }))
    ;(view.find((e) => e.props['data-open-candidate'] === SAM.key)?.props.onClick as () => void)()
    assert.deepEqual(picked, [SAM.key])
    const page = readFileSync(resolve(ROOT, FEATURE, 'StaffCandidatesPage.tsx'), 'utf8')
    assert.match(page, /go\(key, 'pipeline', next\)/, 'a NEXT STEP keeps the Pipeline and opens the panel on that candidate')
    const pipe = readFileSync(resolve(ROOT, FEATURE, 'sections/Pipeline.tsx'), 'utf8')
    assert.match(pipe, /else onOpen\(r\.key, \{ kind: o\.kind \}\)/, 'the transcript and the interview open the right panel')
  })

  it('Transcript: the phone screen\'s whole conversation in the right panel — every turn, its speaker and its stamp', async () => {
    await settled(readKey('candidateProfileTranscripts', KEY), () => readTranscripts(KEY))
    await settled(readKey('candidateProfileTranscript', KEY, 'screen'), () => readTranscript(KEY, 'screen'))
    const html = draw(createElement(CandidatePanel, { ask: { kind: 'screen' }, row: maria(), share, onClose: noop }))
    assert.match(html, /<aside aria-label="Phone screen"/)
    noModal(html, 'phone screen')
    for (const w of ['Phone screen transcript · Maria Lopez', 'data-transcript-panel="screen"', 'Phone screen with Maria Lopez',
      'Sep 05, 2026', '5m 12s', 'ASA screening line (330) 754-4040', 'Copy transcript', 'logged with who asked']) {
      assert.ok(html.includes(w), w)
    }
    for (const line of SCREEN_WORDS.split('\n')) {
      const [, at, , words] = /^\[(\d+:\d+)\] (\S+): (.*)$/.exec(line) as RegExpExecArray
      assert.ok(flat(html).includes(words.replace(/'/g, '&#x27;')), words)
      assert.match(html, new RegExp(`data-stamp=""[^>]*>${at}<`), `the stamp ${at} sits in its bubble`)
    }
    assert.equal((html.match(/data-bubble="left"/g) ?? []).length, 2, 'our line: two turns')
    assert.equal((html.match(/data-bubble="right"/g) ?? []).length, 3, 'the candidate: three turns')
    const speakers = [...html.matchAll(/data-speaker=""[^>]*>([^<]*)</g)].map((m) => m[1])
    assert.deepEqual(speakers, ['ASA screening line', 'Maria Lopez', 'ASA screening line', 'Maria Lopez'],
      'a run of turns by one speaker is named once')
  })

  it('Transcript, when the record holds no phone screen yet: the panel says so, and the other calls open instead', async () => {
    await settled(readKey('candidateProfileTranscripts', OTHER), () => readTranscripts(OTHER))
    const ben = rosterRows().find((r) => r.key === OTHER) as RosterRow
    const asked: CandidateAsk[] = []
    const html = draw(createElement(CandidatePanel, { ask: { kind: 'screen' }, row: ben, share, onClose: noop, onAsk: (a) => { asked.push(a) } }))
    assert.ok(html.includes('No phone-screen transcript is on Ben Carter') && html.includes('data-call="AC9other"'))
    assert.ok(!html.includes('data-transcript-panel'), 'no empty conversation')
  })

  it('Interview: who held it, when, the scorecard\'s score, recommendation and comments — and what is not on file yet', async () => {
    await settled(readKey('candidateProfileInterviews', OTHER), () => readInterviews(OTHER))
    const ben = rosterRows().find((r) => r.key === OTHER) as RosterRow
    const html = draw(createElement(CandidatePanel, { ask: { kind: 'interview' }, row: ben, share, onClose: noop }))
    assert.match(html, /<aside aria-label="Interview"/)
    noModal(html, 'interview')
    for (const w of ['Interview · Ben Carter', 'Structured interview', '>Completed<', '>Interviewer<', 'Ivy Interviewer', '>Scheduled<',
      'Sep 18, 2026 · 2:30 PM', 'Main office, Canton', '>Scorecard signed<', '>Score<', '8 / 10', '>Recommendation<', '>Advance<',
      'Advance · score 8/10', 'Scorecard comments', 'Calm, kind, careful with the residents.']) {
      assert.ok(html.includes(w), w)
    }
    assert.ok(!html.includes('Booked with'), 'who the calendar booked is its own line only when it is not who signed')
    await settled(readKey('candidateProfileInterviews', KEY), () => readInterviews(KEY))
    const waiting = draw(createElement(CandidatePanel, { ask: { kind: 'interview' }, row: maria(), share, onClose: noop }))
    for (const w of ['>Awaiting Confirmation<', 'The slot is not confirmed yet. No scorecard is signed yet.', 'Booked with', 'Ivy Interviewer',
      'Sep 24, 2026', 'Not on file — the scorecard is not signed.']) {
      assert.ok(waiting.includes(w), w)
    }
    assert.ok((waiting.match(/Not on file/g) ?? []).length >= 4, 'each line the record lacks says so')
  })

  it('New Hire packet: the signed file opens centred in the platform\'s viewer, its bytes through the candidate\'s own door', async () => {
    const h = mountHook(() => useCandidateDocs(), {})
    let got = ''
    h.run(() => { void openSignedPacket(OTHER, 'Ben Carter', h.current).then((g) => { got = g }) })
    // the bytes land the way they do in a browser — React's own scheduler, the act environment off while they do
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    env.IS_REACT_ACT_ENVIRONMENT = false
    try {
      for (let i = 0; i < 200 && !useFileViewerStore.getState().file; i++) await new Promise((r) => setTimeout(r, 5))
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = true
    }
    const f = useFileViewerStore.getState().file
    assert.ok(f && /^blob:/.test(f.url), 'a blob URL in the platform\'s one viewer')
    assert.deepEqual([f?.title, f?.subtitle], ['New Hire Packet', 'Ben Carter'])
    assert.equal(got, 'opened')
    assert.deepEqual(seen.filter((s) => s.kind === 'gas' && s.name === 'candidateProfileDocFile').map((s) => s.payload),
      [{ candidate: OTHER, file_id: 'packetfile0001' }])
    useFileViewerStore.getState().closeFile()
    h.unmount()
  })

  it('New Hire packet with no copy on the list: nothing opens, and the panel says why — never an empty panel', async () => {
    const h = mountHook(() => useCandidateDocs(), {})
    assert.equal(await openSignedPacket('CAN_ada00004', 'Ada Nguyen', h.current), 'missing')
    assert.equal(useFileViewerStore.getState().file, null)
    h.unmount()
    await settled(readKey('candidateProfileDocuments', 'CAN_ada00004'), () => readDocuments('CAN_ada00004'))
    const ada = rosterRows().find((r) => r.key === 'CAN_ada00004') as RosterRow
    const html = draw(createElement(CandidatePanel, { ask: { kind: 'packet' }, row: ada, share, onClose: noop }))
    assert.ok(html.includes('signed in Dropbox Sign, but no copy of the signed file is on Ada Nguyen'), 'says why nothing opens')
    assert.ok(!html.includes('data-open-packet'))
    await settled(readKey('candidateProfileDocuments', OTHER), () => readDocuments(OTHER))
    const ben = rosterRows().find((r) => r.key === OTHER) as RosterRow
    const withFile = draw(createElement(CandidatePanel, { ask: { kind: 'packet' }, row: ben, share, onClose: noop }))
    assert.ok(withFile.includes('data-open-packet="packetfile0001"') && withFile.includes('Open the signed packet'))
  })
})

/* ---------- Information: the resume ---------- */

describe('Information: what the resume says', () => {
  it('the resume is Information\'s own read — never the pack — with only the parameter its door declares', async () => {
    const r = resumeOf(await readResume(KEY))
    assert.deepEqual(gasCalls(), ['candidateProfileResume'])
    assert.deepEqual(packAsks(), [])
    assert.deepEqual(seen.find((s) => s.name === 'candidateProfileResume')?.payload, { candidate: KEY })
    assert.deepEqual([r.work.length, r.education.length, r.certifications.length, r.languages.join()], [2, 1, 3, 'English,Spanish'])
    assert.deepEqual(r.analysis.map((l) => l.label), ['Highest responsibility', 'DSP agencies', 'Months since the last care job'])
  })

  it('a line the record leaves empty is filled from the resume and says so; the record wins when both hold one', () => {
    const r = resumeOf(RESUME)
    const empty = { availability: '', experience: '', preferred_location: '', earliest_start: '' }
    const f = resumeFilled(empty, r)
    assert.deepEqual([f.availability.source, f.availability.value, f.earliest_start.value], ['resume', 'Weekdays and evenings', 'October 6, 2026'])
    const kept = resumeFilled({ ...empty, availability: 'Weekdays after 3pm', earliest_start: '2026-10-06' }, r)
    assert.deepEqual([kept.availability.source, kept.availability.value, kept.earliest_start.value], ['record', 'Weekdays after 3pm', 'Oct 06, 2026'])
    const home = resumeFilled(empty, resumeOf({ ...RESUME, fields: { ...RESUME.fields, preferred_location: 'Akron, OH', preferred_basis: 'home' } }))
    assert.deepEqual([home.preferred_location.value, home.preferred_location.note], ['Akron, OH', 'where they live'])
    const none = resumeFilled(empty, null)
    assert.deepEqual(Object.values(none).map((v) => v.source), ['', '', '', ''])
  })

  it('the lines say where each value came from, and the resume\'s blocks follow: summary, work, schools, credentials, skills, languages', () => {
    const o = overviewOf({ ...answers(KEY).overview, information: { ...(answers(KEY).overview.information as Row), availability: '',
      experience: '', preferred_location: '' } })
    const html = draw(createElement(InformationView, { row: maria(), overview: ready(o), onRetry: noop, resume: ready(resumeOf(RESUME)),
      onResumeRetry: noop }))
    const lineOf = (label: string) => {
      const at = html.indexOf(`>${label}</dt>`)
      return html.slice(at, html.indexOf('</dd>', at))
    }
    assert.match(lineOf('Availability'), /Weekdays and evenings<span data-from="resume"[^>]*>Resume</)
    assert.match(lineOf('Experience'), /3 jobs listed since 2014[^<]*<span data-from="resume"/)
    assert.match(lineOf('Preferred location'), /Canton or North Canton<span data-from="resume"/)
    assert.match(lineOf('Earliest start'), /Oct 06, 2026<span data-from="record"[^>]*>Hiring record</, 'the record wins when both hold one')
    assert.match(lineOf('Full name'), /Maria Lopez<span data-from="record"/)
    for (const w of ['From the resume', 'data-resume-block="summary"', 'Compassionate DSP with 7 years of residential care.',
      'Direct Support Professional · Bright Path Residential Services · Canton, OH', 'June 2019 – Present', 'Home Health Aide · Comfort Keepers',
      '03/2016 – 05/2019', 'Diploma · Canton South High School', 'Canton, OH · 2012', 'CPR / First Aid (American Red Cross)', 'STNA',
      'Driver&#x27;s license', 'Personal care', 'Meal preparation', 'data-resume-chips="languages"', 'Spanish', 'Highest responsibility', 'Lead DSP']) {
      assert.ok(html.includes(w), w)
    }
    assert.equal((html.match(/data-job=""/g) ?? []).length, 2)
    noModal(html, 'information')
  })

  it('with no resume on file the card says so plainly; the record\'s own lines stand as they are', () => {
    const html = draw(createElement(InformationView, { row: maria(), overview: ready(overviewOf(answers(KEY).overview)), onRetry: noop,
      resume: ready(resumeOf({ ...RESUME, on_file: false, work: [] })), onResumeRetry: noop }))
    assert.ok(html.includes('No resume is on file for Maria Lopez.'))
    assert.ok(!html.includes('data-resume-block='))
    assert.match(html, /Weekdays after 3pm<span data-from="record"/)
    const reading = draw(createElement(InformationView, { row: maria(), overview: ready(overviewOf(answers(KEY).overview)), onRetry: noop,
      resume: { status: 'loading', data: null, error: '', refreshing: false }, onResumeRetry: noop }))
    assert.ok(reading.includes('Reading the resume'))
  })
})

/* ---------- the writes ---------- */

describe('the writes: the note, and the Hiring doors', () => {
  it('the note is filed on the hiring journey with the step it is about first; an empty one is refused', async () => {
    S.packOpen = false
    const body = noteBody('Call after 5', 'Interview scheduled')
    assert.equal(body, 'Interview scheduled: Call after 5')
    await addNote(KEY, body)
    assert.deepEqual(seen.filter((s) => s.kind === 'gas').map((s) => [s.name, s.payload]),
      [['candidateProfileNoteAdd', { candidate: KEY, body }]])
    await assert.rejects(addNote(KEY, '   '), /body/)
  })

  it('a press goes through the app\'s own door — the candidate, what is pressed, and only its form\'s fields; the backend ' +
    'finds the Hiring door on the answer, and a door this screen does not know is never sent', async () => {
    const who = { key: KEY }
    const f = { ...NO_FIELDS, notes: 'Attested by e-mail', date: '2026-10-01', time: '10:00', location: 'Office', with_name: 'Ann Lee',
      interviewer_name: 'Ann Lee', score: '8', recommendation: 'Advance' }
    const foreign = { candidate_id: 'CAN_someone9', checkpoint: 'advance-decision', value: 'Advance', to_stage: 'onboarding', stray: 'x' }
    await openDoor({ action: 'setDecision', form: '', payload: foreign }, who, { press: 'complete', item: 'advance-decision' }, f)
    await openDoor({ action: 'moveStage', form: '', payload: foreign }, who, { press: 'stage', item: 'onboarding' }, f)
    await openDoor({ action: 'hiringDiscard', form: 'reason', payload: foreign }, who, { press: 'stage', item: 'not-hiring' }, f)
    await openDoor({ action: 'hiringScheduleCreate', form: 'schedule', payload: foreign }, who,
      { press: 'complete', item: 'interview-scheduled' }, f)
    await openDoor({ action: 'interviewSave', form: 'scorecard', payload: foreign }, who,
      { press: 'complete', item: 'interview-scorecard' }, f)
    const sent = seen.filter((s) => s.kind === 'gas')
    assert.deepEqual(sent.map((s) => s.name), Array(5).fill('candidateProfileDoor'))
    assert.deepEqual(sent.map((s) => s.payload), [
      { candidate: KEY, press: 'complete', item: 'advance-decision', fields: {} },
      { candidate: KEY, press: 'stage', item: 'onboarding', fields: {} },
      { candidate: KEY, press: 'stage', item: 'not-hiring', fields: { notes: 'Attested by e-mail' } },
      { candidate: KEY, press: 'complete', item: 'interview-scheduled',
        fields: { date: '2026-10-01', time: '10:00', location: 'Office', with_name: 'Ann Lee', notes: 'Attested by e-mail' } },
      { candidate: KEY, press: 'complete', item: 'interview-scorecard',
        fields: { interviewer_name: 'Ann Lee', score: '8', recommendation: 'Advance', notes: 'Attested by e-mail' } },
    ])
    const declared = Object.keys(POLICY.candidateProfileDoor?.params ?? {})
    for (const s of sent) assert.ok(Object.keys(s.payload ?? {}).every((k) => declared.includes(k)), 'the door declares what it is sent')
    for (const [door, takes] of Object.entries(GS.fields)) {
      const form = door === 'tableDocUpload' ? ['filename', 'mime_type', 'base64'] : ['notes', 'date', 'time', 'location', 'with_name',
        'interviewer_name', 'score', 'recommendation']
      for (const k of Object.keys(takes)) assert.ok(form.includes(k), `${door} takes ${k}, a field the panel sends`)
    }
    seen = []
    await assert.rejects(openDoor({ action: 'userDelete', form: '', payload: {} }, who, { press: 'complete', item: 'x' }, f),
      /does not open that door/)
    await assert.rejects(openDoor({ action: 'tableDocUpload', form: 'upload', payload: { item_id: 'cjis' } }, who,
      { press: 'upload', item: 'cjis' }, f), /file/)
    assert.deepEqual(gasCalls(), [])
  })

  it('a press that landed without its line on the hiring journey says so; a filed one says nothing more', () => {
    assert.match(pressUnlogged({ logged: false, why: 'The Hiring door wrote it, but the press could not be filed.' }), /could not be filed/)
    assert.equal(pressUnlogged({ logged: true, why: '' }), '')
    assert.equal(pressUnlogged({ note: { id: 'jrn_1' } }), '')
    assert.equal(pressUnlogged(null), '')
  })

  it('a door is ready only when its form holds what the door itself will check', () => {
    const d = (form: Door['form']): Door => ({ action: 'x', form, payload: {} })
    assert.equal(doorReady(d(''), NO_FIELDS), true)
    assert.equal(doorReady(d('note'), { ...NO_FIELDS, notes: 'ok' }), false)
    assert.equal(doorReady(d('note'), { ...NO_FIELDS, notes: 'In the drawer' }), true)
    assert.equal(doorReady(d('schedule'), { ...NO_FIELDS, date: '2026-10-01', location: 'Office' }), false)
    assert.equal(doorReady(d('scorecard'), { ...NO_FIELDS, interviewer_name: 'Ann', score: '11', recommendation: 'Advance', notes: 'long enough words' }), false)
    assert.equal(doorReady(d('scorecard'), { ...NO_FIELDS, interviewer_name: 'Ann', score: '0', recommendation: 'Hold', notes: 'long enough words' }), true)
  })

  it('a write forgets the candidate and every section on screen reads again', async () => {
    S.packOpen = false
    const h = mountHook(() => useCandidateRead(readKey('candidateProfileActivity', KEY), () => readActivity(KEY), activityOf), {})
    await h.settle(() => h.current.status === 'ready')
    const before = gasCalls().filter((n) => n === 'candidateProfileActivity').length
    const sentAt = Date.now()
    const got = await addNote(KEY, 'Called about the start date')
    h.run(() => { candidateWrote(KEY, got, sentAt) })
    await h.settle(() => gasCalls().filter((n) => n === 'candidateProfileActivity').length > before && !h.current.refreshing)
    assert.ok(gasCalls().filter((n) => n === 'candidateProfileActivity').length > before, 'read again after the write')
    h.unmount()
  })
})

/* ---------- Add document ---------- */

describe('Add document: the paper read by the decoder before the step\'s own door files it', () => {
  const DIRECTOR = { id: 'u-dir', name: 'Dee Rector', email: 'dee@example.org', role: 'admin', types: ['DIRECTOR'], isMaster: false }
  const paperFile = (name: string, type: string) => ({ name, type, size: 3 }) as unknown as File
  const b64 = (name: string) => Buffer.from(name).toString('base64')
  const held = (globalThis as Record<string, unknown>).FileReader
  before(() => {
    // the browser's reader, as far as fileToBase64 asks it: the file's own bytes as a data: address
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: class {
      result: string | null = null
      error: Error | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL(f: { name: string; type: string }) {
        this.result = `data:${f.type};base64,${b64(f.name)}`
        setTimeout(() => this.onload?.(), 0)
      }
    } })
  })
  after(() => {
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: held })
    useAuthStore.setState({ user: null } as never)
  })

  it('the button: after Add note, only on a step that takes a paper, and only when the section is the master\'s', () => {
    const a = actionsOf(answers(KEY).actions)
    assert.deepEqual(a.items.filter((x) => x.paper).map((x) => x.id), ['cjis'])
    const on = draw(createElement(ActionsView, { name: 'Maria Lopez', actions: ready(a), query: '', onQuery: noop, onAsk: noop,
      onRetry: noop, canWrite: true }))
    assert.equal((on.match(/data-row-action="document"/g) ?? []).length, 1)
    assert.match(on, /data-action-row="cjis"[\s\S]*?data-row-action="note"[\s\S]*?data-row-action="document"[^>]*>[\s\S]*?Add document/)
    assert.equal((on.match(/data-row-action="note"/g) ?? []).length, 4, 'Add note stays on every row')
    const off = draw(createElement(ActionsView, { name: 'Maria Lopez', actions: ready(a), query: '', onQuery: noop, onAsk: noop,
      onRetry: noop }))
    assert.ok(!off.includes('data-row-action="document"') && !off.includes('Add document'), 'hidden unless the master')
    const section = readFileSync(resolve(ROOT, FEATURE, 'sections/Actions.tsx'), 'utf8')
    assert.match(section, /canWrite=\{canWrite\}/)
    const ask: CandidateAsk = { kind: 'document', item: 'cjis' }
    assert.equal(panelParam(ask), 'document~cjis')
    assert.deepEqual(panelOf('document~cjis'), ask)
    assert.equal(panelOf('document'), null)
    assert.deepEqual([panelLabel(ask), panelTitle(ask, 'Maria Lopez')], ['Add document', 'Add document · Maria Lopez'])
  })

  it('the panel is the right aside: for the master, what the step asks, what it must read as, where it is filed and a PDF drop ' +
    'zone; for anyone else, nothing to press', async () => {
    S.packOpen = false
    const h = mountHook(() => useCandidateRead(readKey('candidateProfileActions', KEY), () => readActions(KEY), (raw) => raw), {})
    await h.settle(() => h.current.status === 'ready')
    h.unmount()
    const r = maria()
    const share = sharePayloadFor(r, 'actions')
    // the master's own body of the panel, as DocumentForm hands it over once useEffectiveIsMaster says so
    const html = draw(createElement(DocumentBody, { row: r, item: 'cjis', onDone: noop }))
    noModal(html, 'Add document')
    for (const w of ['data-document-panel="cjis"', 'The decoder reads the paper first', 'Background check (BCI)', 'a background check',
      'the Hiring record', 'accept=".pdf"', 'PDF · up to 15MB']) {
      assert.ok(html.includes(w), w)
    }
    assert.ok(!html.includes('data-paper-verdict') && !html.includes('data-press='), 'nothing to press before the paper is read')
    const none = draw(createElement(DocumentBody, { row: r, item: 'interview-scheduled', onDone: noop }))
    assert.ok(none.includes('Interview scheduled takes no document here.'))
    const forms = readFileSync(resolve(ROOT, FEATURE, 'CandidateForms.tsx'), 'utf8')
    assert.match(forms, /const master = useEffectiveIsMaster\(\)\n\s*if \(!master\) return <EmptyNote>Only the master adds a document here\.<\/EmptyNote>/)
    // a session that is not the master's: the aside says so, and nothing is read or pressed
    useAuthStore.setState({ user: DIRECTOR } as never)
    const other = draw(createElement(CandidatePanel, { ask: { kind: 'document', item: 'cjis' }, row: r, share, onClose: noop }))
    assert.match(other, /<aside aria-label="Add document"/)
    assert.ok(other.includes('Only the master adds a document here.') && !other.includes('data-document-panel'))
    useAuthStore.setState({ user: null } as never)
  })

  it('a check, then the filing: the paper goes through the app\'s own door with the step and only the fields it declares; the ' +
    'override and the background result ride only when given', async () => {
    S.packOpen = false
    const bci = paperFile('bci.pdf', 'application/pdf')
    const cpr = paperFile('cpr.pdf', 'application/pdf')
    const read = paperReadingOf(await addDocument(KEY, 'cjis', bci, { check: true }))
    assert.deepEqual([read.verified, read.reason, read.check, read.filed, read.read_as, read.result, read.cjis_status, read.closes],
      [true, '', true, false, 'a background check', 'clear', 'Clear', true], 'Clear is only suggested, on a check')
    const unpicked = paperReadingOf(await addDocument(KEY, 'cjis', bci))
    assert.deepEqual([unpicked.filed, unpicked.cjis_status, unpicked.closes], [true, 'Pending', false],
      'with no result picked, a clear reading still files Pending')
    const filed = paperReadingOf(await addDocument(KEY, 'cjis', bci, { cjisStatus: 'Clear' }))
    assert.deepEqual([filed.filed, filed.override, filed.where, filed.cjis_status, filed.closes],
      [true, false, 'the Hiring record', 'Clear', true])
    const wrong = paperReadingOf(await addDocument(KEY, 'cjis', cpr))
    assert.deepEqual([wrong.verified, wrong.filed, wrong.reason], [false, false, 'kind'])
    assert.equal(wrong.why, 'This reads as a CPR / First Aid card — not Background check (BCI). Nothing was written.')
    const anyway = paperReadingOf(await addDocument(KEY, 'cjis', cpr, { confirmMismatch: true, cjisStatus: 'Disqualified' }))
    assert.deepEqual([anyway.filed, anyway.override, anyway.cjis_status], [true, true, 'Disqualified'])
    await addDocument(OTHER, 'new-hire-packet', paperFile('licence.jpg', 'image/jpeg'), { doc: 'drivers_id', check: true })
    const sent = seen.filter((s) => s.kind === 'gas')
    assert.deepEqual(sent.map((s) => s.name), Array(6).fill('candidateProfileDoor'))
    const pdf = (name: string) => ({ filename: name, mime_type: 'application/pdf', base64: b64(name) })
    assert.deepEqual(sent.map((s) => s.payload), [
      { candidate: KEY, press: 'document', item: 'cjis', fields: { ...pdf('bci.pdf'), check: true } },
      { candidate: KEY, press: 'document', item: 'cjis', fields: pdf('bci.pdf') },
      { candidate: KEY, press: 'document', item: 'cjis', fields: { ...pdf('bci.pdf'), cjis_status: 'Clear' } },
      { candidate: KEY, press: 'document', item: 'cjis', fields: pdf('cpr.pdf') },
      { candidate: KEY, press: 'document', item: 'cjis', fields: { ...pdf('cpr.pdf'), confirm_mismatch: true, cjis_status: 'Disqualified' } },
      { candidate: OTHER, press: 'document', item: 'new-hire-packet',
        fields: { filename: 'licence.jpg', mime_type: 'image/jpeg', base64: b64('licence.jpg'), doc: 'drivers_id', check: true } },
    ])
    const declared = Object.keys(POLICY.candidateProfileDoor?.params ?? {})
    for (const s of sent) assert.ok(Object.keys(s.payload ?? {}).every((k) => declared.includes(k)), 'the door declares what it is sent')
  })

  it('the Background result is a person\'s: the four the Hiring app\'s CJIS door offers, pre-selected from the reading, sent as ' +
    'picked, and said before the second press and in the toast', () => {
    const modal = readFileSync(resolve(ROOT, 'src/features/hiring/CjisUploadModal.tsx'), 'utf8')
    // the backend's arrays live in another realm: copied, so only their values are compared
    const statuses = [...GS.statuses]
    assert.deepEqual(statuses, [...(/CJIS_STATUSES = \[([^\]]+)\]/.exec(modal)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]),
      'the same four the Hiring app\'s own CJIS upload offers')
    assert.deepEqual(actionsOf(answers(KEY).actions).items.find((x) => x.id === 'cjis')?.paper?.statuses, statuses)
    assert.deepEqual(['Clear', 'Verified', 'Pending', 'Disqualified'].map(cjisResultWords), [
      'Clear — the step is marked done', 'Verified — the step is marked done', 'Pending — the step stays open',
      'Disqualified — the step stays open'])
    const forms = readFileSync(resolve(ROOT, FEATURE, 'CandidateForms.tsx'), 'utf8')
    assert.match(forms, /setResult\(r\.cjis_status\)/, 'the reading\'s suggestion is pre-selected')
    assert.match(forms, /data-cjis-result=""/)
    assert.match(forms, /cjisStatus: statuses\.length \? result : undefined/, 'the pick is what is sent')
    assert.match(forms, /data-review-result=""/, 'the second press says the result that will be written')
    assert.match(forms, /`Background result: \$\{r\.cjis_status\}`/, 'the toast says the result written')
  })

  it('what the panel draws is the reading the backend\'s own verdict builds, worded by why: a match, a paper of another kind, a ' +
    'paper naming someone else, one never read, one the decoder is not taught', () => {
    const match = paperReadingOf({ ...GS.verdict(CJIS_PAPER, readOf('bci.pdf'), 'Maria Lopez'), check: true })
    assert.equal(match.verified, true)
    assert.deepEqual(readingLines(match, 'Maria Lopez'), [
      { label: 'Read as', value: 'a background check' }, { label: 'Name on it', value: 'Maria Lopez' },
      { label: 'Issued', value: 'Sep 10, 2026' }, { label: 'Result', value: 'Clear — no record found' },
    ])
    const ok = draw(createElement(PaperVerdict, { got: match, asks: 'Background check (BCI)', name: 'Maria Lopez' }))
    assert.ok(ok.includes('data-paper-verdict="match"') && ok.includes('>Matches<') && !ok.includes('data-paper-warning'))
    const wrong = paperReadingOf(GS.verdict(CJIS_PAPER, readOf('cpr.pdf'), 'Maria Lopez'))
    assert.equal(wrong.reason, 'kind')
    const bad = draw(createElement(PaperVerdict, { got: wrong, asks: 'Background check (BCI)', name: 'Maria Lopez' }))
    for (const w of ['data-paper-verdict="mismatch"', 'data-paper-reason="kind"', '>Does not match<', 'a CPR / First Aid card',
      'Apr 17, 2028', 'data-paper-warning', 'This paper does not read as Background check (BCI). File anyway only if you know it is']) {
      assert.ok(bad.includes(w), w)
    }
    const someone = paperReadingOf(GS.verdict(CJIS_PAPER, { paper: { state: 'read', chars: 90, kind: 'background_check', kind_score: 30,
      person_seen: 'Zed Other' }, named: 'other', result: 'clear' }, 'Maria Lopez'))
    assert.deepEqual([someone.verified, someone.reason], [false, 'person'])
    assert.equal(someone.why, 'This paper names Zed Other, not Maria Lopez.')
    assert.equal(readingLines(someone, 'Maria Lopez')[1].value, 'Zed Other — not Maria Lopez')
    const other = draw(createElement(PaperVerdict, { got: someone, asks: 'Background check (BCI)', name: 'Maria Lopez' }))
    assert.ok(other.includes('>Names someone else<') && !other.includes('>Does not match<'))
    assert.ok(other.includes('Filing it anyway puts Zed Other’s background check on Maria Lopez’s record as Background check (BCI).'))
    assert.ok(!other.includes('does not read as'), 'a paper of the right kind is never said to be the wrong one')
    const unread = paperReadingOf(GS.verdict(CJIS_PAPER, { paper: { state: 'error', chars: 0, why: 'Drive would not convert it' },
      named: 'unread' }, 'Maria Lopez'))
    assert.deepEqual([unread.verified, unread.reason, unread.state], [false, 'unread', 'error'])
    const never = draw(createElement(PaperVerdict, { got: unread, asks: 'Background check (BCI)', name: 'Maria Lopez', onReadAgain: noop }))
    for (const w of ['>Could not read<', 'data-paper-read-again', 'Read again', 'The decoder could not read this paper',
      'Drive would not convert it']) {
      assert.ok(never.includes(w), w)
    }
    assert.ok(!never.includes('>Does not match<') && !never.includes('Read as'), 'a reading that never happened is not a mismatch')
    const empty = paperReadingOf(GS.verdict(CJIS_PAPER, { paper: { state: 'empty', chars: 0 }, named: 'unread' }, 'Maria Lopez'))
    assert.equal(empty.reason, 'unread')
    // an answer that names no reason still tells a reading that never happened from a mismatch
    assert.equal(paperReadingOf({ verified: false, reading: { state: 'heic' } }).reason, 'unread')
    assert.equal(paperReadingOf({ verified: false, reading: { state: 'read', kind: 'cpr_first_aid' } }).reason, 'kind')
    const untaught = paperReadingOf(GS.verdict({ label: 'Car Insurance Card', kinds: [] }, readOf('bci.pdf'), 'Maria Lopez'))
    assert.equal(untaught.reason, 'untaught')
    assert.equal(paperVerdictWords(untaught, 'Car Insurance Card', 'Maria Lopez').pill.label, 'Cannot tell')
    const faint = GS.verdict(CJIS_PAPER, { paper: { state: 'read', chars: 90, kind: 'background_check', kind_score: 4 }, named: 'match' },
      'Maria Lopez')
    assert.deepEqual([faint.verified, faint.reason], [false, 'faint'])
    assert.match(faint.why, /only faintly/)
    assert.equal(paperVerdictWords(paperReadingOf(faint), 'Background check (BCI)', 'Maria Lopez').pill.label, 'Does not match')
  })

  it('a file the decoder cannot take is refused on the screen with the step\'s own extensions, before anything is sent — the ' +
    'resume also as a Word file, as its own door takes one', () => {
    assert.equal(paperFileRefusal('bci.jpg', 10, ['pdf']), 'The Hiring record keeps this paper as a PDF — a PDF of it, please.')
    assert.equal(paperFileRefusal('notes.txt', 10, PAPER_EXTS), 'Only PDF, JPG, PNG or GIF.')
    assert.equal(paperFileRefusal('cv.docx', 10, PAPER_EXTS), 'Only PDF, JPG, PNG or GIF.')
    assert.equal(paperFileRefusal('card.png', 16 * 1024 * 1024, PAPER_EXTS), 'Up to 15MB.')
    assert.equal(paperFileRefusal('CARD.PNG', 10, PAPER_EXTS), '')
    assert.equal(paperFileRefusal('bci.pdf', 10, ['pdf']), '')
    const resumeExts = [...GS.paperExts, ...Object.keys(GS.wordTypes)]
    assert.equal(paperFileRefusal('cv.docx', 10, resumeExts), '')
    assert.equal(paperFileRefusal('cv.DOC', 10, resumeExts), '')
    assert.equal(paperExtsWords(resumeExts), 'PDF, JPG, PNG, GIF, DOC or DOCX')
    assert.equal(paperExtsWords(['pdf']), 'PDF')
    assert.equal(paperAccept(resumeExts), '.pdf,.jpg,.jpeg,.png,.gif,.doc,.docx')
    assert.deepEqual([...GS.paperExts], PAPER_EXTS, 'the screen\'s own list is the backend\'s')
    const types = vm.runInNewContext(`(${lift('ComplianceDocs.gs', 'CERT_DOC_TYPES').replace(/^var CERT_DOC_TYPES = /, '').replace(/;$/, '')})`) as
      Record<string, string>
    for (const ext of PAPER_EXTS) assert.ok(types[ext], `.${ext} is a type the backend files`)
    // what a step answers: its own extensions, a PDF only where the door keeps one, the shipped list when it says none
    const stepOf = (paper: Row) => actionsOf({ items: [{ id: 'resume', label: 'Resume', status: 'missing', paper }] }).items[0]?.paper
    assert.deepEqual(stepOf({ asks: 'Resume', exts: resumeExts })?.exts, resumeExts)
    assert.deepEqual(stepOf({ asks: 'Background check (BCI)', pdf_only: true, exts: ['pdf', 'jpg'] })?.exts, ['pdf'])
    assert.deepEqual(stepOf({ asks: 'New Hire Packet' })?.exts, PAPER_EXTS)
    const html = draw(createElement(FileDropZone, { accept: paperAccept(resumeExts), hint: `${paperExtsWords(resumeExts)} · up to 15MB`,
      onFile: noop }))
    assert.ok(html.includes('accept=".pdf,.jpg,.jpeg,.png,.gif,.doc,.docx"') && html.includes('PDF, JPG, PNG, GIF, DOC or DOCX · up to 15MB'))
  })
})

/* ---------- no modal anywhere ---------- */

describe('no modal anywhere', () => {
  it('no browser dialog, no Dialog or Sheet, no modal or viewer of its own, no framed document, no Drive link', () => {
    for (const file of walk(FEATURE)) {
      const text = readFileSync(resolve(ROOT, file), 'utf8')
      assert.doesNotMatch(text, /window\.(confirm|alert|prompt)\(/, file)
      assert.doesNotMatch(text, /import[^;]*\b\w*(Dialog|Sheet|Modal)\b[^;]*from/, file)
      assert.doesNotMatch(text, /from '[^']*(ui\/dialog|ui\/sheet)'/, file)
      assert.doesNotMatch(text, /components\/shared\/FileViewer|openFile\(|fixed inset-0|aria-modal|role="dialog"/, file)
      assert.doesNotMatch(text, /<iframe|createObjectURL/, `${file}: a document opens in the platform's viewer`)
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      assert.doesNotMatch(code, /drive\.google\.com|docs\.google\.com|webViewLink|target="_blank"/, file)
    }
    const openers = walk(FEATURE).filter((f) => readFileSync(resolve(ROOT, f), 'utf8').includes("from '@/lib/platformDoc'"))
    assert.deepEqual(openers.map((f) => f.slice(FEATURE.length + 1)), ['useCandidateRead.ts'])
  })
})

/* ---------- what the relay keeps ---------- */

describe('what the relay keeps', () => {
  it('every candidate read and the pack are never stamped for a receipt; the note and the press keep their exactly-once receipt', () => {
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    const line = /^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{([^}]*)\}\)/m.exec(relay)?.[1] ?? ''
    const listed = new Set([...line.matchAll(/"(\w+)"/g)].map((m) => m[1]))
    for (const name of [...GS.actions, 'candidatePack']) {
      const write = POLICY[name]?.idempotent === false
      if (write) assert.ok(!listed.has(name), `${name} keeps its receipt`)
      else assert.ok(listed.has(name), `${name} (${POLICY[name]?.lane}) is in RELAY_NO_RECEIPT_ACTIONS`)
    }
    assert.equal(POLICY.candidateProfileNoteAdd?.lane, 'write')
    // the press answers with the door's own outcome: one honest wait, never a queued {accepted:true}
    assert.deepEqual([POLICY.candidateProfileDoor?.lane, POLICY.candidateProfileDoor?.idempotent], ['tool', false])
  })
})

/* ---------- a candidate the slice lacks ---------- */

describe('a candidate the slice lacks', () => {
  const st = (status: ReadState<unknown>['status'], error = '', data: unknown = null): ReadState<unknown> =>
    ({ status, data, error, refreshing: false })
  const active = st('ready', '', { candidates: [] })
  const unknown = 'Unknown action.'

  it('while the live board or the record is still asked, the screen reads', () => {
    assert.equal(lookupRead(false, true, false, active, st('loading'), st('idle')).roster.status, 'loading')
    assert.equal(lookupRead(false, true, true, active, st('failed', unknown), st('loading')).roster.status, 'loading')
  })

  it('a look that could not answer is drawn as that failure, with Retry asking the looks again — never "no candidate"', () => {
    const stray = st('failed', unknown)
    const got = lookupRead(false, true, true, active, st('failed', 'Network error — could not reach the server.'), stray)
    assert.equal(got.roster, stray)
    assert.equal(got.retryLook, true)
    const html = draw(createElement(CandidatesScreen, { roster: got.roster, onRetry: noop, candidates: [], wanted: OFF_BOARD, row: null,
      tab: 'overview', details: null, actionsCount: null, onCandidate: noop, onTab: noop, onAsk: noop }))
    assert.ok(html.includes('The candidates could not be read') && html.includes(NOT_OPEN))
    assert.ok(!html.includes(`No candidate ${OFF_BOARD}`))
  })

  it('the record\'s own "not on file" is the only answer that says the candidate is unknown', () => {
    const got = lookupRead(false, true, true, active, st('failed', unknown), st('failed', `No candidate "${OFF_BOARD}" is on file.`))
    assert.equal(got.roster, active)
    assert.equal(got.retryLook, false)
    const html = draw(createElement(CandidatesScreen, { roster: got.roster, onRetry: noop, candidates: [], wanted: OFF_BOARD, row: null,
      tab: 'overview', details: null, actionsCount: null, onCandidate: noop, onTab: noop, onAsk: noop }))
    assert.ok(html.includes(`No candidate ${OFF_BOARD} in the hiring records the platform reads.`))
  })

  it('a candidate found draws the slice\'s read as it is', () => {
    assert.deepEqual(lookupRead(true, true, true, active, st('failed', unknown), st('failed', unknown)), { roster: active, retryLook: false })
  })
})

/* ---------- the lane-1 roster stays pure ---------- */

describe('the lane-1 roster', () => {
  it('each candidate once, the board\'s next step, the recruiter without the platform\'s stamp', () => {
    const r = rosterOf(rosterFrom([...boardRows(), boardRows()[0]]))
    assert.deepEqual(r.candidates.map((c) => c.key), ['CAN_ada00004', OTHER, KEY])
    assert.deepEqual(r.candidates.map((c) => c.next_step), ['', 'New Hire packet', 'Interview scheduled'])
  })
})

/* ---------- a released app: the reader the server narrows, and every reader but the master ---------- */

describe('a released app', () => {
  const as = (user: Record<string, unknown> | null) => useAuthStore.setState({ user } as never)
  const narrowRoster = () => ({
    candidates: [{ key: KEY, name: 'Maria Lopez', position: 'Direct Support Professional', stage: 'interview', stage_label: 'Interview',
      avatar: '' }],
    stages: [], viewer: 'client', why: [], degraded: false,
  })
  afterEach(() => as(null))

  it('a client, an SSA or a FAMILY reader never asks the whole board\'s lanes — the slice and the pack — only the actions the ' +
    'server cuts, whatever its role word says', async () => {
    for (const user of [
      { id: 'u-kay', name: 'Kay', email: 'kay@example.org', role: 'client', types: ['CLIENT'], isMaster: false },
      // the SSA a client's records name as guardian: on a staff role, or a client-role account linked to one ward
      { id: 'u-den', name: 'Den', email: 'den@example.org', role: 'staff', types: ['SSA'], isMaster: false },
      { id: 'u-jen', name: 'Jen', email: 'jen@example.org', role: 'client', types: ['SSA'], isMaster: false },
      // the FAMILY the records name as SSA: a staff-role account with no client link — its role word never counts
      { id: 'u-fay', name: 'Fay', email: 'fay@example.org', role: 'staff', types: ['FAMILY'], isMaster: false },
      // a cell written before 10-30 still says GUARDIAN: read as FAMILY (scope.BADGE_RENAMED)
      { id: 'u-old', name: 'Old', email: 'old@example.org', role: 'staff', types: ['GUARDIAN'], isMaster: false },
    ]) {
      as(user)
      seen = []
      forgetSnapshot()
      forgetPack()
      forgetCandidateReads()
      assert.equal(mayBeNarrowed(), true, user.id)
      await readRoster(false)
      await readOverview(KEY)
      await readInterviews(KEY)
      assert.deepEqual(seen.map((s) => `${s.kind}:${s.name}`),
        ['gas:candidateProfileRoster', 'gas:candidateProfileOverview', 'gas:candidateProfileInterviews'], user.id)
    }
  })

  it('a STAFF reader and the master read the lanes as before', async () => {
    as({ id: 'u-sal', name: 'Sal', email: 'sal@example.org', role: 'staff', types: ['STAFF'], isMaster: false })
    assert.equal(mayBeNarrowed(), false)
    await readRoster(false)
    assert.deepEqual(gasCalls(), [])
    as({ id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: ['FAMILY', 'SSA'], isMaster: true })
    assert.equal(mayBeNarrowed(), false)
  })

  it('the roster says whose narrowed view it is; that reader has three sections, an address naming another opens the ' +
    'overview, and the menu is every candidate alone', () => {
    assert.equal(rosterOf(narrowRoster()).viewer, 'client')
    // an SSA's view (kind "ssa") is narrowed exactly as a family's (kind "guardian") and a client's
    for (const kind of ['guardian', 'ssa'] as const) assert.equal(rosterOf({ ...narrowRoster(), viewer: kind }).viewer, kind)
    assert.equal(rosterOf(ROSTER_ANSWER()).viewer, '')
    assert.equal(rosterOf({ ...narrowRoster(), viewer: 'master' }).viewer, '')
    assert.deepEqual(tabsFor(true).map((t) => t.id), ['overview', 'pipeline', 'interviews'])
    assert.deepEqual([tabFor('documents', true), tabFor('interviews', true), tabFor('documents', false)], ['overview', 'interviews', 'documents'])
    const r = rosterOf(narrowRoster()).candidates[0]
    const html = draw(createElement(CandidatesScreen, { roster: ready(null), onRetry: noop, candidates: [r], wanted: KEY, row: r,
      tab: 'documents', details: null, actionsCount: null, onCandidate: noop, onTab: noop, onAsk: noop,
      reach: { write: false, narrow: true } }))
    for (const t of ['overview', 'pipeline', 'interviews']) assert.ok(html.includes(`data-tab="${t}"`), t)
    for (const t of ['actions', 'information', 'documents', 'activity', 'sms', 'transcripts']) assert.ok(!html.includes(`data-tab="${t}"`), t)
    assert.ok(html.includes('data-section="overview"') && html.includes('data-overview="narrow"'))
    const menu = draw(createElement(ActionsMenu, { candidate: KEY, details: null, onPick: noop, onTab: noop, onDone: noop,
      reach: { write: false, narrow: true } }))
    assert.equal((menu.match(/role="menuitem"/g) ?? []).length, 1)
    assert.ok(menu.includes('View all candidates') && !menu.includes('Open in Hiring') && !menu.includes('Copy e-mail'))
    const none = draw(createElement(CandidatesScreen, { roster: ready(null), onRetry: noop, candidates: [], wanted: '', row: null,
      tab: 'overview', details: null, actionsCount: null, onCandidate: noop, onTab: noop, onAsk: noop,
      reach: { write: false, narrow: true } }))
    assert.ok(none.includes('No candidate is tied to your house.'))
  })

  it('the narrowed sections: the basic card, the pipeline without location or next step, the meetings at their house', () => {
    const r = rosterOf(narrowRoster()).candidates[0]
    const basic = overviewOf({
      candidate: { key: KEY, name: 'Maria Lopez', position: 'Direct Support Professional', stage: 'interview', stage_label: 'Interview',
        status_label: 'Interview', archived: false, avatar: '' },
      information: { full_name: 'Maria Lopez', stage_label: 'Interview', position: 'Direct Support Professional' },
      viewer: 'client', why: [], degraded: false,
    })
    const card = draw(createElement(NarrowOverviewView, { row: r, overview: ready(basic), onRetry: noop, onTab: noop }))
    for (const w of ['At a glance', 'Direct Support Professional', 'Interview', 'Interviews and meet-and-greets', 'View all candidates']) {
      assert.ok(card.includes(w), w)
    }
    for (const w of ['Contact', 'Add note', 'Update stage', 'Recruiter', 'Next step', 'Recent activity']) assert.ok(!card.includes(w), w)
    const pipe = draw(createElement(PipelineView, { candidates: [r], current: KEY, query: '', onQuery: noop, stage: '', onStage: noop,
      onCandidate: noop, narrow: true }))
    assert.ok(!pipe.includes('>Location<') && !pipe.includes('>Next step<') && pipe.includes('1 candidate tied to your house.'))
    const steps = draw(createElement(PipelineView, { candidates: [{ ...r, next_step: 'Transcript', next_id: 'transcript',
      stage: 'phone-screen' }], current: KEY, query: '', onQuery: noop, stage: '', onStage: noop, onCandidate: noop, onNext: noop,
    narrow: true }))
    assert.ok(!steps.includes('data-next-cell') && !steps.includes('data-next-open'), 'a narrowed reader has no next step to open')
    const iv = interviewsOf({ plan: [{ id: 'event_HEV_1', title: 'In-person interview', date: '2026-09-25', owner: 'Gia Guardian',
      status: 'scheduled', detail: 'Zeta House · 14:00', result: '', comments: '' }], preferences: {}, viewer: 'client', why: [],
    degraded: false })
    const meet = draw(createElement(InterviewsView, { row: { name: 'Maria Lopez' }, interviews: ready(iv), onRetry: noop, narrow: true }))
    for (const w of ['Interviews &amp; meet-and-greets', 'In-person interview', '>Scheduled<', 'Zeta House · 14:00', 'Gia Guardian']) {
      assert.ok(meet.includes(w), w)
    }
    assert.ok(!meet.includes('Candidate preferences'))
  })

  it('a reader who is not the master is shown no write — no quick action, no row button, no Upload, no Candidate actions — ' +
    'and a form reached by its address says it is not open to them', () => {
    const o = draw(createElement(OverviewView, { row: maria(), overview: ready(overviewOf(answers(KEY).overview)),
      actions: ready(actionsOf(answers(KEY).actions)), onRetry: noop, onAsk: noop, onTab: noop }))
    assert.ok(o.includes('Quick actions') && o.includes('View all candidates') && !o.includes('data-quick="note"') &&
      !o.includes('data-quick="stage"'))
    const a = draw(createElement(ActionsView, { name: 'Maria Lopez', actions: ready(actionsOf(answers(KEY).actions)), query: '',
      onQuery: noop, onAsk: noop, onRetry: noop }))
    assert.ok(a.includes('data-actions-table') && !a.includes('data-row-action='))
    const d = draw(createElement(DocumentsView, { row: { key: KEY, name: 'Maria Lopez' }, docs: ready(documentsOf(answers(KEY).documents)),
      doc: { opening: '', open: noop }, onAsk: noop, onRetry: noop }))
    assert.ok(d.includes('data-open-doc=') && !d.includes('data-upload='))
    const menu = draw(createElement(ActionsMenu, { candidate: KEY, details: { email: 'maria@example.org', phone: '3305550111' },
      onPick: noop, onTab: noop, onDone: noop }))
    assert.equal((menu.match(/role="menuitem"/g) ?? []).length, 4)
    assert.ok(!menu.includes('Add note') && !menu.includes('Update stage') && menu.includes('Copy e-mail'))
    const asks: CandidateAsk[] = [{ kind: 'note', about: '' }, { kind: 'stage' }, { kind: 'complete', item: 'cjis' },
      { kind: 'upload', doc: 'cjis' }]
    for (const ask of asks) {
      const html = draw(createElement(CandidatePanel, { ask, row: maria(), share: sharePayloadFor(maria(), 'overview'), onClose: noop }))
      assert.ok(html.includes(NOT_OPEN) && !html.includes('data-door=') && !html.includes('<textarea') &&
        !html.includes('data-stage-select'), ask.kind)
    }
  })

  it('a part the server refuses says plainly that it is not open, never a red failure', () => {
    const html = draw(createElement(ReadLine, { state: { status: 'failed', data: null, error: 'Unknown action.', refreshing: false },
      what: 'the documents', onRetry: noop }))
    assert.ok(html.includes(NOT_OPEN) && !html.includes('role="alert"') && !html.includes('could not be read'))
    for (const e of ['Unknown action.', 'This action is for admin or manager.', 'Requires an admin or manager account']) {
      assert.equal(readRefusal(e), NOT_OPEN, e)
    }
    assert.equal(readRefusal('Network error'), 'Network error')
  })
})
