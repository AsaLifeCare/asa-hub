/**
 * Run the Apps Script self-test HERE, before anybody deploys it.
 *
 * SelfTest.gs asserts the hiring pipeline against the real functions, but it
 * only runs inside Apps Script — which means the loop is: push, have somebody
 * run it there, read the log, fix, push again. That is a twenty-minute
 * round trip for a typo, and it spends a person's attention on a machine's
 * mistakes.
 *
 * The pure logic does not need Google. Referral validation, the packet hold,
 * stage mapping, OCR date selection, the resolver's gate, the RPC contracts —
 * all of it is plain JavaScript over plain values. So this loads the .gs
 * sources with the Google globals stubbed, runs the sections that touch
 * nothing external, and reports the same shape SelfTest.gs does.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: fake the data. The live section
 * (stLive_) reads real tabs and is skipped here rather than mocked — a mock
 * of a spreadsheet asserts that my idea of the data is self-consistent,
 * which is exactly the thing a test must not be allowed to prove. That
 * section runs in Apps Script, against the real sheets, or not at all.
 *
 * Run: node tools/run-selftest.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'
import crypto from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gsDir = resolve(root, 'apps-script')

/** Anything that reaches Google throws by default. A stub that silently
 *  returns a plausible value is how a test ends up asserting the stub. */
const reject = (what) => () => { throw new Error(`${what} is not available outside Apps Script`) }

const props = new Map()
const sandbox = {
  console,
  JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, isNaN, parseInt, parseFloat,
  Error, TypeError,
  Logger: { log: () => {} },
  Utilities: {
    base64Decode: reject('Utilities.base64Decode'),
    newBlob: reject('Utilities.newBlob'),
    // REAL timezone conversion, not a stand-in: Node's Intl and Apps Script
    // both implement the IANA database, so the attendance locks assert the
    // same arithmetic the server will do. Only the three patterns the code
    // uses are supported — an unknown pattern still throws, like everything
    // else here.
    formatDate: (date, tz, pattern) => {
      const part = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(date)
      if (pattern === 'EEE, MMM d, yyyy') {
        return `${part({ weekday: 'short' })}, ${part({ month: 'short' })} ${part({ day: 'numeric' })}, ${part({ year: 'numeric' })}`
      }
      if (pattern === 'HH:mm') {
        return part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      }
      if (pattern === 'h:mm a') {
        return part({ hour: 'numeric', minute: '2-digit', hour12: true }).replace('\u202f', ' ')
      }
      if (pattern === 'yyyy-MM-dd') {
        const p2 = (o) => part(o).padStart(2, '0')
        return `${part({ year: 'numeric' })}-${p2({ month: '2-digit' })}-${p2({ day: '2-digit' })}`
      }
      // the shift flow's day ("Tue 9/22") and the URGENT OPEN SHIFT's weekday
      if (pattern === 'EEE M/d') {
        return `${part({ weekday: 'short' })} ${part({ month: 'numeric' })}/${part({ day: 'numeric' })}`
      }
      if (pattern === 'EEEE') return part({ weekday: 'long' })
      throw new Error(`Utilities.formatDate pattern "${pattern}" is not stubbed`)
    },
    getUuid: () => 'uuid-stub',
    // REAL SHA-256, not a stand-in. The SSN fingerprint is the strong key
    // empdbFindRow_ refuses on, and a fake digest here would assert that the
    // fake is consistent with itself — which is the one thing a test of a
    // hash must not be allowed to prove. Node's crypto runs the same
    // algorithm Apps Script does.
    DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (algo, value) =>
      [...crypto.createHash(algo).update(String(value), 'utf8').digest()]
        .map((b) => (b > 127 ? b - 256 : b)),
    base64Encode: (bytes) =>
      Buffer.from(Uint8Array.from(bytes, (b) => (b < 0 ? b + 256 : b))).toString('base64'),
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => props.set(k, v),
      deleteProperty: (k) => props.delete(k),
    }),
  },
  // A cache that forgets everything is not a faithful stand-in — it hides
  // exactly the class of bug it should expose. The idempotency receipt that
  // stops one applicant being texted twice lives here, and against a
  // forgetful stub that test can only ever fail. TTL is ignored: nothing in
  // this suite runs long enough for expiry to be the thing under test.
  CacheService: (() => {
    const store = new Map()
    const api = {
      get: (k) => (store.has(k) ? store.get(k) : null),
      put: (k, v) => { store.set(k, String(v)) },
      remove: (k) => { store.delete(k) },
    }
    return { getScriptCache: () => api, getUserCache: () => api, getDocumentCache: () => api }
  })(),
  SpreadsheetApp: { openById: reject('SpreadsheetApp.openById'), flush: () => {} },
  DriveApp: { getFileById: reject('DriveApp.getFileById'), getFoldersByName: reject('DriveApp') },
  // The forms import mapper reads ONLY the enum — String(ItemType.X) is the
  // member's NAME in Apps Script, so a name map is the same value, not a
  // stand-in. Opening a real form still rejects like everything else here.
  FormApp: {
    ItemType: {
      TEXT: 'TEXT', PARAGRAPH_TEXT: 'PARAGRAPH_TEXT', MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
      LIST: 'LIST', CHECKBOX: 'CHECKBOX', SCALE: 'SCALE', RATING: 'RATING',
      DATE: 'DATE', TIME: 'TIME', DATETIME: 'DATETIME', DURATION: 'DURATION',
      GRID: 'GRID', CHECKBOX_GRID: 'CHECKBOX_GRID', SECTION_HEADER: 'SECTION_HEADER',
      PAGE_BREAK: 'PAGE_BREAK', IMAGE: 'IMAGE', VIDEO: 'VIDEO', FILE_UPLOAD: 'FILE_UPLOAD',
    },
    openById: reject('FormApp.openById'),
    openByUrl: reject('FormApp.openByUrl'),
  },
  UrlFetchApp: { fetch: reject('UrlFetchApp.fetch') },
  MailApp: { sendEmail: reject('MailApp.sendEmail') },
  GmailApp: {},
  HtmlService: {},
  ContentService: {},
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ScriptApp: { getService: () => ({ getUrl: () => '' }) },
  Session: { getActiveUser: () => ({ getEmail: () => 'selftest@asa' }) },
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)

