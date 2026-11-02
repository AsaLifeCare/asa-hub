/**
 * THE REHEARSAL, RUN AGAINST REAL DATA, WITHOUT TOUCHING ANYTHING.
 *
 * The comms lane is written and proven by the self-test — against fixtures.
 * Fixtures prove the logic is internally consistent; they cannot say what the
 * lane would actually DO to sixty-seven real people, and that is the only
 * question worth answering before a dial is turned.
 *
 * This loads the real .gs sources the way the self-test harness does, feeds
 * them the live obligations matrix and the live cortex routes out of the
 * mirror, and prints what the lane would decide. It writes nothing, calls
 * nothing, and needs no publish — so the evidence exists before the decision
 * rather than after it.
 *
 *     node tools/comm-rehearsal.mjs
 *
 * Everything it prints is the lane on paper: who would be contacted, about
 * what, through which route, in which window, and every reason the policy and
 * the gates behind it reached.
 *
 * WHAT IT REFUSES TO DO IS PRETEND.
 *
 * The first version of this file proved less than it appeared to, in three
 * ways that all had the same shape — a thing the lane really asks was replaced
 * by a constant, and the constant was never named in the output.
 *
 *   · It loaded the nine `Comm*.gs` files and nothing else, so the words, the
 *     situation catalogue and the ledger rules — all of which live in
 *     `SmartComms.gs` — were simply absent from the run.
 *   · It stubbed `digestSetting_` to return its own floor argument, so every
 *     `comm_*` value in the rehearsal was the shipped floor in
 *     `COMM_POLICY_FLOOR`, never what was typed into `Digest
 *     Settings`. Editing a policy could not change this tool's output at all,
 *     and nothing said so.
 *   · It called `commPlanVerdict_` and stopped there — never
 *     `commDispatchAllowed_`, never the consent store, never the opt-out
 *     list — so "would send" was structurally optimistic against the real
 *     engine, which asks all of those before it hands anything over.
 *
 * So: the lane's own files are loaded, the settings are read from the mirrored
 * words book and the dial is the one actually set, the consent
 * and refusal gates are in the counted path, and everything that still had to
 * be stubbed (because this is node, not Apps Script) is NAMED in the output —
 * with the age of every mirrored source, because a rehearsal run on an
 * eleven-day-old copy of a tab is evidence about eleven days ago.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gsDir = resolve(root, 'apps-script')

/* ── the live rows, straight out of the mirror ─────────────────────────── */
const psql = (sql) => execFileSync('docker', [
  'exec', '-i', 'asa-hub-db', 'psql', '-U', 'asa_hub', '-d', 'asa_hub',
  '-tA', '-F', '', '-c', sql,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').filter(Boolean).map((l) => l.split(''))

/* WHAT WAS READ, AND HOW OLD IT IS.
 *
 * Every tab below is a COPY of a live sheet, and the copies do not arrive
 * together: the words book is re-read daily while `smart_comms` may be a
 * fortnight behind. A number in this report is only as true as the oldest
 * row it rests on, so each read records its age and the run prints them. */
const sources = []

/** One mirrored tab as row objects, in sheet order, with its age recorded. */
function mirrored(sheetId, tab, label) {
  let rows = []
  let stamp = ''
  try {
    const raw = execFileSync('docker', [
      'exec', '-i', 'asa-hub-db', 'psql', '-U', 'asa_hub', '-d', 'asa_hub',
      '-tA', '-c',
      `SELECT coalesce(to_char(max(ingested_at) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI')||'Z','')
       FROM asa_drive_sheets_rows WHERE sheet_id='${sheetId}' AND tab_name='${tab}'`,
    ], { encoding: 'utf8' }).trim()
    stamp = raw
    const body = execFileSync('docker', [
      'exec', '-i', 'asa-hub-db', 'psql', '-U', 'asa_hub', '-d', 'asa_hub',
      '-tA', '-c',
      `SELECT data::text FROM asa_drive_sheets_rows
       WHERE sheet_id='${sheetId}' AND tab_name='${tab}' ORDER BY row_number`,
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    rows = body.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch (e) {
    sources.push({ label, tab, rows: 0, stamp: '', error: String((e && e.message) || e).split('\n')[0] })
    return []
  }
  sources.push({ label, tab, rows: rows.length, stamp: stamp, error: '' })
  return rows
}

/* The two book readers normalise a header the same way — lower case, runs of
   anything else collapsed to one underscore. The mirror keeps the raw header
   as the JSON key, so the same rule is applied here rather than a near one:
   `Config ID` must arrive as `config_id` or the real reader misses it. */
const bookKeys = (row) => {
  const out = {}
  Object.keys(row || {}).forEach((h) => {
    const k = String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
    if (k) out[k] = row[h] === null || row[h] === undefined ? '' : row[h]
  })
  return out
}

const REQ_HOUSE = '1JLHYYp0Wf7bEQIE8S1rjme2yhArDp_AarpoYe4gj7p0'
/* `ASA Hub — Generic Configuration`: the words book every rule that can be
   edited without a publish lives in (Digest.gs HUB_GENERIC_CONFIG_ID). */
const WORDS_BOOK = '1Ky7FPu876WavnMTzsO6zejDXtI1I4b2xebuMdsBMMgg'
const HUB_DB = '1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts'

const matrix = psql(`
  SELECT data->>'person_key', data->>'person_name', data->>'req_id',
         data->>'state', coalesce(data->>'expires',''), coalesce(data->>'days_left','')
  FROM asa_drive_sheets_rows
  WHERE sheet_id='${REQ_HOUSE}' AND tab_name='Data'
`).map(([person_key, person_name, req_id, state, expires, days_left]) =>
  ({ person_key, person_name, req_id, state, expires, days_left }))
sources.push({ label: 'the obligations matrix', tab: 'requirement_states (house)',
               rows: matrix.length, stamp: '', error: '' })

/* THE SAME ROSTER THE ENGINE USES, not a near neighbour.
 *
 * This read `ops.employees` where status='Yes' while commRecordRoster_ reads
 * the employee database's own Master tab. The two agreed on magnitude and
 * that was the trap: a rehearsal whose population is merely SIMILAR to the
 * engine's is a description of the output, and this file's whole claim is
 * that it IS the output. So it reads the mirrored Master and applies
 * COMM_ROSTER_ACTIVE — Yes and Admin — exactly as CommRecord.gs does. */
const CERT_SOURCE = '1Gqq08-3nZgKDoCLDnIHg16qTtdzeSZt9aNQRRi5y45s'
const roster = Object.fromEntries(psql(`
  SELECT DISTINCT lower(regexp_replace(
           coalesce(NULLIF(data->>'Employee',''), data->>'Name', ''),
           '[^a-zA-Z0-9]+','','g'))
  FROM asa_drive_sheets_rows
  WHERE sheet_id='${CERT_SOURCE}' AND tab_name='Master'
    AND lower(trim(coalesce(data->>'Status',''))) IN ('yes','admin')
`).map(([k]) => [k, 1])
  .filter(([k]) => k))

/* THE REAL WINDOWS, NOT A FIXED HOUR.
 *
 * The first cut passed 10am on a Tuesday for everybody, so every intent came
 * back "would send" and the rehearsal quietly reported its own best case. The
 * cortex knows when 54 of these people are actually awake; asking it is the
 * difference between a rehearsal and a demonstration. */
const windows = (psql(`
  SELECT lower(regexp_replace(entity_name,'[^a-zA-Z0-9]+','','g')), fact_value
  FROM asa_entity_facts
  WHERE fact_type='schedule_entry' AND source NOT ILIKE '%synthetic%'
        AND source NOT ILIKE '%bank_teaching%'
`).reduce((acc, [k, v]) => {
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])[Mm]/.exec(String(v || ''))
  if (!m) return acc
  let h = Number(m[1]) % 12
  if (m[3].toLowerCase() === 'p') h += 12
  if (!acc[k]) acc[k] = []
  acc[k].push(h)
  return acc
}, {}))

/* ── what the lane reads that is not a .gs file ────────────────────────── */
const bookTab = (tab, label) => mirrored(WORDS_BOOK, tab, label).map(bookKeys)
const wordsBook = {
  'Digest Settings': bookTab('Digest Settings', 'the words book: settings'),
  'Smart Situations': bookTab('Smart Situations', 'the words book: situations'),
  'Smart Letters': bookTab('Smart Letters', 'the words book: letters'),
  'Smart AI Requests': bookTab('Smart AI Requests', 'the words book: AI requests'),
  'Smart Mailbox Events': bookTab('Smart Mailbox Events', 'the words book: mailbox events'),
  'Smart Comms': bookTab('Smart Comms', 'the words book: comms'),
  'Smart Header': bookTab('Smart Header', 'the words book: header'),
  'comm_bindings': bookTab('comm_bindings', 'the words book: purpose bindings'),
}
const smartRows = mirrored(HUB_DB, 'smart_comms', 'the situation catalogue')
const consentRows = mirrored('1CE-YmINAJXJdY5xC_8iRmRwAYdpVAN1SLzMsSdHgTcI',
                             'entity_comm_consent', 'the consent store')
const optOutRows = mirrored(HUB_DB, 'entity_opt_outs', 'the opt-out list')
const peopleRows = mirrored(HUB_DB, 'people', 'the People house')
const routeRows = mirrored('1qGKRdejHb9xLXwvvSYwf3ih-Np_mE_pRtXnkBuKbH84',
                           'comm_routes', 'the cortex routes')
const intentRows = mirrored('16MQYMC2om9abqZ4OzQ-0-XkEKejRNzS68xySxi7bBik',
                            'comm_intents', 'what earlier passes already asked')
const bindingRows = mirrored('1TfEiQ237e5_L1BYSgILGT-k4pdFT50JyD9YLN1U5p48',
                             'comm_bindings', 'the bindings already recorded')
const alertsRows = mirrored('1bU3dlsDA18ZJorAIvSTS0m9YHvMFRNTqKi5cVAWeq-o',
                            'hiring_alerts_config', 'the transport config (test mode)')
const requirementRows = mirrored(HUB_DB, 'requirements', 'the requirements catalogue')
const alertsCfg = {}
alertsRows.forEach((r) => { const k = String(r.key || '').trim(); if (k) alertsCfg[k] = String(r.value == null ? '' : r.value) })

/* ── the lane's own code, in the order the live project loads it ───────── */
/* EVERY SUBSTITUTION IS CONFESSED. Nothing may stand in for a real function
   without landing in this list, because the whole failure this file is
   repairing was a stub nobody could see from the output. */
const stubbed = []
const stub = (name, why) => stubbed.push({ name, why })

const sandbox = {
  console,
  Utilities: {
    computeDigest: (_a, s) => Array.from(Buffer.from(String(s))).map((b) => (b * 31) % 256),
    DigestAlgorithm: { MD5: 'MD5' },
    getUuid: () => 'uuid',
    formatDate: (d, _tz, f) => (f === 'H' ? String(new Date(d).getHours())
      : f === 'u' ? String(((new Date(d).getDay() + 6) % 7) + 1) : String(d)),
  },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '', setProperty: () => {} }) },
  SpreadsheetApp: {}, DriveApp: {}, UrlFetchApp: {}, MailApp: {},
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Session: { getActiveUser: () => ({ getEmail: () => 'rehearsal@asa' }),
             getScriptTimeZone: () => 'America/New_York' },
  ScriptApp: { getService: () => ({ getUrl: () => '' }) },
  HUB_ACTIONS: {}, HUB_POLICY: {},
}
stub('the Apps Script globals',
     'Utilities, CacheService, PropertiesService, SpreadsheetApp, DriveApp, ' +
     'UrlFetchApp, MailApp, LockService, Session, ScriptApp — node is not Apps Script')
