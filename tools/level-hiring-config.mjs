/**
 * Bring `hiring_alerts_config` up to what the code declares — from here,
 * without waiting for a deploy.
 *
 * WHY THIS EXISTS. `hiringAlertsSheet_` seeds additively, but only on a CACHE
 * MISS, and on a busy account the cache is always warm. So a key added in a
 * deploy can stay invisible for hours: the reader falls back to whatever the
 * code hardcodes, and the admin cannot fill in a row that does not exist. That
 * bit on 2026-08-07 with `test_redirect_sms` — shipped, documented, and absent
 * from the tab while sending was on.
 *
 * THE DEFAULTS ARE READ OUT OF THE CATALOGUE, not retyped here. A second
 * copy of a list is a list that diverges, and this one decides who gets paged.
 *
 * IT NEVER OVERWRITES. A key already in the tab keeps its value, whatever the
 * code now says — an admin's edit always outranks a default it came from.
 * Values are changed only when named explicitly in SET below, and every one of
 * those prints its before and after.
 *
 * Run: node tools/level-hiring-config.mjs [--apply]
 * Without --apply it prints what it would do and writes nothing.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENV = '/opt/docker/asa-hub/server/.tools.env'
const HUB_DB = '1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts'
const TAB = 'hiring_alerts_config'
const apply = process.argv.includes('--apply')

/** The decisions taken on 2026-08-08, written explicitly rather than left to
 *  a default — a blank cell tells the next person nothing about whether the
 *  value was chosen or never considered. */
const SET = {
  test_mode: 'on',
  test_redirect_sms: '+13309195558',
  test_redirect_email: 'asatech@asalifecare.com',
  packet_rehearsal_number: '+13309195558',
  test_banner: '',
  sms_recipients: '+13309195559, +13309197779, +13309195558',
  email_recipients: 'admin@abrighterdawninc.com, ty.bond@asalifecare.com, asatech@asalifecare.com',
  packet_hold_hours: '24',
  onboarding_window_before_days: '1',
  onboarding_window_after_days: '7',
  messages_paused: '',
}

/* ---- the catalogue, from the source of truth ------------------------- */
/**
 * THE CATALOGUE IS A SHEET NOW, and this reads the rows the migration writes
 * into it (tools/hiring-alerts-catalogue.json) rather than an array in
 * AlertsConfig.gs, which no longer exists. The two are the same list:
 * tools/check-alerts-catalogue.mjs compares that file against the
 * last-resort copy in apps-script/AlertsCatalog.gs, in order, key for key.
 *
 * A key that somebody added to the live CATALOGUE sheet and not to the file
 * is not levelled by this tool. That is the honest limit of a repository
 * tool, and it costs nothing: hiringAlertsSheet_ seeds such a key into the
 * values tab on its own, from the catalogue, on the next cache miss.
 */
const catalogue = JSON.parse(readFileSync(resolve(root, 'tools/hiring-alerts-catalogue.json'), 'utf8'))
const defaults = catalogue.map((r) => ({ key: r.key, value: r.default_value, note: r.note, group: r.group }))
console.log(`the catalogue declares ${defaults.length} config keys`)

/* ---- the sheet ------------------------------------------------------ */
function env(k) {
  for (const line of readFileSync(ENV, 'utf8').split('\n')) {
    const t = line.trim()
    if (t.startsWith(k + '=')) return t.slice(k.length + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return ''
}
const tok = await (async () => {
  const body = new URLSearchParams({
    client_id: env('GS_GOOGLE_CLIENT_ID'), client_secret: env('GS_GOOGLE_CLIENT_SECRET'),
    refresh_token: env('GS_GOOGLE_REFRESH_TOKEN'), grant_type: 'refresh_token',
  })
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })
  if (!r.ok) throw new Error(`token ${r.status}`)
  return (await r.json()).access_token
})()
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }
const url = (p) => `https://sheets.googleapis.com/v4/spreadsheets/${HUB_DB}/${p}`

const rows = (await (await fetch(url(`values/${encodeURIComponent(TAB)}`), { headers: H })).json()).values || []
const at = new Map()
rows.forEach((r, i) => { const k = String(r[0] || '').trim(); if (k) at.set(k, i + 1) })
console.log(`sheet holds ${at.size - 1} keys\n`)

const missing = [], changed = [], kept = []
for (const d of defaults) {
  const row = at.get(d.key)
  const current = row ? String((rows[row - 1] || [])[1] ?? '') : null
  const wanted = Object.prototype.hasOwnProperty.call(SET, d.key) ? SET[d.key] : null

  if (row === undefined) {
    missing.push([d.key, wanted !== null ? wanted : d.value, d.note || ''])
    continue
  }
  if (wanted !== null && current.trim() !== wanted) { changed.push({ key: d.key, row, from: current, to: wanted }); continue }
  kept.push(d.key)
}

for (const m of missing) console.log(`  + ${m[0]}\n      ${String(m[1]).slice(0, 100)}`)
for (const c of changed) console.log(`  > ${c.key}\n      was: ${c.from.slice(0, 90)}\n      now: ${c.to.slice(0, 90)}`)
console.log(`\n${missing.length} to add, ${changed.length} to change, ${kept.length} left exactly as they are`)

if (!apply) { console.log('\ndry run — nothing written. Re-run with --apply.'); process.exit(0) }

if (missing.length) {
  await fetch(url(`values/${encodeURIComponent(TAB)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`),
    { method: 'POST', headers: H, body: JSON.stringify({ values: missing }) })
}
if (changed.length) {
  await fetch(url('values:batchUpdate'), {
    method: 'POST', headers: H,
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: changed.map((c) => ({ range: `${TAB}!B${c.row}`, values: [[c.to]] })),
    }),
  })
}
console.log('\napplied.')
