/**
 * STAFF · the contract between the page and its doors. Every call the page makes is caught at `fetch` and handed to
 * Apps Script's own StaffProfiles.gs (with Locations.gs, whose house helpers it leans on), run here on in-memory
 * stores; the answer comes back as JSON and is read by the page's own readers. A name, a parameter or a field that
 * one side renames breaks here, not on the screen.
 *
 * Only the stores are stood in for (People, the Employee Database Master, the accounts, the clients, the calendar,
 * the punches, the IST records, Drive, the uploads ledger, the requirement states, the Trainings Status tracker, the
 * Med Del flows, the events trail, the texts and transcripts houses, the HR tracker). The helpers the .gs files lean on
 * are lifted whole out of their own files; the HR tracker's own writer (StaffIssues.gs) runs whole.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import { useAuthStore } from '@/auth/useAuthStore'
import type { HouseClient, HouseRow } from '@/pages/features/houses/houseModel'
import { blobOf, docShapeOf } from '@/pages/features/myprofile/certDocFile'
import {
  NOT_PUBLISHED, actionButton, actionsOf, activityOf, assignSplit, assignableHouses, callsByDay, cellWords, complianceOf, courseWords,
  defaultStaff, diplomaWords, docOpens, documentsOf, employmentOf, endDayWords, filingCourses, hrOf, notesOf, olderCursor, overviewOf,
  parseSpeakerTranscript, readRefusal, referralPaidWords, rosterOf, screenWords, shiftsOf, staffEditViewOf, textsOf, threadOrder,
  trainingSub, transcriptOf, transcriptsOf, waitingPapers,
} from '@/pages/features/staffprofiles/staffModel'
import { editAnswerOf } from '@/lib/recordEdit'
import {
  addHrIssue, addNote, assignTraining, editDriving, editIst, editMais, editStaff, forgetStaffReads, readActions, readActivity, readCompliance, readDocFile, readDocuments,
  readEmployment, readHr, readKey, readNotes, readOverview, readPerformance, readRoster, readShifts, readTexts, readTranscript,
  readTranscripts, recordVisit, renameStaff, requestTraining, setNoteState, staffWrote, useStaffRead, writeQueued, readPreferences,
  savePreferences,
} from '@/pages/features/staffprofiles/useStaffRead'
import { performanceOf } from '@/pages/features/staffprofiles/perfModel'
import { mountHook } from './react-host'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const STAFF = 'noahreed'
const NOW = '2026-09-28T15:00:00Z'
const PDF = [0x25, 0x50, 0x44, 0x46]
const PNG = [0x89, 0x50, 0x4e, 0x47]

const gsText = (file: string) => readFileSync(resolve(ROOT, 'apps-script', file), 'utf8')

/** One top-level function or var of a .gs file, exactly as written there. */
function lift(file: string, name: string): string {
  const src = gsText(file)
  const fn = src.indexOf(`\nfunction ${name}(`)
  if (fn !== -1) return src.slice(fn + 1, src.indexOf('\n}', fn + 1) + 2)
  const v = src.indexOf(`\nvar ${name} =`)
  assert.notEqual(v, -1, `${file} has no ${name}`)
  return src.slice(v + 1, src.indexOf(';\n', v) + 1)
}

/** One door of another file, `HUB_ACTIONS.<name> = function …};`, exactly as written there. */
function liftDoor(file: string, name: string): string {
  const src = gsText(file)
  const at = src.indexOf(`\nHUB_ACTIONS.${name} = function`)
  assert.notEqual(at, -1, `${file} has no door ${name}`)
  return src.slice(at + 1, src.indexOf('\n};', at + 1) + 3)
}

const HELPERS: [string, string][] = [
  ['Clients.gs', 'clientNameKey_'], ['Main.gs', 'hubAddrKey_'], ['CommBroadcast.gs', 'commBroadcastDay_'],
  ['Hotline.gs', 'HOTLINE_MANAGER_CURRENT_DAYS'], ['Hotline.gs', 'hotlineRowDay_'], ['Hotline.gs', 'hotlineManagersByHouse_'],
  ['Hotline.gs', 'HOTLINE_TRANSCRIPTS_TAB'], ['Hotline.gs', 'HOTLINE_COLS'],
  ['IST.gs', 'istPairKey_'], ['IST.gs', 'istLatestDate_'], ['IST.gs', 'IST_STATUS_OWED'],
  ['HubCore.gs', 'hubCellSafe_'], ['HubCore.gs', 'hubSsnDigits_'], ['Talent.gs', 'str_'], ['Talent.gs', 'TALENT_CANDIDATES_TAB'],
  ['Profile.gs', 'hubNameFold_'], ['Profile.gs', 'profileParsePhones_'], ['Profile.gs', 'profileCleanPhones_'],
  ['Profile.gs', 'profileParseEmails_'], ['Profile.gs', 'profileCleanEmails_'],
  ['ComplianceDocs.gs', 'CERT_DOC_TYPES'], ['ComplianceDocs.gs', 'CERT_DOC_TYPE_WORDS'],
  ['ComplianceDocs.gs', 'complianceDocsTypeOk_'], ['ComplianceDocs.gs', 'complianceDocsTypeByName_'],
  ['ComplianceDocs.gs', 'complianceDocsTypeLoose_'], ['ComplianceDocs.gs', 'complianceDocsSameType_'],
  ['ComplianceDocs.gs', 'complianceDocsFileType_'], ['ComplianceDocs.gs', 'complianceDocsShownType_'],
  ['ComplianceDocs.gs', 'complianceDocsOut_'], ['ComplianceDocs.gs', 'complianceDocsRosterId_'],
  ['ComplianceDocs.gs', 'complianceDocsFileIdOf_'], ['ComplianceDocs.gs', 'complianceDocsDay_'],
  ['ComplianceDocs.gs', 'CERT_READ_UPLOADABLE'], ['ComplianceDocs.gs', 'CERT_READ_WORDS'], ['ComplianceDocs.gs', 'CERT_CONFIRM_WORDS'],
  ['ComplianceDocs.gs', 'complianceDocsReqShut_'], ['ComplianceDocs.gs', 'complianceDocsConfirmShut_'],
  ['ComplianceDocs.gs', 'complianceDocsDateRole_'], ['ComplianceDocs.gs', 'CERT_READ_KIND_WORDS'],
  ['Emp360.gs', 'emp360NameHit_'], ['Emp360.gs', 'emp360NameNorm_'], ['Emp360.gs', 'EMP360_ACTIVE_STATUSES'],
  ['Emp360.gs', 'emp360StatusActive_'], ['RequirementStates.gs', 'reqStatesListFrom_'],
  // the record edit's own door: the Master writer whole, with the guards it shares
  ['Emp360.gs', 'emp360Cell_'], ['Emp360.gs', 'emp360Key_'], ['Emp360.gs', 'EMP360_PII_EXACT'], ['Emp360.gs', 'emp360PiiBlocked_'],
  ['Emp360.gs', 'EMP360_DATA_COLUMNS'], ['Emp360.gs', 'emp360Column_'], ['Emp360.gs', 'emp360EditableField_'],
  ['Emp360.gs', 'emp360RosterPerson_'], ['Emp360.gs', 'emp360FindMasterRow_'], ['Emp360.gs', 'emp360ReadTab_'],
  ['Emp360.gs', 'emp360MasterRows_'], ['Emp360.gs', 'emp360Resolve_'], ['Emp360.gs', 'emp360RowMoved_'],
  ['Emp360.gs', 'emp360WriteCell_'],
  ['Events.gs', 'EVENTS_TAB'], ['Events.gs', 'EVENTS_HEADER'], ['StaffPerformance.gs', 'PERF_TABS'], ['Files.gs', 'DOCS_TAB'],
  ['CommCalls.gs', 'COMM_CALLS_TAB'], ['CommCalls.gs', 'COMM_WORK_ITEMS_TAB'], ['CommCalls.gs', 'commCallsText_'],
  ['MedDel.gs', 'MEDDEL_TAB'], ['Certs.gs', 'certFieldOf_'],
  // who ranks HM or above (Assign Training, the roster's `may`) and who writes the HR tracker (a new HR issue)
  ['Profile.gs', 'HUB_USER_TYPES'], ['Profile.gs', 'HUB_BADGE_FOLLOWS'], ['Profile.gs', 'HUB_CALENDAR_BADGE'],
  ['Profile.gs', 'userTypesFromRaw_'], ['Profile.gs', 'userBadgesWorn_'], ['Profile.gs', 'userBadgesWornBy_'],
  ['Profile.gs', 'hubCalendarBadges_'], ['HubCore.gs', 'hubIsWriter_'], ['HubCore.gs', 'hubDenied_'], ['Estate.gs', 'estateKey_'],
]

/* ---------- the stores ---------- */

type Row = Record<string, unknown>
type Grid = unknown[][]
type DriveFile = { name: string; mime: string; bytes: number[] }
type Folder = { id: string; name: string; folders: Folder[]; files: string[] }

/** The Employee Database Master as a column list: the scorecard block, then `Status` onward, secrets included. */
function masterGrid(): Grid {
  const cols: unknown[][] = [
    ['Employee', 'Noah Reed', 'Ava Stone', 'Old Timer'],
    ['Job App', 1, '', ''], ['Attestation', 1, '', ''], ['i9 Form', 1, '', ''], ['W4', 1, '', ''], ['HIPAA', 1, '', ''],
    ['Pay Auth', 0.5, '', ''], ['HS Diploma', 1, '', ''], ['Drive Abstract (last)', 1, '', ''], ['Car Insurance', 1, '', ''],
    ['SAM', 1, '', ''], ['OIG', 1, '', ''], ['Abuser', 1, '', ''], ['Sex Offender', 1, '', ''], ['Offender', 1, '', ''],
    ['Nurse Aide', 1, '', ''], ['Exclusions', 1, '', ''], ['BCI', 1, '', ''], ['Rapback', 1, '', ''],
    ['Status', 'Yes', 'Yes', 'No'], ['Employee ID', 'ASA-1060', 'ASA-2000', ''], ['First Name', 'Noah', 'Ava', 'Old'],
    ['Last Name', 'Reed', 'Stone', 'Timer'], ['SSN#', '987-65-4329', '', ''], ['SSN (Last 4)', '', '', ''],
    ['Date of Birth', '05/17/1990', '', ''], ['Address', '12 Main St NW', '', ''], ['City', 'Canton', '', ''],
    ['State', 'OH', '', ''], ['Zip', '44708', '', ''], ['Phone Number', '(330) 555-0113', '', ''],
    ['Email', 'noah.home@example.org', '', ''], ['Referral', 'Rae Ref', '', ''], ['Referral Paid?', 'Yes 5/1/2025', '', ''],
    ['Start Date(doc)', '01/02/2024', '', ''], ['Start Date (first day)', '01/10/2024', '', ''], ['End Date\n(last day)', '', '', ''],
    ['Job App Date', '12/20/2023', '', ''], ['Resume', 'Yes', '', ''], ['Attestation Date', '12/21/2023', '', ''],
    ['I-9 Date', '12/22/2023', '', ''], ['I-9 Completed', 'Yes', '', ''], ['I-9 Type 1', 'Driver License', '', ''],
    ['I-9 1 Exp Date', '06/30/2027', '', ''], ['I-9 Type 2', 'Social Security', '', ''], ['I-9 2 Exp Date', 'n/a', '', ''],
    ['W-4 Date', '12/22/2023', '', ''], ['HIPAA Form Date', '12/22/2023', '', ''], ['Pay Auth Form Date', '12/22/2023', '', ''],
    ['HS Diploma', 'Yes', '', ''], ['Driver', 'Yes', '', ''], ['DL#', 'SV347731', '', ''], ['License Exp Date', '06/30/2027', '', ''],
    ["Driver's Abstract (Original)", '01/05/2024', '', ''], ["Driver's Abstract (Latest)", '01/05/2026', '', ''],
    ['Insurance Exp Date', '10/20/2026', '', ''], ['SAM', '01/03/2024', '', ''], ['OIG', '01/03/2024', '', ''],
    ['Abuser Registry', '01/03/2024', '', ''], ['Sex Offender', '01/03/2024', '', ''], ['Offender', '01/03/2024', '', ''],
    ['Nurse Aide', 'n/a', '', ''], ['Exclusions Database', '01/03/2024', '', ''], ['BCI/FBI', 'BMT123456789', '', ''],
    ['BCI Check Date', '01/04/2024', '', ''], ['Rapback Entry Date', '01/08/2024', '', ''],
    ['Login', 'noah.login', '', ''], ['Password', 'Secret.4329!', '', ''],
  ]
  return cols[0].map((_, r) => cols.map((c) => c[r]))
}

