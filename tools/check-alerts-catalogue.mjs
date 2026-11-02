/**
 * Can the config catalogue and its last-resort copy drift apart?
 *
 * The forty-five configuration keys live in a sheet now — the
 * `hiring_alerts_catalog` house — and three things in this repository claim to
 * know the same list:
 *
 *   tools/hiring-alerts-catalogue.json      what the migration WRITES
 *   apps-script/AlertsCatalog.gs            what the platform FALLS BACK TO
 *   tools/mint_alerts_catalogue.py --print  what the tool really emits
 *
 * A disagreement between the first two is the failure this whole move could
 * introduce: the sheet would carry one default and the code another, and the
 * day the house is unreachable the platform would quietly configure itself
 * differently from the day before. Nothing about that is visible on a screen.
 *
 * So all three are compared, in ORDER and KEY FOR KEY, on key, group and
 * default. The third is not redundant, and it had to be made real to stop
 * being so: `--print` used to hand back the very file it was compared against,
 * which is a witness that cannot disagree. It now emits the rows LAID OUT
 * against the declared header — the arrays that really go into the cells — so
 * this check covers the column mapping, the width and the header order too.
 *
 * THE NOTES ARE DELIBERATELY NOT COMPARED BETWEEN CODE AND FILE, because the
 * shipped copy has none. That is the point of it — the prose is what left the
 * code. This check enforces the absence: a `note` reappearing in
 * AlertsCatalog.gs is the first step back to three hundred lines of array.
 *
 * BUT THE NOTES THEMSELVES ARE NOT UNGUARDED, and that is new. The self-test
 * pin that every retired `msg_*` row says where it went can only run where a
 * catalogue sheet answers — which is Apps Script and nowhere else, so on this
 * side it was skipped and nothing in the repository could see a marker being
 * deleted. The assertions below are the offline half: they are made against
 * the rows the migration WRITES, which need no network and are the same rows.
 *
 * Run: node tools/check-alerts-catalogue.mjs [--strict]
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const strict = process.argv.includes('--strict')
const problems = []

/* ---- 1. the last-resort copy, out of the .gs ------------------------ */
const gsPath = resolve(root, 'apps-script/AlertsCatalog.gs')
const gsSrc = readFileSync(gsPath, 'utf8')
const block = gsSrc.match(/var HIRING_ALERTS_CATALOG_SHIPPED = \[[\s\S]*?\n\];/)
if (!block) {
  console.error('HIRING_ALERTS_CATALOG_SHIPPED not found in apps-script/AlertsCatalog.gs')
  process.exit(1)
}
const sandbox = { console, JSON, String, Number, Boolean, Array, Object, RegExp, Date, Math }
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(block[0], sandbox)
const shipped = sandbox.HIRING_ALERTS_CATALOG_SHIPPED

/* The vocabulary the reader will accept, and the column names it looks for —
 * taken out of the same file rather than retyped, because a second copy of a
 * list is a list that diverges. */