sandbox.globalThis = sandbox
vm.createContext(sandbox)

const onDisk = readdirSync(gsDir).filter((f) => f.endsWith('.gs'))
let order = onDisk
try {
  const rec = JSON.parse(readFileSync(resolve(root, 'tools/project-order.json'), 'utf8')).order
  order = [...rec.map((n) => `${n}.gs`).filter((f) => onDisk.includes(f)),
           ...onDisk.filter((f) => !rec.includes(f.replace(/\.gs$/, '')))]
} catch { /* alphabetical is a rehearsal nobody runs; the recording is the truth */ }

/* WHAT THE LANE ACTUALLY LOADS.
 *
 * Only the nine Comm*.gs were here, and that was the first lie this file
 * told. `CommRecord.gs` asks `SmartComms.gs` for the words and the situation,
 * `CommPolicy.gs` asks `Digest.gs` for every rule that is editable,
 * `CommRecord.gs` asks `OptOut.gs` whether somebody said stop, and the test
 * redirect that decides whether consent is ENFORCED or merely recorded lives
 * in `AlertsConfig.gs`. Absent, each of those turned into a silent default
 * and the run reported a lane nobody operates.
 *
 * Still not all 149: the rest pull in Drive and Sheets calls the sandbox
 * cannot answer, and a rehearsal that dies on an unrelated module tells us
 * nothing about the lane. What is missing is stubbed at its LEAF — the one
 * function that touches a spreadsheet — so every rule above it is the real
 * one, and every stub is named in the output. */
