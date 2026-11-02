/**
 * DOES THE PLACE LAW HOLD, AND CAN ANYTHING PROVE IT?
 *
 * The audit of 2026-08-18 found the answer was no, and found the reason in
 * one sentence: none of the eleven checkers that run on every build ever
 * opens the two files that decide who may stand where. That is why the
 * duplicate access rows, the three-second flash of headquarters data and the
 * two-login world were all invisible — nothing was looking.
 *
 * This looks. Four questions, each one a way the law has already failed:
 *
 *   PHANTOM      every name on HUB_TENANT_SAFE_ACTIONS resolves to a handler
 *                that exists. `sessionPing` sat on that list for a day and is
 *                not a function anywhere in the repo — a line for a name no
 *                file defines reads as a reviewed decision about a door
 *                nobody can open.
 *
 *   UNNARROWED   every allowlisted handler either reaches a place predicate
 *                or is named in HUB_PLACE_EXEMPT with a written reason.
 *                appUpsert and appDelete sat on the allowlist under a comment
 *                claiming they were place-stamped; they are NAMED actions, so
 *                they never pass route(), and the tab they write has no place
 *                column at all. A comment is not a mechanism.
 *
 *   WRITES       an allowlisted handler that WRITES and narrows nothing is
 *                the sharpest form of the same bug, so it is reported on its
 *                own line even when an exemption covers it.
 *
 *   ORDER        the place must be settled BEFORE anything can return. In
 *                route() six adapters answer above the filter; in doPost the
 *                three resolvers depend on each other in one direction only.
 *
 * The call graph is textual and generous on purpose (check-emits.mjs made the
 * same choice for the same reason): a missed edge here means a door nobody
 * narrowed, and over-approximating costs a comment while under-approximating
 * costs a leak.
 *
 * Run: node tools/check-places.mjs [--strict]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gsDir = resolve(root, 'apps-script')
const strict = process.argv.includes('--strict')

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

/** Every top-level `function name(...)` body, plus every HUB_ACTIONS handler. */
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

/** A declared list of bare names out of Tenant.gs. */
function listOf(varName) {
  const m = blank(tenantSrc).match(new RegExp(`var\\s+${varName}\\s*=\\s*\\[([\\s\\S]*?)\\];`))
  if (!m) return []
  // strings were blanked, so read the names from the RAW source instead
  const rawM = tenantSrc.match(new RegExp(`var\\s+${varName}\\s*=\\s*\\[([\\s\\S]*?)\\];`))
  return [...rawM[1].matchAll(/'((?:ACTION:)?[A-Za-z_$][\w$]*)'/g)].map((x) => x[1])
}

