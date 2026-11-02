#!/usr/bin/env node
/**
 * DOES THE RELAY ASK FOR DOORS THAT EXIST, AND MAY IT?
 *
 * WHY THIS EXISTS. On 2026-08-19 the JSON lane shipped, was published, and was
 * dead on arrival: `snapshotBundleBuild` and `snapshotBundleSweep` were named
 * in SERVICE_SWEEP_ACTIONS and the READ half, `snapshotBundleLatest`, was
 * named nowhere — so the relay could file a bundle in Drive and met the
 * service identity's default refusal the moment it tried to read one back.
 * The handler was right. The relay wiring was right. The one list that had to
 * agree with both was consulted by no assertion anywhere.
 *
 * It was found by RUNNING it, after the publish, which is the expensive way.
 * And it was never invisible to reading: both sides were sitting in this
 * repository the whole time. Nothing looked because **every other gate here
 * reads one side of a boundary** — nine open only `apps-script/`, one crosses
 * into the SPA (and exists because that crossing burned somebody before), and
 * until this file NOTHING opened `server/` at all.
 *
 * THE THREE QUESTIONS, each one a way the lane breaks silently:
 *
 *   PHANTOM   every action the relay names must be dispatchable — a named
 *             handler, a generic verb, or one of doPost's inline service
 *             branches. A name nothing answers is a 404 nobody sees until a
 *             screen is empty.
 *
 *   REFUSED   every action the relay calls WITH THE SERVICE SECRET must sit
 *             in SERVICE_READ_ACTIONS or SERVICE_SWEEP_ACTIONS. This is the
 *             403 above, and it is the whole reason for this file.
 *
 *   UNUSED    a name on a service list that nothing calls is reported, never
 *             failed: a human or a trigger may be its caller, and an
 *             allowlist entry is a decision somebody made. It is printed so
 *             the decision stays visible rather than accumulating.
 *
 * Calls carrying a PERSON'S token (`{"token": token, …}`) are checked for
 * existence and nothing else — the service lists do not speak about them, and
 * treating them as service calls would demand entries that must not exist.
 *
 * Run: node tools/check-relay-contract.mjs [--strict]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gsDir = resolve(root, 'apps-script')
const pyDir = resolve(root, 'server')
const strict = process.argv.includes('--strict')

/* ---------- what the backend can answer ---------- */

const gs = new Map()
for (const f of readdirSync(gsDir).filter((n) => n.endsWith('.gs'))) {
  gs.set(f, readFileSync(resolve(gsDir, f), 'utf8'))
}
const all = [...gs.values()].join('\n')

/** Every named handler, both declaration styles. */
const handlers = new Set([
  ...[...all.matchAll(/^HUB_ACTIONS\.([A-Za-z_$][\w$]*)\s*=\s*function/gm)].map((m) => m[1]),
  ...[...all.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:\s*function\s*\(/gm)].map((m) => m[1]),
])

/** The verbs the resource router answers. */
const VERBS = new Set(['list', 'get', 'create', 'update', 'delete'])

/**
 * doPost answers a few names inline for the service identity, before the
 * named-action table — the bulk readers and the freshness probe. Read from
 * the router rather than listed here, so one added tomorrow is known.
 */
const main = gs.get('Main.gs') || ''
const inline = new Set(
  [...main.matchAll(/action === '([\w]+)'\s*&&\s*user\.is_service/g)].map((m) => m[1]),
)
/** And the doors answered before any session exists (referral, invite, …). */
const post = main.slice(main.indexOf('function doPost('))
const preSession = post.slice(0, Math.max(0, post.indexOf('serviceIdentityFor_')))
for (const m of preSession.matchAll(/action === '([\w]+)'/g)) inline.add(m[1])
// authRoute_ owns everything that starts with auth
const authRouted = (name) => name.startsWith('auth')

/** The two service lists, read from the file that enforces them. */
function listOf(name) {
  const src = gs.get('ServiceIdentity.gs') || ''
  const m = src.match(new RegExp(`var\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`))
  return m ? [...m[1].matchAll(/'([\w]+)'/g)].map((x) => x[1]) : []
}
const serviceAllowed = new Set([...listOf('SERVICE_READ_ACTIONS'), ...listOf('SERVICE_SWEEP_ACTIONS')])

/* ---------- what the relay asks for ---------- */

/** The argument text of every _post_exec call, with its file and line. */
function callSites(src, file) {
  const out = []
  const re = /_post_exec\s*\(/g
  let m
  while ((m = re.exec(src))) {
    let depth = 0
    let i = m.index + m[0].length - 1
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') { depth--; if (depth === 0) break }
    }
    const text = src.slice(m.index, i + 1)
    out.push({ text, file, line: src.slice(0, m.index).split('\n').length })
  }
  return out
}

const asks = []
for (const f of readdirSync(pyDir).filter((n) => n.endsWith('.py'))) {
  const src = readFileSync(resolve(pyDir, f), 'utf8')
  for (const site of callSites(src, f)) {
    // `action="x"` (kwarg) or `"action": "x"` (dict literal)
    const a = site.text.match(/action\s*=\s*"([\w]+)"/) ||
              site.text.match(/"action"\s*:\s*"([\w]+)"/)
    if (!a) continue                      // a computed name — reported below
    asks.push({
      action: a[1],
      service: /credential/.test(site.text),
      file: site.file,
      line: site.line,
    })
  }
}
const computed = []
for (const f of readdirSync(pyDir).filter((n) => n.endsWith('.py'))) {
  const src = readFileSync(resolve(pyDir, f), 'utf8')
  for (const site of callSites(src, f)) {
    const has = /action\s*=\s*"[\w]+"/.test(site.text) || /"action"\s*:\s*"[\w]+"/.test(site.text)
    if (!has && /action/.test(site.text)) computed.push(`${site.file}:${site.line}`)
  }
}