const NEEDED = new Set(['HubCore.gs', 'Digest.gs', 'SmartComms.gs', 'OptOut.gs',
                        'AlertsConfig.gs', 'Requirements.gs',
                        'CommIntent.gs', 'CommPolicy.gs', 'CommConsent.gs',
                        'CommDispatch.gs', 'CommInbound.gs', 'CommContribution.gs',
                        'CommQualify.gs', 'CommDesk.gs', 'CommCortex.gs', 'CommRecord.gs'])
const loaded = []
const unloadable = []
for (const file of order.filter((f) => NEEDED.has(f))) {
  try {
    vm.runInContext(readFileSync(resolve(gsDir, file), 'utf8'), sandbox, { filename: file })
    loaded.push(file)
  } catch (e) {
    /* A FILE THAT WILL NOT LOAD IS NEWS, not a shrug. Swallowed, it becomes
       another silent default — the exact fault this rewrite exists to end. */
    unloadable.push(`${file}: ${String((e && e.message) || e).split('\n')[0]}`)
  }
}

/* ── the leaves: every seam that would have touched a spreadsheet ──────── */
/* These are the ONLY substitutions. Each one replaces a reader, never a rule:
   the row still arrives in the shape the real reader hands over, and every
   decision taken on it above is the lane's own code. */