/**
 * What must never leave Apps Script: the raw secrets (an SSN however it is grouped; the licence whole, or its own
 * letters shown as if they were a state beside its last four), the credentials, the clinical words, a stranger's
 * number, and another person's file that only shares letters of the name.
 */
const NEVER = ['987-65-4329', '987654329', '987 65 4329', 'SV347731', 'SV ••••', 'BMT123456789', 'noah.login', 'Secret.4329!',
  'HASHVALUE123', 'SALTVALUE', 'Secret pill', 'dx words', 'private words', 'Slipped in the hall', '3305550999', 'stranger text',
  'from the shared phone', 'Stranger words', 'jonoahi9file', 'Jonoah Reed']

function freshStores() {
  const files: Record<string, DriveFile> = {
    i9noahfile01: { name: 'Form I-9 Noah Reed.pdf', mime: 'application/pdf', bytes: PDF },
    cprcardfile1: { name: 'CPR card.png', mime: 'image/png', bytes: PNG },
    bcinoahfile1: { name: 'BCI result.pdf', mime: 'application/pdf', bytes: PDF },
    resumefile01: { name: 'Noah Reed resume.pdf', mime: 'application/pdf', bytes: PDF },
    cprformfile1: { name: 'CPR form upload.pdf', mime: 'application/pdf', bytes: PDF },
    cprupload001: { name: 'cpr.pdf', mime: 'application/pdf', bytes: PDF },
    istpaper0001: { name: 'IST Noah Kenny.pdf', mime: 'application/pdf', bytes: PDF },
    avafile00001: { name: 'Ava I-9.pdf', mime: 'application/pdf', bytes: PDF },
    jonoahi9file: { name: 'Jonoah Reed Form I-9.pdf', mime: 'application/pdf', bytes: PDF },
  }
  const quoMessages: Grid = [
    ['message_id', 'message_created', 'direction', 'from_number', 'to_number', 'body', 'quo_number'],
    ['M1', '2026-09-01T12:00:00Z', 'incoming', '+13305550111', '+13305550100', 'Running late', 'PN_main'],
    ['M2', '2026-09-01T12:05:00Z', 'outgoing', '+13305550100', '+13305550111', 'Thanks, door code 123456789', 'PN_main'],
    ['M3', '2026-09-10T09:00:00Z', 'incoming', '+13305550111', '+13305550199', 'Payroll question', 'PN_pay'],
    ['M4', '2026-09-11T09:00:00Z', 'incoming', '+13305550112', '+13305550100', 'from the shared phone', 'PN_main'],
    ['M5', '2026-09-12T09:00:00Z', 'incoming', '+13305550999', '+13305550100', 'stranger text', 'PN_main'],
    ['M6', '2026-08-01T09:00:00Z', 'incoming', '+13305550113', '+13305550100', 'Older, from the Master phone, ssn 987 65 4329', 'PN_main'],
  ]
  const hotline: Grid = [
    ['Call ID', 'Transcript Created', 'Event Timestamp', 'Duration (sec)', 'Direction', 'Participant(s)', 'Team Member(s)',
      '# Turns', 'Full Transcript', 'Speaker Transcript'],
    ['AC2', '2026-09-15T14:01:00Z', '2026-09-15T14:00:00Z', 95, 'incoming', '+13305550111', '+13305550100', 2, 'Hello there',
      '[0:00] +13305550111: Hello there.\n[0:03] +13305550100: Hi Noah.'],
    ['AC9', '2026-09-16T14:01:00Z', '2026-09-16T14:00:00Z', 20, 'incoming', '+13305550999', '+13305550100', 1, 'Stranger words', ''],
    ['AC8', '2026-09-17T14:01:00Z', '2026-09-17T14:00:00Z', 20, 'incoming', '+13305550112', '+13305550100', 1, 'Shared words', ''],
  ]
  const quoTranscripts: Grid = [
    ['call_id', 'transcript_created', 'event_at', 'duration_s', 'direction', 'turns', 'participants', 'team_members',
      'full_transcript', 'speaker_transcript'],
    ['AC1', '2026-09-20T16:01:00Z', '2026-09-20T16:00:00Z', 30, 'outgoing', 2, '+13305550111', '+13305550199', 'Payroll call words',
      '[0:00] +13305550199: Payroll here.\n[0:04] +13305550111: Hi.'],
  ]
  const workItems: Grid = [['call_id', 'work_type', 'category'], ['AC1', 'payroll', 'Payroll'], ['AC2', 'callout', 'Scheduling']]
  const events: Grid = [
    ['event_id', 'type', 'actor', 'subject_type', 'subject_key', 'subject_name', 'payload', 'source', 'at', 'tenant'],
    ['E1', 'requirement_state_changed', 'system', 'person', STAFF, 'Noah Reed',
      JSON.stringify({ req_id: 'cpr', prev_state: 'current', state: 'expiring', expires: '2026-10-15' }), 'relay', '2026-09-14T08:00:00Z', ''],
    ['E2', 'staffProfileHr', 'boss@example.org', 'person', STAFF, 'Noah Reed', '{}', 'hub', '2026-09-25T08:00:00Z', ''],
    ['E3', 'requirement_state_changed', 'system', 'person', 'avastone', 'Ava Stone', '{}', 'relay', '2026-09-14T08:00:00Z', ''],
  ]
  // MedDel.gs's house: one flow per person and level; only the person's active ones count
  const meddelFlows: Grid = [
    ['id', 'createdAt', 'updatedAt', 'employeeId', 'employeeName', 'nameKey', 'medLevel', 'certExpDate', 'phone', 'email', 'phase',
      'overallStatus'],
    ['MD1', '', '', 'P1', 'Noah Reed', STAFF, 'Med 1', '2025-01-01', '', '', '3', 'active'],
    ['MD2', '', '', 'P1', 'Noah Reed', STAFF, 'Med 2', '2026-11-01', '', '', '2', 'active'],
    ['MD3', '', '', 'P1', 'Noah Reed', STAFF, 'Med 3', '2026-10-20', '', '', '5', 'complete'],
    ['MD4', '', '', 'P2', 'Ava Stone', 'avastone', 'Med 1', '2026-10-20', '', '', '4', 'active'],
  ]
  // the Employee Database's driving tabs, secrets included, with their real headers
  const driverTab: Grid = [
    ['Employee', 'Status', 'First Name', 'Last Name', 'SSN#', 'Date of Birth', 'Driver', 'DL #', 'Points', 'License Exp Date',
      "Driver's Abstract (Original)", "Driver's Abstract (Latest)", 'Insurance Exp Date'],
    ['Noah Reed', 'Yes', 'Noah', 'Reed', '987-65-4329', '05/17/1990', 'Yes', 'SV347731', 2, '06/30/2027', '01/05/2024', '01/05/2026',
      '10/20/2026'],
    ['Ava Stone', 'Yes', 'Ava', 'Stone', '', '', 'No', '', '', '', 'n/a', '', 'n/a'],
  ]
  const driverCompliance: Grid = [
    ['Employee', 'Status', 'Driver', 'DL #', 'Drivers Abstract Latest', 'Insurance Expiration'],
    ['Noah Reed', 'Yes', 'Suspended', 'SV347731', '01/05/2026', '10/20/2026'],
  ]
  // the Med Del Certs (MAIS) scrape as certReadTab_ keys it: a history per person, the registry id and the day of birth
  const maisRow = (type: string, eff: string, exp: string, status: string) => ({
    timestamp: '2026-09-01 10:00:00', search_first: 'Noah', search_last: 'Reed', search_dob: '05/17/1990', dd_id: 'MA00000001',
    name: 'Noah Reed', dob: '05/17/1990', cert_type: type, effective: eff, expiration: exp, status,
  })
  return {
    driverTab,
    driverCompliance,
    mais: [maisRow('Cat - II', '2/1/2024', '2/1/2026', 'Certified'), maisRow('Cat - I', '1/5/2023', '1/5/2025', 'Expired'),
      maisRow('Cat - I', '1/5/2025', '1/5/2027', 'Certified'), maisRow('Cat - III', '3/1/2026', '3/1/2028', 'ERROR: HTTP 503')] as Row[],
    people: [
      { id: 'P1', name: 'Noah Reed', first_name: 'Noah', last_name: 'Reed', role: 'DSP', status: 'active',
        email: 'noah.reed@example.org', phone: '330-555-0111', phones: ['(330) 555-0112'], employee_id: '' },
      { id: 'P2', name: 'Ava Stone', status: 'active', phone: '330-555-0222' },
      { id: 'P3', name: 'Old Timer', status: 'inactive' },
      { id: 'P4', name: 'Twin Name', status: 'active' },
      { id: 'P5', name: 'twin  name', status: 'active' },
      { id: 'PPL_guardian_gina', name: 'Gina Guardian', guardian_for: 'Kenny Marsh', phone: '330-555-0909' },
      { id: 'P7', name: 'Kenny Marsh', role: 'client' },
      { id: 'P8', name: 'Sam Share', status: 'active', phone: '(330) 555-0112' },
    ] as Row[],
    master: masterGrid(),
    users: [
      { userid: 'U1', email: 'noah.reed@example.org', displayname: 'Noah Reed', role: 'staff', active: 'true',
        lastlogin: '2026-09-20T10:00:00Z', createdat: '2025-01-01T00:00:00Z', phone: '(330) 555-0111',
        phones: '[{"label":"Mobile","number":"(330) 555-0111"}]', emails: 'noah.alt@example.org', avatar: 'https://img/noah.png',
        passhash: 'HASHVALUE123', salt: 'SALTVALUE', mustchange: 'true', candidateid: '' },
    ] as Row[],
    clients: [
      { client_key: 'kenny_marsh', id: 'C1', name: 'Kenny Marsh', house: 'NW4045', home_address: '908 Arlington Ave NW, Canton, OH 44708',
        status: 'active', avatar: 'https://img/kenny.png', medications: ['Secret pill'], diagnoses_text: 'dx words' },
      // no house code and no client_key: placed by the registry street, keyed by the folded name
      { name: 'Lia Gomez', house: '', home_address: '908 Arlington Ave NW, Canton, OH 44708', status: 'active' },
      { client_key: 'mo_new', id: 'C3', name: 'Mo New', house: 'NW4045', status: 'active' },
      { client_key: 'bo_briar', id: 'C4', name: 'Bo Briar', house: 'BW1001', status: 'active' },
    ] as Row[],
    ist: [
      { id: 'IST1', staffName: 'Noah Reed', clientName: 'Kenny Marsh', house: 'NW4045', status: 'done', trainedAt: '2025-02-01',
        dueDate: '2025-02-10', docFileId: 'istpaper0001', docAt: '2025-02-02T00:00:00Z', createdAt: '2025-01-15T00:00:00Z' },
      { id: 'IST2', staffName: 'Noah  Reed', clientName: 'Lia Gomez', house: 'NW4045', status: 'owed', dueDate: '2026-09-01',
        createdAt: '2026-08-01T00:00:00Z' },
      { id: 'IST3', staffName: 'Ava Stone', clientName: 'Bo Briar', house: 'BW1001', status: 'done' },
    ] as Row[],
    istMap: {} as Record<string, string[]>,
    homes: [
      ['abbreviation', 'home_name', 'address', 'region', 'telephone', 'manager_name', 'manager_phone', 'calendar_link', 'thumbnail_url'],
      ['NW4045', 'CAN - NW - NW4045', '908 Arlington Ave NW, Canton, OH 44708', 'Canton', '3305550100', '', '', '', ''],
      ['BW1001', 'CAN - BW - BW1001', '12 Briar Way, Canton, OH 44708', 'Canton', '', '', '', '', ''],
    ] as Grid,
    calendar: [
      ['Location', 'Employee', 'Designation', 'Phone', 'Date', 'Start Time', 'End Time'],
      ['CAN - BW - BW1001', 'Noah Reed', '', '', '01/06/2025', '', ''],
      ['CAN - NW - NW4045', 'Noah Reed', '**', '', '09/20/2026', '07:00', '15:00'],
      ['CAN - NW - NW4045', 'Noah Reed', '', '', '09/22/2026', '07:00', '15:00'],
      ['CAN - NW - NW4045', 'Noah Reed', '', '', '09/30/2026', '07:00', '15:00'],
      ['CAN - NW - NW4045', 'Noah Reed', '', '', '10/02/2026', '07:00', '15:00'],
      ['CAN - NW - NW4045', 'Ava Stone', '***', '', '09/21/2026', '', ''],
    ] as Grid,
    punches: [
      { employee: 'Noah Reed', house: 'NW4045', location_name: '908 Arlington Ave NW', date_iso: '2026-09-27',
        start_time: '2026-09-27T11:00:00Z', end_time: '2026-09-27T19:00:00Z', consumer_1: 'Kenny Marsh',
        consumer_2: 'Stranger Client', comments: 'private words' },
      { employee: 'Ava Stone', house: 'NW4045', date_iso: '2026-09-26' },
    ] as Row[],
    files,
    folders: {
      noahfolder00: { id: 'noahfolder00', name: 'Noah Reed', files: ['i9noahfile01', 'cprcardfile1'], folders: [
        { id: 'bgfolder0000', name: 'Background', files: ['bcinoahfile1'], folders: [] },
      ] },
    } as Record<string, Folder>,
    loose: [{ id: 'resumefile01', name: 'Noah Reed resume.pdf', mime: 'application/pdf', updated: '2023-12-19' },
      // another person whose name ends in this one's: the newest I-9 in the room, never this person's paper
      { id: 'jonoahi9file', name: 'Jonoah Reed Form I-9.pdf', mime: 'application/pdf', updated: '2026-09-20' }],
    formDocs: [{ type: 'CPR / First Aid', certified: '2025-10-15', expires: '2026-10-15', fileId: 'cprformfile1', from: 'form' }],
    uploads: [
      { id: 'UP1', person: 'Noah Reed', cert: 'cpr', reqid: 'cpr', fileid: 'cprupload001', at: '2026-09-20T12:00:00Z', by: 'Noah Reed',
        confirmedat: '' },
      { id: 'UP2', person: 'Ava Stone', cert: 'cpr', reqid: 'cpr', fileid: 'avafile00001', at: '2026-09-20T12:00:00Z', confirmedat: '' },
    ] as Row[],
    certs: {
      [STAFF]: { certs: { dodd: { expires: '2026-10-20', status: 'expiring' }, cpr: { expires: '2026-10-15', status: 'expiring' },
        med1: { expires: '2025-01-01', status: 'expired' } } },
    } as Record<string, { certs: Record<string, { expires: string; status: string }> }>,
    // the Trainings Status tracker, keyed as certReadTab_ keys it; its Status word is its own
    tracker: [
      { name: 'Noah Reed', training: 'DODD 8-Hour Exp', status: 'Renewal assigned', expiration_date: '10/20/2026' },
      { name: 'Noah Reed', training: 'Some other course', status: 'Whatever', expiration_date: '' },
      { name: 'Ava Stone', training: 'CPR Exp Date', status: 'Scheduled', expiration_date: '10/01/2026' },
    ] as Row[],
    requirements: [
      { req_id: 'cpr', label: 'CPR / First Aid', category: 'training', enabled: 'yes', date_source: 'CPR Exp Date', credential: 'cpr' },
      { req_id: 'i9', label: 'Form I-9', category: 'documents' },
      { req_id: 'tb', label: 'TB test', category: 'medical' },
      { req_id: 'med2', label: 'Med Delivery 2', category: 'training', credential: 'med2', enabled: 'yes', date_source: 'Med 2 Exp Date' },
      // switched off in the catalogue: no paper is filed under it
      { req_id: 'mandt', label: 'Mandt', category: 'training', enabled: 'no', date_source: 'Mandt Exp Date' },
      { req_id: 'car_insurance', label: 'Car Insurance', category: 'documents', enabled: 'yes', date_source: 'Insurance Exp Date',
        credential: 'Insurance Exp Date' },
      { req_id: 'nurse_aide', label: 'Nurse Aide Registry', category: 'background', enabled: 'yes' },
    ] as Row[],
    reqStates: {
      hdr: ['person_key', 'person_name', 'req_id', 'state', 'expires', 'days_left'],
      values: [[STAFF, 'Noah Reed', 'cpr', 'expiring', '2026-10-15', '17'], [STAFF, 'Noah Reed', 'i9', 'missing', '', ''],
        [STAFF, 'Noah Reed', 'tb', 'expired', '2026-01-01', ''], ['avastone', 'Ava Stone', 'cpr', 'expired', '', ''],
        [STAFF, 'Noah Reed', 'med2', 'expiring', '2026-11-01', '34']],
    },
    incidents: [
      { id: 'r2', timestamp: '2026-09-20T18:00:00.000Z', your_name: 'Ann Lee', employees_involved: 'Noah Reed, Ava Stone',
        client_name: 'Kenny Marsh', incident_category: 'Minor injury or illness (rash, bruise, small cut), Fall',
        incident_date: '2026-09-20T04:00:00.000Z', summary_of_incident: 'Slipped in the hall' },
      { id: 'r3', timestamp: '2026-09-21T18:00:00.000Z', your_name: 'Bo Diaz', employees_involved: 'Ava Stone', incident_category: 'Fall',
        incident_date: '2026-09-21T04:00:00.000Z' },
    ] as Row[],
    perfNotes: [
      { category: 'Manager note', name: 'Noah Reed', createdat: '2026-01-05T10:00:00Z', src: 'hub:Boss', text: 'Great with Kenny' },
      { category: 'Attendance', name: 'Noah Reed', createdat: '2026-01-06T10:00:00Z', src: 'hub:Boss', text: 'Late once' },
    ] as Row[],
    // the HR tracker (the Staff Issues book's Master tab) as HR keeps it by hand: one resolved matter naming Noah
    hr: [
      ['Date', 'Employees Involved', 'Situation', 'Follow Up', 'Disciplinary Action', 'Result', 'Termination Summary'],
      ['3/2/2026', 'Noah Reed, Ava Stone', 'Raised voices at shift change\nCategory: Conflict\nSeverity: Coaching', 'Talked it through',
        'Monitoring', 'Resolved after coaching', ''],
    ] as Grid,
    tabs: {
      quo_messages: sheetOf(quoMessages), quo_transcripts: sheetOf(quoTranscripts), comm_work_items: sheetOf(workItems),
      events: sheetOf(events), meddel_flows: sheetOf(meddelFlows),
    } as Record<string, ReturnType<typeof sheetOf>>,
    hotline: sheetOf(hotline),
    acting: false,
    created: 0,
    logged: [] as string[],
    cache: new Map<string, string>(),
    // App Control as ViewerScope.gs answers it: the scope each released account is given (the master needs none)
    released: {} as Record<string, Row>,
    // the staff keys hubStaffVisibleForHouses_ names for a house
    visibleAt: { NW4045: [STAFF, 'avastone'] } as Record<string, string[]>,
    // the staff keys hubStaffScheduledForHouses_ names for a house: those on its shifts this week (a client's cut)
    scheduledAt: { NW4045: [STAFF, 'avastone'] } as Record<string, string[]>,
  }
}