/**
 * Load in the order the LIVE PROJECT uses, recorded by push_apps_script.py
 * into tools/project-order.json.
 *
 * Order is not cosmetic here. Apps Script runs top-level code in project
 * order, and a value built from a constant declared later is silently
 * `undefined` — that is exactly how the estate's employee Master stopped
 * being recognised as the estate's. Loading alphabetically would reproduce
 * a sequence that does not exist anywhere, so this runner would either miss
 * a real hazard or invent one. A new file not yet in the recording is
 * appended last, which is where the push tool puts it — the most dangerous
 * position, and therefore the right one to rehearse.
 */
const onDisk = readdirSync(gsDir).filter((f) => f.endsWith('.gs'))
let recorded = null
try {
  recorded = JSON.parse(readFileSync(resolve(root, 'tools/project-order.json'), 'utf8')).order
} catch { /* never recorded — fall back and say so below */ }
const files = recorded
  ? [...recorded.map((n) => n + '.gs').filter((f) => onDisk.includes(f)),
     ...onDisk.filter((f) => !recorded.includes(f.replace(/\.gs$/, '')))]
  : ['Main.gs', 'HubCore.gs', ...onDisk.filter((f) => !['Main.gs', 'HubCore.gs'].includes(f)).sort()]
if (!recorded) console.log('note: project order not recorded — loading alphabetically, which is NOT what Apps Script does')

const skipped = []
for (const name of files) {
  const src = readFileSync(resolve(gsDir, name), 'utf8')
  try {
    vm.runInContext(src, sandbox, { filename: name })
  } catch (err) {
    // A file whose TOP LEVEL needs Google cannot load here. That is a fact
    // about the file, not a failure of the test — but it is reported, because
    // a silently skipped file is a silently untested one.
    skipped.push(`${name}: ${String(err.message || err).slice(0, 100)}`)
  }
}