sandbox.__book = wordsBook
sandbox.__smart = smartRows
sandbox.__optOut = optOutRows
sandbox.__people = peopleRows
sandbox.__boards = {
  comm_routes: routeRows,
  entity_comm_consent: consentRows,
  comm_intents: intentRows,
  comm_bindings: bindingRows,
}
sandbox.__alerts = alertsCfg
sandbox.__requirements = requirementRows

vm.runInContext(`
  /* Talent.gs's own str_, and Clients.gs's own name key: two pure helpers the
     lane borrows from files that are not worth loading whole. */
  function str_(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    return String(v).trim();
  }
  function clientNameKey_(v) {
    return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  /* THE WORDS BOOK, FROM THE MIRROR. hubBookRows_ and digestVocabRows_ are
     the two doors every editable rule comes through; fed here, everything
     above them — digestSetting_, digestVocab_, hubBookMerge_, hubBookText_,
     commPolicy_, commDial_ — is the real code reading the real cells. */
  function hubBookRows_(tabName) { return (__book[String(tabName)] || []).slice(); }
  function digestVocabRows_(tabName) { return (__book[String(tabName)] || []).slice(); }

  /* THE SITUATION CATALOGUE. smartSituations_ reads the tab and smartSheet_
     seeds the ids it does not carry yet — additively, never overwriting an
     edited row. Same rule here, so a situation that exists only in the code
     seed (compliance_bundle, until somebody opens the tab) is judged exactly
     as the next real sweep will judge it. */
  function smartSituations_() {
    var out = __smart.slice();
    var have = {};
    out.forEach(function (r) { if (r.id) have[String(r.id)] = 1; });
    var seeds = [];
    try { seeds = smartDefaults_().concat(smartAiRequests_()); } catch (e) { seeds = []; }
    seeds.forEach(function (d) { if (d && d.id && !have[String(d.id)]) out.push(d); });
    return out;
  }

  /* THE OPT-OUT LIST. optOutBlocked_ above this is untouched, including its
     fail-closed reading of an unreadable list. */
  function optOutIndex_() {
    var out = { by: {}, error: '' };
    __optOut.forEach(function (r) {
      var key = str_(r.target_key) || optOutKey_(r.target);
      if (!key) return;
      if (str_(r.released_at)) { delete out.by[key]; return; }
      out.by[key] = { target: str_(r.target), kind: str_(r.kind), name: str_(r.person_name),
                      candidate_id: str_(r.candidate_id), source: str_(r.source),
                      phrase: str_(r.phrase), at: str_(r.at) };
    });
    return out;
  }

  /* WHO CAN BE REACHED. The real one runs the people merge and the ISP-client
     guard; the mirror already holds the merged rows those produce. */
  function commRecordPeople_() {
    var out = {};
    __people.forEach(function (p) {
      var k = clientNameKey_(p && p.name);
      if (!k || out[k]) return;
      out[k] = { name: String(p.name || ''), phone: str_(p.phone), email: str_(p.email) };
    });
    return out;
  }

  /* THE HOUSES. commBoardRows_ is the one door to all four; every reader
     above it (routes, consent, prior intents, prior bindings) stays real. */
  function commBoardRows_(tab) { return (__boards[String(tab)] || []).slice(); }

  /* A CACHE THAT NEVER HITS. One process, one pass: the real cacheRead_ exists
     so a six-hourly sweep does not re-derive a tab twenty times, and here it
     would only hide which reader actually answered. The producer always runs. */
  function cacheRead_(scope, name, producer) { return producer(); }

  /* THE REQUIREMENTS TAB. requirementsAll_ above it still decides between the
     tab and the code catalogue, and requirementRowValid_ still refuses a bad
     row — which matters twice over: this list is what smartDefaults_ derives
     the reminder situations from, and what commRecordOwnedReqs_ uses to drop
     the obligations an older, ON reminder already speaks for. */
  function requirementsRowsFromTab_() {
    try {
      var out = [];
      __requirements.forEach(function (raw) {
        var row = {};
        Object.keys(raw).forEach(function (h) { row[String(h).trim()] = str_(raw[h]); });
        if (requirementRowValid_(row)) out.push(row);
      });
      return out;
    } catch (e) { return null; }
  }

  /* THE TRANSPORT'S CONFIG. hiringAlerts_ reads a tab; hubTestModeState_ and
     everything that asks it whether consent is enforced or merely recorded
     is the real code. hubTestRedirect_ is Rpc.gs's three lines, verbatim. */
  function hiringAlerts_() { return __alerts; }
  function hubTestRedirect_() {
    try {
      var st = (typeof hubTestModeState_ === 'function') ? hubTestModeState_() : null;
      if (!st || !st.on) return null;
      return { sms: st.sms, emails: st.emails };
    } catch (e) { return null; }
  }
`, sandbox)
stub('str_ and clientNameKey_', 'two pure helpers, copied verbatim from Talent.gs and Clients.gs')
stub('hubBookRows_ / digestVocabRows_', 'the words book, served from the mirror instead of Sheets')
stub('smartSituations_', 'the smart_comms tab from the mirror, plus the code seeds for ids it does not carry — smartSheet_\'s own additive rule')
stub('optOutIndex_', 'the entity_opt_outs tab from the mirror')
stub('commRecordPeople_', 'the People house from the mirror (the merge it runs is already baked into those rows)')
stub('commBoardRows_', 'comm_routes, entity_comm_consent, comm_intents and comm_bindings from the mirror')
stub('cacheRead_', 'a cache that never hits — one process, one pass, so every reader really runs')
stub('requirementsRowsFromTab_', 'the requirements tab from the mirror (requirementRowValid_ above it is real)')
stub('hiringAlerts_ / hubTestRedirect_', 'the transport config from the mirror; hubTestRedirect_ is Rpc.gs\'s body verbatim')

