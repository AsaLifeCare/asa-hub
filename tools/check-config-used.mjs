/**
 * Is every configuration key actually READ by something?
 *
 * A settings screen is a promise: this cell changes what the platform does.
 * A key nothing reads breaks that promise silently — somebody edits it, saves,
 * and nothing happens, with no error and no clue. That has now happened twice
 * here in one week: eleven duplicate rows where only the last was consulted,
 * and four hiring-policy override columns that Apply reported as applied while
 * no runtime consumer existed.
 *
 * So the question gets asked mechanically. For every key the catalogue knows,
 * is the literal string used anywhere in apps-script/ OUTSIDE its own
 * declaration?
 *
 * THE KEY LIST MOVED TO A SHEET and this reads the LAST-RESORT COPY of it,
 * apps-script/AlertsCatalog.gs, because that is the list this repository can
 * be checked against without a network. tools/check-alerts-catalogue.mjs is
 * what keeps that copy equal to the rows the migration writes, so the two
 * checks together still cover every key the platform will ever show. A key
 * that exists ONLY in the live sheet is invisible here — and that is honest:
 * nothing in this repository could read it either.
 *
 * WHAT COUNTS AS A READ: the key appearing in any .gs file other than in the
 * defaults block itself. That is generous on purpose — it over-approximates
 * rather than under-approximates, because a false "this key is dead" would
 * get a live setting deleted.
 *
 * WHAT IT CANNOT SEE: a key read through a computed name (`cfg[someVar]`).
 * There are none today; if one appears, this will report it dead and the
 * answer is to add it to KNOWN_DYNAMIC below with the reason, not to weaken
 * the check.
 *
 * Run: node tools/check-config-used.mjs [--strict]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gsDir = resolve(root, 'apps-script')
const strict = process.argv.includes('--strict')

/** Keys reached by a computed name, with the reason. Empty is the goal. */
const KNOWN_DYNAMIC = {}

const src = readFileSync(resolve(gsDir, 'AlertsCatalog.gs'), 'utf8')
const block = src.match(/var HIRING_ALERTS_CATALOG_SHIPPED = \[[\s\S]*?\n\];/)
if (!block) { console.error('HIRING_ALERTS_CATALOG_SHIPPED not found'); process.exit(1) }
const sandbox = { console, JSON, String, Number, Boolean, Array, Object, RegExp, Date, Math }
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(block[0], sandbox)
const keys = sandbox.HIRING_ALERTS_CATALOG_SHIPPED.map((d) => d.key)

/** Every .gs, with the shipped block itself cut out of AlertsCatalog. */
const bodies = readdirSync(gsDir).filter((f) => f.endsWith('.gs')).map((f) => {
  let text = readFileSync(resolve(gsDir, f), 'utf8')
  if (f === 'AlertsCatalog.gs') text = text.replace(block[0], '')
  return { file: f, text }
})

const dead = [], live = []
for (const k of keys) {
  const where = bodies.filter((b) => b.text.includes(k)).map((b) => b.file)
  if (where.length) live.push({ k, where })
  else if (KNOWN_DYNAMIC[k]) live.push({ k, where: ['dynamic: ' + KNOWN_DYNAMIC[k]] })
  else dead.push(k)
}

console.log(`hiring config: ${keys.length} keys declared, ${live.length} read somewhere`)
if (dead.length) {
  console.error(`\n${dead.length} key(s) are declared and READ BY NOTHING:`)
  for (const k of dead) console.error(`  ✗ ${k}`)
  console.error('  Editing one of these changes nothing, says nothing, and looks like it worked.')
  console.error('  Either wire it up, or take it out of the catalogue sheet AND off the')
  console.error('  last-resort copy in apps-script/AlertsCatalog.gs — both, or it comes back.')
} else {
  console.log('  every key is read by at least one function.')
}

/**
 * THE SAME QUESTION OF THE IST LANE'S TAB.
 *
 * `ist_config` is the second settings tab on this platform and it was born
 * with the same promise and the same way of breaking it. Two differences from
 * the block above, and each one is the reason it gets its own pass rather
 * than being folded into it:
 *
 *   · some of its keys are read from the BROWSER, not from Apps Script — the
 *     column lists reach a screen through src/lib/istConfig.ts — so the search
 *     covers src/ as well, or every one of those would report as dead;
 *   · the values themselves are held against the browser's copy and the mint
 *     tool's by tools/test-ist-config.py, which is the drift question. This is
 *     only the "does anything read it" question.
 */
const istSrc = readFileSync(resolve(gsDir, 'IstConfig.gs'), 'utf8')
const istBlock = istSrc.match(/var IST_CONFIG_DEFAULTS = \[[\s\S]*?\n\];/)
if (!istBlock) { console.error('IST_CONFIG_DEFAULTS not found'); process.exit(1) }
const istSandbox = { console, JSON, String, Number, Boolean, Array, Object, RegExp, Date, Math }
istSandbox.globalThis = istSandbox
vm.createContext(istSandbox)
vm.runInContext(istBlock[0], istSandbox)
const istKeys = istSandbox.IST_CONFIG_DEFAULTS.map((d) => d.key)

/** Every .ts/.tsx under src/, flat — a key is a literal wherever it is read. */
const srcDir = resolve(root, 'src')
const webBodies = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.tsx?$/.test(entry.name)) webBodies.push({ file: 'src/' + entry.name, text: readFileSync(full, 'utf8') })
  }
}
walk(srcDir)

const istBodies = [
  ...readdirSync(gsDir).filter((f) => f.endsWith('.gs')).map((f) => {
    let text = readFileSync(resolve(gsDir, f), 'utf8')
    if (f === 'IstConfig.gs') text = text.replace(istBlock[0], '')
    return { file: f, text }
  }),
  // The browser's own floor is a COPY of these keys, not a read of them — it
  // would make every key look live. The file is cut out for the same reason
  // the defaults block is.
  ...webBodies.filter((b) => !b.text.includes('export const IST_CONFIG_SHIPPED')),
  ...webBodies.filter((b) => b.text.includes('export const IST_CONFIG_SHIPPED'))
    .map((b) => ({ ...b, text: b.text.replace(/export const IST_CONFIG_SHIPPED[\s\S]*?\n\}/, '') })),
  // and so is the tool that seeds the tab
  { file: 'tools/mint_ist_config_house.py', text: '' },
]

const istDead = [], istLive = []
for (const k of istKeys) {
  const where = istBodies.filter((b) => b.text.includes(k)).map((b) => b.file)
  if (where.length) istLive.push(k)
  else istDead.push(k)
}

console.log(`ist config: ${istKeys.length} keys declared, ${istLive.length} read somewhere`)
if (istDead.length) {
  console.error(`\n${istDead.length} IST key(s) are declared and READ BY NOTHING:`)
  for (const k of istDead) console.error(`  ✗ ${k}`)
  console.error('  Editing one of these changes nothing, says nothing, and looks like it worked.')
  console.error('  Either wire it up, or take it out of IST_CONFIG_DEFAULTS and off the tab.')
} else {
  console.log('  every key is read by at least one function.')
}

if (strict && (dead.length || istDead.length)) process.exit(1)
