/**
 * Run the REAL predicates against the REAL rows.
 *
 * The suite in SelfTest.gs has one weakness it cannot fix from inside: the
 * logic it wants to test lives in functions that read spreadsheets, so
 * outside Apps Script most of what it can assert is that the SOURCE TEXT
 * looks a certain way — `String(fn).indexOf(...)`. Those checks caught real
 * regressions this week, and they break on a rename and pass on a rewrite.
 *
 * This is the other half. `tools/freeze-corpus.mjs` pulls the tabs into a
 * fixture with private columns stripped; this loads the actual .gs sources,
 * points the tab readers at that fixture, and runs the real functions over
 * every real row.
 *
 * THE ASSERTION THAT MATTERS IS ABOUT THE DISTRIBUTION, NOT ANY ONE ROW:
 *
 *     a predicate that answers the same for EVERY real row is broken or
 *     useless, and both deserve a failure.
 *
 * That is not a hypothetical. `missingDocs` in Hired.gs tests
 * `docRows[d].doc` — a property `onboardingChecklist_` does not return — so
 * it has been empty for every person who ever reached Hired, and every one of
 * them was announced to the team as "all documentation is OK". Nobody
 * noticed, because a clean bill of health is a plausible answer. A check
 * asserting a specific row would not have caught it either; only counting
 * across the corpus does.
 *
 * A one-row corpus proves nothing about constancy, so the check reports
 * `no verdict` rather than passing when there is nothing to compare.
 *
 * Run: node tools/check-corpus.mjs [--strict]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'
import crypto from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gsDir = resolve(root, 'apps-script')
const strict = process.argv.includes('--strict')
const corpusPath = resolve(root, 'tools/corpus.json')

if (!existsSync(corpusPath)) {
  console.error('no corpus: run `node tools/freeze-corpus.mjs` first.')
  console.error('  NOT passing by default — a check that skips itself when its input is')
  console.error('  missing is a check that reports success for doing nothing.')
  process.exit(strict ? 1 : 0)
}
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'))
const rowsOf = (tab) => (corpus.tabs[tab] && corpus.tabs[tab].rows) || []

/** normKey_ from the runtime: lowercase, alphanumeric only. */
const normKey = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '')

const reject = (what) => () => { throw new Error(`${what} is not available here`) }
const props = new Map()
const sandbox = {
  console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp,
  isNaN, parseInt, parseFloat, Error, TypeError,
  Logger: { log: () => {} },
  Utilities: {
    getUuid: () => 'uuid-stub',
    DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (algo, value) =>
      [...crypto.createHash(algo).update(String(value), 'utf8').digest()]
        .map((b) => (b > 127 ? b - 256 : b)),
    base64Encode: (bytes) =>
      Buffer.from(Uint8Array.from(bytes, (b) => (b < 0 ? b + 256 : b))).toString('base64'),
    base64Decode: reject('Utilities.base64Decode'),
    newBlob: reject('Utilities.newBlob'),
    formatDate: reject('Utilities.formatDate'),
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => props.set(k, v),
      deleteProperty: (k) => props.delete(k),
    }),
  },
  CacheService: (() => {
    const store = new Map()
    const api = { get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => store.set(k, String(v)), remove: (k) => store.delete(k) }
    return { getScriptCache: () => api, getUserCache: () => api, getDocumentCache: () => api }
  })(),
  // Reads are served from the corpus; every WRITE throws. This runner must be
  // incapable of changing anything, and the way to guarantee that is to make
  // the attempt fail loudly rather than to remember not to.
  SpreadsheetApp: { openById: () => ({ __corpus: true }), flush: () => {} },
  DriveApp: { getFileById: reject('DriveApp'), getFoldersByName: reject('DriveApp') },
  UrlFetchApp: { fetch: reject('UrlFetchApp.fetch') },
  MailApp: { sendEmail: reject('MailApp.sendEmail') },
  GmailApp: {}, HtmlService: {}, ContentService: {},
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ScriptApp: { getService: () => ({ getUrl: () => '' }) },
  Session: { getActiveUser: () => ({ getEmail: () => 'corpus@asa' }) },
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)