const readDecl = (name) => {
  const m = gsSrc.match(new RegExp(`var ${name} = (\\[[\\s\\S]*?\\]);`))
  if (!m) { console.error(`${name} not found in apps-script/AlertsCatalog.gs`); process.exit(1) }
  return JSON.parse(m[1].replace(/'/g, '"').replace(/,(\s*])/g, '$1'))
}
const groups = readDecl('HIRING_ALERTS_CATALOG_GROUPS')
const header = readDecl('HIRING_ALERTS_CATALOG_HEADER')
const refusedNames = readDecl('HIRING_ALERTS_CATALOG_REFUSED_KEYS')

/* ---- 2. the rows the migration writes -------------------------------- */
const file = JSON.parse(readFileSync(resolve(root, 'tools/hiring-alerts-catalogue.json'), 'utf8'))

/* ---- 3. and what the tool itself says it would write ----------------- */
let emitted = null
try {
  emitted = JSON.parse(execFileSync('python3', [resolve(root, 'tools/mint_alerts_catalogue.py'), '--print'],
                                    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
} catch (err) {
  problems.push(`the migration tool could not print its rows: ${String(err.message).slice(0, 300)}`)
}

/* ---- the comparisons -------------------------------------------------- */
const asShipped = (r) => ({ key: r.key, group: r.group, value: r.default_value })

function compare(what, a, b) {
  if (a.length !== b.length) {
    problems.push(`${what}: ${a.length} row(s) here, ${b.length} there`)
  }
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = JSON.stringify(a[i] ?? null), y = JSON.stringify(b[i] ?? null)
    if (x !== y) problems.push(`${what}: row ${i} differs\n      code: ${x}\n      file: ${y}`)
  }
}

compare('AlertsCatalog.gs vs hiring-alerts-catalogue.json', shipped, file.map(asShipped))

/* THE THIRD WITNESS, AND IT IS THE CELLS. The tool emits the header it will
 * stamp and every row already laid out against it, so what is compared here is
 * the mapping that decides which cell a note ends up in — not a second reading
 * of the file the second comparison already used. */
if (emitted) {
  const eHead = emitted.header || []
  if (JSON.stringify(eHead) !== JSON.stringify(header)) {
    problems.push(`mint_alerts_catalogue.py would stamp the header ${JSON.stringify(eHead)}, ` +
                  `but AlertsCatalog.gs looks for ${JSON.stringify(header)}`)
  }
  const at = Object.fromEntries(header.map((h, i) => [h, eHead.indexOf(h)]))
  const laid = (emitted.rows || []).map((cells) => ({
    key: cells[at.key], group: cells[at.group],
    default_value: cells[at.default_value], note: cells[at.note],
  }))
  compare('hiring-alerts-catalogue.json vs the cells mint_alerts_catalogue.py would write',
          file, laid)
  for (const cells of emitted.rows || []) {
    if (cells.length !== eHead.length) {
      problems.push(`mint_alerts_catalogue.py would write a ${cells.length}-cell row under a ` +
                    `${eHead.length}-column header (${cells[at.key]})`)
    }
  }
}

/* Every row must carry the three fields, and the shipped copy must carry no
 * fourth — the note is what left the code and it does not come back. */
for (const r of shipped) {
  const keys = Object.keys(r).sort().join(',')
  if (keys !== 'group,key,value') {
    problems.push(`AlertsCatalog.gs: ${r.key || '(no key)'} has fields {${keys}} — expected {group,key,value}`)
  }
}
for (const r of file) {
  const keys = Object.keys(r).sort().join(',')
  if (keys !== 'default_value,group,key,note') {
    problems.push(`hiring-alerts-catalogue.json: ${r.key || '(no key)'} has fields {${keys}}`)
  }
  if (!String(r.note || '').trim()) {
    problems.push(`hiring-alerts-catalogue.json: ${r.key} has no note — the sheet would show an unexplained field`)
  }
}

/* A key twice anywhere is a row that shadows another the moment it is in a
 * sheet, which is the exact shape the values tab already bled from. */
const seen = new Set()
for (const r of file) {
  if (seen.has(r.key)) problems.push(`hiring-alerts-catalogue.json: ${r.key} appears twice`)
  seen.add(r.key)
}

/* ---- the laws the SHEET rows have to obey, asserted offline ----------- */

/**
 * THE MESSAGES GROUP IS HISTORY, AND THE MARKER IS WHAT SAYS SO.
 *
 * Every `msg_*` key is a retired template whose living copy is a Smart Comms
 * situation. No screen renders the group, and the one thing standing between a
 * reader and the belief that these are live, editable settings is the sentence
 * in the note. SelfTest.gs asserts it against the catalogue the reader really
 * answers with — which outside Apps Script is the last-resort copy, and that
 * copy has no notes at all, so on this side the assertion was skipped and a
 * deleted marker passed every check in the repository.
 *
 * Here it is asserted against the rows the migration writes, which is the same
 * text that will be in the cells and needs no network to read.
 */
for (const r of file) {
  const isMsgKey = String(r.key).startsWith('msg_')
  const isMsgGroup = r.group === 'messages'
  if (isMsgKey !== isMsgGroup) {
    problems.push(`hiring-alerts-catalogue.json: ${r.key} is ${isMsgKey ? '' : 'not '}a msg_ key ` +
                  `but its group is "${r.group}" — a retired template on a live screen, or a live ` +
                  `setting filed as history`)
  }
  if (isMsgGroup && !String(r.note).includes('moved to Smart Comms')) {
    problems.push(`hiring-alerts-catalogue.json: ${r.key} is in the messages group and its note ` +
                  `does not say "moved to Smart Comms" — it reads as a live, editable setting`)
  }
}
if (!file.some((r) => r.group === 'messages')) {
  problems.push('hiring-alerts-catalogue.json: no row is in the messages group at all — the ' +
                'check above would then be asserting nothing')
}

/**
 * A GROUP OUTSIDE THE VOCABULARY IS A SETTING NOBODY CAN SEE. `group` is the
 * only thing that decides which screen draws a key, so `guards` for `guard` is
 * a key that still governs the contact guard and appears nowhere. The reader
 * now repairs that and says so; this stops the repository shipping one.
 */
for (const r of [...file, ...shipped]) {
  if (!groups.includes(r.group)) {
    problems.push(`${r.key}: group "${r.group}" is not in HIRING_ALERTS_CATALOG_GROUPS ` +
                  `(${groups.join(', ')}) — no Settings screen would draw it`)
  }
}

/* And no row may be named one of the names a plain `{key: value}` map cannot
 * carry — the reader refuses those, so shipping one would be shipping a field
 * that can never hold a value. */
for (const r of [...file, ...shipped]) {
  if (refusedNames.includes(r.key)) {
    problems.push(`${r.key}: the reader refuses this name — a config key is read into a plain ` +
                  `map and that name cannot be stored in one`)
  }
}

/* The code must not have grown a second hardcoded catalogue while nobody was
 * looking: the array that used to hold the notes is gone and stays gone. */
for (const f of ['AlertsConfig.gs', 'AlertsCatalog.gs']) {
  const src = readFileSync(resolve(root, 'apps-script', f), 'utf8')
  if (/var\s+HIRING_ALERTS_DEFAULTS\s*=/.test(src)) {
    problems.push(`${f}: HIRING_ALERTS_DEFAULTS is back — the catalogue belongs in the sheet`)
  }
}

console.log(`alerts catalogue: ${file.length} keys in the migration, ${shipped.length} in the ` +
            `last-resort copy${emitted ? `, ${(emitted.rows || []).length} rows the tool would ` +
            `write under ${(emitted.header || []).join('/')}` : ''}; ` +
            `${file.filter((r) => r.group === 'messages').length} retired message row(s) still ` +
            `marked moved`)
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error('  The sheet and the code would configure the platform differently.')
  if (strict) process.exit(1)
} else {
  console.log('  all three agree, key for key, in order — and no note has crept back into the code.')
}