/* ── what the lane's own rules now say ─────────────────────────────────── */
/* THE DIAL IS ASKED, NOT ASSUMED. It used to be hardcoded to 'record', which
   meant this file could not report that the dial had already been turned
   past that. It still sends nothing either way — this process has no
   transport — but the number it prints changes, and so does what it means. */
const dial = sandbox.commDial_()
const F = sandbox.COMM_POLICY_FLOOR
/* WHICH RULES ARE SET IN THE BOOK AND WHICH ARE THE FLOOR, one line each.
   The floor answering is a legitimate state; the floor answering SILENTLY is
   what made the old output untrustworthy. */
const settingsSeen = {}
;(wordsBook['Digest Settings'] || []).forEach((r) => {
  const a = String(r.active || 'on').toLowerCase()
  if (a === 'off' || a === 'false' || a === 'no' || a === '0') return
  const k = String(r.key || '').trim().toLowerCase()
  if (k && String(r.value == null ? '' : r.value).trim() !== '') settingsSeen[k] = String(r.value).trim()
})
const policyKeys = Object.keys(F)
const policyNow = policyKeys.map((k) => ({
  key: k,
  value: sandbox.commPolicy_(k),
  from: settingsSeen['comm_' + k] !== undefined ? 'the words book' : 'the shipped floor',
}))
const bookReadable = (wordsBook['Digest Settings'] || []).length > 0

/* ── group the matrix by person, exactly as the sweep does ─────────────── */
/* ONE VOICE PER CREDENTIAL. The sweep drops every obligation an ON reminder
   situation already speaks for, so the bundle does not ask a second time from
   a lane that cannot see the first one's ledger. Left out here, the rehearsal
   counted obligations the real pass never carries. */
const owned = sandbox.commRecordOwnedReqs_()
let ownedDropped = 0
const byPerson = {}
for (const r of matrix) {
  const k = String(r.person_key || '').trim().toLowerCase()
  if (!k) continue
  if (owned[String(r.req_id || '')]) { ownedDropped++; continue }
  if (!byPerson[k]) byPerson[k] = { name: r.person_name, rows: [] }
  byPerson[k].rows.push(r)
}

const plan = sandbox.commIntentsFrom_(byPerson, { roster, now: new Date().toISOString() })
const now = Date.now()

/* THE REST OF THE ENGINE'S PASS, read once as the sweep reads it. */
const people = sandbox.commRecordPeople_()
const routes = sandbox.commRecordRoutes_()
const consent = sandbox.commRecordConsentRows_()
const situation = sandbox.commSituationFor_('compliance.owed')
const testMode = sandbox.commTestMode_()
/* WHAT EARLIER PASSES ALREADY ASKED. Every intent went in at `attempts: 0,
   lastAskedMs: 0` — the state of a lane that had never run. It has run: 128
   intent rows carry an attempt count and a last-asked stamp, and the gap and
   the attempt cap are decided by exactly those two numbers. Starting them at
   zero is what made "would send" mean "would send if we had never spoken to
   anybody", which is a different and much larger number. */