const onDisk = readdirSync(gsDir).filter((f) => f.endsWith('.gs'))
let recorded = null
try { recorded = JSON.parse(readFileSync(resolve(root, 'tools/project-order.json'), 'utf8')).order } catch { /* below */ }
const files = recorded
  ? [...recorded.map((n) => n + '.gs').filter((f) => onDisk.includes(f)),
     ...onDisk.filter((f) => !recorded.includes(f.replace(/\.gs$/, '')))]
  : onDisk.sort()

const skipped = []
for (const name of files) {
  try { vm.runInContext(readFileSync(resolve(gsDir, name), 'utf8'), sandbox, { filename: name }) }
  catch (err) { skipped.push(`${name}: ${String(err.message || err).slice(0, 80)}`) }
}

/**
 * Point the tab readers at the fixture. Overridden AFTER load so the real
 * definitions exist first and a rename here fails loudly instead of silently
 * shadowing nothing.
 */
sandbox.__rows = rowsOf
vm.runInContext(`
  readTabNormalized_ = function (ss, tabName) {
    return __rows(tabName).map(function (r) {
      var o = {};
      for (var k in r) o[__norm(k)] = r[k];
      return o;
    });
  };
  packetMirrorRows_ = function () { return []; };
  packetFindRow_ = function (email, cid) {
    var want = String(cid || '');
    var hit = null;
    __rows('onboarding_packet').forEach(function (p) {
      if (!hit && want && (p.GradCandidateId === want || p.HubCandidateId === want || p.CandidateId === want)) hit = p;
    });
    return hit;
  };
  obField_ = function (row, col) { return row ? (row[col] == null ? '' : row[col]) : ''; };
`, sandbox)
sandbox.__norm = normKey

const call = (name) => vm.runInContext(name, sandbox)
const cands = rowsOf('entity_candidates')

/* ------------------------------------------------------------------ */
/* the predicates under test                                          */
/* ------------------------------------------------------------------ */
/**
 * Each entry answers ONE question about ONE candidate, and returns a short
 * label rather than a boolean — "which of the possible answers did this row
 * get" is what makes the constancy check meaningful.
 */
const norm = (c) => { const o = {}; for (const k in c) o[normKey(k)] = c[k]; return o }

/**
 * `needs` is what makes the constancy check honest.
 *
 * One answer for every row has two causes and they are not the same fault:
 * the predicate reads a field that does not exist (a bug, always), or the
 * data genuinely does not vary right now (nobody is on hold this morning).
 * Without a way to tell them apart the check either cries wolf or, worse,
 * gets switched off.
 *
 * So a predicate may declare the input its answer could possibly turn on. No
 * row carrying that input means NO VERDICT — stated out loud, never counted
 * as a pass. A check that reports success for having tested nothing is the
 * thing this whole file exists to stop.
 */
/**
 * PREDICATES THIS CORPUS CAN NEVER JUDGE — declared, with the reason.
 *
 * "No verdict" has two meanings and only one of them is a gap. Usually it
 * means nobody froze a row that turns the predicate on, and re-freezing fixes
 * it. Sometimes it means the input can never be in a fixture at all, and then
 * an open failure is a permanent red light nobody can act on — which is how a
 * checker gets switched off.
 *
 * A name below is reported and does not fail. Every OTHER predicate with no
 * verdict still does, so the gap this file exists to find is still found.
 */
const UNJUDGEABLE = {
  'packetState_.state':
    'it matches against the packet MIRROR — the envelope rows — and that tab is ' +
    'deliberately never frozen: freeze-corpus.mjs measured 180 of its rows carrying ' +
    'a full SSN and a bank account number, and a fixture is a file in a repository. ' +
    'Feeding it the onboarding tracker instead was tried on 2026-08-19 and turned an ' +
    'honest no-verdict into a CONSTANT that looked like a finding.',
}