/* ---------- the verdict ---------- */

const phantom = [], refused = []
for (const ask of asks) {
  const dispatchable = handlers.has(ask.action) || VERBS.has(ask.action) ||
                       inline.has(ask.action) || authRouted(ask.action)
  if (!dispatchable) phantom.push(ask)
  else if (ask.service && !serviceAllowed.has(ask.action)) refused.push(ask)
}
const called = new Set(asks.filter((a) => a.service).map((a) => a.action))
const unused = [...serviceAllowed].filter((n) => !called.has(n))

const names = [...new Set(asks.map((a) => a.action))].sort()
console.log(`relay contract: ${names.length} action name(s) the relay sends, ` +
            `${serviceAllowed.size} the service identity may use`)

if (phantom.length) {
  console.error(`\n${phantom.length} name(s) the relay sends that NOTHING answers:`)
  for (const p of phantom) console.error(`  ✗ ${p.action}  — ${p.file}:${p.line}`)
  console.error('  a 404 nobody sees until a screen is empty.')
}
if (refused.length) {
  console.error(`\n${refused.length} name(s) the SERVICE identity is refused:`)
  for (const r of refused) console.error(`  ✗ ${r.action}  — ${r.file}:${r.line}`)
  console.error('  the door exists and the machine may not open it: add it to')
  console.error('  SERVICE_READ_ACTIONS (a read) or SERVICE_SWEEP_ACTIONS (a write),')
  console.error('  and to the lock in SelfTest.gs that pins that list by name.')
}
if (!phantom.length && !refused.length) {
  console.log('  every name the relay sends is answered, and allowed where it is used.')
}
if (unused.length) {
  console.log(`\n  · allowed and not called from here (${unused.length}) — a trigger or a`)
  console.log(`    person may be the caller: ${unused.join(', ')}`)
}
if (computed.length) {
  console.log(`\n  blind spot: ${computed.length} call site(s) name the action at runtime —`)
  console.log(`    ${computed.join(', ')}`)
}

/**
 * DOES THE RELAY ASK FOR ANYTHING NOBODY SERVES?
 *
 * The fourth question, from the Guardian screen on 2026-08-20: four slices sat
 * in permanent error — "the backend does not serve this resource" — rebuilt and
 * refused on every cycle, spending an Apps Script execution each time to be told
 * no. They were page dataSource names for screens that read through ACTIONS, and
 * the manifest classified them 'adapter' because adapter was the FALLBACK: with
 * no tab, nothing derived and no explicit live entry, everything became adapter
 * by omission. A default that means "ask the backend" is a default that spends
 * executions on whatever nobody thought about.
 *
 * The emitter reads the router now. This asserts it stayed read.
 */
function servedCheck() {
  const problems = []
  let manifest = null
  // PUBLIC FIRST, dist as the fallback (2026-08-21). Reading dist first is
  // how a seven-hour-old build artifact quietly fed the resolver manifest a
  // resource whose app had been deleted that morning. `public/` is what the
  // emitter writes; dist is a copy of it that only refreshes on a build.
  for (const candidate of ['public/snapshot-manifest.json']) {
    try { manifest = JSON.parse(readFileSync(resolve(root, candidate), 'utf8')); break } catch { /* try the next */ }
  }
  if (!manifest) return { asked: 0, problems: [] }
  const gsAll = readdirSync(resolve(root, 'apps-script'))
    .filter((f) => f.endsWith('.gs'))
    .map((f) => readFileSync(resolve(root, 'apps-script', f), 'utf8'))
    .join('\n')
  const routed = new Set([...gsAll.matchAll(/^\s{2}(\w+)\s*:\s*\{/gm)].map((m) => m[1]))
  const adapters = new Set([
    ...[...gsAll.matchAll(/resource === '(\w+)'/g)].map((m) => m[1]),
    ...[...(gsAll.match(/ESTATE_SOURCES\s*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? '')
        .matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]),
  ])
  // ADAPTER MODE ONLY. `sheet` reads the Postgres mirror and never asks the
  // backend at all — including it flagged phoneScreens, which has a tab, is
  // served from the mirror and has never failed a build. A gate that names a
  // healthy resource is a gate that gets scrolled past.
  const asked = (manifest.resources ?? []).filter((r) => r.mode === 'adapter')
  for (const r of asked) {
    if (!routed.has(r.resource) && !adapters.has(r.resource)) {
      problems.push(`the snapshot manifest asks the backend for "${r.resource}" (mode ${r.mode}) and nothing routes or adapts it — every build cycle spends an execution to be refused`)
    }
  }
  return { asked: asked.length, problems }
}

const served = servedCheck()
console.log(`\nslices asked of the backend: ${served.asked}`)
if (served.problems.length) {
  for (const p of served.problems) console.log(`  \u2717 ${p}`)
} else if (served.asked) {
  console.log('  every one of them is routed or adapted — nothing is asked for that cannot answer.')
}

process.exit(strict && (phantom.length || refused.length || served.problems.length) ? 1 : 0)