const SECTIONS = [
  ['intake / referral', 'stReferral_'],
  ['packet hold', 'stPacketHold_'],
  ['who may be texted', 'stSendable_'],
  ['stages', 'stStages_'],
  ['certificate OCR', 'stOcr_'],
  ['resolver', 'stResolver_'],
  ['outbound rpc', 'stRpc_'],
  ['rpc path', 'stRpcPath_'],
  ['onboarding tracker', 'stOnboarding_'],
  ['the exceptions', 'stExceptions_'],
  ['amber recipients', 'stAmberRecipients_'],
  ['the morning fixes', 'stMorningFixes_'],
  ['private data', 'stPrivate_'],
  ['smart comms', 'stSmartComms_'],
  ['app builder', 'stAppBuilder_'],
  ['time reconciliation', 'stRecon_'],
  ['sheet cell text', 'stCellText_'],
  ['document approval', 'stDocApproval_'],
  ['seat identity', 'stSeatIdentity_'],
  ['resume rubric', 'stResumeRubric_'],
  ['staff docs', 'stStaffDocs_'],
  ['opt-out', 'stOptOut_'],
  ['document chain', 'stDocChain_'],
  ['cjis folder', 'stCjis_'],
  ['questionnaires', 'stQuestionnaire_'],
  ['client chart', 'stClientChart_'],
  ['smart preview', 'stSmartPreviewDry_'],
  ['ai providers', 'stAiProviders_'],
  ['ledger key', 'stSmartLedgerKey_'],
  ['platform mail', 'stPlatformMail_'],
  ['hiring flow', 'stHiringFlow_'],
  ['interview flow', 'stInterviewFlow_'],
  ['user types', 'stUserTypes_'],
  ['team lead badge', 'stTeamLead_'],
  ['platform lead badge', 'stPlatformLead_'],
  ['suggestions', 'stSuggestions_'],
  ['support profile', 'stSupportProfile_'],
  ['master unlisted', 'stMasterUnlisted_'],
  ['quo enrich', 'stQuoEnrich_'],
  ['client accounts', 'stClientAccounts_'],
  ['workspace shelf', 'stWorkspaceShelf_'],
  ['chat', 'stChat_'],
  ['render sheet', 'stRenderSheet_'],
  ['user worlds', 'stWorld_'],
  ['the place', 'stTenant_'],
  ['the member axis', 'stMember_'],
  ['requirements', 'stRequirements_'],
  ['events', 'stEvents_'],
  ['requirement states', 'stRequirementStates_'],
  ['comm intent', 'stCommIntent_'],
  ['hub owned sheets', 'stHubOwnedSheets_'],
  ['one door', 'stOneDoor_'],
  ['matrix engine', 'stMatrixEngine_'],
  ['the whole matrix', 'stBulk_'],
  ['bulk write', 'stBulkWrite_'],
  ['mail doors', 'stMail_'],
  ['no invented data', 'stNoMockLeft_'],
  ['forms import', 'stFormsImport_'],
  ['forms import runtime', 'stFormsImportRuntime_'],
  ['guardian', 'stGuardian_'],
  ['gather database', 'stGatherDatabase_'],
  ['contacts sync', 'stContactsSync_'],
  ['behavior support', 'stBehavior_'],
  // the machine's door onto the proposals house — pure by construction: the
  // real upsert is run twice over an array, because only running it can tell
  // a pass that writes nothing from one that rewrites the house
  ['comm proposals', 'stCommProposals_'],
  // the phone-transcript lane's clear side — pure by construction: the
  // cleaners and the refusal list are plain functions over plain values, and
  // they are the whole of what keeps a person's words out of a spreadsheet
  ['comm calls', 'stCommCalls_'],
  // the PSI Anywhere decision and its proof — pure by construction on the
  // reading side (a table of real queue sentences over plain functions), and
  // pure by ACCIDENT on the proof side, which is the useful half: UrlFetchApp
  // throws in this runner, so running the probe here IS the "our own egress
  // failed" case, and the section pins that what comes back is `unknown` and
  // never `up`
  ['psi anywhere', 'stPsiAnywhere_'],
  // rule 13's door — pure by construction: the People house, the hotline
  // calendar and the send door are stood in for, so what runs is the door's
  // own decision about each row the relay planned
  ['shift reminder', 'stShiftReminder_'],
  // the shift flow's door under each position of the sending dial, and the
  // URGENT OPEN SHIFT's renderer, blast and migration — pure by construction:
  // the People house, the calendar, the relay, the send door and the config
  // tab are all stood in for
  ['shift flow', 'stShiftFlow_'],
  // the send door's quiet window (21:31-07:59 New York) — pure by
  // construction: the transport, the opt-out list and the mock and rehearsal
  // writers are stood in for, and each check names the hour it is about
  ['quiet window', 'stQuietWindow_'],
  // the one-shot pages the window held (an incident, a support request, a PSI
  // outage), kept on the morning list and said at 08:00 only while still true
  // — the store, the transport and the lanes' readers are stood in for
  ['morning list', 'stQuietOwed_'],
  // every message of the shift flow and the URGENT OPEN SHIFT in the mock
  // outbox, under each switch, and the morning carry of what the night held
  ['mock outbox', 'stMockRouting_'],
  // test mode as the one switch: every sender held under ON and handing over
  // under OFF, the dial derived, the one exemption, and the reason to the 5558
  // group alone — every transport and book stood in for
  ['one switch', 'stOneSwitch_'],
  // and the law that makes the one switch worth anything: an UNREADABLE switch
  // HOLDS, at all five readers — plus the doors that reach the world without
  // saying a word, which arrive off, and the two letters that leave while the
  // lane holds and say so on their row
  ['the switch and the gates', 'stSmartGate_'],
  // what a review of it found: the self-test that could text a real line, the
  // seeds the Desk could not save, the one-shot alerts the quiet window lost,
  // the reset link in the outbox, the doors that still mailed around the lane
  // — every door, store and transport stood in for
  ['the switch and the gates, reviewed', 'stSmartGateReview_'],
  // a second review: letters kept as facts and said whole at 08:00, every
  // morning-list refusal logged, carriers that keep an unreadable entry, the
  // platform's own mailbox through the one door, a person door read twice,
  // no secret in a tester's copy, the resource gate outside Main.gs
  ['the switch and the gates, second pass', 'stSmartGateSecondPass_'],
  // the holes a review found in it: a person's own mailbox under test mode,
  // the morning list against Apps Script's 9 KB per property, and the
  // directors' text against the provider's 1,600 characters
  ['one switch, reviewed', 'stOneSwitchReview_'],
  // the master's release door — pure by construction: the refusal is a plain
  // function over a plain user, the rest reads declarations and source text.
  // It was written and registered in the Apps Script list but NEVER added
  // here, so two of its assertions had gone stale (they still asserted the
  // letter was `inviteEmail_` and that the wire emitted e-mail alone) and
  // nothing on this side could say so. A section that only runs where nobody
  // watches is a section that stops being true quietly.
  ['release users', 'stReleaseUsers_'],
  // Release Users' counting — each letter's outcome, the run's tally, the
  // stamp and the situation asked once; the app lane and the book stood in for
  ['release count', 'stReleaseCount_'],
  // the interview decline that ends the run (Hold open) and the phone screen's
  // Accept — pure by construction: the real engine, the real setDecision and
  // the real dissolved-tab rebuild run over a runtime Facts tab held in memory;
  // every door that would reach a live book is stood in for
  ['hiring decisions', 'stHiringDecisions_'],
  // the Med Del renewal's settings, now in a sheet — pure by construction:
  // medDelCatalogBuild_ takes a read result and a legacy override and answers
  // a resolved catalogue, so the four cases that matter (missing, unreadable,
  // emptied, a row only in the sheet) run with no spreadsheet anywhere near
  // them, and the phases that consume it are asserted on their own source
  ['med del catalogue', 'stMedDel_'],
  // the worked examples, now a sheet a person edits instead of five arrays in
  // the code — pure by construction: five stand-in tabs of plain values, and
  // the destinations counted rather than written
  ['examples catalogue', 'stExamples_'],
  // the configuration catalogue, which is a SHEET now: present, missing,
  // unreadable, a key only in the sheet, a key only in the last-resort copy,
  // a key typed twice and a header somebody rearranged — every case drives
  // the real reader through a fake sheet handle, so nothing here is a mock
  // agreeing with itself. The laws of the shipped copy (no duplicates, a
  // known group each, and NO notes) are plain assertions over the array.
  ['config catalogue', 'stAlertsCatalog_'],
  // the IST lane's vocabulary now that it lives in a tab — pure by
  // construction on the reading side (the real readers over a configuration
  // this file names out loud) and pure by ACCIDENT on the failing side, which
  // is the half that matters: hubTabEnsure_ needs Google and throws in this
  // runner, so the checks about a sheet that cannot be read are really running
  // against a sheet that cannot be read
  ['ist config', 'stIstConfig_'],
  // the next three stand in every Google read; the send door is the real one
  ['staff broadcast', 'stStaffBroadcast_'],
  ['open shift covered', 'stOpenShiftCovered_'],
  ['recruiting book', 'stRecruitBook_'],
  ['time off', 'stTimeOff_'],
  ['production actions', 'stProductionActions_'],
  // the sheet is stood in for; the client identity is the real merge's shape
  ['estate filing', 'stEstateFiling_'],
  // what a review of the integrated package found — every door, store and
  // transport stood in for
  ['package repair', 'stPackageRepair_'],
  // Settings → Users → Invite is the invitation: both switches, the claim on
  // the letter only, and an answer per account — every door stood in for
  ['user invite door', 'stUserInviteDoor_'],
  // the master wearing another account — the real doPost, session resolution,
  // policy door and log over a sessions tab and accounts held in memory
  ['be another', 'stBeAnother_'],
  // certificate uploads: the master reads the whole ledger, everyone else only
  // their own — the ledger, the roster and the Drive filing stood in for
  ['cert privacy', 'stCertPrivacy_'],
  // an uploaded paper read by the decoder onto its own ledger row, the eye's own-record door and the
  // master's confirmation — the ledger, roster, Drive, the Master and the words book stood in for
  ['cert reading', 'stCertRead_'],
  // the task board opens only its own workbooks; Drive and the board folder stood in for
  ['sheet board guard', 'stSheetBoardGuard_'],
  // Settings > My Work: only the master's own session saves the switches, and the
  // config lane carries them — the tab and the log stood in for
  ['my work display', 'stMyWorkDisplay_'],
  // MAR errors through the generic route: the Medications desk's audience reads, a writer writes,
  // everybody else is refused before a row is touched — the rows and the place stood in for
  ['mar errors door', 'stMarErrorsDoor_'],
  // forgot password: a fresh temporary password by e-mail, by text when the letter cannot reach them, one sign-in
  // that lands on the change gate, the caps and the one generic answer — every transport, book and store stood in for
  ['password reset', 'stPasswordReset_'],
  // Locations: the master-only gate, the staff merge, the repairs and incidents joins,
  // the consumption math and the write doors — every book and Drive stood in for
  ['locations', 'stLocations_'],
  // Staff: the master-only gate, the Master's positional read and its masks, the shifts inversion, the
  // identity-only clients, the doors and the visit log — every book, sheet and Drive stood in for
  ['staff-profiles', 'stStaffProfiles_'],
  // Families: the master-only gate, the family read from the records, the plans and the directory, the documents,
  // texts, calls, FAMILY shifts and incidents matched to one family member, the notes and call doors and the relay's
  // pack — every book, sheet, calendar and Drive stood in for
  ['family-profiles', 'stFamilyProfiles_'],
  // My Work, My Calendar and My Inbox for a client-role account — every adapter, the App Control reader, the
  // hotline calendar and the suggestions tab stood in for; the narrowing is the real one
  ['my family', 'stMyFamily_'],
  // Clients: the master-only gate, the identity-only roster, the masks, the incident review join, the plan
  // cut and the write doors — every book, sheet and Drive stood in for
  ['client-profiles', 'stClientProfiles_'],
  // SSA: the master-only gate, the SSAs read from the client records, the documents, texts, calls and mail matched
  // to the SSA alone, the ISP follow-ups, the notes door and the relay's pack — every book, sheet and Drive stood in for
  ['ssa-profiles', 'stSsaProfiles_'],
  // who a released profile app answers and how far it sees: the master, the App Control row, the client, the
  // guardian, the SSA by e-mail and by name, and the staff a house's client may see — every book stood in for
  ['viewer scope', 'stViewerScope_'],
  // Staff Candidates: the master-only gate, the pipeline from the board rows, the board's own next step, each open
  // step's Hiring door, the documents allow-list, texts and calls by the candidate's own phones, the note on the
  // hiring journey and the relay's pack — every book, sheet and Drive stood in for
  ['candidate-profiles', 'stCandidateProfiles_'],
  // Client Candidates: the App Control release on the reads and the master's gate on the presses and the pack, the
  // Potential Clients row read through the intake's six stages, the
  // phases and their presses, the log of every press, the papers, the alerts, texts and calls by the referral's
  // numbers, the two write doors and the relay's pack — the referral rows, the event log, the books and Drive stood in for
  ['client-candidates', 'stClientCandidates_'],
  // Clients · Appointments: the master-only gate, the name join, the visits and doctors shaped, a failing source
  // saying why — the clients, the estate tabs and Future Apts stood in for
  ['client appointments', 'stClientSourceAppointments_'],
  // Clients › Transportation: the master-only gate, the Van Calendar read (rows one cell short realigned),
  // the trip statuses, the fleet's availability, the miles on shifts and why a source did not read
  ['client transport', 'stClientSourceTransport_'],
  // Client Funds and Billing: the master-only gate, the client join, the ledger, balances, receipts, PAWS spans and
  // MBS claims shaping, and a failing source saying why — every book, the punches and Drive stood in for
  ['client sources, finance', 'stClientSourceFinance_'],
  // Clients › Refills: the master-only gate, the name join over the Missing Medications book,
  // each tab's shaping and a failing source saying why — the book and the clients stood in for
  ['client refills', 'stClientSourceRefills_'],
  // Clients › Administration: the gate, the joins, the pass-day repair, a failing source, the document door and the
  // import scan — the tabs, the drive and the log stood in for
  ['client sources, mar', 'stClientSourceMar_'],
  // Scheduling: the grammar against the Python's own answers, the overlap law, the board's per-viewer cut, the
  // editor writes, the seed off a fake book and the roll — every house, account and cache stood in for
  ['scheduling', 'stScheduling_'],
  // the request, call-off, swap and outreach flows — every house, transport and clock stood in for
  ['scheduling flows', 'stSchedulingFlows_'],
  // Support Requests: the queue's key against the Python's vectors, the cut, the one-verdict law, the hooks off and
  // on, the ADP guards and the Scheduling delegation — every house, account, book and transport stood in for
  ['support desk', 'stSupportDesk_'],
  // Transportation: the clock words, the request's refusals in order, the first answer, out of service, the privacy
  // cut, the directors, the Van Calendar import and the Support Requests rows — every house, account and text stood in for
  ['vehicle calendar', 'stVehicleCalendar_'],
  // Settings > App Control access: a listed account sees its apps' rows alone, writes them only with May change on,
  // is refused outside the list, and everybody else — the master included — is answered as before; every book,
  // the config tab and the log stood in for
  ['app control access', 'stAppControlDelegates_'],
  // Settings > Editions: the master makes every edition, a listed person only while its key is on, each Locations door
  // answers its own edition, Associated clients never takes a client off and Staff never deletes the record — the config
  // tab, App Control's row, the house, the stores and the log stood in for
  ['editions', 'stEditions_'],
]

