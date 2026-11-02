/**
 * Remove the shadowed duplicate rows from `hiring_alerts_config`.
 *
 * WHY THEY ARE DANGEROUS, not just untidy. `hiringAlerts_` walks the tab top
 * to bottom doing `cfg[key] = value`, so the LAST row carrying a key is the
 * one that decides. Every earlier copy is dead: an admin who opens the
 * spreadsheet, finds the first `packet_hold_hours` and types into it has
 * changed nothing at all, and nothing anywhere says so. That is the exact
 * shape of "I set it and it did not work".
 *
 * WHERE THEY CAME FROM. `hiringAlertsSheet_` reads the tab, works out which
 * keys are missing, and appends them — with no lock. This account runs ~30
 * executions at once and the snapshot builder passes every few minutes, so
 * two of them can read "missing" at the same moment and both append. The race
 * is fixed in the seeder; these are the rows it already produced.
 *
 * IT REFUSES TO DELETE A DISAGREEMENT. A shadowed row that is blank, or that
 * holds exactly what the winner holds, is noise and goes. A shadowed row with
 * a DIFFERENT non-empty value is somebody's edit that has been silently
 * ignored — possibly for weeks — and deleting it would destroy the only
 * evidence of what they meant. Those are printed and kept.
 *
 * Run: node tools/dedupe-hiring-config.mjs [--apply]
 */
import { readFileSync } from 'node:fs'

const ENV = '/opt/docker/asa-hub/server/.tools.env'
const HUB_DB = '1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts'
const TAB = 'hiring_alerts_config'
const apply = process.argv.includes('--apply')

function env(k) {
  for (const line of readFileSync(ENV, 'utf8').split('\n')) {
    const t = line.trim()
    if (t.startsWith(k + '=')) return t.slice(k.length + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return ''
}
const body = new URLSearchParams({
  client_id: env('GS_GOOGLE_CLIENT_ID'), client_secret: env('GS_GOOGLE_CLIENT_SECRET'),
  refresh_token: env('GS_GOOGLE_REFRESH_TOKEN'), grant_type: 'refresh_token',
})
const tok = (await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })).json()).access_token
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }
const api = (p) => `https://sheets.googleapis.com/v4/spreadsheets/${HUB_DB}/${p}`

const meta = await (await fetch(api('?fields=sheets.properties'), { headers: H })).json()
const sheet = meta.sheets.find((s) => s.properties.title === TAB)
if (!sheet) { console.error(`no tab ${TAB}`); process.exit(1) }
const sheetId = sheet.properties.sheetId

const rows = (await (await fetch(api(`values/${encodeURIComponent(TAB)}`), { headers: H })).json()).values || []
const seen = new Map()          // key -> [{row, value}]
rows.forEach((r, i) => {
  const k = String(r[0] || '').trim()
  if (!k || i === 0) return
  if (!seen.has(k)) seen.set(k, [])
  seen.get(k).push({ row: i + 1, value: String(r[1] ?? '') })
})

const drop = [], conflicts = []
for (const [key, list] of seen) {
  if (list.length < 2) continue
  const winner = list[list.length - 1]          // the one hiringAlerts_ actually uses
  for (const dup of list.slice(0, -1)) {
    if (dup.value.trim() === '' || dup.value === winner.value) drop.push({ key, ...dup })
    else conflicts.push({ key, shadowed: dup, winner })
  }
}

console.log(`${seen.size} distinct keys across ${rows.length - 1} rows`)
if (conflicts.length) {
  console.log(`\n${conflicts.length} shadowed row(s) hold a DIFFERENT value — kept, and worth reading:`)
  for (const c of conflicts) {
    console.log(`  ! ${c.key}`)
    console.log(`      row ${c.shadowed.row} (ignored): ${c.shadowed.value.slice(0, 80)}`)
    console.log(`      row ${c.winner.row} (in use)  : ${c.winner.value.slice(0, 80)}`)
  }
}
console.log(`\n${drop.length} dead duplicate row(s) to remove:`)
for (const d of drop) console.log(`  - row ${d.row}  ${d.key}${d.value ? '  (same value)' : '  (blank)'}`)

if (!drop.length) { console.log('\nnothing to do.'); process.exit(0) }
if (!apply) { console.log('\ndry run — nothing deleted. Re-run with --apply.'); process.exit(0) }

// Bottom up, so an earlier deletion never shifts a later row index.
const requests = drop.map((d) => d.row).sort((a, b) => b - a).map((row) => ({
  deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } },
}))
const res = await fetch(api(':batchUpdate'), { method: 'POST', headers: H, body: JSON.stringify({ requests }) })
if (!res.ok) { console.error(`batchUpdate failed: ${res.status} ${await res.text()}`); process.exit(1) }
console.log(`\nremoved ${drop.length} row(s).`)
