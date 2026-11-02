/**
 * EVERY MESSAGE THIS PLATFORM CAN SEND, COUNTED — and each one proved to have
 * words in it.
 *
 * The failure this exists to make impossible: a message MOVING between two
 * configuration homes and landing in neither.
 *
 * On 2026-08-08 six templates moved out of `hiring_alerts_config` into Smart
 * Comms situations. `check-config-used.mjs` noticed the six keys had gone dead
 * — but only because they were still declared. Had they been deleted in the
 * same commit that forgot to add the situations, every check would have been
 * green and the platform would simply have stopped saying three things. No
 * error, no log line: a sender rendering an empty template sends an empty
 * message, and the account finds out from a new hire who was never chased.
 *
 * So the question is not "is this key used" but "does every message have a
 * body, wherever its body now lives". The inventory is the UNION of the
 * sources, so moving one from A to B cannot reduce the total.
 *
 * THE SOURCES, and why each is read the way it is:
 *   hubAlertRender_('key', vars, fallback)   the hiring templates. A key with
 *       no row is fine IF the literal fallback is non-empty — that is the
 *       deliberate design ("a missing tab can never silence an alert"), so
 *       the check verifies the fallback rather than banning the case.
 *   SMART_HIRING_EVENTS / smartDefaults_     the situations. A situation whose
 *       `channels` names sms must carry sms_text; the same for email.
 *
 * Run: node tools/check-messages.mjs [--strict]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gsDir = resolve(root, 'apps-script')
const strict = process.argv.includes('--strict')

const read = (f) => readFileSync(resolve(gsDir, f), 'utf8')
const files = readdirSync(gsDir).filter((f) => f.endsWith('.gs'))

/* ---- the values, from the REAL sources -------------------------------
 * Loaded the way the runtime loads them, not scraped with a regex. The first
 * version of this file matched declarations by pattern and reported
 * SMART_DODD_SMS as empty because it is concatenated across five lines — a
 * checker whose extractor is wrong invents failures, and a checker that
 * invents failures gets switched off.
 */
const reject = () => { throw new Error('not available here') }
const sb = {
  console, JSON, String, Number, Boolean, Array, Object, RegExp, Date, Math,
  isNaN, parseInt, parseFloat, Error, TypeError,
  Logger: { log: () => {} },
  Utilities: { getUuid: () => 'u' },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  SpreadsheetApp: { openById: reject }, LockService: { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) },
  UrlFetchApp: { fetch: reject }, MailApp: {}, DriveApp: {}, Session: {},
  HtmlService: {}, ContentService: {}, ScriptApp: {},
}
sb.globalThis = sb
vm.createContext(sb)
let recorded = null
try { recorded = JSON.parse(readFileSync(resolve(root, 'tools/project-order.json'), 'utf8')).order } catch { /* below */ }
const ordered = recorded
  ? [...recorded.map((n) => n + '.gs').filter((f) => files.includes(f)),
     ...files.filter((f) => !recorded.includes(f.replace(/\.gs$/, '')))]
  : files.slice().sort()
const unloadable = []
for (const f of ordered) {
  try { vm.runInContext(read(f), sb, { filename: f }) } catch (e) { unloadable.push(f) }
}
// THE CONFIG CATALOGUE IS A SHEET NOW, so the list of keys and their shipped
// values comes from the last-resort copy in AlertsCatalog.gs — the only one of
// the two a repository check can read without a network. A key that lives ONLY
// in the catalogue sheet is invisible here, and so it is to every other reader
// on this side; tools/check-alerts-catalogue.mjs is what keeps that copy equal
// to the rows the migration writes.
if (!sb.HIRING_ALERTS_CATALOG_SHIPPED) { console.error('AlertsCatalog.gs did not load — cannot check messages'); process.exit(1) }
const declared = new Map(sb.HIRING_ALERTS_CATALOG_SHIPPED.map((d) => [d.key, String(d.value ?? '')]))

const problems = []
const inventory = []

// Every render site, with the fallback it carries. The fallback may span
// lines and concatenate, so the argument is captured up to the closing paren
// of the call and only tested for "does it contain a non-empty string".
for (const f of files) {
  const src = read(f)
  for (const m of src.matchAll(/hubAlertRender_\(\s*'([a-z0-9_]+)'\s*,/g)) {
    const key = m[1]
    // Read the call's remaining arguments by MATCHING PARENS, not by guessing
    // where the line ends: these fallbacks are multi-line concatenations and a
    // line-based regex silently read none of them.
    let depth = 1, i = m.index + m[0].length
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') depth--
    }
    const rest = src.slice(m.index + m[0].length, i - 1)
    const hasFallback = /'[^']{5,}'|"[^"]{5,}"/.test(rest.split(',').slice(1).join(','))
    const value = declared.get(key)
    inventory.push({ what: key, where: f, from: 'hiring_alerts_config' })
    if (value === undefined && !hasFallback) {
      problems.push(`${f}: hubAlertRender_('${key}') — no config row AND no literal fallback. It renders EMPTY.`)
    } else if (value !== undefined && !value.trim() && !hasFallback) {
      problems.push(`${f}: hubAlertRender_('${key}') — the config default is blank and there is no fallback.`)
    }
  }
}

