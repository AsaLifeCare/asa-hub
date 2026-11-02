/**
 * ONE DOOR MAKES TABS — the ratchet that keeps it that way.
 *
 * WHY (2026-09-03). While the old monolith spreadsheet was being drained,
 * eighty-seven call sites across sixty files each opened a workbook, looked
 * for a tab, and created it when missing — every one deciding for itself
 * which workbook that should be. They did not agree. A forty-five agent
 * census found twenty-two live paths that would re-create a deliberately
 * deleted tab in the old workbook while every reader used the new address,
 * and one of them fired every 180 seconds from a server refresh, unattended.
 *
 * The routing question now has exactly one answer — `hubTabEnsure_` in
 * TabRouter.gs — and this check is what stops the eighty-eighth door from
 * being opened by the next feature. Without it, the census has to be re-run
 * after every merge, and nobody re-runs a census.
 *
 * IT IS A RATCHET, NOT A BAN. The allowed sites below are the ones that are
 * genuinely creating a tab somewhere the router must not be asked about — a
 * world's own book, a deliberate re-seed. The count may fall; it may never
 * rise, and a file not on the list may not create tabs at all. Lowering a
 * number here is a real improvement and needs no permission. Raising one
 * means a new door, and that is the thing this file exists to refuse.
 *
 * Run: node tools/check-one-door.mjs [--strict]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const GS_DIR = resolve(HERE, '..', 'apps-script')

/**
 * file -> how many `insertSheet(` calls it is allowed to hold, and why.
 * Anything absent from this map is allowed ZERO.
 */
const ALLOWED = {
  'TabRouter.gs': { max: 1, why: 'hubTabEnsure_ — THE door' },
  'SeedDemo.gs': { max: 1, why: 'the demo seed deliberately replaces tabs; editor-only' },
  'World.gs': { max: 3, why: 'a world builds its own book, which the router must not re-point' },
  'WorldDefaults.gs': { max: 1, why: "the marker tab is written into the world's own book" },
  'Prefs.gs': { max: 1, why: 'HUB_PREFS_ID — routing it would blank every signed-in person\'s tiles' },
  'SysLog.gs': { max: 1, why: 'HUB_LOGS_ID — an unset property must fail loudly, not land at headquarters' },
  'Resolver.gs': { max: 1, why: 'HUB_LOGS_ID; the resolver must never consult a sheet to decide routing' },
  'SheetBoard.gs': { max: 1, why: "a person's own board spreadsheet, opened by id" },
  'HiringSimConfig.gs': { max: 2, why: 'the hiring words book, opened by id' },
}

const strict = process.argv.includes('--strict')
const files = readdirSync(GS_DIR).filter((f) => f.endsWith('.gs')).sort()

const offences = []
let total = 0

for (const file of files) {
  const src = readFileSync(resolve(GS_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
  const hits = src.match(/\.insertSheet\s*\(/g) || []
  if (!hits.length) continue
  total += hits.length
  const allowed = ALLOWED[file]
  if (!allowed) {
    offences.push(`${file}: ${hits.length} insertSheet call(s) — every tab is made by hubTabEnsure_ (TabRouter.gs)`)
  } else if (hits.length > allowed.max) {
    offences.push(`${file}: ${hits.length} insertSheet call(s), ${allowed.max} allowed (${allowed.why})`)
  }
}

console.log(`one door: ${total} insertSheet call(s) across ${files.length} .gs files`)
for (const [file, { max, why }] of Object.entries(ALLOWED)) {
  console.log(`   allowed  ${file} up to ${max} — ${why}`)
}

if (!offences.length) {
  console.log('\nevery tab in this backend is made by one function.')
  process.exit(0)
}

console.log(`\n${offences.length} file(s) open their own door:`)
for (const o of offences) console.log(`   ${o}`)
console.log('\nUse hubTabEnsure_(tab, header) — it resolves the runtime, the houses and the')
console.log('book map in one order, and refuses to re-create a tab somebody declared gone.')
process.exit(strict ? 1 : 0)