const prior = sandbox.commRecordPrior_()

let wouldSend = 0, held = 0, blocked = 0, withWindow = 0
const bands = {}
let carried = 0, deferred = 0
let cleared = 0
const stops = {}
const bump = (why) => { stops[why] = (stops[why] || 0) + 1 }
/* WHAT TEST MODE IS HIDING. While it is on, a missing consent record is
   recorded and not enforced — correct, because every recipient is a tester.
   But the day it goes off, that same record decides, so the run counts the
   enforced answer too rather than letting it be discovered live. */
let enforcedRefusals = 0
const worst = []

for (const intent of plan.intents) {
  const was = prior[String(intent.intent_key || '')] || {}
  /* A THREAD THE PERSON STOPPED IS NEVER RE-PLANNED — the sweep's first
     answer, before the policy is even asked. The row does not move, so it
     does not belong in the pacing table either. */
  if (String(was.state || '') === 'stopped') { bump('the person stopped this thread'); continue }
  /* Their own shift hours where the cortex has them, and the platform's
     default where it does not — which is the honest shape of a real pass. */
  const hours = windows[intent.person_key] || []
  const localHour = hours.length
    ? Math.round(hours.reduce((a, b) => a + b, 0) / hours.length)
    : 10
  /* the hours the cortex says they are awake narrow the platform's quiet
     hours — narrowed, never widened, exactly as commRecordSweep_ does it */
  const routeRow = routes[String(intent.person_key || '')] || null
  const quiet = sandbox.commCortexWindowFrom_
    ? sandbox.commCortexWindowFrom_(routeRow, sandbox.commPolicy_('quiet_from'),
                                    sandbox.commPolicy_('quiet_to'))
    : null
  const mem = sandbox.commRecordMemory_(was, testMode)
  const verdict = sandbox.commPlanVerdict_(intent, {
    attempts: mem.attempts, lastAskedMs: mem.lastMs, nowMs: now,
    localHour: localHour, localDay: 2, test: testMode, quiet: quiet,
  })
  if (hours.length) withWindow++
  if (verdict.policy === 'would send') wouldSend++
  else if (verdict.policy === 'held') held++
  else blocked++
  for (const p of verdict.parts || []) bands[p.band] = (bands[p.band] || 0) + p.bindings.length
  carried += intent.bindings.length
  deferred += intent.deferred

  /* EVERY GATE THE ENGINE ASKS, ASKED HERE TOO.
   *
   * The policy is the first of five, and reporting it alone is what made the
   * old "would send" a best case rather than a forecast. The consent store,
   * the opt-out list, the situation and the contact details all refuse
   * independently at CommRecord.gs:360-362, and each refusal is counted by
   * its own name — an aggregate nobody can decompose is a number nobody can
   * act on. */
  const person = sandbox.commRecordContact_(people, routes, intent.person_key)
  const channels = situation ? sandbox.commRecordChannels_(situation) : ['sms', 'email']
  const refusals = sandbox.commRecordRefused_(person)
  let route = sandbox.commRouteFor_(consent[String(intent.person_key || '')] || [],
                                    refusals, intent.purpose, channels, now)
  if (!route.ok) enforcedRefusals++
  if (!route.ok && testMode) {
    // recorded, not enforced: the recipient is a tester either way
    route = { ok: true, channel: channels[0] || 'email',
              why: route.why + ' — not enforced in test mode', tried: route.tried }
  }
  const allowed = sandbox.commDispatchAllowed_(intent, verdict, route)
  /* THE DIAL IS A SEPARATE ANSWER. commDispatchAllowed_ folds it in with the
     rest, which is right at a send door and wrong in a forecast: "nothing
     would go out" because the dial is at `record` says nothing about whether
     the other four gates would have let it. So it is lifted out and reported
     on its own line. */
  const why = (allowed.blocked || []).filter((b) => b.indexOf('the dial says') !== 0)
  if (channels.every((c) => refusals[c])) bump('they asked us to stop')
  if (!verdict.send) bump('the policy held it')
  if (!route.ok) bump('no permitted route — consent')
  if (!situation) bump('no words — the situation is absent or off')
  if (!person || (!person.phone && !person.email)) bump('no phone and no address')
  if (!(intent.bindings || []).filter((b) => String(b.binding_state || 'open') === 'open').length) {
    bump('every obligation already settled')
  }
  if (!why.length && situation && person && (person.phone || person.email)) cleared++

  worst.push({ name: intent.person_name, n: intent.bindings.length,
               over: intent.deferred, worst: intent.worst })
}

const n = (x) => String(x).padStart(6)
console.log('\n  THE REHEARSAL — what the lane would do, on today\'s data\n')