/* ---- 2. the situations ----------------------------------------------- */
const sbs = sb
const sits = [...(sbs.SMART_HIRING_EVENTS || []), ...(sbs.SMART_DIGESTS || []),
              ...(sbs.SMART_EXTRA_SITUATIONS_SEED || [])]
for (const s of sits) {
  const ch = String(s.channels ?? '')
  inventory.push({ what: s.id, where: 'SmartComms.gs', from: 'smart_comms situation' })
  if (ch.includes('sms') && !String(s.sms_text ?? '').trim()) {
    problems.push(`SmartComms.gs: situation '${s.id}' sends by sms and has no sms_text.`)
  }
  if (ch.includes('email') && !String(s.email_text ?? '').trim()) {
    problems.push(`SmartComms.gs: situation '${s.id}' sends by email and has no email_text.`)
  }
  if (ch.includes('email') && !String(s.email_subject ?? '').trim()) {
    problems.push(`SmartComms.gs: situation '${s.id}' sends by email and has no subject.`)
  }
}
// The per-certification reminders are generated from CERT_LABELS at runtime and
// all share the generic wording and DODD's own. Those are the whole risk.
//
// THE WORDS MOVED TO THE BOOK on 2026-09-11 and the constants became SEEDS —
// but this check still reads the SEED on purpose, because the seed is the
// FLOOR: it is what the platform sends when the book cannot be read, so an
// empty seed is silence waiting for a bad morning. A book row that blanks one
// of these is a different question, and the reader answers it by keeping the
// floor rather than sending nothing.
for (const [name, val] of [['SMART_DODD_SMS', sbs.SMART_DODD_SMS_SEED],
                           ['SMART_GENERIC.sms_text', sbs.SMART_GENERIC_SEED?.sms_text],
                           ['SMART_GENERIC.email_text', sbs.SMART_GENERIC_SEED?.email_text],
                           ['SMART_GENERIC.email_subject', sbs.SMART_GENERIC_SEED?.email_subject]]) {
  inventory.push({ what: name, where: 'SmartComms.gs', from: 'situation template' })
  if (!String(val ?? '').trim()) problems.push(`SmartComms.gs: ${name} is empty — every certification reminder built from it sends nothing.`)
}

/* ---- 3. and every event situation says WHEN it happens ----------------
 *
 * A message with words in it that nobody dares switch on is as silent as an
 * empty one, and this screen is where the daring happens. `EVENT_SENTENCE`
 * (SmartCommsPage.tsx, moved there when the Settings section was removed) is the line under the switch; on 2026-08-28 it named
 * eight of twenty-seven and the rest printed their own id at the reader —
 * *When "onboarding_report" happens* — which reads like a bug on a page whose
 * whole job is to be trusted with real people's phones.
 *
 * Read as TEXT on purpose: the map is a TypeScript literal in a file this
 * Node script cannot import, and the alternative — moving the sentences into
 * the .gs so both sides could load them — would put UI copy in the sender.
 */
const sectionFile = resolve(root, 'src/pages/features/smartcomms/SmartCommsPage.tsx')
let sentenceIds = null
try {
  const tsx = readFileSync(sectionFile, 'utf8')
  const block = tsx.slice(tsx.indexOf('const EVENT_SENTENCE'))
  const end = block.indexOf('\n}')
  sentenceIds = new Set(
    [...block.slice(0, end).matchAll(/^\s{2}([a-z0-9_]+):\s*'/gm)].map((m) => m[1]),
  )
} catch {
  problems.push('SmartCommsPage.tsx could not be read — the switch captions cannot be checked.')
}
if (sentenceIds) {
  const eventRows = [...(sbs.SMART_HIRING_EVENTS || []), ...(sbs.SMART_GUARDIAN_EVENTS || [])]
    .filter((s) => String(s.kind ?? '') === 'event')
  const mute = eventRows.filter((s) => !sentenceIds.has(String(s.event ?? s.id)))
  console.log(`switch captions: ${eventRows.length - mute.length} of ${eventRows.length} event situations say when they happen`)
  for (const s of mute) {
    problems.push(`SmartCommsPage.tsx: EVENT_SENTENCE has no line for '${s.id}' — the screen falls back to its label, and then to the raw id.`)
  }
}

/* ---- the count ------------------------------------------------------- */
const byHome = {}
for (const i of inventory) byHome[i.from] = (byHome[i.from] || 0) + 1
if (unloadable.length) {
  console.log(`  (${unloadable.length} file(s) need Google at load time and were skipped: ${unloadable.join(', ')})`)
}
console.log(`messages: ${inventory.length} the platform can send`)
for (const [home, n] of Object.entries(byHome)) console.log(`    ${String(n).padStart(3)}  ${home}`)

if (problems.length) {
  console.error(`\n${problems.length} message(s) would go out EMPTY:`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error('  An empty template does not fail — it sends nothing, silently, to somebody waiting.')
} else {
  console.log('  every one of them has words in it.')
}
if (strict && problems.length) process.exit(1)