function sheetOf(grid: Grid) {
  const width = () => (grid[0] ?? []).length
  const cell = (r: number, c: number) => (grid[r] ?? [])[c] ?? ''
  return {
    grid,
    getLastRow: () => grid.length,
    getLastColumn: width,
    getDataRange: () => ({ getValues: () => grid.map((_, r) => Array.from({ length: width() }, (_, c) => cell(r, c))) }),
    getRange: (r: number, c: number, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r - 1 + i, c - 1 + j))),
      getFormula: () => '',
      setValue: (v: unknown) => {
        while (grid.length < r) grid.push([])
        grid[r - 1][c - 1] = v
      },
    }),
    appendRow: (line: unknown[]) => { grid.push([...line]) },
  }
}

let S = freshStores()

const iter = <T>(list: T[]) => {
  let i = 0
  return { hasNext: () => i < list.length, next: () => list[i++] }
}

function folderOf(f: Folder): unknown {
  return {
    getId: () => f.id,
    getName: () => f.name,
    getFolders: () => iter(f.folders.map(folderOf)),
    getFiles: () => iter(f.files.map((id) => ({
      getId: () => id, getName: () => S.files[id].name, getMimeType: () => S.files[id].mime,
      getLastUpdated: () => new Date('2026-09-01T12:00:00Z'),
    }))),
  }
}

function formatDate(date: Date, tz: string, pattern: string): string {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(date)
  if (pattern === 'yyyy-MM-dd') {
    return `${part({ year: 'numeric' })}-${part({ month: '2-digit' }).padStart(2, '0')}-${part({ day: '2-digit' }).padStart(2, '0')}`
  }
  if (pattern === 'HH:mm') return part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  if (pattern === 'yyyyMMddHH') return formatDate(date, tz, 'yyyy-MM-dd').replace(/-/g, '') + part({ hour: '2-digit', hourCycle: 'h23' })
  throw new Error(`formatDate pattern ${pattern} is not stood in for`)
}

/* ---------- Apps Script, booted ---------- */

type Gs = Record<string, unknown> & {
  HUB_POLICY: Record<string, { file: string; lane: string; params?: Record<string, unknown> }>
  HUB_ACTIONS: Record<string, (payload: unknown, user: unknown) => unknown>
  SP_ACTIONS: string[]
}

const COMPANY_LINES: Record<string, { name: string; e164: string; shared: boolean; humans: number; owner: string }> = {
  '3305550100': { name: 'Main line', e164: '+13305550100', shared: false, humans: 1, owner: 'Ann Lee' },
  '3305550199': { name: 'Payroll', e164: '+13305550199', shared: true, humans: 3, owner: '' },
}
const LINE_BY_QUO: Record<string, string> = { PN_main: '3305550100', PN_pay: '3305550199' }

