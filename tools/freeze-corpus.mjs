/**
 * Freeze the real tabs into a fixture, so predicates can be tested against
 * data that actually exists.
 *
 * WHY THIS AND NOT INVENTED CASES. On 2026-08-07 a regex date reader passed
 * six hand-written cases and then read `03:16` off a playback timestamp in the
 * a real transcript, which would have booked an interview at three in
 * the morning. Invented cases confirm what you already believed; they cannot
 * contain the thing you did not think of. Every shape that has ever broken
 * this platform — a blank where a date was assumed, a status spelled by hand,
 * two cards with one name, an envelope with no e-mail — is already sitting in
 * these tabs.
 *
 * WHAT IS DELIBERATELY NOT FROZEN: anything private. `fields_json` holds the
 * packet answers and the mirror measured 180 rows carrying a full SSN and a
 * bank account number; a fixture is a file on a laptop and in a repository,
 * which is the last place any of that should go. The columns below are an
 * ALLOWLIST for exactly that reason — a denylist grows a hole the first time
 * somebody adds a column.
 *
 * Run: node tools/freeze-corpus.mjs [out.json]
 * Reads the same Google credentials the snapshot service uses.
 */
import { writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = process.argv[2] || resolve(root, 'tools/corpus.json')
const ENV = '/opt/docker/asa-hub/server/.tools.env'
const HUB_DB = '1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts'

/** Only these columns leave the spreadsheet. Nothing else, ever. */
const ALLOW = {
  entity_candidates: [
    'candidate_id', 'candidate_name', 'status', 'archived', 'source',
    // resume_link is a live Drive URL to a real person's CV. The gate only
    // asks whether one is on file, so PRESENCE is the whole signal and the
    // address is pure exposure — see PRESENCE_ONLY below.
    'resume_link', 'created_at', 'updated_at',
    'manual_onboarding', 'manual_onboarding_method',
    'packet_status', 'packet_srid', 'packet_matched_by', 'packet_checked_at',
    'packet_waived_by', 'packet_hold_since', 'packet_hold_until',
    'packet_requested_at', 'packet_amber_alerted_at',
    'hired_complete_at', 'docs_folder_id',
  ],
  entity_resume_analyses: [
    // No `summary`. It is free text written by a model about a person, and
    // the live rows carry phone numbers inside it ("via SMS: From +1330…").
    // Free text is where the thing you did not think of always is.
    'candidate_id', 'analyzed_at', 'composite_score',
    'cjis_status', 'cjis_report_url', 'decision_status',
  ],
  entity_phone_screens: [
    'candidate_id', 'screen_status', 'final_result', 'date_accepted', 'score',
  ],
  entity_in_person_interviews: [
    'candidate_id', 'scheduled_for', 'access_from', 'access_until',
    'score', 'comments', 'recommendation',
  ],
  onboarding_packet: [
    'CandidateId', 'HubCandidateId', 'GradCandidateId', 'FullName',
    'PacketAcknowledged', 'BackgroundCheck', 'DocumentsComplete',
    'CompleteTraining', 'QuestionnaireComplete', 'TutorialsComplete',
    'CompletedAt', 'updated_by', 'updated_at',
  ],
  candidate_documents: ['candidate_id', 'doc_type', 'file_id', 'uploaded_at'],
}

/**
 * Columns a predicate only ever asks a yes/no of. The value is replaced with
 * `(set)`, so presence survives and content does not.
 *
 * Every one of these was found by grepping the first corpus for an `@` and a
 * ten-digit run, which is a check worth running on any fixture before it is
 * trusted: an allowlist keeps out the columns you thought of, and these are
 * the ones that carry somebody's address, a Drive URL to their CV, or the
 * e-mail of whoever last touched the row.
 */
const PRESENCE_ONLY = new Set([
  'resume_link', 'cjis_report_url', 'docs_folder_id',
  'packet_matched_by', 'packet_waived_by', 'updated_by', 'comments',
])

/**
 * A name is not private the way a number is, but it is still a person, and a
 * fixture is read by anybody with the repository. Names are replaced with a
 * stable pseudonym: stable because the whole point of the corpus is that two
 * cards which collide on a name still collide in the fixture.
 */
function pseudonym(name, seen) {
  const key = String(name || '').trim().toLowerCase()
  if (!key) return ''
  if (!seen.has(key)) seen.set(key, `Person ${String(seen.size + 1).padStart(3, '0')}`)
  return seen.get(key)
}

function env(k) {
  for (const line of readFileSync(ENV, 'utf8').split('\n')) {
    const t = line.trim()
    if (t.startsWith(k + '=')) return t.slice(k.length + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return ''
}

async function token() {
  const body = new URLSearchParams({
    client_id: env('GS_GOOGLE_CLIENT_ID'),
    client_secret: env('GS_GOOGLE_CLIENT_SECRET'),
    refresh_token: env('GS_GOOGLE_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  })
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })
  if (!r.ok) throw new Error(`token: ${r.status}`)
  return (await r.json()).access_token
}

async function tab(tk, name) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${HUB_DB}/values/${encodeURIComponent(name)}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tk}` } })
  if (!r.ok) return null
  return (await r.json()).values || []
}

const tk = await token()
const names = new Map()
const corpus = { frozen_at: new Date().toISOString(), tabs: {} }
let total = 0

for (const [tabName, allow] of Object.entries(ALLOW)) {
  const rows = await tab(tk, tabName)
  if (!rows || !rows.length) {
    console.error(`  ! ${tabName}: not readable — the corpus will be short and says so`)
    corpus.tabs[tabName] = { unreadable: true, rows: [] }
    continue
  }
  const hdr = rows[0].map((h) => String(h).trim())
  const keep = hdr.map((h) => allow.includes(h))
  const out = []
  for (const r of rows.slice(1)) {
    const o = {}
    hdr.forEach((h, i) => {
      if (!keep[i]) return
      const v = String(r[i] == null ? '' : r[i]).trim()
      o[h] = PRESENCE_ONLY.has(h) ? (v ? '(set)' : '') : v
    })
    // Names, pseudonymised but stable — collisions must survive.
    for (const f of ['candidate_name', 'FullName']) {
      if (o[f] !== undefined) o[f] = pseudonym(o[f], names)
    }
    if (Object.values(o).some((v) => v !== '')) out.push(o)
  }
  corpus.tabs[tabName] = { rows: out }
  total += out.length
  console.log(`  ${tabName}: ${out.length} rows, ${allow.filter((a) => hdr.includes(a)).length}/${allow.length} allowed columns present`)
}

/**
 * The last gate, and the only one that does not depend on me having thought
 * of the column. An allowlist keeps out what you listed; this asks the file
 * itself whether anything that LOOKS like a person got through.
 */
const text = JSON.stringify(corpus)
const leaks = []
const emails = text.match(/"[^"]*@[^"]*"/g) || []
if (emails.length) leaks.push(`${emails.length} value(s) containing '@': ${emails.slice(0, 3).join(', ')}`)
const ssn = text.match(/\d{3}-\d{2}-\d{4}/g) || []
if (ssn.length) leaks.push(`${ssn.length} value(s) shaped like an SSN`)
// Anchored on BOTH sides against neighbouring digits. Without the lookbehind
// this fires on `OB-1775482614632` — an epoch-milliseconds id, which contains
// a ten-digit run starting with a 5. A leak check that cries wolf on ids is
// one somebody deletes, and then it catches nothing at all.
const phones = text.match(/(?<!\d)(?:\+?1[2-9]\d{9}|[2-9]\d{9})(?!\d)/g) || []
if (phones.length) leaks.push(`${phones.length} value(s) shaped like a phone number: ${[...new Set(phones)].slice(0, 3).join(', ')}`)

if (leaks.length) {
  console.error('\nNOT WRITTEN — something that identifies a person got through the allowlist:')
  leaks.forEach((l) => console.error(`  ✗ ${l}`))
  console.error('  Add the column to PRESENCE_ONLY or take it out of ALLOW, then re-run.')
  process.exit(1)
}

writeFileSync(OUT, JSON.stringify(corpus, null, 1))
console.log(`corpus: ${total} rows across ${Object.keys(ALLOW).length} tabs → ${OUT}`)
console.log('  no free text, no fields_json, no e-mail, no phone, no URLs — names pseudonymised.')