const out = { failures: 0, checks: [], live: {} }
sandbox.__out = out
// THE SEND DOOR'S QUIET WINDOW READS THE CLOCK (Rpc.gs hubQuietHolds_), and a
// verdict run at 23:00 must not fail sixteen checks about what a lane SENDS
// because of the hour. The run is pinned to noon in New York, as runSelfTest()
// pins it in the editor; the checks about the window name their own hours.
vm.runInContext('HUB_QUIET_NOW = ST_QUIET_DAYTIME', sandbox)
const ran = []
for (const [label, fn] of SECTIONS) {
  if (typeof sandbox[fn] !== 'function') {
    out.failures++
    out.checks.push({ check: `${label}: section missing`, pass: false, detail: `${fn} did not load` })
    continue
  }
  try {
    vm.runInContext(`${fn}(__out)`, sandbox)
    ran.push(label)
  } catch (err) {
    out.failures++
    out.checks.push({ check: `${label}: threw`, pass: false, detail: String(err.message || err) })
  }
}

/*
 * THE SCREENS THAT EDIT THE ONE SWITCH, read as source — node only, because
 * Apps Script cannot read the SPA. Test mode on sends nothing to anybody, so a
 * screen that still offers "redirected to the testers", refuses the emergency
 * stop for want of a tester, or calls the send-door pause an emergency stop is
 * telling its reader there is a second switch, or a wrong one.
 */
{
  const src = (p) => { try { return readFileSync(resolve(root, p), 'utf8') } catch { return '' } }
  const push = (check, pass, detail) => {
    out.checks.push({ check, pass, detail })
    if (!pass) out.failures++
  }
  const settings = src('src/pages/settings/TestModeSection.tsx')
  push('one switch, screens: Settings > Test mode offers two positions — no "sheet" option and no redirect to the testers',
       !!settings && !/<option value="sheet"/.test(settings) && !/redirected to the testers/i.test(settings) &&
       !/goes to the testers/i.test(settings) && /<option value="on">On — nothing leaves/.test(settings),
       'TestModeSection.tsx')
  push('one switch, screens: Settings > Test mode never refuses turning it on for want of a tester, and checks the ' +
       'tester lists only when the save changes one of them',
       !!settings && !/needs at least one tester on both lists/i.test(settings) &&
       /listsTouched \? draft\.test_redirect_sms/.test(settings), 'TestModeSection.tsx localRefusal')
  const desk = src('src/pages/features/smartcomms/SmartCommsPage.tsx')
  const testCard = desk.indexOf('Test mode — the one switch, and the emergency stop')
  const pauseCard = desk.indexOf('Extra brake — the send door only')
  push('one switch, screens: the Desk shows test mode first as the emergency stop, and the pause as an extra brake on ' +
       'the send door — never "nothing leaves"; its test-mode strip no longer says the testers receive every send',
       !!desk && testCard !== -1 && pauseCard !== -1 && testCard < pauseCard &&
       !/Paused — nothing leaves/.test(desk) && !/>Emergency stop</.test(desk) &&
       !/Every send goes to the testers/.test(desk), 'SmartCommsPage.tsx BrakesPanel and the test-mode strip')
  const stale = [
    ['src/pages/features/hiring/FlowControlPage.tsx', /sends to the testers/],
    ['src/pages/features/comms/CommsBoardPage.tsx', /went to the testers, nobody else/],
    ['src/pages/features/smartcomms/SmartCommsActivityPage.tsx', /Every send is redirected to the testers/],
    ['src/pages/features/smartcomms/SmartCommsRepliesPage.tsx', /is redirected to the tester/],
  ].filter(([p, re]) => re.test(src(p))).map(([p]) => p)
  push('one switch, screens: no live banner still says test mode sends to the testers', stale.length === 0,
       stale.join(', '))
}