function boot(): Gs {
  let uuid = 0
  const g: Record<string, unknown> = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN, isFinite, parseInt, Error,
    HUB_POLICY: {}, HUB_ACTIONS: {}, HUB_MEMBER_CTX: null,
    Utilities: {
      formatDate, getUuid: () => `u${++uuid}`,
      base64Encode: (b: number[]) => Buffer.from(b).toString('base64'),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ get: (k: string) => S.cache.get(k) ?? null, put: (k: string, v: string) => { S.cache.set(k, v) } }) },
    DriveApp: {
      getFileById: (id: string) => {
        const f = S.files[id]
        if (!f) throw new Error(`File not found: ${id}`)
        return {
          isTrashed: () => false, getName: () => f.name, getMimeType: () => f.mime, getSize: () => f.bytes.length,
          getBlob: () => ({ getBytes: () => f.bytes }), getAs: () => ({ getBytes: () => PDF }),
        }
      },
      getFolderById: (id: string) => {
        const f = S.folders[id]
        if (!f) throw new Error(`Folder not found: ${id}`)
        return folderOf(f)
      },
    },
    SpreadsheetApp: { openById: (id: string) => ({ getSheetByName: (n: string) => (id === 'HOTBOOK' && n === 'Transcripts' ? S.hotline : null) }) },
    hubIsRealMaster_: (u: Row | null) => !!u && u.email === 'boss@example.org' && !u.visiting_member && !u.is_service,
    hubProfileAppGate_: (appId: string, u: Row | null) => {
      const none = { kind: 'none', client_keys: [], house_codes: [], ssa_keys: [], family_keys: [], why: '' }
      if (!u || u.is_service) return { open: false, scope: none }
      if (u.email === 'boss@example.org' && !u.visiting_member) return { open: true, scope: { ...none, kind: 'master' } }
      const scope = appId === 'staff-profiles' && !u.visiting_member ? S.released[String(u.email)] : undefined
      return scope ? { open: true, scope: { ...none, ...scope } } : { open: false, scope: none }
    },
    hubStaffVisibleForHouses_: (codes: string[]) => ({
      keys: [...new Set((codes ?? []).flatMap((c) => S.visibleAt[c] ?? []))].sort(), why: '',
    }),
    hubStaffScheduledForHouses_: (codes: string[]) => ({
      keys: [...new Set((codes ?? []).flatMap((c) => S.scheduledAt[c] ?? []))].sort(), why: '', week: '2026-09-28',
    }),
    hubQuietNow_: () => new Date(NOW),
    hubProp_: (k: string) => (k === 'HOTLINE_TRANSCRIPTS_ID' ? 'HOTBOOK' : ''),
    hubId_: (k: string) => (k === 'HOTLINE_TRANSCRIPTS_ID' ? 'HOTBOOK' : k === 'HUB_DB_ID' ? 'HUBDB' : k === 'ESTATE_HR_ID' ? 'HRBOOK' : ''),
    cacheRead_: (_scope: string, _name: string, fn: () => unknown) => fn(),
    cacheScopeSheet_: (id: string, tab: string) => `${id}:${tab}`,
    cacheScope_: (t: string) => t,
    cacheVersion_: () => 1,
    cacheBump_: () => {},
    empDbId_: () => 'EMPDB',
    emp360MasterTab_: () => 'Master',
    ssOpen_: (id: string) => ({
      getSpreadsheetTimeZone: () => 'America/New_York',
      getSheetByName: (tab: string) => (id === 'EMPDB'
        ? (tab === 'Master' ? sheetOf(S.master) : tab === 'employee driver' ? sheetOf(S.driverTab)
          : tab === 'Driver Compliance' ? sheetOf(S.driverCompliance) : null)
        : id === 'HOTBOOK' ? (tab === 'Transcripts' ? S.hotline : null)
          : id === 'HRBOOK' ? (tab === 'Master' ? sheetOf(S.hr) : null)
            : tab === 'entity_homes' ? sheetOf(S.homes) : null),
    }),
    listRows_: (r: string) => (r === 'people' ? S.people.map((p) => ({ ...p })) : r === 'istRecords' ? S.ist.slice()
      : r === 'photos' ? [] : (() => { throw new Error(`no store ${r}`) })()),
    peopleMerged_: (rows: Row[]) => rows,
    withoutIspClients_: (rows: Row[]) => rows,
    clientsDerived_: () => S.clients,
    clientPhotoIndex_: () => ({}),
    usersAll_: () => S.users,
    hubCalendarManagers_: () => ({ [STAFF]: ['CAN - NW - NW4045'] }),
    commBroadcastCalendarRows_: () => ({ values: S.calendar, tz: 'America/New_York' }),
    psiPunchesFullSheet_: () => ({}),
    psiPunchesRows_: () => ({ rows: S.punches }),
    estateSource_: (r: string) => ({ id: 'estate', tab: r }),
    estateRows_: (r: string) => (r === 'uiIncidents' ? S.incidents : []),
    userDocsIndex_: () => ({ folders: { [STAFF]: { id: 'noahfolder00' } } }),
    userDocsLooseAll_: () => S.loose,
    profileDriveIndex_: () => ({ folders: {} }),
    profileDriveFiles_: () => [],
    staffDocsFor_: (name: string) => ({ docs: name === 'Noah Reed' ? S.formDocs : [] }),
    complianceDocsRows_: () => S.uploads,
    certLabel_: (k: string) => ({ cpr: 'CPR / First Aid', dodd: 'DODD 8-Hour', med1: 'Medication Delivery 1', med2: 'Medication Delivery 2',
      mandt: 'MANDT', money: 'Money Management', i9: 'Form I-9' } as Record<string, string>)[k] ?? k,
    certPicture_: () => S.certs,
    certMatrixColumns_: () => ['dodd', 'cpr', 'med1', 'med2', 'mandt', 'money'],
    certExpiringDays_: () => 60,
    certTrainingKeys_: () => ({ 'dodd 8-hour exp': 'dodd', 'cpr exp date': 'cpr', 'med 1 exp date': 'med1' }),
    certSourceField_: (f: string) => ({ 'trainings.name': 'name', 'trainings.course': 'training', 'trainings.status': 'status',
      'mais.name': 'name', 'mais.status': 'status', 'mais.expires': 'expiration', 'mais.category': 'cert_type' } as
      Record<string, string>)[f] ?? '',
    certSourceTab_: (which: string) => (which === 'trainings' ? 'Trainings Status' : which === 'mais' ? 'Med Del Certs (MAIS)' : ''),
    // ist_cert_mais_statuses as shipped: certified=certified, ERROR*=skip, *=expired
    certStateOf_: (_key: string, word: string, fallback: string) =>
      (/^certified$/i.test(word.trim()) ? 'certified' : /^error/i.test(word.trim()) ? 'skip' : fallback),
    certReadTab_: (tab: string) => {
      if (tab === 'Med Del Certs (MAIS)') return S.mais.map((r) => ({ ...r }))
      if (tab !== 'Trainings Status') throw new Error(`no estate tab ${tab}`)
      return S.tracker.map((r) => ({ ...r }))
    },
    applicationFor_: () => null,
    packetMirrorRows_: () => [],
    requirementsAll_: () => ({ rows: S.requirements }),
    reqStatesListValues_: () => S.reqStates,
    perfReadSoft_: () => S.perfNotes,
    readTabNormalized_: () => [],
    readAll_: (sheet: ReturnType<typeof sheetOf>) => {
      const [head = [], ...rows] = sheet.getDataRange().getValues()
      return rows.map((line) => Object.fromEntries(head.map((h, i) => [String(h), line[i]])))
    },
    hubLineOurs_: (d: string) => !!COMPANY_LINES[d],
    hubLineRow_: (id: string) => COMPANY_LINES[LINE_BY_QUO[id] ?? id] ?? null,
    hubTabSheet_: (tab: string) => S.tabs[tab] ?? null,
    hubTabEnsure_: (tab: string, header: string[]) => (S.tabs[tab] ??= sheetOf([[...header]])),
    ensureHeader_: (sheet: ReturnType<typeof sheetOf>, keys: string[]) => {
      const head = (sheet.grid[0] ?? []).map(String)
      for (const k of keys) if (!head.includes(k)) head.push(k)
      sheet.grid[0] = head
      return [...head]
    },
    istHouseMap_: () => S.istMap,
    istCertNote_: () => '',
    createRow_: (_r: string, rec: Row) => {
      const row = { ...rec, id: `ISTN${++S.created}` }
      S.ist.push(row)
      return { ...row }
    },
    sheetDbGateHolds_: () => null,
    sheetDbRefused_: () => null,
    beAnotherActive_: () => S.acting,
    hubSysLog_: (_who: string, kind: string, target: string) => { S.logged.push(`${kind}:${target}`); return true },
  }
  const ctx = vm.createContext(g)
  vm.runInContext(HELPERS.map(([file, name]) => lift(file, name)).join('\n'), ctx)
  vm.runInContext(liftDoor('CommCalls.gs', 'commCallsTranscript'), ctx)
  vm.runInContext(lift('CommCalls.gs', 'commCallsTranscriptRead_'), ctx)
  vm.runInContext(gsText('Locations.gs'), ctx)
  vm.runInContext(gsText('RecordEdit.gs'), ctx)
  vm.runInContext(gsText('StaffIssues.gs'), ctx)
  vm.runInContext(gsText('StaffProfiles.gs'), ctx)
  return ctx as unknown as Gs
}

const GS = boot()
const MASTER = { email: 'boss@example.org', role: 'admin', display_name: 'Boss' }
const DIRECTOR = { email: 'dee@example.org', role: 'admin', display_name: 'Dee Rector' }
let SESSION: Row = MASTER

/* ---------- the page's calls, answered by the doors ---------- */

const calls: { action: string; payload: Row }[] = []
const answers: string[] = []
const realFetch = globalThis.fetch

before(() => {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : ''
    const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: Row }
    calls.push({ action: env.action, payload: env.payload ?? {} })
    const door = GS.HUB_ACTIONS[env.action]
    const out = JSON.stringify(door ? door(JSON.parse(JSON.stringify(env.payload ?? {})), SESSION) : { status: 404, message: 'Unknown action.' })
    answers.push(out)
    return new Response(out)
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => {
  S = freshStores()
  SESSION = MASTER
  forgetStaffReads()
})

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

function walk(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n)
    return statSync(resolve(ROOT, p)).isDirectory() ? walk(p) : [p]
  })
}

/** The houses slice's row for a house, as the Assign Training form picks it. */
const sliceHouse = (code: string, title: string, clients: HouseClient[]): Pick<HouseRow, 'code' | 'title' | 'active' | 'clients'> =>
  ({ code, title, active: true, clients })