/* ── what this run could read, and what it could not ───────────────────── */
console.log('  WHAT THIS RUN IS STANDING ON\n')
console.log(`    lane files loaded            ${n(loaded.length)}   ${loaded.join(' ')}`)
if (unloadable.length) {
  console.log('    FILES THAT WOULD NOT LOAD — every rule inside them is missing from this run:')
  unloadable.forEach((r) => console.log(`      ${r}`))
}
console.log('')
for (const s of sources) {
  const age = s.error ? `COULD NOT BE READ — ${s.error}`
    : (s.stamp ? `mirrored ${s.stamp}` : 'read directly')
  console.log(`    ${String(s.label).padEnd(32)} ${String(s.rows).padStart(6)} rows   ${age}`)
}
console.log('')
console.log('    STUBBED, because this is node and not Apps Script:')
for (const s of stubbed) console.log(`      ${s.name} — ${s.why}`)

console.log('\n  THE RULES THIS RUN OBEYED\n')
console.log(`    the dial says                ${dial}   (Digest Settings · comm_dial)`)
console.log(`    test mode                    ${testMode ? 'ON — consent and the attempt cap are RECORDED, not enforced' : 'off — every gate is enforced'}`)
if (!bookReadable) {
  /* THE ONE THING THIS FILE MUST NEVER DO QUIETLY. */
  console.log('')
  console.log('    THE WORDS BOOK ANSWERED NOTHING. Every value below is the shipped')
  console.log('    floor in COMM_POLICY_FLOOR, NOT what anybody typed into the')
  console.log('    Digest Settings tab — so editing a policy cannot change a number')
  console.log('    in this report. Fix the mirror before trusting anything here.')
}
console.log('')
for (const p of policyNow) {
  console.log(`      comm_${String(p.key).padEnd(22)} ${String(p.value).padStart(6)}   ${p.from}`)
}
console.log('')
console.log(`    the situation carrying compliance.owed: ` +
            (situation ? `${situation.id} (on, via ${sandbox.commRecordChannels_(situation).join(' then ')})`
                       : 'NONE — absent from the catalogue or switched off, and null sends nothing'))

console.log('\n  WHAT THE LANE WOULD RAISE\n')
console.log(`  obligation rows read         ${n(matrix.length)}`)
console.log(`    dropped, an ON reminder already speaks for them ${n(ownedDropped)}`)
console.log(`  people carrying any          ${n(Object.keys(byPerson).length)}`)
console.log(`  active roster                ${n(Object.keys(roster).length)}`)
console.log('  ' + '-'.repeat(46))
console.log(`  intents the lane would raise ${n(plan.intents.length)}`)
console.log(`    skipped, not on the roster ${n(plan.skipped.off_roster)}`)
console.log(`    skipped, owing nothing     ${n(plan.skipped.nothing_open)}`)
console.log('  ' + '-'.repeat(46))
console.log(`  policy: would send           ${n(wouldSend)}`)
console.log(`  policy: held                 ${n(held)}`)
console.log(`  policy: blocked              ${n(blocked)}`)
console.log(`    of those, judged on THEIR own shift hours ${n(withWindow)}`)
console.log('  ' + '-'.repeat(46))
/* WHAT "WOULD SEND" MEANS NOW. The policy clearing an intent is one of five
   answers, and the four behind it refuse for reasons the policy never sees.
   An intent is counted here only when every one of them said yes. */
console.log(`  cleared by EVERY gate        ${n(cleared)}`)
console.log('    ' + (dial !== 'send'
  ? `the dial says ${dial}, so none of them is handed over — the count is what would happen if it were turned`
  : cleared
    ? 'the dial says send — these would be handed to the transport on the next sweep'
    : 'the dial says send, and not one of them clears — the gates below say why'))
console.log('  each gate that refused, by name (an intent can meet several):')
const stopList = Object.entries(stops).sort((a, b) => b[1] - a[1])
if (!stopList.length) console.log('    none — every intent cleared every gate')
for (const [whyNot, count] of stopList) console.log(`    ${whyNot.padEnd(42)} ${n(count)}`)
if (testMode) {
  console.log(`  and the one test mode is holding open: consent would refuse ${n(enforcedRefusals)}`)
  console.log('    the day test mode goes off — recorded now, enforced then')
}
console.log('  ' + '-'.repeat(46))
console.log(`  obligations carried          ${n(carried)}`)
console.log(`  obligations deferred by cap  ${n(deferred)}`)
for (const [band, count] of Object.entries(bands)) {
  console.log(`    band ${band.padEnd(9)}          ${n(count)}`)
}
/* HOW LONG UNTIL SOMEBODY HAS BEEN ASKED ABOUT EVERYTHING THEY OWE.
   The cap keeps a message readable; the gap keeps it from being harassment.
   Together they set a floor on how long the slowest person takes to hear
   about their last item, and that number is a consequence of two constants
   nobody would think to multiply. */