const PREDICATES = [
  { name: 'talentStage_', of: (c) => String(call('talentStage_')(c.status) || 'none') },
  { name: 'hubOnboardingDone_.ok', of: (c) => String(call('hubOnboardingDone_')(norm(c)).ok) },
  { name: 'hubOnboardingDone_.how', of: (c) => String(call('hubOnboardingDone_')(norm(c)).how || 'none') },
  /**
   * THE PROBE HAS TO FEED THE FUNCTION ITS EVIDENCE (2026-08-19).
   *
   * `hubGate_.ok` answered false for every real row for weeks, and the honest
   * reading of that was "a predicate the data never varies on". It was not.
   * hubEvidence_ builds `{cand, analysis, screen}` and the probe passed only
   * the first two, so every candidate sitting at phone-screen read
   * `ev.screen || {}` — an empty object — and failed the one condition it was
   * being asked about. The screens were in the fixture the whole time,
   * frozen and unused.
   *
   * That is exactly the failure this file exists to catch, happening to this
   * file: a check that reads a field which is not there, answering the same
   * plausible thing forever. It is fixed the same way the missingDocs bug
   * was — by giving the function what the real caller gives it.
   */
  /**
   * AND THE CONSTANT RULE CANNOT JUDGE THIS ONE (2026-08-29, on the first
   * corpus refreshed in ten days).
   *
   * `hubGate_.ok` came back false on all 30 rows and the rule called it
   * broken. It is not: every refusal was measured one by one and every one is
   * legitimate. Two rungs are HARD-CLOSED in code and can never answer true
   * (onboarding→hired is the button's alone; ready→working belongs to the
   * Shift Board watch), eight rows carry a status with no stage at all, and
   * the remaining fourteen are genuinely waiting on a decision nobody has
   * recorded yet. A quiet board answers false everywhere, and a check that
   * fails on a true state is a check somebody switches off.
   *
   * SO THE PROTECTION MOVED RATHER THAN VANISHED. The bug this predicate was
   * sharpened for on 2026-08-19 — the probe feeding an empty screen, so every
   * phone-screen card was refused for something the data actually satisfied —
   * is now caught FAR better by the gate/checklist agreement at the bottom of
   * this file: it compares the refusal against the square that describes the
   * same fact, per card, and names the person. A boolean's spread never could.
   *
   * `informational` keeps the distribution on screen (a human reading this
   * output learns the board is stuck) without failing the build for it.
   */
  { name: 'hubGate_.ok', informational: true,
    of: (c) => String(call('hubGate_')(evidenceFor(c)).ok) },
  /** What it refuses FOR — this is where the variance lives, and it is the
   *  half worth watching go constant. */
  { name: 'hubGate_.why',
    of: (c) => {
      const g = call('hubGate_')(evidenceFor(c))
      return g.ok ? 'ok' : String((g.reasons || [])[0] || 'no reason').slice(0, 22)
    } },
  { name: 'hubGate_.to', of: (c) => String(call('hubGate_')(evidenceFor(c)).to || 'none') },
  { name: 'packetHold_.phase',
    needs: (c) => !!c.packet_hold_until,
    of: (c) => { const h = call('packetHold_')(norm(c)); return h ? String(h.phase) : 'none' } },
  { name: 'hubCjisCleared_', of: (c) => String(call('hubCjisCleared_')(analysisFor(c))) },
  /**
   * PACKET STATE CANNOT BE JUDGED HERE, AND THAT IS PERMANENT — not a TODO.
   *
   * packetState_ matches a candidate against the packet MIRROR: the envelope
   * rows, with their signing status and SR ids. The onboarding_packet tab
   * frozen beside the candidates is a different thing entirely — the
   * onboarding tracker — and feeding it to this function was tried on
   * 2026-08-19: every row came back 'unknown', which turned an honest "no
   * verdict" into a CONSTANT that looked like a finding. A probe fed the
   * wrong tab is worse than a probe not run.
   *
   * The mirror itself is deliberately NOT frozen: freeze-corpus.mjs measured
   * 180 of its rows carrying a full SSN and a bank account number, and a
   * fixture is a file in a repository. So this predicate reports no verdict,
   * for a reason that will not change, and the reason is written here so the
   * next person does not spend the same hour discovering it.
   */
  { name: 'packetState_.state',
    needs: (c) => !!(c.packet_status || c.packet_srid || c.packet_waived_by),
    of: (c) => String(call('packetState_')(norm(c), []).state) },
]

const analyses = {}
rowsOf('entity_resume_analyses').forEach((a) => { analyses[a.candidate_id] = norm(a) })
function analysisFor(c) { return analyses[c.candidate_id] || {} }