/** A declared map of name -> written reason out of Tenant.gs. */
function mapOf(varName) {
  const m = tenantSrc.match(new RegExp(`var\\s+${varName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`))
  const out = new Map()
  if (!m) return out
  for (const e of m[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(['"])([\s\S]*?)\2\s*,?\s*$/gm)) {
    out.set(e[1], e[3].trim())
  }
  return out
}

const allow = listOf('HUB_TENANT_SAFE_ACTIONS')
const exempt = mapOf('HUB_PLACE_EXEMPT')

/**
 * WHAT COUNTS AS NARROWING BY PLACE. Every one of these reads or writes the
 * axis: the row filter, the person filter, the stamp, the context itself.
 */
const PREDICATES = [
  'tenantRowVisible_', 'tenantUserVisible_', 'tenantUserRow_', 'hubAwayTenant_',
  'hubTenantId_', 'tenantStamp_', 'hubPlaceGate_', 'hubAdapterPlaceGate_',
  'tenantContext_', 'tenantResolve_', 'hubActingUserId_', 'worldRowFor_',
  // NOT tenantIdsForUser_ / tenantHomeFrom_: userPublic_ calls the first to
  // BUILD the session user, so counting it as narrowing marked a third of the
  // platform place-aware for reading a column it never filters on.
  'tenantHomeId_',
  'memberResolve_', 'memberContext_',
]

/** Which place predicates can `name` reach? Depth-limited, cycle-safe. */
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
  for (const p of PREDICATES) {
    if (new RegExp(`\\b${p}\\s*\\(`).test(node.text)) hit.add(p)
  }
  for (const m of node.text.matchAll(/\b([A-Za-z_$][\w$]*_)\s*\(/g)) {
    if (m[1] === name) continue
    for (const r of narrows(m[1], seen)) hit.add(r)
  }
  return hit
}

/** The declared lane of every action, from HUB_POLICY. */
const lane = new Map()
for (const [, src] of raw) {
  for (const m of src.matchAll(/HUB_POLICY\.([A-Za-z_$][\w$]*)\s*=\s*\{([\s\S]*?)\n\};/g)) {
    const l = m[2].match(/lane:\s*'(\w+)'/)
    if (l) lane.set(m[1], l[1])
  }
  for (const m of src.matchAll(/^\s{2}([A-Za-z_$][\w$]*):\s*\{[^}]*?lane:\s*'(\w+)'/gm)) {
    if (!lane.has(m[1])) lane.set(m[1], m[2])
  }
}

const phantom = [], unnarrowed = [], writesUnnarrowed = [], exemptWrites = []
for (const name of allow) {
  // the auth family is answered by authRoute_ before any session exists, so
  // it never reaches HUB_ACTIONS at all — that is the one structural exception
  const isAuth = name.startsWith('auth')
  const handler = graph.get('ACTION:' + name)
  if (!handler && !isAuth) { phantom.push(name); continue }
  const hit = handler ? narrows('ACTION:' + name) : new Set()
  const why = exempt.get(name)
  const writes = lane.get(name) === 'write'
  if (hit.size === 0 && !why && !isAuth) {
    unnarrowed.push(`${name} (${handler ? handler.file : '?'})`)
    if (writes) writesUnnarrowed.push(name)
  } else if (hit.size === 0 && why && writes) {
    exemptWrites.push(`${name} — ${why}`)
  }
}

/** THE ORDER. Each pair is "this must appear before that", and each one is a
 *  leak the day it stops being true. */
const mainSrc = blank(raw.get('Main.gs') || '')
function within(fnName) {
  const b = bodies(mainSrc, 'Main.gs').get(fnName)
  return b ? b.text : ''
}
const routeText = within('route')
const postText = within('doPost')
const ORDER = [
  ['route()', routeText, 'hubAdapterPlaceGate_', 'talentRoute_',
   'an adapter that answers first hands a franchise headquarters\' own workbook'],
  ['route()', routeText, 'hubPlaceGate_', 'switch (action)',
   'the column must be seized before any verb touches the payload'],
  ['doPost()', postText, 'tenantContext_', 'memberContext_',
   'a member visit rewrites `user`, and the tenant is derived from the caller\'s own account'],
  ['doPost()', postText, 'memberContext_', 'worldContext_',
   'worldResolve_ reads the member context — resolving the world first is what killed work_world'],
]
const misordered = []
for (const [where, text, first, second, why] of ORDER) {
  const a = text.indexOf(first), b = text.indexOf(second)
  if (a === -1 || b === -1 || a > b) misordered.push(`${where}: ${first} must come before ${second} — ${why}`)
}

/**
 * FAIL-CLOSED, OR SAY WHY NOT.
 *
 * Five findings in the audit were one shape: a catch that answers with an
 * empty list, an empty string or null inside a function whose result decides
 * what somebody may SEE. `membersRows_`, the two tenant directory readers,
 * the master's own address and the chat's visibleTo all did it. When the
 * sheet is unreadable those turn a failure into permission — the emptiest
 * possible answer is also the widest one, because "no membership" reads as
 * "belongs everywhere" in more than one place downstream.
 *
 * Some of them must stay open: an unreadable tenants tab that locks 188
 * people out of sign-in is a worse outage than the leak it prevents. So the
 * rule is not "never" — it is "never silently". A fail-open catch inside a
 * function the place law depends on must carry the words FAIL-OPEN: and the
 * reason, right there, which turns a hazard into a decision somebody made.
 */
const governed = listOf('HUB_FAIL_CLOSED')
const failOpen = [], missingGoverned = []
for (const name of governed) {
  const key = name.startsWith('ACTION:') ? name : name
  const node = graph.get(key)
  if (!node) { missingGoverned.push(name); continue }
  if (!/catch\s*\([^)]*\)\s*\{[^}]*=\s*(\[\]|''|""|null|false)/.test(node.text)) continue
  // the RAW body, comments intact — the written decision lives in one
  const src = raw.get(node.file) || ''
  const at = src.indexOf(node.text.slice(0, 60))
  const body = at === -1 ? node.text : src.slice(at, at + node.text.length + 400)
  if (/FAIL-(OPEN|CLOSED):/.test(body)) continue
  failOpen.push(`${name.replace('ACTION:', '')} (${node.file})`)
}

const problems = phantom.length + unnarrowed.length + misordered.length + failOpen.length + missingGoverned.length
console.log(`places: ${allow.length} allowlisted action(s), ${exempt.size} exempt with a written reason, ` +
            `${governed.length} function(s) whose answer decides what somebody sees`)
if (phantom.length) {
  console.log(`\n  ✗ ON THE ALLOWLIST, DEFINED NOWHERE (${phantom.length}):`)
  for (const n of phantom) console.log(`      ${n}`)
}
if (unnarrowed.length) {
  console.log(`\n  ✗ ALLOWED AWAY FROM HOME AND NARROWS NOTHING (${unnarrowed.length}):`)
  for (const n of unnarrowed) console.log(`      ${n}${writesUnnarrowed.includes(n.split(' ')[0]) ? '   ← and it WRITES' : ''}`)
  console.log('      Either make it place-aware, or name it in HUB_PLACE_EXEMPT with the reason.')
}
if (misordered.length) {
  console.log(`\n  ✗ OUT OF ORDER (${misordered.length}):`)
  for (const n of misordered) console.log(`      ${n}`)
}
if (missingGoverned.length) {
  console.log(`\n  ✗ NAMED IN HUB_FAIL_CLOSED, DEFINED NOWHERE (${missingGoverned.length}):`)
  for (const n of missingGoverned) console.log(`      ${n}`)
}
if (failOpen.length) {
  console.log(`\n  ✗ FAILS OPEN WITHOUT SAYING SO (${failOpen.length}):`)
  for (const n of failOpen) console.log(`      ${n}`)
  console.log('      A catch that answers [] / \'\' / null here decides what somebody may SEE.')
  console.log('      Write FAIL-OPEN: or FAIL-CLOSED: and the reason in the function, so it is a')
  console.log('      decision somebody made rather than a hazard nobody noticed.')
}
if (exemptWrites.length) {
  console.log(`\n  · exempt, and writes — reviewed, and worth re-reading (${exemptWrites.length}):`)
  for (const n of exemptWrites) console.log(`      ${n.replace(/\\'/g, "'")}`)
}
if (!problems) {
  console.log('  every allowlisted action resolves, narrows or says why not; the order holds.')
}
process.exit(strict && problems ? 1 : 0)