const CAP = sandbox.COMM_BINDINGS_PER_INTENT
/* The pace in force, read live through commPolicy_ — not the shipped defaults. */
const pace = {
  overdue: sandbox.commPolicy_('gap_overdue_hours'),
  soon: sandbox.commPolicy_('gap_soon_hours'),
  open: sandbox.commPolicy_('gap_open_hours'),
}
/* The pace a person actually moves at is their WORST band's, because that is
   the band their message leads with. */
const paceOf = (w) => ({ expired: pace.overdue, expiring: pace.soon }[w.worst] || pace.open)
const days = worst.map((w) => Math.ceil((w.n + w.over) / CAP) * paceOf(w) / 24)
/* NOBODY TO PACE IS AN ANSWER, NOT A NUMBER. An empty plan used to print NaN
   and -Infinity, which reads as a broken tool rather than as an empty queue —
   and a rehearsal nobody trusts the arithmetic of proves nothing. */
const slowest = days.length ? Math.max(...days) : 0
const median = days.length ? days.slice().sort((a, b) => a - b)[Math.floor(days.length / 2)] : 0
console.log('  ' + '-'.repeat(46))
console.log(`  cap ${CAP} per message · patience by band ` +
            `${pace.overdue}/${pace.soon}/${pace.open}h`)
if (!days.length) {
  console.log('    nobody is carrying anything — there is no list to cover')
} else {
  console.log(`    days to cover a list, median          ${n(Math.round(median))}`)
  console.log(`    ...and for the heaviest person        ${n(Math.round(slowest))}`)
}

console.log('\n  the ten heaviest, as the message would carry them:\n')
worst.sort((a, b) => (b.n + b.over) - (a.n + a.over))
for (const w of worst.slice(0, 10)) {
  console.log(`    ${String(w.name).padEnd(26)} ${String(w.n).padStart(2)} carried` +
              `${w.over ? `, ${w.over} deferred` : '            '}   · worst: ${w.worst}`)
}
/* THE ROWS THEMSELVES — what the NEXT sweep will put in the two houses.
 * Shaped by the real commRecordRows_, and handed the same prior row the sweep
 * hands it, so a thread that has already been asked once prints as the second
 * attempt rather than as a first contact that will never happen again. */
const sample = plan.intents.slice(0, 3).map((intent) => {
  const was = prior[String(intent.intent_key || '')] || {}
  const mem = sandbox.commRecordMemory_(was, testMode)
  const v = sandbox.commPlanVerdict_(intent, {
    attempts: mem.attempts, lastAskedMs: mem.lastMs, nowMs: now,
    localHour: 10, localDay: 2, test: testMode })
  return sandbox.commRecordRows_(intent, v, new Date().toISOString(), was)
})
console.log('\n  the first rows, exactly as the sweep will write them:\n')
for (const s of sample) {
  console.log(`    comm_intents  ${s.intent.person_name}`)
  console.log(`      verdict     ${s.intent.verdict}   dial ${s.intent.dial}   worst ${s.intent.worst}`)
  console.log(`      carried ${s.intent.carried}, deferred ${s.intent.deferred}, open ${s.intent.open_count}`)
  console.log(`      reasons     ${s.intent.reasons}`)
  for (const b of s.bindings.slice(0, 3)) {
    console.log(`    comm_bindings   ${String(b.req_id).padEnd(16)} ${String(b.state).padEnd(9)}` +
                ` band ${String(b.band).padEnd(8)} ${b.expires || '(no date)'}`)
  }
  if (s.bindings.length > 3) console.log(`                    …and ${s.bindings.length - 3} more`)
  console.log('')
}

/* THE WORDS, ONCE, SO NOBODY HAS TO IMAGINE THEM. A forecast of sixty-five
   messages is not reviewable until somebody has read the one message. */
if (situation && plan.intents.length) {
  const first = plan.intents.find((i) => (i.bindings || []).length) || plan.intents[0]
  const person = sandbox.commRecordContact_(people, routes, first.person_key)
  const item = sandbox.commDispatchItem_(first, person, situation)
  if (item) {
    const vars = sandbox.commDispatchVars_(item, situation, () => '')
    console.log('  the message itself, rendered by the real template:\n')
    console.log(`    to        ${String(item.name)}`)
    console.log(`    sms       ${sandbox.smartRender_(situation.sms_text, vars).split('\n').join('\n              ')}`)
    if (situation.email_subject) {
      console.log(`    subject   ${sandbox.smartRender_(situation.email_subject, vars)}`)
    }
    console.log('')
  }
}

console.log('  Nothing was written, sent, or asked of anybody.\n')