describe('the names', () => {
  it('every Staff door the page names is a StaffProfiles.gs action, and every StaffProfiles.gs action has a caller', () => {
    const named = new Set<string>()
    for (const f of walk('src/pages/features/staffprofiles')) {
      for (const m of readFileSync(resolve(ROOT, f), 'utf8').matchAll(/gasAction(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) named.add(m[1])
    }
    // an edition holder's panel read, the note edit, a concluded documentation mark and an IST recorded from Related
    // Clients are Python's alone (app/doors.json)
    const py: Record<string, { file: string }> = JSON.parse(readFileSync(resolve(ROOT, 'app/doors.json'), 'utf8'))
    const pyStaff = [...named].filter((n) => n.startsWith('staffProfile') && py[n]).sort()
    assert.deepEqual(pyStaff, ['staffProfileDocConclude', 'staffProfileEditRead', 'staffProfileIstAdd', 'staffProfileNoteEdit'])
    assert.equal(py.staffProfileEditRead.file, 'app/staff.py')
    assert.equal(py.staffProfileNoteEdit.file, 'app/staff_writes.py')
    assert.equal(py.staffProfileDocConclude.file, 'app/staff_writes.py')
    assert.equal(py.staffProfileIstAdd.file, 'app/staff_writes.py')
    assert.equal(GS.HUB_ACTIONS.staffProfileEditRead, undefined, 'no Apps Script handler')
    assert.equal(GS.HUB_ACTIONS.staffProfileNoteEdit, undefined, 'no Apps Script handler')
    assert.equal(GS.HUB_ACTIONS.staffProfileDocConclude, undefined, 'no Apps Script handler')
    assert.equal(GS.HUB_ACTIONS.staffProfileIstAdd, undefined, 'no Apps Script handler')
    const own = [...named].filter((n) => n.startsWith('staffProfile') && !py[n])
    for (const name of own) {
      assert.equal(GS.HUB_POLICY[name]?.file, 'StaffProfiles.gs', `${name} is declared in StaffProfiles.gs`)
      assert.equal(typeof GS.HUB_ACTIONS[name], 'function', `${name} has a handler`)
    }
    assert.deepEqual(own.sort(), [...GS.SP_ACTIONS].sort())
    const reused = [...named].filter((n) => !n.startsWith('staffProfile')).sort()
    assert.deepEqual(reused, ['certDocFile', 'certDocRead', 'certDocUpload', 'certUploadConfirm', 'certUploadRecord', 'editionsMine',
      'releaseUser', 'releaseUserStatus', 'userInvite', 'userUpdate'],
    'only the account doors Users and Release Users send, the certificate doors My Profile files and confirms with, and the editions this viewer makes')
    const everyGs = readdirSync(resolve(ROOT, 'apps-script')).filter((f) => f.endsWith('.gs')).map(gsText).join('\n')
    for (const name of reused) assert.ok(everyGs.includes(`\nHUB_POLICY.${name} = {`), `${name} is a declared door`)
    const catalogue = readFileSync(resolve(ROOT, 'src/lib/actions.generated.ts'), 'utf8')
    for (const name of named) assert.ok(catalogue.includes(`"${name}"`), `${name} is in the generated catalogue`)
  })

  it('the Med Del phase words are the Med Del page\'s own', () => {
    const page = readFileSync(resolve(ROOT, 'src/pages/features/meddel/MedDelPage.tsx'), 'utf8')
    const block = /const PHASE_LABEL[^{]*\{([^}]*)\}/.exec(page)?.[1] ?? ''
    const theirs = Object.fromEntries([...block.matchAll(/'(\d)':\s*'\d · ([^']+)'/g)].map((m) => [m[1], m[2]]))
    assert.equal(Object.keys(theirs).length, 5, block)
    assert.deepEqual(JSON.parse(JSON.stringify(GS.SP_MEDDEL_PHASES)), theirs)
  })

  it('a session that is not the master in its own gets the platform\'s "Unknown action.", which the page says as a sentence', async () => {
    SESSION = DIRECTOR
    await assert.rejects(readOverview(STAFF), (err: Error) => readRefusal(err.message) === NOT_PUBLISHED)
    SESSION = { ...MASTER, visiting_member: 'mem_1' }
    await assert.rejects(readRoster(false), (err: Error) => readRefusal(err.message) === NOT_PUBLISHED)
  })
})

describe('the reads, as the page reads them', () => {
  it('roster: staff only, one row per folded name; a shared name is listed but never opened; the inactive only when asked', async () => {
    const r = rosterOf(await readRoster(false))
    assert.deepEqual(r.staff.map((s) => [s.key, s.status, s.ambiguous]), [
      ['avastone', 'active', false], [STAFF, 'active', false], ['samshare', 'active', false], ['twinname', 'other', true]])
    assert.deepEqual(r.counts, { active: 4, inactive: 1, ambiguous: 1 })
    const noah = r.staff.find((s) => s.key === STAFF)
    assert.deepEqual([noah?.employee_id, noah?.role, noah?.avatar], ['ASA-1060', 'DSP', 'https://img/noah.png'])
    assert.equal(defaultStaff(r.staff)?.key, 'avastone', 'the screen opens on someone it can open')
    const all = rosterOf(await readRoster(true))
    assert.deepEqual(all.staff.filter((s) => s.status === 'inactive').map((s) => s.key), ['oldtimer'])
    await assert.rejects(readOverview('twinname'), /Two staff records share this name/)
    await assert.rejects(readOverview('ginaguardian'), /No staff member/)
    await assert.rejects(readOverview('kennymarsh'), /No staff member/)
  })

  it('overview: every phone and e-mail on its own line; the clients as identity only; the houses, the ISTs, the open notes', async () => {
    const raw = await readOverview(STAFF)
    assert.ok(!/medications|diagnoses|home_address/.test(JSON.stringify(raw)), 'no clinical or address field of a client')
    const o = overviewOf(raw)
    assert.deepEqual(o.person.phones.map((p) => [p.label, p.value]),
      [['Mobile', '(330) 555-0111'], ['Phone', '(330) 555-0112'], ['Phone', '(330) 555-0113']])
    assert.deepEqual(o.person.emails.map((e) => e.value), ['noah.reed@example.org', 'noah.alt@example.org', 'noah.home@example.org'])
    assert.deepEqual([o.person.employee_id, o.person.employee_id_source, o.person.start_date, o.person.status],
      ['ASA-1060', 'master', '2024-01-10', 'active'])
    // the .gs still ties a client by an IST; the page reads only what Python ties by (a punch, a shift at their home)
    assert.deepEqual(o.clients.map((c) => [c.name, c.client_key, c.via]), [
      ['Kenny Marsh', 'kenny_marsh', ['punches', 'house']], ['Lia Gomez', 'liagomez', ['house']], ['Mo New', 'mo_new', ['house']]])
    assert.deepEqual(o.houses.map((h) => [h.code, h.current, h.hm]), [['NW4045', true, true], ['BW1001', false, false]])
    assert.equal(o.houses[0].address, '908 Arlington Ave NW, Canton, OH 44708', 'the map has an address to draw')
    assert.deepEqual(o.ist.map((i) => [i.client_name, i.status, i.house, i.doc_id]), [
      ['Kenny Marsh', 'done', 'NW4045', 'istpaper0001'], ['Lia Gomez', 'owed', 'NW4045', '']])
    assert.equal(o.notesOpen, 0)
    assert.match(o.why, /1 client name\(s\) on the IST records or punches match no client record/)
    assert.equal(o.degraded, false)
  })

  it('overview: the driving record and the MAIS lines ride the same answer, with the licence masked and no birth day or registry id', async () => {
    const raw = await readOverview(STAFF)
    const parts = JSON.stringify([(raw as Record<string, unknown>).driving, (raw as Record<string, unknown>).med_del])
    for (const s of ['1990-05-17', '05/17/1990', 'MA00000001', 'dd_id', 'dob', 'ssn']) assert.ok(!parts.includes(s), `${s} in ${parts}`)
    const { driving: d, medDel: m } = overviewOf(raw)
    assert.deepEqual([d?.found, d?.driver, d?.points, d?.dlLast4, d?.licenseExpires, d?.abstractOriginal, d?.abstractLatest,
      d?.insuranceExpires, d?.source, d?.unread, d?.degraded], [true, true, 2, '•••• 7731', '2027-06-30', '2024-01-05', '2026-01-05',
      '2026-10-20', 'employee driver', [], false])
    assert.deepEqual(d?.standing, { word: 'Suspended', state: 'invalid', source: 'Driver Compliance' })
    assert.equal(d?.driverStanding, null, 'employee driver says only "Yes": nothing to keep beside the standing')
    assert.deepEqual(m?.certs.map((c) => [c.level, c.effective, c.expires, c.status, c.expired, c.older]), [
      ['Cat - I', '2025-01-05', '2027-01-05', 'certified', false, 1], ['Cat - II', '2024-02-01', '2026-02-01', 'certified', true, 0]])
    assert.deepEqual([m?.history, m?.matchedBy, m?.source, m?.degraded], [1, 'name', 'Med Del Certs (MAIS)', false])
    const ava = overviewOf(await readOverview('avastone'))
    assert.deepEqual([ava.driving?.found, ava.driving?.driver, ava.driving?.standing, ava.medDel?.certs.length, ava.medDel?.why],
      [true, false, null, 0, ''])
  })

  it('shifts: the house view inverted — days, the HM badge, what is scheduled ahead as weekday patterns', async () => {
    const s = shiftsOf(await readShifts(STAFF))
    assert.deepEqual(s.days.map((d) => [d.date, d.house, d.designation, d.source]), [
      ['2026-09-27', 'NW4045', '', 'punches'], ['2026-09-22', 'NW4045', '', 'archive'], ['2026-09-20', 'NW4045', 'hm', 'archive']])
    assert.deepEqual(s.upcoming.map((u) => u.date), ['2026-09-30', '2026-10-02'])
    assert.deepEqual(s.patterns.map((p) => [p.house, p.weekdays, p.start, p.end]), [['NW4045', ['Wed', 'Fri'], '07:00', '15:00']])
    assert.deepEqual([s.sources.archive.readable, s.sources.punches.readable, s.degraded], [true, true, false])
  })

  it('employment: the Master\'s hiring, dates and qualifications; the resume opens because its file is the person\'s', async () => {
    const e = employmentOf(await readEmployment(STAFF))
    assert.equal(referralPaidWords(e.hiring), 'Yes · May 01, 2025')
    assert.deepEqual([e.hiring.referral, e.hiring.job_app_date, e.hiring.attestation_date], ['Rae Ref', '2023-12-20', '2023-12-21'])
    assert.deepEqual(e.dates, { start_doc: '2024-01-02', start_first_day: '2024-01-10', end_last_day: '' })
    assert.equal(endDayWords(e.dates.end_last_day, 'active'), 'Not applicable · Active')
    assert.deepEqual([diplomaWords(e.qualifications.hs_diploma), e.qualifications.driver.approved], ['Verified', true])
    assert.deepEqual(e.hiring.resume, { flag: 'yes', doc_id: 'resumefile01' })
    const file = await readDocFile(STAFF, e.hiring.resume.doc_id)
    assert.equal(docShapeOf(file.mime), 'pdf')
  })

  it('documents: the Master\'s papers and every file; each row with a file opens as bytes, a paper with none has no arrow', async () => {
    const d = documentsOf(await readDocuments(STAFF))
    const byTitle = Object.fromEntries(d.docs.map((x) => [x.title, x]))
    assert.deepEqual(['Job application', 'Resume', 'Form I-9', 'Pay authorization form', 'HS diploma / GED'].map((t) =>
      [t, byTitle[t]?.status, byTitle[t]?.fileId]), [
      ['Job application', 'signed', ''], ['Resume', 'on_file', 'resumefile01'], ['Form I-9', 'verified', 'i9noahfile01'],
      ['Pay authorization form', 'partial', ''], ['HS diploma / GED', 'verified', '']])
    assert.equal(byTitle['Form I-9'].expires, '2027-06-30')
    assert.equal(byTitle['BCI result.pdf'].category, 'background', 'the Background folder names the category')
    assert.equal(byTitle['IST — Kenny Marsh'].fileId, 'istpaper0001')
    for (const doc of d.docs.filter((x) => !x.fileId)) {
      assert.equal(docOpens(doc), false, `${doc.title}: no file, no arrow`)
      assert.match(doc.id, /^master:/)
    }
    const opens = d.docs.filter(docOpens)
    assert.deepEqual(opens.map((x) => x.fileId).sort(),
      ['bcinoahfile1', 'cprcardfile1', 'cprformfile1', 'cprupload001', 'i9noahfile01', 'istpaper0001', 'resumefile01'])
    for (const doc of opens) {
      const got = await readDocFile(STAFF, doc.fileId)
      assert.ok(docShapeOf(got.mime) && blobOf(got), `${doc.title} opens in the platform (${got.mime})`)
    }
    await assert.rejects(readDocFile(STAFF, 'avafile00001'), /names no such document/, 'another person\'s file is refused')
    await assert.rejects(readDocFile(STAFF, 'jonoahi9file'), /names no such document/,
      'a loose file whose name only contains the letters of this name is another person\'s')
    await assert.rejects(readDocFile(STAFF, 'master:job_app'), /a Drive file id/)
  })

  it('compliance: every course current or not, a known person with no dated row is "no date", never current; credentials; screening', async () => {
    const c = complianceOf(await readCompliance(STAFF))
    assert.deepEqual(c.training.map((t) => [t.id, t.state]), [
      ['dodd', 'due_soon'], ['cpr', 'in_review'], ['med1', 'expired'], ['med2', 'renewal_assigned'], ['mandt', 'no_date'], ['money', 'no_date']])
    assert.deepEqual(c.training.map((t) => t.label).slice(0, 2), ['DODD 8-Hour', 'CPR / First Aid'])
    // the Med Del flows and the tracker's own word, drawn under each course as the page draws them
    assert.deepEqual(c.training.map(trainingSub), [
      'Renewal assigned', 'A certificate is waiting for review', 'Renewal assigned · Phase 3 · Relias training',
      'Phase 2 · Application received', '', ''])
    assert.deepEqual(c.training[2].renewal, { phase: '3', phaseLabel: 'Relias training', level: 'Med 1' })
    assert.ok(!JSON.stringify(c.training).includes('Scheduled') && !JSON.stringify(c.training).includes('Whatever'),
      'another person\'s tracker word, or a course the tracker keys do not name, is never drawn')
    assert.equal(c.degraded, false)
    assert.deepEqual(c.credentials.map((x) => [x.id, x.state]), [['driver_license', 'current'], ['car_insurance', 'due_soon'], ['nurse_aide', 'na']])
    // the File training document picker: by the catalogue's requirement id, named with the Master column the date lands in
    assert.deepEqual(filingCourses(c).map((x) => [x.reqId, x.group, courseWords(x), x.dateRole, x.confirmWhy]), [
      ['cpr', 'Training', 'CPR / First Aid — CPR Exp Date', 'expires', ''],
      ['med2', 'Training', 'Medication Delivery 2 — Med 2 Exp Date', 'expires', 'Med Delivery dates are written by the MAIS registry check, not here.'],
      ['car_insurance', 'Credentials', 'Auto insurance — Insurance Exp Date', 'expires', ''],
    ], 'a course the catalogue switched off or does not list, and a registry check, take no paper')
    // the person's paper filed and not yet confirmed, offered to continue from — narrowed, never its link or its file
    assert.deepEqual(c.papers.map((p) => [p.id, p.reqId, p.at]), [['UP1', 'cpr', '2026-09-20T12:00:00Z']])
    assert.deepEqual(waitingPapers(c.papers, filingCourses(c)).map((w) => [w.paper.id, w.course.reqId]), [['UP1', 'cpr']])
    const raw = JSON.stringify(await readCompliance(STAFF))
    assert.ok(!raw.includes('cprupload001') && !raw.includes('UP2'), 'no file id, and no one else\'s paper')
    assert.deepEqual(c.screening.map((x) => [x.id, x.state, x.date]), [
      ['federal', 'clear', '2024-01-03'], ['state_registries', 'clear', '2024-01-03'], ['bci_fbi', 'clear', '2024-01-04']])
    assert.equal(c.screening[2].rapbackDate, '2024-01-08')
    assert.equal(c.windowDays, 60)
  })

  it('HR admin: masked where it is read, drawn by the page\'s own mask guard, and every view logged', async () => {
    const h = hrOf(await readHr(STAFF))
    assert.deepEqual([h.personal.ssn_masked, h.driver.license_masked], ['•••-••-4329', 'OH •••• 7731'])
    assert.deepEqual([h.personal.dob, h.personal.city, h.personal.zip], ['1990-05-17', 'Canton', '44708'])
    assert.equal(cellWords(h.work_auth.i9_type_2_exp), 'Not applicable')
    assert.deepEqual(h.screening.map((s) => s.id), ['sam', 'oig', 'abuser', 'sex_offender', 'offender', 'nurse_aide', 'exclusions', 'bci_fbi'])
    assert.equal(screenWords(h.screening[5]), 'Not applicable')
    assert.equal(screenWords(h.screening[0]), 'Clear · Jan 03, 2024')
    assert.equal(h.screening[7].refMasked, 'BMT•••••789')
    assert.deepEqual([h.account?.user_id, h.account?.login, h.account?.active], ['U1', 'noah.reed@example.org', true])
    assert.deepEqual(S.logged, [`staffProfileHr:${STAFF}`])
  })

  it('actions: the pendencies in the page\'s order; a Med Del renewal at its phase; every "Review" opens a file the door serves', async () => {
    const a = actionsOf(await readActions(STAFF))
    assert.deepEqual(a.items.map((i) => [i.id, i.status, i.flow, i.action.kind]), [
      ['req:i9', 'needs_attention', 'Document renewal', 'none'], ['meddel:MD1', 'needs_attention', 'Med Del renewal', 'none'],
      ['ist:IST2', 'needs_attention', 'IST training', 'none'], ['req:cpr', 'due_soon', 'Training renewal', 'doc'],
      ['req:med2', 'due_soon', 'Med Del renewal', 'none'], ['upload:UP1', 'in_review', 'Certificate review', 'doc']])
    assert.deepEqual(a.items.filter((i) => i.flow === 'Med Del renewal').map((i) => [i.item, i.date, i.phase]), [
      ['Medication Delivery 1', '2025-01-01', 'Phase 3 · Relias training'], ['Med Delivery 2', '2026-11-01', 'Phase 2 · Application received']],
    'a course the requirements already list is one row, at the flow\'s phase; a complete flow or another person\'s never')
    assert.equal(a.items[2].action.house, 'NW4045')
    assert.deepEqual(a.items.map(actionButton), ['', '', '', 'Review document', '', 'Review certificate'])
    assert.deepEqual(a.counts, { needs_attention: 3, due_soon: 2, in_review: 1 })
    for (const item of a.items.filter((i) => i.action.kind === 'doc')) {
      const got = await readDocFile(STAFF, item.action.docId)
      assert.ok(blobOf(got), `${item.item} opens`)
    }
  })

  it('activity: the year\'s timeline — ISTs, requirements, HR views, uploads, incidents, the schedule; never an incident\'s words', async () => {
    const raw = await readActivity(STAFF)
    const a = activityOf(raw)
    const kinds = new Set(a.events.map((e) => e.kind))
    for (const k of ['ist_assigned', 'requirement', 'hr_view', 'upload', 'incident', 'scheduled'] as const) assert.ok(kinds.has(k), k)
    assert.ok(a.events.some((e) => e.title === 'CPR / First Aid: current → expiring'))
    assert.ok(a.events.some((e) => e.title === 'Scheduled — NW4045 · Wed, Fri · 07:00–15:00'))
    assert.ok(a.events.some((e) => e.kind === 'incident' && e.detail === 'named in the report'))
    assert.ok(!a.events.some((e) => /Kenny Marsh/.test(e.title) && e.kind === 'ist_assigned'), 'a row older than a year is left out')
    assert.deepEqual([a.visits, a.visitsTotal], [[], 0])
  })

  it('texts: one conversation per company line, the newest first; a shared phone and a stranger are never attributed; paging by `before`', async () => {
    const first = textsOf(await readTexts(STAFF))
    assert.deepEqual(first.counterparts.map((c) => [c.id, c.label, c.owner, c.count]), [
      ['3305550199', 'Payroll', '', 1], ['3305550100', 'Main line', 'Ann Lee', 3]])
    assert.equal(first.with, '3305550199')
    assert.deepEqual(first.messages.map((m) => m.id), ['M3'])
    assert.match(first.why, /1 phone number\(s\) on this record also belong to someone else/)
    assert.equal(first.phonesMatched, 2)
    const main = textsOf(await readTexts(STAFF, '3305550100'))
    assert.deepEqual(main.messages.map((m) => [m.id, m.dir, m.by]), [['M2', 'out', 'Ann Lee'], ['M1', 'in', 'Noah Reed'], ['M6', 'in', 'Noah Reed']])
    assert.match(main.messages[0].body, /\[withheld\]/, 'a nine-digit run never leaves')
    assert.deepEqual(main.coverage.gaps, [{ from: '2026-08-02', to: '2026-08-31' }])
    const older = textsOf(await readTexts(STAFF, '3305550100', olderCursor(main.messages.slice(0, 2))))
    assert.deepEqual(older.messages.map((m) => m.id), ['M6'])
    assert.deepEqual(threadOrder(main.messages.slice(0, 2), older.messages).map((m) => m.id), ['M6', 'M1', 'M2'])
  })

  it('transcripts: the calls by day and category from both houses; one call\'s words only through the door, with speakers', async () => {
    const t = transcriptsOf(await readTranscripts(STAFF))
    assert.deepEqual(t.calls.map((c) => [c.callId, c.kind, c.categories, c.line]), [
      ['AC1', 'payroll', ['Payroll'], '+13305550199'], ['AC2', 'callout', ['Scheduling'], '+13305550100']])
    assert.deepEqual(t.categories, [{ name: 'Payroll', count: 1 }, { name: 'Scheduling', count: 1 }])
    assert.deepEqual(callsByDay(t.calls, 'Scheduling').map((d) => d.calls.map((c) => c.callId)), [['AC2']])
    const words = transcriptOf(await readTranscript(STAFF, 'AC2'))
    assert.deepEqual([words.callId, words.hasWords, words.durationSec], ['AC2', true, 95])
    const turns = parseSpeakerTranscript(words.speaker, words.line, ['(330) 555-0111'])
    assert.deepEqual(turns.map((x) => x.role), ['caller', 'agent'])
    await assert.rejects(readTranscript(STAFF, 'AC9'), /no such call/, 'a stranger\'s call is not this person\'s')
    await assert.rejects(readTranscript(STAFF, 'AC8'), /no such call/, 'a call from a shared phone is not attributed')
  })

  it('performance: the score over the parts with data, its formula said; the courses, the documentation and the HR tracker\'s own rows', async () => {
    const p = performanceOf(await readPerformance(STAFF))
    assert.equal(p.windowDays, 90)
    assert.deepEqual(p.score.parts.map((x) => [x.id, x.value, x.weight]), [['mandatory', 0, 30], ['documentation', 50, 30]],
      'no on-time start on record: attendance is no part of the score, never a zero')
    assert.equal(p.score.value, 25)
    assert.match(p.score.formula, /HR matters are never scored/)
    assert.deepEqual(p.attendance.rows.map((r) => [r.date, r.status, r.scheduledStart]), [['2026-09-22', 'no_punch', '07:00'],
      ['2026-09-20', 'no_punch', '07:00']])
    assert.deepEqual(p.training.mandatory.map((t) => [t.id, t.state, t.expires]), [['cpr', 'in_review', '2026-10-15'],
      ['dodd', 'due_soon', '2026-10-20']])
    assert.deepEqual(p.training.valueAdd.filter((t) => t.id.startsWith('ist_')).map((t) => [t.label, t.state]),
      [['IST · Kenny Marsh', 'current'], ['IST · Lia Gomez', 'overdue']])
    assert.deepEqual(p.documentation.exceptions.map((x) => [x.date, x.area, x.status]), [['2026-09-27', 'daily_notes', 'missing']])
    assert.deepEqual(p.hr.rows.map((r) => [r.date, r.title, r.category, r.severity, r.decision, r.status]),
      [['2026-03-02', 'Raised voices at shift change', 'Conflict', 'Coaching', 'Monitoring', 'resolved']])
    assert.deepEqual([p.hr.connected, p.hr.open], [true, 0])
    assert.ok(!p.needs.some((n) => n.area === 'HR & conduct'), 'a resolved matter is not a need')
  })
})

describe('the writes, as the page files them', () => {
  it('the record edit: a Master field lands on its own column and reads back; a stale witness is 409 with what the cell holds; the rename, the payroll id and the protected fields are refused; the log names fields, never a contact value; another admin is refused', async () => {
    const head = (S.master[0] as unknown[]).map(String)
    const first = head.indexOf('Start Date (first day)'), doc = head.indexOf('Start Date(doc)'), zip = head.indexOf('Zip')
    const view = staffEditViewOf('employment', await readEmployment(STAFF))
    assert.equal(view.edit.start_first_day, '01/10/2024', 'the raw cell, as the witness reads it')
    const got = await editStaff(STAFF, [{ field: 'start_first_day', value: '2024-01-12', expected: view.edit.start_first_day }])
    assert.deepEqual(editAnswerOf(got), { written: ['start_first_day'], refused: [] })
    assert.deepEqual([S.master[1][first], S.master[1][doc]], ['2024-01-12', '01/02/2024'], 'its own column: the two start dates fold to one key')
    assert.equal(employmentOf(await readEmployment(STAFF)).dates.start_first_day, '2024-01-12')

    // out of the vm's realm, as the wire carries it
    const stale = JSON.parse(JSON.stringify(GS.HUB_ACTIONS.staffProfileEdit({ key: STAFF, changes: [{ field: 'zip', value: '44709',
      expected: '44000' }] }, MASTER))) as { status: number; data: { current: Record<string, string>; written: string[] } }
    assert.deepEqual([stale.status, stale.data.current, stale.data.written, S.master[1][zip]], [409, { zip: '44708' }, [], '44708'])

    const shut = editAnswerOf(await editStaff(STAFF, ['first_name', 'employee_id', 'role', 'ssn', 'dob', 'dl', 'bci_fbi'].map((field) =>
      ({ field, value: 'x', expected: '' }))))
    assert.deepEqual([shut.written, shut.refused.map((r) => r.field)], [[], ['first_name', 'employee_id', 'role', 'ssn', 'dob', 'dl', 'bci_fbi']])
    assert.ok(shut.refused.every((r) => r.why.length > 10))

    const prof = staffEditViewOf('profile', await readOverview(STAFF))
    S.logged = []
    await editStaff(STAFF, [{ field: 'phone', value: '(330) 555-0177', expected: prof.edit.phone }])
    assert.equal(S.master[1][head.indexOf('Phone Number')], '(330) 555-0177')
    assert.ok(S.logged.includes(`staffProfileEdit:${STAFF}: phone`), S.logged.join(' | '))
    assert.ok(!S.logged.some((l) => l.includes('555-0177') || l.includes('555-0113')), 'no contact value in the log')

    SESSION = DIRECTOR
    await assert.rejects(editStaff(STAFF, [{ field: 'zip', value: '1', expected: '44708' }]), /Unknown action/)
    const one = [{ field: 'x', value: '1', expected: '' }]
    await assert.rejects(renameStaff(STAFF, one), /Unknown action/)
    await assert.rejects(editDriving(STAFF, one), /Unknown action/)
    await assert.rejects(editMais(STAFF, 'Cat 1', one), /Unknown action/)
    await assert.rejects(editIst(STAFF, 'ISTN1', one), /Unknown action/)
    await assert.rejects(savePreferences(STAFF, {}, ''), /Unknown action/)
    // the preferences read answers a house not set up as such, never an error loop
    SESSION = MASTER
    await readPreferences(STAFF).catch(() => null)
    assert.equal(S.master[1][zip], '44708')
  })

  it('staff notes: filed, read back, resolved; the staff key rides as the witness', async () => {
    const got = await addNote({ staff: STAFF, category: 'training', priority: 'high', details: 'Needs MANDT refresher' })
    assert.equal(writeQueued(got), false, 'the door\'s own answer is the note, not a ledger receipt')
    const n = notesOf(await readNotes(STAFF))
    assert.deepEqual(n.notes.map((x) => [x.category, x.priority, x.details, x.state, x.by]),
      [['training', 'high', 'Needs MANDT refresher', 'open', 'Boss']])
    assert.deepEqual(n.earlier.map((x) => [x.by, x.details]), [['Boss', 'Great with Kenny']], 'only the earlier manager notes')
    assert.equal(overviewOf(await readOverview(STAFF)).notesOpen, 1)
    await setNoteState(n.notes[0].id, 'resolved', STAFF)
    assert.equal(notesOf(await readNotes(STAFF)).notes[0].state, 'resolved')
    await assert.rejects(setNoteState(n.notes[0].id, 'open', 'avastone'), /belongs to another staff member/)
    const a = activityOf(await readActivity(STAFF))
    assert.ok(a.events.some((e) => e.kind === 'note' && e.title === 'Note added — training'))
  })

  it('a new HR issue: one row on the HR tracker, Under review, with its category and severity; Performance reads it back open', async () => {
    const day = '2026-09-25'
    await assert.rejects(addHrIssue({ staff: STAFF, date: day, severity: 'Shouting', category: 'Conduct', summary: 'x', details: 'y' }),
      /severity: one of Coaching/)
    await assert.rejects(addHrIssue({ staff: STAFF, date: '2999-01-01', severity: 'Coaching', category: 'Conduct', summary: 'x',
      details: 'y' }), /never a later one/)
    assert.equal(S.hr.length, 2, 'a refused draft writes nothing')
    await readPerformance(STAFF)
    const got = await addHrIssue({ staff: STAFF, date: day, severity: 'Verbal warning', category: 'Dress code',
      summary: 'Came in without the badge', details: 'Second time this month.', action: 'Badge reminder', next_review: '2026-10-15' })
    assert.equal(writeQueued(got), false)
    const head = (S.hr[0] as unknown[]).map(String)
    const row = S.hr[2] as unknown[]
    assert.deepEqual(['Date', 'Employees Involved', 'Result'].map((h) => row[head.indexOf(h)]), ['9/25/2026', 'Noah Reed', 'Under review'])
    assert.equal(row[head.indexOf('Situation')], 'Came in without the badge\nSecond time this month.\nCategory: Dress code\nSeverity: Verbal warning')
    assert.equal(row[head.indexOf('Follow Up')], 'Badge reminder\nNext review: 2026-10-15')
    const p = performanceOf(await readPerformance(STAFF))
    assert.deepEqual(p.hr.rows.map((r) => [r.date, r.title, r.category, r.severity, r.status, r.nextReview]), [
      [day, 'Came in without the badge', 'Dress code', 'Verbal warning', 'under_review', '2026-10-15'],
      ['2026-03-02', 'Raised voices at shift change', 'Conflict', 'Coaching', 'resolved', '']], 'the write retired the read it changed')
    assert.equal(p.hr.open, 1)
    assert.ok(p.needs.some((n) => n.area === 'HR & conduct' && n.status === 'Under review'))
    assert.equal(p.score.value, 25, 'an HR matter never moves the score')
    SESSION = DIRECTOR
    await assert.rejects(addHrIssue({ staff: STAFF, date: day, severity: 'Coaching', category: 'Conduct', summary: 'x', details: 'y' }),
      /Unknown action/)
    assert.equal(S.hr.length, 3)
  })

  it('a training request is an open training note on the person, read back on Performance; a manager assigns it too', async () => {
    const got = await requestTraining({ staff: STAFF, priority: 'high', details: 'MANDT refresher before the next shift' })
    assert.equal(writeQueued(got), false)
    const asked = performanceOf(await readPerformance(STAFF)).training.requests
    assert.deepEqual(asked.map((q) => [q.priority, q.details, q.by, q.self]), [['high', 'MANDT refresher before the next shift', 'Boss', false]])
    assert.deepEqual(notesOf(await readNotes(STAFF)).notes.map((n) => [n.category, n.state]), [['training', 'open']])
    // an HM badge, worn or derived from the calendar, ranks as a manager: no Staff release is needed for this one door
    SESSION = { email: 'hank@example.org', role: 'staff', display_name: 'Hank Manager', types: ['HM'] }
    await requestTraining({ staff: 'avastone', priority: 'normal', details: 'CPR renewal' })
    SESSION = MASTER
    assert.deepEqual(notesOf(await readNotes('avastone')).notes.map((n) => [n.category, n.by]), [['training', 'Hank Manager']])
  })

  it('a note filed from the page is on the section at once: the write forgets the person and the section reads again', async () => {
    const h = mountHook(() => useStaffRead(readKey('staffProfileNotes', STAFF), () => readNotes(STAFF), notesOf), {})
    await h.settle(() => h.current.status === 'ready')
    assert.equal(h.current.data?.notes.length, 0)
    const got = await addNote({ staff: STAFF, priority: 'normal', details: 'Covered a double' })
    h.run(() => { staffWrote(STAFF, got) })
    await h.settle(() => (h.current.data?.notes.length ?? 0) === 1 && !h.current.refreshing)
    assert.equal(h.current.data?.notes[0].details, 'Covered a double')
    h.unmount()
  })

  it('visits: a section opened is one row in the house, shown under Activity; an acting session records nothing', async () => {
    recordVisit(STAFF, 'hr')
    await settle()
    const rows = S.tabs.staff_profile_visits?.grid ?? []
    assert.equal(rows.length, 2)
    const a = activityOf(await readActivity(STAFF))
    assert.deepEqual(a.visits.map((v) => [v.visitor, v.section]), [['Boss', 'hr']])
    assert.equal(a.visitsTotal, 1)
    S.acting = true
    recordVisit(STAFF, 'documents')
    await settle()
    assert.equal(S.tabs.staff_profile_visits.grid.length, 2, 'an acting session is never recorded')
    assert.ok(!S.logged.some((l) => l.startsWith('staffProfileVisit')), 'a visit writes no log line')
  })

  it('Assign Training: the form\'s split is the door\'s — one IST per staff member and client; a mapped name no client answers is said', async () => {
    const house = sliceHouse('NW4045', 'Arlington', [{ name: 'Kenny Marsh' }, { name: 'Lia Gomez' }, { name: 'Mo New' }])
    const before = overviewOf(await readOverview(STAFF))
    const split = assignSplit(house, before.ist)
    assert.deepEqual(split, { toTrain: ['Mo New'], trained: ['Kenny Marsh'], owed: ['Lia Gomez'] })
    S.istMap = { NW4045: ['Kenny Marsh', 'Lia Gomez', 'Mo New', 'Ghost Person'] }
    const got = await assignTraining({ staff: STAFF, house: 'NW4045' })
    assert.equal(writeQueued(got), false)
    assert.deepEqual((got.created ?? []).map((c) => c.client_name), split.toTrain)
    assert.deepEqual((got.already ?? []).map((c) => c.client_name).sort(), [...split.trained, ...split.owed].sort())
    assert.deepEqual(got.unplaced, ['Ghost Person'])
    assert.equal(got.created?.[0].due, '2026-09-28', 'due today when no day is given')
    const after = overviewOf(await readOverview(STAFF))
    assert.deepEqual(assignSplit(house, after.ist), { toTrain: [], trained: ['Kenny Marsh'], owed: ['Lia Gomez', 'Mo New'] })
    assert.deepEqual(assignableHouses([house], after.ist), [], 'a house with no one left to add is not offered')
    const again = await assignTraining({ staff: STAFF, house: 'NW4045', due_date: '2026-10-15' })
    assert.deepEqual(again.created, [])
    assert.ok(actionsOf(await readActions(STAFF)).items.some((i) => i.item === 'IST — Mo New' && i.action.house === 'NW4045'))
  })
})

describe('the session the answers belong to', () => {
  it('a refused re-read draws nothing it held; another session starts from nothing held', async () => {
    const h = mountHook(() => useStaffRead(readKey('staffProfileHr', STAFF), () => readHr(STAFF), hrOf), {})
    await h.settle(() => h.current.status === 'ready')
    assert.equal(h.current.data?.personal.ssn_masked, '•••-••-4329')
    SESSION = DIRECTOR
    h.run(() => { h.current.reload() })
    await h.settle(() => h.current.status === 'failed')
    assert.equal(h.current.data, null, 'the HR record read before the refusal is not drawn after it')
    assert.equal(readRefusal(h.current.error), NOT_PUBLISHED)
    h.unmount()

    SESSION = MASTER
    const first = mountHook(() => useStaffRead(readKey('staffProfileNotes', STAFF), () => readNotes(STAFF), notesOf), {})
    await first.settle(() => first.current.status === 'ready')
    first.unmount()
    const token = useAuthStore.getState().token
    try {
      useAuthStore.setState({ token: 'another-session' })
      const next = mountHook(() => useStaffRead(readKey('staffProfileNotes', STAFF), () => readNotes(STAFF), notesOf), {})
      assert.equal(next.current.status, 'loading', 'nothing the session before read is drawn for this one')
      await next.settle(() => next.current.status === 'ready')
      next.unmount()
    } finally {
      useAuthStore.setState({ token })
    }
  })
})

describe('a viewer App Control released Staff to', () => {
  const CLIENT = { email: 'kenny@example.org', role: 'client', display_name: 'Kenny Marsh', types: ['CLIENT'], client_key: 'kenny_marsh' }
  const FAMILY = { email: 'gina@example.org', role: 'client', display_name: 'Gina Guardian', types: ['GUARDIAN'], client_key: 'kenny_marsh' }
  const STAFFER = { email: 'sally@example.org', role: 'staff', display_name: 'Sally Staff', types: ['STAFF'] }
  const houseOf = (kind: string) => ({ kind, client_keys: ['kenny_marsh'], house_codes: ['NW4045'] })
  const refused = (err: Error) => readRefusal(err.message) === NOT_PUBLISHED
  const CONTACT = ['noah.reed@example.org', 'noah.alt@example.org', 'noah.home@example.org', '555-0111', '555-0112', '555-0113',
    'ASA-1060', 'Lia Gomez', 'Mo New', 'Great with Kenny', 'istpaper0001', '05/17/1990', '1990-05-17']

  it('STAFF on the released app reads every section whole; the writes stay refused and make nothing', async () => {
    SESSION = STAFFER
    await assert.rejects(readRoster(false), refused)
    S.released[STAFFER.email] = { kind: 'all' }
    const r = rosterOf(await readRoster(false))
    assert.equal(r.view, 'full')
    assert.ok(r.staff.some((s) => s.key === 'samshare'), 'every staff member')
    const o = overviewOf(await readOverview(STAFF))
    assert.ok(o.person.phones.length > 0 && o.person.employee_id === 'ASA-1060' && o.clients.length > 0)
    assert.equal(hrOf(await readHr(STAFF)).personal.ssn_masked, '•••-••-4329')
    const words = transcriptOf(await readTranscript(STAFF, 'AC2'))
    assert.deepEqual([words.callId, words.hasWords], ['AC2', true], 'a listed call\'s words, past the admin-only door')
    assert.equal(performanceOf(await readPerformance(STAFF)).hr.rows.length, 1)
    await assert.rejects(addNote({ staff: STAFF, priority: 'normal', details: 'x' }), refused)
    await assert.rejects(assignTraining({ staff: STAFF, house: 'NW4045' }), refused)
    await assert.rejects(requestTraining({ staff: STAFF, priority: 'normal', details: 'x' }), refused, 'another person\'s training')
    await assert.rejects(addHrIssue({ staff: STAFF, date: '2026-09-25', severity: 'Coaching', category: 'Conduct', summary: 'x',
      details: 'y' }), refused, 'the HR tracker is written by an admin or a manager account alone')
    assert.equal(S.tabs.staff_notes, undefined, 'no note was filed')
    assert.equal(S.created, 0, 'no IST row was made')
    assert.equal(S.hr.length, 2, 'no HR row was made')
  })

  it('the person themselves asks for their own training — never an IST at a house, never another person\'s, never an HR issue', async () => {
    const AVA = { email: 'ava@example.org', role: 'staff', display_name: 'Ava Stone', types: ['STAFF'] }
    SESSION = AVA
    await assert.rejects(readOverview('avastone'), refused, 'the rule opens one write, not the app')
    await requestTraining({ staff: 'avastone', priority: 'normal', details: 'I would like the Med 1 course' })
    await assert.rejects(assignTraining({ staff: 'avastone', house: 'NW4045' }), /An IST at a house is assigned by a manager/)
    await assert.rejects(requestTraining({ staff: STAFF, priority: 'normal', details: 'x' }), refused)
    await assert.rejects(addHrIssue({ staff: 'avastone', date: '2026-09-25', severity: 'Coaching', category: 'Conduct', summary: 'x',
      details: 'y' }), refused)
    SESSION = MASTER
    const asked = performanceOf(await readPerformance('avastone')).training.requests
    assert.deepEqual(asked.map((q) => [q.details, q.by, q.self]), [['I would like the Med 1 course', 'Ava Stone', true]])
    assert.equal(notesOf(await readNotes(STAFF)).notes.length, 0)
    assert.deepEqual([S.created, S.hr.length], [0, 2])
  })

  it('a client reads the staff their house sees, each one BASIC: who they are and the ISTs on their own client', async () => {
    S.released[CLIENT.email] = houseOf('client')
    SESSION = CLIENT
    const r = rosterOf(await readRoster(false))
    assert.equal(r.view, 'basic')
    assert.deepEqual(r.staff.map((s) => s.key), ['avastone', STAFF])
    assert.ok(r.staff.every((s) => s.employee_id === ''), 'no employee id')
    const raw = await readOverview(STAFF)
    const o = overviewOf(raw)
    assert.equal(o.person.name, 'Noah Reed')
    assert.equal(o.person.role, 'DSP')
    assert.deepEqual([o.person.phones, o.person.emails, o.clients, o.houses], [[], [], [], []])
    assert.deepEqual(o.ist.map((i) => [i.client_name, i.status]), [['Kenny Marsh', 'done']])
    assert.equal(o.ist[0].doc_id, '')
    assert.equal(o.driving, null)
    assert.equal(o.medDel, null)
    const text = JSON.stringify(raw)
    assert.deepEqual(CONTACT.filter((s) => text.includes(s)), [])
  })

  it('for a client or family viewer every other section, file, call and write is refused; a staff member their houses do not see is no one', async () => {
    for (const [who, kind] of [[CLIENT, 'client'], [FAMILY, 'guardian']] as const) {
      S.released[who.email] = houseOf(kind)
      SESSION = who
      for (const read of [readShifts, readEmployment, readDocuments, readCompliance, readPerformance, readHr, readActions, readActivity,
        readNotes, readTranscripts, readTexts]) {
        await assert.rejects(read(STAFF), refused, `${kind}: ${read.name}`)
      }
      await assert.rejects(readDocFile(STAFF, 'i9noahfile01'), refused)
      await assert.rejects(readTranscript(STAFF, 'AC1'), refused)
      await assert.rejects(addNote({ staff: STAFF, priority: 'normal', details: 'x' }), refused)
      await assert.rejects(setNoteState('SN_1', 'resolved', STAFF), refused)
      await assert.rejects(assignTraining({ staff: STAFF, house: 'NW4045' }), refused)
      await assert.rejects(requestTraining({ staff: STAFF, priority: 'normal', details: 'x' }), refused)
      await assert.rejects(addHrIssue({ staff: STAFF, date: '2026-09-25', severity: 'Coaching', category: 'Conduct', summary: 'x',
        details: 'y' }), refused)
      await assert.rejects(readOverview('samshare'), (err: Error) => err.message === 'No staff member with that key.')
      await assert.rejects(readOverview('zzznobody'), (err: Error) => err.message === 'No staff member with that key.')
    }
    assert.deepEqual([S.logged, S.created, S.tabs.staff_notes, S.tabs.staff_profile_visits, S.hr.length], [[], 0, undefined, undefined, 2])
  })
})

describe('what crossed the wire', () => {
  it('every call carried only the parameters its door declares, and every Staff door was called', () => {
    const bad = calls.filter((c) => {
      const declared = Object.keys(GS.HUB_POLICY[c.action]?.params ?? {})
      return Object.keys(c.payload).some((k) => !declared.includes(k))
    })
    assert.deepEqual(bad, [])
    assert.deepEqual([...new Set(calls.map((c) => c.action))].sort(), [...GS.SP_ACTIONS].sort())
  })

  it('no answer ever carried a raw SSN, licence or BCI number, a credential, a clinical word or a stranger\'s number', () => {
    const all = answers.join('\n')
    assert.ok(answers.length > 20, `${answers.length} answers read`)
    assert.deepEqual(NEVER.filter((s) => all.includes(s)), [])
  })

  it('a staff document, a call\'s words, the HR record, the texts and the notes are never kept as relay receipts; a write keeps its exactly-once receipt', () => {
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    const line = /^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{([^}]*)\}\)/m.exec(relay)?.[1] ?? ''
    for (const r of ['staffProfileDocFile', 'staffProfileTranscript', 'staffProfileHr', 'staffProfileTexts', 'staffProfileNotes',
      'staffProfileEditRead']) {
      assert.ok(line.includes(`"${r}"`), `${r}: ${line}`)
    }
    for (const w of ['staffProfileAssignTraining', 'staffProfileNoteAdd', 'staffProfileNoteState', 'staffProfileVisit']) {
      assert.ok(!line.includes(`"${w}"`), `${w} keeps its receipt`)
    }
  })

  it('every read the Staff app declares is never stamped for a receipt; its Apps Script writes keep exactly-once', () => {
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    const line = /^RELAY_NO_RECEIPT_ACTIONS = frozenset\(\{([^}]*)\}\)/m.exec(relay)?.[1] ?? ''
    const listed = new Set([...line.matchAll(/"(\w+)"/g)].map((m) => m[1]))
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'public/resolver-manifest.json'), 'utf8')) as {
      actions: Record<string, { lane: string }>
    }
    const mine = Object.entries(manifest.actions).filter(([name]) => /^staffProfile[A-Z]/.test(name))
    const reads = mine.filter(([, p]) => p.lane === 'read').map(([name]) => name)
    const writes = mine.filter(([, p]) => p.lane === 'write').map(([name]) => name)
    // a door only Python answers (app/doors.json) never reaches Apps Script's receipts: it rides with the reads
    const py: Record<string, unknown> = JSON.parse(readFileSync(resolve(ROOT, 'app/doors.json'), 'utf8'))
    assert.ok(reads.length >= 12 && writes.length >= 3, `${reads.length} reads, ${writes.length} writes`)
    assert.deepEqual(reads.filter((a) => !listed.has(a)), [])
    assert.deepEqual(writes.filter((a) => listed.has(a) && !py[a]), [])
    assert.deepEqual(writes.filter((a) => py[a] && !listed.has(a)), [])
  })
})
