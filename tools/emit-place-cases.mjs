/**
 * THE 262 REFUSALS, AS A WORKLIST — and as test cases.
 *
 * Default-deny gave the platform a number: away from headquarters roughly
 * forty named actions answer and two hundred and sixty-two do not. The
 * right question about that number is whether 262 actions really must stay
 * denied, and the honest answer is that a count is not a plan. A
 * refusal is only correct while somebody knows WHY each one is refused, and
 * nothing anywhere recorded that.
 *
 * This records it. Every named action on the platform becomes one row with a
 * verdict:
 *
 *   place-aware        it narrows by place itself — it may answer away, and
 *                      the allowlist is where it says so
 *   central-by-design  it carries identity, configuration or the machine's
 *                      own lane, with no company rows inside it; the reason
 *                      is written in HUB_PLACE_EXEMPT and travels with the row
 *   TODO               refused away today, and opening its screen in a
 *                      franchise means making it place-aware first
 *
 * The TODO count IS the backlog, and it shrinks one reviewable line at a
 * time. check-places.mjs fails the build the moment a TODO appears on the
 * allowlist, which is the case that matters: refused-and-unnarrowed is a
 * decision, allowed-and-unnarrowed is a leak.
 *
 * Every row is also a test case, and says what to assert: `at_home` is what
 * headquarters must get, `away` is what a franchise must get. C6's bulk
 * harness reads exactly this file rather than re-deriving the matrix.
 *
 * Run: node tools/emit-place-cases.mjs [dist/place-cases.json] [--markdown docs/…md]
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gsDir = resolve(root, 'apps-script')
const args = process.argv.slice(2)
const outPath = resolve(root, args.find((a) => !a.startsWith('--')) || 'dist/place-cases.json')
const mdFlag = args.indexOf('--markdown')
const mdPath = mdFlag !== -1 && args[mdFlag + 1] ? resolve(root, args[mdFlag + 1]) : null

/** Comments and string bodies out, so a name in prose is not a call. */
function blank(src) {
  const out = Array.from(src)
  const wipe = (a, b) => { for (let i = a; i < b && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ' }
  let i = 0
  while (i < src.length) {
    const c = src[i], n = src[i + 1]
    if (c === '/' && n === '/') { let j = i; while (j < src.length && src[j] !== '\n') j++; wipe(i, j); i = j; continue }
    if (c === '/' && n === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? src.length : j + 2; wipe(i, e); i = e; continue }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c) break
        if (c !== '`' && src[j] === '\n') break
        j++
      }
      wipe(i + 1, j); i = Math.min(j + 1, src.length); continue
    }
    i++
  }
  return out.join('')
}

