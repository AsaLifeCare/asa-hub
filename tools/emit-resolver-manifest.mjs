/**
 * Derive the resolver's routing table from the code that implements it.
 *
 * The relay in `server/snapshot_service.py` decides how every request
 * travels — how patiently to retry it, whether it may be re-delivered,
 * whether it belongs in the write ledger. Until now it decided that from
 * three sets typed by hand in Python, beside no code at all. They fell
 * behind: 25 of 106 actions appeared in none of them, and an unlisted
 * action was not refused, it silently became an eight-second write.
 *
 * Smart Comms reached the same place from the other direction — 22 of its
 * 78 RPC handlers pass with no contract, because its validator treats
 * "undeclared" as "allowed".
 *
 * So the table is READ, not restated. Each action declares itself beside
 * its handler (`HUB_POLICY.<action> = {...}` in Resolver.gs's shape), and
 * this emitter collects those declarations, joins them with the app/
 * resource half already computed by emit-snapshot-manifest.mjs, and writes
 * one file the relay obeys.
 *
 * The .gs sources are PARSED, NEVER RUN. They are full of SpreadsheetApp
 * and UrlFetchApp; importing them here would either explode or, worse,
 * reach Google from a build step. Every declaration is therefore required
 * to be a pure data literal, and this file proves that before evaluating
 * one — an identifier that is not a key or a boolean is a hard error, not
 * a warning, because a declaration that needs running is a declaration
 * that can lie about itself.
 *
 * Run:  node tools/emit-resolver-manifest.mjs [outfile] [--strict]
 *       --strict exits non-zero when any action is undeclared. That is the
 *       gate; it is armed once the count reaches zero, not before, because
 *       a build that fails on day one gets disabled on day two.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const strict = args.includes('--strict')
const out = resolve(root, args.find((a) => !a.startsWith('--')) || 'public/resolver-manifest.json')
const gsDir = resolve(root, 'apps-script')

/**
 * Blank out comments and the CONTENTS of string and regex literals, keeping
 * every offset intact so slices taken from the blanked text line up with the
 * original source.
 *
 * This is a scanner and not a regular expression on purpose. The obvious
 * `/'(?:[^'\\]|\\.)*'/` version reads the apostrophe in a prose comment —
 * "the account's rule", "it's ambiguous", and this codebase is full of them
 * — as the start of a string, then runs to the next apostrophe hundreds of
 * lines later and swallows every declaration in between. It does not fail;
 * it silently reports a smaller surface. First run of this emitter found 46
 * handlers where there are 106, which is precisely the kind of quiet
 * undercount the resolver exists to stop.
 */
function blankStrings(src) {
  const out = Array.from(src)
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' '
  }
  let i = 0
  let prev = ''   // last significant character — decides / as regex or divide
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      let j = i
      while (j < src.length && src[j] !== '\n') j++
      blank(i, j); i = j; continue
    }
    if (c === '/' && next === '*') {
      const j = src.indexOf('*/', i + 2)
      const end = j < 0 ? src.length : j + 2
      blank(i, end); i = end; continue
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c) break
        if (c !== '`' && src[j] === '\n') break   // unterminated: do not run away
        j++
      }
      blank(i + 1, j); i = Math.min(j + 1, src.length); prev = c; continue
    }
    if (c === '/' && /[=(,:[!&|?{};+\-*%<>~^]/.test(prev)) {
      let j = i + 1, inClass = false
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '[') inClass = true
        else if (src[j] === ']') inClass = false
        else if (src[j] === '/' && !inClass) break
        else if (src[j] === '\n') { j = i; break }   // not a regex after all
        j++
      }
      if (j > i) { blank(i + 1, j); i = Math.min(j + 1, src.length); prev = '/'; continue }
    }
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out.join('')
}