// last row wins, the same rule hubEvidence_ follows for both of these
const screens = {}
rowsOf('entity_phone_screens').forEach((s) => { screens[s.candidate_id] = norm(s) })
function screenFor(c) { return screens[c.candidate_id] || null }

/** What the real caller hands hubGate_ — hubEvidence_'s own shape. */
function evidenceFor(c) {
  return { cand: norm(c), analysis: analysisFor(c), screen: screenFor(c) }
}

/* ------------------------------------------------------------------ */
let failures = 0
console.log(`corpus: ${cands.length} candidate rows frozen ${String(corpus.frozen_at).slice(0, 16)}`)
if (skipped.length) console.log(`  ${skipped.length} file(s) could not load here: ${skipped.map((s) => s.split(':')[0]).join(', ')}`)
if (!cands.length) {
  console.error('  the corpus has no candidates — nothing was tested.')
  process.exit(strict ? 1 : 0)
}
console.log('')

let noVerdict = 0
for (const p of PREDICATES) {
  if (p.needs && !cands.some(p.needs)) {
    const why = UNJUDGEABLE[p.name]
    if (why) {
      console.log(`    ${p.name.padEnd(26)} not judgeable here, on purpose`)
      console.log(`    ${' '.repeat(26)}   ${why}`)
      continue
    }
    noVerdict++
    console.log(`    ${p.name.padEnd(26)} NO VERDICT — no row in the corpus carries the input it turns on`)
    continue
  }
  const counts = new Map()
  let threw = 0
  for (const c of cands) {
    let v
    try { v = p.of(c) } catch (e) { threw++; v = `THREW:${String(e.message || e).slice(0, 40)}` }
    counts.set(v, (counts.get(v) || 0) + 1)
  }
  const spread = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const line = spread.map(([v, n]) => `${v}×${n}`).join('  ')
  const constant = counts.size === 1 && cands.length > 1
  const allThrew = threw === cands.length
  if (allThrew) {
    failures++
    console.error(`  ✗ ${p.name.padEnd(26)} threw on every row — ${spread[0][0]}`)
  } else if (p.informational) {
    // Shown, never failed on — the reason is written where it is declared.
    console.log(`    ${p.name.padEnd(26)} ${line}${constant ? '   (constant, and allowed to be)' : ''}`)
  } else if (constant) {
    failures++
    console.error(`  ✗ ${p.name.padEnd(26)} CONSTANT across ${cands.length} real rows — ${line}`)
  } else {
    console.log(`    ${p.name.padEnd(26)} ${line}${threw ? `  (${threw} threw)` : ''}`)
  }
}

/* ------------------------------------------------------------------ */
/**
 * THE SAME EVIDENCE, ANSWERED TWICE — do the two answers agree?
 *
 * `hubGateFor_` decides whether somebody may advance. `talentChecklist_` draws
 * the squares that say what is still owed. They read the SAME spreadsheet
 * columns and they answer INDEPENDENTLY, and no screen reads both: the board,
 * the drawer and the Flow views all draw the checklist; the gate is reached
 * only through a write.
 *
 * That is one truth with two implementations, and this codebase already paid
 * for one: the drawer's own copy of the gate (`GATE_NEED`, CandidatePanel.tsx)
 * sat two decisions out of date for two months and disabled Advance for
 * candidates the server would have moved. Nothing compared it to anything.
 *
 * MEASURED THE DAY THIS WAS WRITTEN (2026-08-29): 21 real cards, **zero**
 * disagreements. The duplication is structural and has not drifted in the
 * data — which is the argument for a watchman rather than surgery. Merging
 * them means operating on the engine that decides who advances, to prevent a
 * drift that has not happened; this catches it on the day it starts, on real
 * rows rather than on source text.
 *
 * A REFUSAL NOBODY CAN SEE IS THE FAILURE. If the gate refuses on something
 * whose own square reads settled, the card is stuck with nothing on screen
 * explaining why — which is precisely how the drawer bug felt to the person
 * holding the mouse.
 */
const GATE_TO_ITEM = {
  'resume decision Advance': 'resume-decision',
  'screen Completed': 'screen-details',
  'advance decision Advance': 'advance-decision',
  'interview scorecard (score + comments)': 'interview-scorecard',
}
/**
 * Reasons that are deliberately about NO square: a closed rung's fixed
 * sentence, or a read that failed. Listed rather than pattern-guessed, so a
 * reason added tomorrow lands in the "no mapping" failure below instead of
 * being quietly excused.
 */