function bodies(src, file) {
  const out = new Map()
  const push = (name, from) => {
    let depth = 0, started = false
    for (let i = from; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true }
      else if (src[i] === '}') { depth--; if (started && depth === 0) { out.set(name, { text: src.slice(from, i + 1), file }); return } }
    }
  }
  for (const m of src.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) push(m[1], m.index)
  for (const m of src.matchAll(/^HUB_ACTIONS\.([A-Za-z_$][\w$]*)\s*=\s*function\s*\(/gm)) push('ACTION:' + m[1], m.index)
  const lit = src.match(/var HUB_ACTIONS\s*=\s*\{/)
  if (lit) {
    for (const m of src.slice(lit.index).matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:\s*function\s*\(/gm)) {
      push('ACTION:' + m[1], lit.index + m.index)
    }
  }
  return out
}

const raw = new Map()
for (const f of readdirSync(gsDir).filter((n) => n.endsWith('.gs'))) {
  raw.set(f, readFileSync(resolve(gsDir, f), 'utf8'))
}
const graph = new Map()
for (const [f, src] of raw) {
  for (const [name, v] of bodies(blank(src), f)) if (!graph.has(name)) graph.set(name, v)
}

const tenantSrc = raw.get('Tenant.gs') || ''
function listOf(varName) {
  const m = tenantSrc.match(new RegExp(`var\\s+${varName}\\s*=\\s*\\[([\\s\\S]*?)\\];`))
  return m ? [...m[1].matchAll(/'((?:ACTION:)?[A-Za-z_$][\w$]*)'/g)].map((x) => x[1]) : []
}
function mapOf(varName) {
  const m = tenantSrc.match(new RegExp(`var\\s+${varName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`))
  const out = new Map()
  if (!m) return out
  for (const e of m[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(['"])([\s\S]*?)\2\s*,?\s*$/gm)) {
    out.set(e[1], e[3].replace(/\\'/g, "'").trim())
  }
  return out
}
const allow = new Set(listOf('HUB_TENANT_SAFE_ACTIONS'))
const exempt = mapOf('HUB_PLACE_EXEMPT')

const PREDICATES = [
  'tenantRowVisible_', 'tenantUserVisible_', 'tenantUserRow_', 'hubAwayTenant_',
  'hubTenantId_', 'tenantStamp_', 'hubPlaceGate_', 'hubAdapterPlaceGate_',
  'tenantContext_', 'tenantResolve_', 'hubActingUserId_', 'worldRowFor_',
  // NOT tenantIdsForUser_ / tenantHomeFrom_: userPublic_ calls the first to
  // BUILD the session user, so counting it as narrowing marked a third of the
  // platform place-aware for reading a column it never filters on.
  'memberResolve_', 'memberContext_', 'tenantHomeId_',
]
/**
 * STAMPING A LOG LINE IS NOT NARROWING AN ANSWER. hubSysLog_ records WHERE a
 * write happened, so it calls tenantStamp_ — and every handler that logs
 * reached a place predicate through it. That marked 185 of the platform's 311
 * actions place-aware for writing a column into the audit trail while
 * answering with everybody's rows, which is precisely the false comfort this
 * whole file exists to remove. The walk does not enter them.
 */
const NOT_NARROWING = new Set([
  // stamping a log line is not narrowing an answer
  'hubSysLog_', 'logsAppend_', 'hubTeamNotify_',
  /**
   * AND NEITHER IS PICKING A WORKBOOK (2026-08-19, second measurement).
   * The place workbook seam (C3) made hubDb_ and cacheScope_ consult the
   * place to choose WHICH book and WHICH cache key — and every read and every
   * write in the platform goes through them. Counting that as narrowing moved
   * 88 actions into "place-aware" overnight without one of them changing, and
   * dropped the backlog from 249 to 169 for free. It is the same flattery
   * hubSysLog_ produced the first time this was measured: the question is
   * whether a HANDLER narrows its own answer, not whether the storage layer
   * underneath it knows where it is standing.
   */
  'hubDb_', 'cacheScope_', 'tenantSpreadsheetId_', 'tabFor_', 'sheetFor_',
])

function narrows(name, seen = new Set()) {
  if (seen.has(name) || NOT_NARROWING.has(name)) return new Set()
  seen.add(name)
  const node = graph.get(name)
  const hit = new Set()
  if (!node) return hit
  for (const p of PREDICATES) if (new RegExp(`\\b${p}\\s*\\(`).test(node.text)) hit.add(p)
  for (const m of node.text.matchAll(/\b([A-Za-z_$][\w$]*_)\s*\(/g)) {
    if (m[1] === name) continue
    for (const r of narrows(m[1], seen)) hit.add(r)
  }
  return hit
}

/** Every declared action, with the file and lane it declares. */
const declared = new Map()
for (const [file, src] of raw) {
  for (const m of src.matchAll(/HUB_POLICY\.([A-Za-z_$][\w$]*)\s*=\s*\{([\s\S]*?)\n\};/g)) {
    const lane = (m[2].match(/lane:\s*'(\w+)'/) || [])[1] || ''
    const declaredFile = (m[2].match(/file:\s*'([^']+)'/) || [])[1] || file
    declared.set(m[1], { file: declaredFile, lane })
  }
  for (const m of src.matchAll(/^\s{2}([A-Za-z_$][\w$]*):\s*\{[^}]*?lane:\s*'(\w+)'[^}]*?\}/gm)) {
    if (!declared.has(m[1])) declared.set(m[1], { file, lane: m[2] })
  }
}
// a handler with no policy entry is still an action the router will dispatch
for (const key of graph.keys()) {
  if (!key.startsWith('ACTION:')) continue
  const name = key.slice(7)
  if (!declared.has(name)) declared.set(name, { file: graph.get(key).file, lane: '' })
}

const cases = []
for (const [action, meta] of [...declared].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const node = graph.get('ACTION:' + action)
  const hit = node ? [...narrows('ACTION:' + action)].sort() : []
  const allowed = allow.has(action)
  const reason = exempt.get(action) || ''
  const verdict = hit.length ? 'place-aware' : reason ? 'central-by-design' : 'TODO'
  cases.push({
    action,
    file: node ? node.file : meta.file,
    lane: meta.lane || 'unknown',
    allowed_away: allowed,
    predicates: hit,
    verdict,
    reason,
    // what a test must assert, in both directions
    expect: {
      at_home: 'runs — the allowlist does not exist for headquarters',
      away: allowed ? 'runs, and answers only this place\'s rows'
                    : '404 "Unknown action." — refused by omission',
    },
  })
}

const counts = cases.reduce((a, c) => { a[c.verdict] = (a[c.verdict] || 0) + 1; return a }, {})
const deniedTodo = cases.filter((c) => !c.allowed_away && c.verdict === 'TODO')
const allowedTodo = cases.filter((c) => c.allowed_away && c.verdict === 'TODO')

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify({
  generated_from: 'apps-script/*.gs — HUB_POLICY, HUB_ACTIONS, HUB_TENANT_SAFE_ACTIONS, HUB_PLACE_EXEMPT',
  total: cases.length,
  allowed_away: cases.filter((c) => c.allowed_away).length,
  refused_away: cases.filter((c) => !c.allowed_away).length,
  verdicts: counts,
  backlog: deniedTodo.length,
  cases,
}, null, 2) + '\n')

console.log(`place cases: ${cases.length} named action(s) → ${outPath.replace(root + '/', '')}`)
console.log(`  ${cases.filter((c) => c.allowed_away).length} answer away from home, ` +
            `${cases.filter((c) => !c.allowed_away).length} are refused by omission`)
console.log(`  place-aware ${counts['place-aware'] || 0} · ` +
            `central-by-design ${counts['central-by-design'] || 0} · TODO ${counts.TODO || 0}`)
console.log(`  the backlog — refused away and not yet place-aware: ${deniedTodo.length}`)
if (allowedTodo.length) {
  console.log(`  ✗ allowed away and narrows nothing (${allowedTodo.length}): ` +
              allowedTodo.map((c) => c.action).join(', '))
}

if (mdPath) {
  const rows = cases.map((c) =>
    `| \`${c.action}\` | ${c.file} | ${c.lane} | ${c.allowed_away ? 'yes' : '—'} | ` +
    `${c.verdict}${c.reason ? ` — ${c.reason}` : ''} | ${c.predicates.join(', ') || '—'} |`)
  const byFile = new Map()
  for (const c of deniedTodo) byFile.set(c.file, (byFile.get(c.file) || 0) + 1)
  const backlog = [...byFile].sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `| ${f} | ${n} |`).join('\n')
  mkdirSync(dirname(mdPath), { recursive: true })
  writeFileSync(mdPath, `# The named actions, as place test cases

Generated by \`node tools/emit-place-cases.mjs\` — do not edit by hand.

**${cases.length}** named actions. **${cases.filter((c) => c.allowed_away).length}** answer away
from headquarters; **${cases.filter((c) => !c.allowed_away).length}** are refused by omission,
with the same 404 the platform gives a name it does not have.

| verdict | count | what it means |
|---|---|---|
| place-aware | ${counts['place-aware'] || 0} | narrows by place itself |
| central-by-design | ${counts['central-by-design'] || 0} | identity, configuration or the machine's lane — no company rows in it |
| TODO | ${counts.TODO || 0} | opening its screen in a franchise means making it place-aware first |

**The backlog is ${deniedTodo.length}** — refused away, and not yet place-aware. That is the
number that has to come down for a franchise to grow past what it has today,
and it comes down one reviewable line at a time: make the handler narrow, add
its name to \`HUB_TENANT_SAFE_ACTIONS\`, and this table moves it.

\`check-places.mjs\` fails the build when a TODO appears on the allowlist.
Refused-and-unnarrowed is a decision; allowed-and-unnarrowed is a leak.

## Where the backlog lives

| file | actions still refused away |
|---|---|
${backlog}

## Every action

Each row is a test case. At home every action runs — the allowlist does not
exist for headquarters. Away, an allowlisted action must answer with **only
this place's rows**, and every other name must answer \`404 Unknown action.\`

| action | file | lane | answers away | verdict | narrows via |
|---|---|---|---|---|---|
${rows.join('\n')}
`)
  console.log(`  markdown → ${mdPath.replace(root + '/', '')}`)
}