/** From the `{` at `start`, the index just past its matching `}`. */
function matchBrace(src, start) {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * A declaration may contain: strings, numbers, booleans, null, arrays,
 * objects, and keys. Nothing else. Anything that could execute — a call, a
 * template literal, an arrow, a reference to another variable — means the
 * value is not knowable without running the file, and the whole point is
 * that we never run it.
 */
function assertPureLiteral(literal, where) {
  const blanked = blankStrings(literal)
  if (/`|=>|\bnew\b|\bfunction\b|\bthis\b|\+\+|\/\//.test(blanked)) {
    throw new Error(`${where}: policy must be a pure data literal (found code)`)
  }
  // Every bare word must be a key (`word:`) or a literal keyword.
  const bare = blanked.replace(/\b(true|false|null)\b/g, ' ')
  const bad = [...bare.matchAll(/[A-Za-z_$][\w$]*/g)]
    .filter((m) => {
      const after = bare.slice(m.index + m[0].length)
      return !/^\s*:/.test(after)
    })
    .map((m) => m[0])
  if (bad.length) {
    throw new Error(`${where}: policy references ${[...new Set(bad)].join(', ')} — ` +
      `it must be a pure data literal, so its value can be read without executing the file`)
  }
}

const files = readdirSync(gsDir).filter((f) => f.endsWith('.gs')).sort()

const policies = new Map()   // action -> {policy, file}
const handlers = new Map()   // action -> file
const problems = []

for (const name of files) {
  const src = readFileSync(resolve(gsDir, name), 'utf8')
  const blanked = blankStrings(src)

  // 1. Declarations.
  for (const m of blanked.matchAll(/HUB_POLICY\.([A-Za-z_$][\w$]*)\s*=\s*\{/g)) {
    const action = m[1]
    const open = m.index + m[0].length - 1
    const end = matchBrace(blanked, open)
    if (end < 0) { problems.push(`${name}: unterminated policy for ${action}`); continue }
    const literal = src.slice(open, end)
    try {
      assertPureLiteral(literal, `${name}/${action}`)
      // eslint-disable-next-line no-new-func -- proven above to contain no code
      const value = new Function(`return (${literal})`)()
      if (policies.has(action)) problems.push(`${action}: declared twice (${policies.get(action).file}, ${name})`)
      policies.set(action, { policy: value, file: value.file || name })
    } catch (err) {
      problems.push(String(err.message || err))
    }
  }

  // 2. Handlers — BOTH registration forms. Counting only `HUB_ACTIONS.x =`
  //    undercounts the surface by the eleven declared inside HubCore.gs's
  //    object literal, which is how the first audit of this gap invented
  //    sixteen phantom rules and missed two real ones.
  for (const m of blanked.matchAll(/^HUB_ACTIONS\.([A-Za-z_$][\w$]*)\s*=/gm)) handlers.set(m[1], name)
  const lit = blanked.match(/var HUB_ACTIONS\s*=\s*\{/)
  if (lit) {
    const open = lit.index + lit[0].length - 1
    const end = matchBrace(blanked, open)
    if (end > 0) {
      for (const m of blanked.slice(open, end).matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:\s*function/gm)) {
        handlers.set(m[1], name)
      }
    }
  }
}

/**
 * THE DOORS ONLY PYTHON ANSWERS. An action asa-hub-app answers with no .gs
 * handler beside it is declared in app/doors.json, in HUB_POLICY's shape, its
 * `file` the module that answers it; JSON is a pure literal by construction.
 */
const pyPath = resolve(root, 'app/doors.json')
let PY_DOORS = {}
if (existsSync(pyPath)) {
  try { PY_DOORS = JSON.parse(readFileSync(pyPath, 'utf8')) || {} } catch (err) {
    problems.push(`app/doors.json: ${String(err.message || err)}`)
  }
}
for (const [action, policy] of Object.entries(PY_DOORS)) {
  const file = String((policy && policy.file) || '')
  if (policies.has(action)) { problems.push(`${action}: declared twice (${policies.get(action).file}, app/doors.json)`); continue }
  if (!/^app\/[a-z_]+\.py$/.test(file)) { problems.push(`${action}: app/doors.json names no app/ module for it`); continue }
  policies.set(action, { policy, file })
  handlers.set(action, file)
}

/** The resource half: what each app reads, and who may read it. Already
 *  derived from the registry — read it rather than deriving it twice. */
let resources = []
// PUBLIC FIRST: dist is a build copy that goes stale, and reading it first
// emitted a resource whose app had been removed hours earlier (2026-08-21).
for (const candidate of ['public/snapshot-manifest.json']) {
  const p = resolve(root, candidate)
  if (existsSync(p)) { resources = JSON.parse(readFileSync(p, 'utf8')).resources || []; break }
}
if (!resources.length) {
  console.warn('resolver manifest: no snapshot manifest found — run emit-snapshot-manifest.mjs first; ' +
               'the routing table will carry actions but no resource gate')
}

const VALID_LANES = ['read', 'write', 'tool', 'auth']
const VALID_STORES = ['slice', 'json', 'table', 'sheet', 'drive', 'external']
const VALID_COSTS = ['instant', 'seconds', 'minutes']
const knownResources = new Set(resources.map((r) => r.resource))

const actions = {}
for (const [action, { policy, file }] of [...policies].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (!handlers.has(action)) problems.push(`${action}: declared in ${file} but no handler answers it`)
  if (!VALID_LANES.includes(policy.lane)) problems.push(`${action}: lane "${policy.lane}" is not one of ${VALID_LANES.join('|')}`)
  if (policy.store && !VALID_STORES.includes(policy.store)) problems.push(`${action}: store "${policy.store}" is not one of ${VALID_STORES.join('|')}`)
  if (policy.cost && !VALID_COSTS.includes(policy.cost)) problems.push(`${action}: cost "${policy.cost}" is not one of ${VALID_COSTS.join('|')}`)
  for (const r of policy.invalidates || []) {
    // A rebuild aimed at a slice that does not exist refreshes nothing, and
    // says nothing while it fails to.
    if (knownResources.size && !knownResources.has(r)) problems.push(`${action}: invalidates "${r}", which is not a slice`)
  }
  actions[action] = {
    file,
    lane: policy.lane,
    store: policy.store || '',
    idempotent: policy.idempotent === true,
    cost: policy.cost || 'seconds',
    roles: policy.roles || [],
    invalidates: policy.invalidates || [],
    emits: policy.emits || [],
    // The studio's action picker shows these as payload hints. Without this
    // line the catalogue baked every action with params: [] and the hint
    // never once rendered.
    params: policy.params || {},
    // a write that changes only these reads (never its whole app); a read never kept per viewer
    ...(Array.isArray(policy.touches) ? { touches: policy.touches.map(String) } : {}),
    ...(policy.cache === false ? { cache: false } : {}),
  }
  if (policy.touches !== undefined && !Array.isArray(policy.touches)) problems.push(`${action}: touches must be a list of reads`)
}

// THE ROUTER'S OWN VERBS. These reach doPost and are routed by the relay,
// but they are not HUB_ACTIONS: `list`/`get` are the generic resource
// router in Main.gs, and the other four are the snapshot builder's bulk
// reads behind the service identity. They have no handler to sit beside,
// so they are declared here — the one place that legitimately owns them.
//
// Without this they arrive at the relay as "undeclared" and are counted as
// a defect forever. A metric that shows a permanent fault where there is
// none is a metric people learn to ignore, and then it is not a metric.
const ROUTER_ACTIONS = {
  list:      { lane: 'read', store: 'sheet', cost: 'seconds', service: false },
  get:       { lane: 'read', store: 'sheet', cost: 'seconds', service: false },
  stamp:     { lane: 'read', store: 'sheet', cost: 'instant', service: true },
  tabs:      { lane: 'read', store: 'sheet', cost: 'seconds', service: true },
  revs:      { lane: 'read', store: 'sheet', cost: 'instant', service: true },
  resources: { lane: 'read', store: 'sheet', cost: 'seconds', service: true },
}
for (const [name, r] of Object.entries(ROUTER_ACTIONS)) {
  if (actions[name]) continue          // a real handler always wins
  actions[name] = {
    file: r.service ? 'ServiceIdentity.gs' : 'Main.gs',
    lane: r.lane, store: r.store, idempotent: true, cost: r.cost,
    roles: [], invalidates: [], emits: [], router: true, service: r.service,
  }
}

const undeclared = [...handlers.keys()].filter((a) => !policies.has(a)).sort()

writeFileSync(out, JSON.stringify({
  version: 1,
  emitted_at: new Date().toISOString(),
  actions,
  undeclared,
  resources: Object.fromEntries(resources.map((r) => [r.resource, {
    apps: r.apps || [], roles: r.roles || [], mode: r.mode, shelf: r.shelf,
  }])),
}, null, 2) + '\n')

/**
 * AND THE MAP THE BROWSER NEEDS, AS CODE.
 *
 * The client has to know what an action invalidates, and the first attempt
 * fetched this manifest over HTTP at runtime. It answered 403 — because the
 * manifests were deliberately closed to the public earlier the same day — and
 * the fetch failed quietly, so the invalidation never once ran and every
 * named write went on being served from a slice older than itself.
 *
 * Baked at build time instead: no request, nothing to expose, and nothing that
 * can fail silently. If this file is missing the BUILD breaks, which is the
 * failure you want.
 */
const tsOut = resolve(root, 'src/lib/invalidates.generated.ts')
const invalidating = Object.fromEntries(
  Object.entries(actions).filter(([, a]) => (a.invalidates || []).length)
    .map(([name, a]) => [name, a.invalidates]))
writeFileSync(tsOut,
  '/** GENERATED by tools/emit-resolver-manifest.mjs — do not edit.\n' +
  ' *  action -> the slices it makes stale, straight out of HUB_POLICY. */\n' +
  'export const ACTION_INVALIDATES: Record<string, string[]> = ' +
  JSON.stringify(invalidating, null, 2) + '\n')
console.log(`invalidation map: ${Object.keys(invalidating).length} action(s) → src/lib/invalidates.generated.ts`)

/**
 * WHICH ANSWERS THE TAB MAY HOLD, AS CODE. The read lane (only a read's answer is ever held, and only when the relay
 * says it keeps it) and the writes that change nothing but the reads they name — a document's or a call's door, which
 * only answers bytes, names none.
 */
const keptOut = resolve(root, 'src/lib/keptReads.generated.ts')
const readNames = Object.keys(actions).filter((n) => actions[n].lane === 'read').sort()
const touching = Object.fromEntries(Object.entries(actions)
  .filter(([n, a]) => Array.isArray(a.touches) ||
    (a.lane === 'tool' && a.idempotent && a.cost === 'seconds' && /(DocFile|DocRead|Transcript)$/.test(n)))
  .map(([n, a]) => [n, Array.isArray(a.touches) ? a.touches : []]))
writeFileSync(keptOut,
  '/** GENERATED by tools/emit-resolver-manifest.mjs — do not edit.\n' +
  ' *  The read lane, and the writes that change only the reads they name. */\n' +
  'export const READ_ACTIONS: ReadonlySet<string> = new Set(' + JSON.stringify(readNames) + ')\n' +
  'export const WRITE_TOUCHES: Record<string, string[]> = ' + JSON.stringify(touching, null, 2) + '\n')
console.log(`kept reads: ${readNames.length} read(s), ${Object.keys(touching).length} narrow write(s) → src/lib/keptReads.generated.ts`)

/**
 * THE STUDIO'S CATALOGUE, BAKED FOR THE SAME REASON.
 *
 * The playground's action builder lets an admin put a button on a page that
 * CALLS a declared action, so the studio needs to know which actions exist,
 * which lane they ride, what they may emit and which params they ask for.
 * Baked beside the invalidation map: no request, nothing served over HTTP.
 *
 * ROLES ARE DELIBERATELY LEFT OUT. This file ships inside the SPA bundle to
 * every signed-in session, and "who may do what" is exactly the map the
 * manifests were closed to the public for. The studio says "the gate decides"
 * — because it does, server-side, on every call.
 */
/**
 * WHAT EACH ACTION IS FOR, IN WORDS. The Hiring policy screen carried no
 * description at all for any single feature.
 *
 * That made the screen unusable: four hundred rows of
 * `obDocRemove`, `packetProbe`, `packetUnwaive` with a lane and a role beside
 * them and nothing saying what any of it DOES.
 *
 * THE WORDS ARE NOT WRITTEN TWICE. Nearly every handler already carries a doc
 * comment explaining itself — often the best explanation in the project — and
 * a second description kept beside the declaration would be the second truth
 * that drifts the first time somebody edits one and not the other. So this
 * lifts the comment that is ALREADY THERE.
 *
 * IT TAKES THE NEAREST ONE, and that detail is the whole correctness of it: a
 * first attempt matched the first `/**` before the declaration and attributed
 * an unrelated paragraph — recruitmentDoc was described by a comment about
 * response_data. The block must END immediately before the declaration, with
 * nothing but whitespace between.
 *
 * AN ACTION WITH NO COMMENT GETS NOTHING. 166 of 410 have none today; the
 * screen shows a blank for those rather than a sentence somebody invented.
 */
function actionDocs() {
  const out = {}
  for (const file of readdirSync(gsDir).filter((f) => f.endsWith('.gs'))) {
    const src = readFileSync(resolve(gsDir, file), 'utf8')
    const re = /(?:HUB_POLICY|HUB_ACTIONS)\.([A-Za-z0-9_]+)\s*=/g
    let m
    while ((m = re.exec(src))) {
      const name = m[1]
      if (out[name]) continue
      const before = src.slice(0, m.index)
      const end = before.lastIndexOf('*/')
      if (end === -1) continue
      // The comment has to TOUCH the declaration, or it belongs to something else.
      if (before.slice(end + 2).trim() !== '') continue
      const start = before.lastIndexOf('/**', end)
      if (start === -1) continue
      const body = before.slice(start + 3, end)
        .split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join(' ')
        .replace(/\s+/g, ' ').trim()
      if (body) out[name] = body.length > 400 ? body.slice(0, 400).trim() + '…' : body
    }
  }
  return out
}
/**
 * The descriptions are read out of the retired engine's comments; a screen never names that engine or its files.
 * "(Compliance.gs complianceWhose_)" goes, "Profile.gs' cleaners" reads "the Profile module's cleaners", and
 * "Apps Script" reads "the platform".
 */
function scrubEngine(text) {
  return text
    .replace(/\s*\((?:[A-Z][A-Za-z]+\.gs)(?:[ ,:][^)]*)?\)/g, '')
    .replace(/\b([A-Z][A-Za-z]+)\.gs'/g, 'the $1 module\'s')
    .replace(/\b([A-Z][A-Za-z]+)\.gs\b/g, 'the $1 module')
    .replace(/\bApps Script\b/g, 'the platform')
}
const DOCS = Object.fromEntries(Object.entries({
  ...Object.fromEntries(Object.entries(PY_DOORS).filter(([, p]) => p && p.what).map(([n, p]) => [n, String(p.what)])),
  ...actionDocs(),
}).map(([n, w]) => [n, scrubEngine(w)]))

const actionsTsOut = resolve(root, 'src/lib/actions.generated.ts')
const catalogue = Object.fromEntries(
  Object.entries(actions).map(([name, a]) => [name, {
    lane: a.lane || 'write',
    cost: a.cost || 'seconds',
    emits: a.emits || [],
    params: Object.keys(a.params || {}),
    ...(DOCS[name] ? { what: DOCS[name] } : {}),
  }]))
writeFileSync(actionsTsOut,
  '/** GENERATED by tools/emit-resolver-manifest.mjs — do not edit.\n' +
  ' *  action -> { lane, cost, emits, params }, straight out of HUB_POLICY.\n' +
  ' *  Roles are NOT here on purpose: the bundle ships to every session, and\n' +
  ' *  who-may-do-what is the map the manifests were closed to the public for. */\n' +
  'export type BakedAction = { lane: string; cost: string; emits: string[]; params: string[]; what?: string }\n' +
  'export const ACTIONS_CATALOGUE: Record<string, BakedAction> = ' +
  JSON.stringify(catalogue, null, 2) + '\n')
console.log(`actions catalogue: ${Object.keys(catalogue).length} action(s) → src/lib/actions.generated.ts`)

const byLane = (l) => Object.values(actions).filter((a) => a.lane === l).length
console.log(`resolver manifest: ${Object.keys(actions).length}/${handlers.size} actions declared ` +
            `(${byLane('read')} read, ${byLane('write')} write, ${byLane('tool')} tool) ` +
            `+ ${resources.length} resources → ${out.replace(root + '/', '')}`)

if (problems.length) {
  console.error(`\nresolver manifest: ${problems.length} problem(s)`)
  for (const p of problems) console.error(`  ✗ ${p}`)
}
if (undeclared.length) {
  console.error(`\nresolver manifest: ${undeclared.length} action(s) with no declared policy`)
  for (const a of undeclared) console.error(`  · ${a}  (${handlers.get(a)})`)
  console.error('  each one falls through to the write lane by omission — declare HUB_POLICY.<action> beside its handler')
}
// A malformed declaration is always fatal: it would reach the relay as a
// silent fallback, which is the failure this whole file exists to end.
// A MISSING one is fatal only under --strict, so the gate can be armed the
// day the count reaches zero rather than the day the work starts.
if (problems.length || (strict && undeclared.length)) process.exit(1)