/*
 * EVERY createRow_ CALLER ASKS WHETHER THE WRITE WAS REFUSED — node only,
 * because Apps Script cannot read its own files. The book-write funnel's hold
 * and a store that files nothing both come back as `{ error }`, never a throw,
 * so a caller that does not look counts a held write as saved. Main.gs ships
 * apart and its route() is named by the funnel's Desk caveat instead.
 */
{
  const push = (check, pass, detail) => {
    out.checks.push({ check, pass, detail })
    if (!pass) out.failures++
  }
  const blind = []
  for (const f of readdirSync(gsDir).filter((n) => n.endsWith('.gs'))) {
    if (/^SelfTest|^Main\.gs$|^SheetDb\.gs$/.test(f)) continue
    const lines = readFileSync(resolve(gsDir, f), 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!/createRow_\(/.test(line) || /function createRow_|typeof createRow_/.test(line)) return
      const near = lines.slice(Math.max(0, i - 3), i + 24).join('\n')
      if (!/sheetDbRefused_\(|\.error\b/.test(near)) blind.push(`${f}:${i + 1}`)
    })
  }
  push('book writes: every createRow_ caller outside Main.gs checks the refusal before it counts a row as saved',
       blind.length === 0, blind.join(', '))
}

/*
 * LOCATIONS NEVER BECOMES A SLICE — node only, because Apps Script cannot read
 * the manifest. Its notes and IST cells name clients; a slice ships flat.
 */
{
  const push = (check, pass, detail) => {
    out.checks.push({ check, pass, detail })
    if (!pass) out.failures++
  }
  let resources = []
  try { resources = JSON.parse(readFileSync(resolve(root, 'public/snapshot-manifest.json'), 'utf8')).resources || [] } catch { /* none */ }
  const hits = resources.filter((r) => r.sheet === 'house_notes' || r.sheet === 'houseSupplies' ||
                                       /^(location|houseNotes)/i.test(r.resource))
  push('locations: no snapshot resource reads house_notes, the supplies ledger or a location* store',
       resources.length > 0 && hits.length === 0,
       resources.length ? hits.map((r) => r.resource).join(', ') : 'public/snapshot-manifest.json could not be read')

  // Clients: the plan's sections and the incident reviews carry clinical text, and the app's page must never
  // pull the clinical slices (clients, isps) into the browser of whoever can open it.
  const cpHits = resources.filter((r) => r.sheet === 'isp_sections' || r.sheet === 'incident_reviews' ||
                                         /^clientProfile/i.test(r.resource))
  push('client-profiles: no snapshot resource reads isp_sections, incident_reviews or a clientProfile* store',
       resources.length > 0 && cpHits.length === 0,
       resources.length ? cpHits.map((r) => r.resource).join(', ') : 'public/snapshot-manifest.json could not be read')
  let registry = null
  try { registry = readFileSync(resolve(root, 'src/registry/apps-client-profiles.ts'), 'utf8') } catch { registry = null }
  if (registry === null) {
    out.checks.push({ check: 'SKIPPED — client-profiles: no page of the app declares the clients or isps slice',
                      pass: true, skipped: true, detail: 'src/registry/apps-client-profiles.ts is not in this tree' })
  } else {
    const code = registry.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    const clinical = [...code.matchAll(/resource\s*:\s*['"](clients|isps)['"]/g)].map((m) => m[1])
    push('client-profiles: no page of the app declares the clients or isps slice',
         clinical.length === 0 && /['"]client-profiles['"]/.test(code), clinical.join(', ') || 'the app id is not declared')
  }
  // Client Funds and Billing carry money and PAWS rows: doors only, never a slice or a RESOURCES entry
  const csf = readFileSync(resolve(gsDir, 'ClientSourceFinance.gs'), 'utf8')
  const moneyHits = resources.filter((r) => /^clientSource/i.test(r.resource) ||
    (r.mode !== 'live' && ['billing_claims', 'finance_transactions', 'finance_balances'].includes(r.sheet)))
  push('client sources, finance: no slice reads the ledger, the balances or billing_claims, no resource is a ' +
       'clientSource* store, and ClientSourceFinance.gs declares no RESOURCES entry',
       resources.length > 0 && moneyHits.length === 0 && !/RESOURCES\s*\[|RESOURCES\.\w+\s*=/.test(csf),
       moneyHits.map((r) => r.resource).join(', '))

  // Staff: the notes and the visit log name people, and the app's page must never pull a clinical slice
  // (clients, isps, behaviorBoard) or the whole roster into the browser of whoever can open it.
  const spHits = resources.filter((r) => r.sheet === 'staff_notes' || r.sheet === 'staff_profile_visits' ||
                                         /^staffProfile/i.test(r.resource))
  push('staff-profiles: no snapshot resource reads staff_notes, staff_profile_visits or a staffProfile* store',
       resources.length > 0 && spHits.length === 0,
       resources.length ? spHits.map((r) => r.resource).join(', ') : 'public/snapshot-manifest.json could not be read')
  let spRegistry = ''
  try { spRegistry = readFileSync(resolve(root, 'src/registry/apps-staff-profiles.ts'), 'utf8') } catch { spRegistry = '' }
  const spCode = spRegistry.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
  const spWide = [...spCode.matchAll(/resource\s*:\s*['"](clients|isps|behaviorBoard|people)['"]/g)].map((m) => m[1])
  push('staff-profiles: no page of the app declares a clinical or people slice',
       spRegistry !== '' && spWide.length === 0 && /['"]staff-profiles['"]/.test(spCode),
       !spRegistry ? 'src/registry/apps-staff-profiles.ts could not be read' : spWide.join(', ') || 'the app id is not declared')

  // SSA: the admin notes name people, and the app's page must never pull a clinical slice or the whole roster
  const ssaHits = resources.filter((r) => r.sheet === 'ssa_notes' || /^ssaProfile/i.test(r.resource))
  push('ssa-profiles: no snapshot resource reads ssa_notes or an ssaProfile* store',
       resources.length > 0 && ssaHits.length === 0,
       resources.length ? ssaHits.map((r) => r.resource).join(', ') : 'public/snapshot-manifest.json could not be read')
  let ssaRegistry = null
  try { ssaRegistry = readFileSync(resolve(root, 'src/registry/apps-ssa-profiles.ts'), 'utf8') } catch { ssaRegistry = null }
  if (ssaRegistry === null) {
    out.checks.push({ check: 'SKIPPED — ssa-profiles: no page of the app declares a clinical or people slice',
                      pass: true, skipped: true, detail: 'src/registry/apps-ssa-profiles.ts is not in this tree' })
  } else {
    const ssaCode = ssaRegistry.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    const ssaWide = [...ssaCode.matchAll(/resource\s*:\s*['"](clients|isps|behaviorBoard|people)['"]/g)].map((m) => m[1])
    push('ssa-profiles: no page of the app declares a clinical or people slice',
         ssaWide.length === 0 && /['"]ssa-profiles['"]/.test(ssaCode), ssaWide.join(', ') || 'the app id is not declared')
  }

  // Families: the admin notes name people, and the app's page must never pull a clinical slice or the whole roster
  const famHits = resources.filter((r) => r.sheet === 'family_notes' || /^familyProfile/i.test(r.resource))
  push('family-profiles: no snapshot resource reads family_notes or a familyProfile* store',
       resources.length > 0 && famHits.length === 0,
       resources.length ? famHits.map((r) => r.resource).join(', ') : 'public/snapshot-manifest.json could not be read')
  let famRegistry = null
  try { famRegistry = readFileSync(resolve(root, 'src/registry/apps-family-profiles.ts'), 'utf8') } catch { famRegistry = null }
  if (famRegistry === null) {
    out.checks.push({ check: 'SKIPPED — family-profiles: no page of the app declares a clinical or people slice',
                      pass: true, skipped: true, detail: 'src/registry/apps-family-profiles.ts is not in this tree' })
  } else {
    const famCode = famRegistry.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    const famWide = [...famCode.matchAll(/resource\s*:\s*['"](clients|isps|behaviorBoard|people|tasks)['"]/g)].map((m) => m[1])
    push('family-profiles: no page of the app declares a clinical, people or task-board slice',
         famWide.length === 0 && /['"]family-profiles['"]/.test(famCode), famWide.join(', ') || 'the app id is not declared')
  }

  // Staff Candidates: every section is a door onto the Hiring app's own records, never a store or a slice of its own
  const cndHits = resources.filter((r) => /^candidateProfile|^candidatePack$/i.test(r.resource))
  push('candidate-profiles: no snapshot resource is a candidateProfile* or candidatePack store',
       resources.length > 0 && cndHits.length === 0,
       resources.length ? cndHits.map((r) => r.resource).join(', ') : 'public/snapshot-manifest.json could not be read')
  let cndRegistry = null
  try { cndRegistry = readFileSync(resolve(root, 'src/registry/apps-staff-candidates.ts'), 'utf8') } catch { cndRegistry = null }
  if (cndRegistry === null) {
    out.checks.push({ check: 'SKIPPED — candidate-profiles: no page of the app declares a clinical or people slice',
                      pass: true, skipped: true, detail: 'src/registry/apps-staff-candidates.ts is not in this tree' })
  } else {
    const cndCode = cndRegistry.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    const cndWide = [...cndCode.matchAll(/resource\s*:\s*['"](clients|isps|behaviorBoard|people)['"]/g)].map((m) => m[1])
    push('candidate-profiles: no page of the app declares a clinical or people slice',
         cndWide.length === 0 && /['"]staff-candidates['"]/.test(cndCode), cndWide.join(', ') || 'the app id is not declared')
  }

  // Client Candidates: every section is a door onto the Potential Clients row, never a store or a slice of its own
  const ccHits = resources.filter((r) => /^clientCandidate/i.test(r.resource))
  push('client-candidates: no snapshot resource is a clientCandidate* store',
       resources.length > 0 && ccHits.length === 0,
       resources.length ? ccHits.map((r) => r.resource).join(', ') : 'public/snapshot-manifest.json could not be read')
  let ccRegistry = null
  try { ccRegistry = readFileSync(resolve(root, 'src/registry/apps-client-candidates.ts'), 'utf8') } catch { ccRegistry = null }
  if (ccRegistry === null) {
    out.checks.push({ check: 'SKIPPED — client-candidates: no page of the app declares a clinical or people slice',
                      pass: true, skipped: true, detail: 'src/registry/apps-client-candidates.ts is not in this tree' })
  } else {
    const ccCode = ccRegistry.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    const ccWide = [...ccCode.matchAll(/resource\s*:\s*['"](clients|isps|behaviorBoard|people)['"]/g)].map((m) => m[1])
    push('client-candidates: no page of the app declares a clinical or people slice',
         ccWide.length === 0 && /['"]client-candidates['"]/.test(ccCode), ccWide.join(', ') || 'the app id is not declared')
  }
}

/*
 * THE SHIPPED EXAMPLE ROWS AGAINST THE READER THAT WILL LOAD THEM — node
 * only, because Apps Script cannot read tools/.
 *
 * The worked examples left the code for a sheet, so the only copy of them left
 * is the seed the migration tool mints that sheet with. A seed the reader
 * would refuse is a catalogue born broken, and without this the discovery is
 * an error in the editor rather than a red line here.
 */
{
  const push = (check, pass, detail) => {
    out.checks.push({ check, pass, detail })
    if (!pass) out.failures++
  }
  const src = (p) => { try { return readFileSync(resolve(root, p), 'utf8') } catch { return '' } }

  let seed = null
  try { seed = JSON.parse(src('tools/examples-seed.json')) } catch { seed = null }
  push('examples, seed: tools/examples-seed.json is there and parses', !!(seed && seed.tabs),
       'tools/examples-seed.json')
  push('examples, seed: the migration tool reads that file rather than carrying a copy of its own',
       src('tools/mint_examples_house.py').includes('examples-seed.json'),
       'tools/mint_examples_house.py')

  const gs = readFileSync(resolve(gsDir, 'Examples.gs'), 'utf8')
  push('examples, seed: no second copy of the rows was left behind in the code — the sheet would ' +
       'lose every argument with one',
       !/EX_SHOP_ITEMS|EX_SHOP_PRICES|EX_ATTEMPTS\b|EX_TRIPS\b/.test(gs) && !/Dyson|Columbus, OH/.test(gs),
       'apps-script/Examples.gs')

  const declared = sandbox.EX_CATALOGUE || []
  const seeded = new Map(((seed && seed.tabs) || []).map((t) => [t.tab, t]))
  const offHeader = declared
    .filter((spec) => {
      const t = seeded.get(spec.tab)
      return !t || JSON.stringify(t.header) !== JSON.stringify(spec.header)
    })
    .map((spec) => spec.tab)
  push('examples, seed: the tool stamps the header the reader reads, tab for tab and column for column',
       declared.length > 0 && seeded.size === declared.length && offHeader.length === 0,
       offHeader.join(', ') || `${seeded.size} seeded tabs against ${declared.length} declared`)

  if (seed && seed.tabs && declared.length) {
    sandbox.__exSeedJson = JSON.stringify(seed)
    const verdict = JSON.parse(vm.runInContext(`JSON.stringify((function () {
      var seed = JSON.parse(__exSeedJson), by = {};
      seed.tabs.forEach(function (t) { by[t.tab] = t; });
      var held = exCatalogueSheet_;
      exCatalogueSheet_ = function (tab) {
        var t = by[tab];
        return t ? stExamplesSheet_(t.header, t.rows, 'ok') : null;
      };
      EX_CATALOGUE_MEMO = null;
      var built;
      try { built = exCatalogueBuild_(); }
      finally { exCatalogueSheet_ = held; EX_CATALOGUE_MEMO = null; }
      var ids = [];
      EX_CATALOGUE.forEach(function (spec) {
        built.kinds[spec.kind].forEach(function (row) { ids.push(row.id); });
      });
      return { problems: built.problems, ids: ids };
    })())`, sandbox))

    push('examples, seed: every shipped row gets past the reader that will load it',
         verdict.problems.length === 0, verdict.problems.join(' | '))
    const seededIds = seed.tabs.flatMap((t) => t.rows.map((r) => String(r[0])))
    push('examples, seed: the reader accepts exactly the rows the tool writes, id for id',
         JSON.stringify(verdict.ids) === JSON.stringify(seededIds),
         `the reader kept ${verdict.ids.length} of ${seededIds.length}`)
    push('examples, seed: every seeded id carries the prefix the removal job keys on',
         seededIds.length > 0 && seededIds.every((id) => id.startsWith(sandbox.EX_PREFIX)),
         seededIds.filter((id) => !id.startsWith(sandbox.EX_PREFIX)).join(', '))
  }

  /*
   * WHICH OF THESE TABS A SCREEN WILL ACTUALLY SHOW.
   *
   * travelTrips_ (Travel.gs) drops every EX_ id before the Business Travel
   * screen, the digest or a decision sees one — the fakes stay out by standing
   * rule, so lifting it is a decision for the account and not a builder. What
   * must not happen is for it to be a SURPRISE: a tab added to the catalogue
   * whose reader hides the prefix the same way would be edited by a person all
   * afternoon while nothing on any screen moved, with every check green.
   *
   * So the catalogue names its blind spot (EX_HIDDEN_RESOURCES) and this reads
   * the sources back: every EX_ filter outside Examples.gs is attributed to the
   * resource it reads, and the two lists must be the same list.
   */
  {
    const declaredHidden = [...(sandbox.EX_HIDDEN_RESOURCES || [])].sort()
    const catalogue = sandbox.EX_CATALOGUE || []
    const found = new Set()
    const unattributed = []
    let readSomewhere = new Set()
    for (const name of readdirSync(gsDir).filter((f) => f.endsWith('.gs'))) {
      if (name === 'Examples.gs' || name === 'SelfTest.gs') continue
      const text = readFileSync(resolve(gsDir, name), 'utf8')
      for (const m of text.matchAll(/listRows_\(\s*'([A-Za-z0-9_]+)'/g)) readSomewhere.add(m[1])
      // each filter on the prefix belongs to the nearest listRows_ above it
      for (const hit of text.matchAll(/indexOf\('EX_'\)/g)) {
        const before = text.slice(Math.max(0, hit.index - 400), hit.index)
        const owner = [...before.matchAll(/listRows_\(\s*'([A-Za-z0-9_]+)'/g)].pop()
        if (owner) found.add(owner[1])
        else unattributed.push(`${name}@${hit.index}`)
      }
    }
    push('examples, screens: every EX_ filter in the platform is one a reader owns — an orphan ' +
         'one would hide rows nobody could account for',
         unattributed.length === 0, unattributed.join(', '))
    push('examples, screens: the catalogue names exactly the destinations whose screen refuses ' +
         'the demo rows — a tab added here cannot be born invisible without saying so',
         JSON.stringify([...found].sort()) === JSON.stringify(declaredHidden),
         `the sources hide [${[...found].sort()}], EX_HIDDEN_RESOURCES says [${declaredHidden}]`)
    const unread = catalogue.map((s) => s.resource).filter((r) => !readSomewhere.has(r))
    push('examples, screens: every destination the catalogue writes is read by some screen at all',
         unread.length === 0, unread.join(', '))
  }
}

const failed = out.checks.filter((c) => !c.pass)
const skippedHere = out.checks.filter((c) => c.skipped)
for (const c of out.checks) {
  if (!c.pass) console.log(`  FAIL  ${c.check}\n        ${c.detail}`)
}
// A CHECK THAT COULD NOT RUN HERE IS PRINTED, not counted quietly as a pass.
// The alternative — writing it as `!canRun || theRealTest` — is an assertion
// that holds everywhere and tests nowhere, and this suite has already shipped
// one of those with a second, unfalsifiable check underneath it.
for (const c of skippedHere) console.log(`  SKIP  ${c.check.replace(/^SKIPPED — /, '')}\n        ${c.detail}`)
// The bulk matrix reports one line for the whole cross-product (C6) — worth
// printing on a green run too, because "1204 passed" does not tell you how
// many PLACE cells were actually crossed.
for (const c of out.checks) {
  if (c.pass && /^bulk: the whole matrix/.test(c.check)) console.log(`\n  ${c.check}`)
}
console.log(`\nself-test (node): ${out.checks.length - failed.length}/${out.checks.length} passed, ` +
            `${failed.length} failed` + (skippedHere.length ? `, ${skippedHere.length} skipped here` : '') +
            ` — sections: ${ran.join(', ')}`)
if (skipped.length) {
  console.log(`\nnot loadable outside Apps Script (${skipped.length}):`)
  for (const s of skipped) console.log(`  · ${s}`)
}
console.log('\nstLive_ is NOT run here: it reads real tabs, and mocking them would only prove ' +
            'the mock agrees with itself. Run runSelfTest() in the editor for that half.')
process.exit(failed.length ? 1 : 0)