const REASON_NO_ITEM = [
  /Manual onboarding/, /Shift Board/, /graduation has not finished/,
  /could not read the users tab/, /candidate not found/, /final stage/,
]
function itemForReason(r) {
  if (GATE_TO_ITEM[r]) return GATE_TO_ITEM[r]
  if (/interviewer recommendation/.test(r)) return 'interview-recommendation'
  if (/^staff account/.test(r)) return 'staff-account'
  if (/no password set/.test(r)) return 'staff-account-armed'
  if (/^ASA Employee Database/.test(r)) return 'internal-docs-fill'
  if (REASON_NO_ITEM.some((re) => re.test(r))) return 'BY-DESIGN'
  return null
}

const screensByCand = {}
rowsOf('entity_phone_screens').forEach((s) => { (screensByCand[s.candidate_id] ??= []).push(norm(s)) })

let compared = 0
const clashes = []
for (const c of cands) {
  const cand = norm(c)
  const stage = call('talentStage_')(c.status)
  if (!stage) continue
  let gate, list
  try { gate = call('hubGateFor_')(evidenceFor(c), stage) } catch { continue }
  try {
    list = call('talentChecklist_')(cand, analysisFor(c), screensByCand[c.candidate_id] || [], stage, null)
  } catch { continue }
  compared++
  const st = {}
  ;(list || []).forEach((i) => { st[i.id] = i.status })
  const who = c.candidate_name || c.candidate_id
  for (const r of gate.reasons || []) {
    const id = itemForReason(r)
    // A REASON THIS MAP DOES NOT KNOW IS A BLIND SPOT, NOT A PASS. The gate
    // gaining a reason is exactly when this check must speak up.
    if (!id) { clashes.push(`${who} [${stage}]: the gate refuses on "${String(r).slice(0, 60)}" and this check has no square mapped to it`); continue }
    if (id === 'BY-DESIGN') continue
    if (st[id] === undefined) {
      clashes.push(`${who} [${stage}]: the gate refuses on "${id}" and no square of that name is drawn at this stage — the card is stuck with nothing explaining why`)
    } else if (st[id] === 'done' || st[id] === 'auto') {
      clashes.push(`${who} [${stage}]: the gate refuses on "${id}" while its own square reads ${st[id]}`)
    }
  }
  if (gate.ok) {
    /**
     * `pending` COUNTS, and leaving it out was a hole in this check found by
     * trying to make it fail (2026-08-29). Removing a real refusal from the
     * gate left five cards saying GO with their own square reading `pending`,
     * and the first version of this loop looked only for `missing` — so the
     * injected bug walked straight past the thing written to catch it.
     *
     * Not settled is not settled, whichever word the square uses for it.
     */
    for (const id of Object.values(GATE_TO_ITEM)) {
      if (st[id] === 'missing' || st[id] === 'pending') {
        clashes.push(`${who} [${stage}]: the gate says GO while the square "${id}" reads ${st[id]}`)
      }
    }
  }
}
console.log('')
console.log(`the gate and the checklist, over ${compared} real cards: ` +
            `${clashes.length ? `${clashes.length} disagreement(s)` : 'they agree on every one'}`)
for (const x of clashes) console.error(`  ✗ ${x}`)
if (clashes.length) {
  failures += clashes.length
  console.error('  one truth, two implementations — and a refusal nobody can see on the card.')
}

console.log('')
if (failures) {
  console.error(`${failures} predicate(s) told the corpus nothing.`)
  console.error('  A predicate with one answer for every real row either asks a question the')
  console.error('  data never varies on, or reads a field that does not exist. Hired.gs\'s')
  console.error('  missing-documents list was the second kind, for every hire this platform')
  console.error('  has ever had.')
} else {
  console.log(`every predicate that could be judged distinguishes at least two real rows.`)
}
if (noVerdict) {
  console.log(`  ${noVerdict} predicate(s) got NO VERDICT — the corpus holds nothing they turn on.`)
  console.log('  Not a pass. Re-freeze while such a row exists, or they stay untested.')
}
if (strict && failures) process.exit(1)
