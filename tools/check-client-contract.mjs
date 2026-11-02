/**
 * Do the client and the backend agree on which actions exist?
 *
 * The resolver made the backend declare every action it answers. The other
 * half of that promise is the SPA: an action name typed in a component is a
 * string, and a string that no handler answers fails at RUNTIME, in front of
 * whoever pressed the button, with a message about an unknown action.
 *
 * WHAT THIS CANNOT SEE, AND SAYS SO.
 *
 * `gasAction(action, payload)` with a VARIABLE — useObFlow's `run()` is
 * exactly this — is invisible to a static scan. A first version of this
 * check found "0 problems" and that number was worthless: it meant zero
 * among the calls it could see, and it could not see the onboarding portal
 * at all. So this counts literal calls, counts indirect call sites
 * SEPARATELY, and reports the second number as a blind spot rather than
 * folding it into a clean bill of health.
 *
 * The indirect ones are then recovered where possible: a wrapper is nearly
 * always called with a literal one line away (`run('obStepDone', …)`), so
 * every string literal that reaches a known wrapper is collected too.
 *
 * Run: node tools/check-client-contract.mjs [--strict]
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readdirSync, statSync } from 'node:fs'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const strict = process.argv.includes('--strict')

let manifest = null
let manifestPath = ''
// ONE SOURCE: the copy the emitter writes. `dist/` is a build artifact that
// only refreshes when somebody builds the SPA, and reading it first is how a
// seven-hour-old list survived a resource being deleted (2026-08-21). A
// fallback to it is the same hazard wearing a smaller hat.
for (const p of ['public/resolver-manifest.json']) {
  const full = resolve(root, p)
  if (existsSync(full)) { manifest = JSON.parse(readFileSync(full, 'utf8')); manifestPath = full; break }
}
if (!manifest) {
  console.error('no resolver manifest — run `npm run resolver:manifest` first')
  process.exit(strict ? 1 : 0)
}

/**
 * IS THE MANIFEST OLDER THAN THE CODE IT DESCRIBES?
 *
 * This reads a BUILD ARTEFACT, not the sources — so it was comparing today's
 * client against whatever the backend looked like at the last `npm run
 * build`. In one direction that fails safe (a new action looks undeclared).
 * In the other it does not: an action DELETED from the code stays in a stale
 * manifest, every client call to it still looks fine, and the check reports
 * agreement that no longer exists. That is the exact failure this tool was
 * written to prevent, reproduced one level up.
 *
 * So staleness is refused rather than tolerated. Found 2026-08-07, by the
 * check failing on four actions that did exist.
 */
const gsDir = resolve(root, 'apps-script')
const newestSource = Math.max(
  ...readdirSync(gsDir).filter((f) => f.endsWith('.gs'))
    .map((f) => statSync(resolve(gsDir, f)).mtimeMs),
)
if (statSync(manifestPath).mtimeMs < newestSource) {
  console.error(`the resolver manifest is OLDER than apps-script/ — it describes a backend that ` +
                `no longer exists.\n  ${manifestPath.replace(root + '/', '')}\n` +
                `  run \`npm run resolver:manifest\` (or \`npm run build\`) and check again.`)
  if (strict) process.exit(1)
}
const known = new Set(Object.keys(manifest.actions || {}))

/**
 * THE PUBLIC DOORS ARE NOT ACTIONS, AND THAT IS THE POINT.
 *
 * referralSubmit, the interview scheduler's two doors and the invitation's
 * two are dispatched in doPost BEFORE the session gate, because no session
 * exists yet — the HMAC token in the payload is the identity. The self-test
 * asserts they stay OUT of HUB_ACTIONS for exactly that reason: a public door
 * in there would ride the gate it must not need. So they never reach the
 * resolver manifest, and the register page's two calls read here as actions
 * the backend does not declare — a checker crying wolf about the one design
 * decision it should be protecting.
 *
 * They are read from the router itself rather than listed here: a door added
 * tomorrow is known the moment it is dispatched, and one removed stops being
 * known the moment it is not.
 */
{
  const main = readFileSync(resolve(gsDir, 'Main.gs'), 'utf8')
  const post = main.slice(main.indexOf('function doPost('))
  const gate = post.indexOf('serviceIdentityFor_')
  const preSession = gate === -1 ? '' : post.slice(0, gate)
  for (const m of preSession.matchAll(/action\s*===\s*'([\w]+)'/g)) known.add(m[1])
}

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = resolve(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(e)) out.push(p)
  }
  return out
}
const files = walk(resolve(root, 'src'))

/**
 * A local wrapper only counts INSIDE a file that actually forwards a
 * computed name to gasAction. Treating every `run('x')` in the codebase as
 * an action call reported `api.ts`'s own facade — `run('remove', resource,
 * …)`, which never reaches Apps Script — as an undeclared action. A check
 * that cries wolf is a check somebody switches off, so the wrapper
 * heuristic is scoped to files that demonstrably have a dispatcher.
 */
const WRAPPERS = ['run', 'call', 'post']

const literal = new Map()   // action -> files
const indirect = []         // call sites whose action is computed
const add = (name, rel) => {
  if (!literal.has(name)) literal.set(name, new Set())
  literal.get(name).add(rel)
}
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const rel = file.replace(root + '/', '')

  for (const m of src.matchAll(/\bgasAction\s*(?:<[^>]*>)?\s*\(\s*(['"`])([\w]+)\1/g)) {
    add(m[2], rel)
  }
  // A call whose first argument is an identifier, not a string.
  const computed = [...src.matchAll(/\bgasAction\s*(?:<[^>]*>)?\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)]
  for (const m of computed) indirect.push({ file: rel, via: m[1] })

  // Only THEN are local wrappers meaningful in this file.
  if (!computed.length) continue
  for (const w of WRAPPERS) {
    const re = new RegExp(`\\b${w}\\s*(?:<[^>]*>)?\\s*\\(\\s*(['"\`])([\\w]+)\\1`, 'g')
    for (const m of src.matchAll(re)) add(m[2], rel)
  }
}

// A wrapper argument that happens to match a real action is a call; one that
// does not is almost certainly an unrelated `run('something')` and is noise.
// Only names the backend knows are counted, and unknown ones are shown for a
// human to judge rather than failing the build on a false match.
const calls = [...literal.keys()]
const unknown = calls.filter((a) => !known.has(a))
const routerish = new Set(['list', 'get', 'create', 'update', 'delete'])
const realUnknown = unknown.filter((a) => !routerish.has(a))

console.log(`client contract: ${calls.length} literal action name(s) found in src/, ` +
            `${known.size} declared by the backend`)

if (realUnknown.length) {
  console.log(`\n${realUnknown.length} name(s) the client uses that the backend does not declare:`)
  for (const a of realUnknown) {
    console.log(`  ✗ ${a}  — ${[...literal.get(a)].slice(0, 3).join(', ')}`)
  }
  console.log('  each one fails at runtime, in front of whoever pressed the button.')
} else {
  console.log('  every literal action the client sends has a declared handler.')
}

if (indirect.length) {
  console.log(`\nblind spot: ${indirect.length} call site(s) pass a COMPUTED action name — ` +
              `not checkable statically:`)
  for (const i of indirect.slice(0, 8)) console.log(`  · ${i.file} (gasAction(${i.via}, …))`)
  console.log('  the literals that reach those wrappers are counted above where they could be found.')
}


/**
 * The pipeline stages, on all three sides.
 *
 * A stage the SPA draws but the backend cannot write is a column nobody
 * ever lands in. A stage the backend writes but the SPA does not draw is
 * worse: the card is real, it is in the sheet, and it appears on no screen
 * — which is exactly what happened to `internal-docs` while step 8 was
 * being built, and it took a person noticing a missing person to find it.
 *
 * Three lists have to agree: TALENT_STAGE_ORDER (what the board renders),
 * HUB_STAGE_TO_STATUS (what can be written into the status column), and the
 * SPA's own pipeline stages.
 */
/**
 * DOES THE DRAWER REFUSE WHAT THE SERVER ALLOWS?
 *
 * `GATE_NEED` (CandidatePanel.tsx) is a hand-written mirror of `hubGateFor_`
 * (HubCore.gs), and on 2026-08-29 it was found two decisions out of date: it
 * still demanded the résumé document and the CJIS at the `new` rung, months
 * after both became NON-BLOCKING. The Advance button was disabled
 * for candidates the server would have moved, and nothing said so — a mirror
 * that refuses too much reads as a rule.
 *
 * A gate cannot compare predicates, so it compares WHAT EACH ITEM IS ABOUT.
 * The map below is the reviewable part: each checklist id names the token its
 * requirement must appear as in the server's own branch. If the drawer demands
 * an item and the server's branch never mentions its field, the drawer is
 * refusing something nobody is asking for.
 *
 * The reverse (server asks, drawer does not) is NOT a failure: the drawer is
 * allowed to be more permissive, because the server refuses the write anyway
 * and says why. Only the false refusal is silent.
 */
const GATE_TOKENS = {
  'resume': 'resumelink',
  'cjis': 'cjis',
  'resume-decision': 'decisionstatus',
  'screen-details': 'screenstatus',
  'advance-decision': 'finalresult',
  'interview-scorecard': 'interviewScored_',
  'interview-recommendation': 'recommendation',
  'new-hire-packet': 'packet',
  'onboarding-complete': 'hubOnboardingDone_',
}

function gateCheck() {
  const read = (p) => { try { return readFileSync(resolve(root, p), 'utf8') } catch { return '' } }
  const panel = read('src/engine/templates/pipeline/CandidatePanel.tsx')
  const hubcore = read('apps-script/HubCore.gs')
  const problems = []
  const pairs = []

  const block = panel.match(/const GATE_NEED[^=]*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  if (!block) return { problems: ['GATE_NEED could not be read from CandidatePanel.tsx'], pairs }

  // hubGateFor_ is the matrix ride's wrapper; the branches live in hubGateCode_.
  const fn = hubcore.slice(hubcore.indexOf('function hubGateCode_'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
  if (!body) return { problems: ['hubGateCode_ could not be read from HubCore.gs'], pairs }

  for (const m of block.matchAll(/'?([a-z-]+)'?\s*:\s*\[([^\]]*)\]/g)) {
    const stage = m[1]
    const ids = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])
    // the branch for this stage, up to the next branch or the end
    const at = body.indexOf(`stage === '${stage}'`)
    if (at === -1) { problems.push(`GATE_NEED names stage "${stage}" and hubGateCode_ has no branch for it`); continue }
    const next = body.indexOf("if (stage === '", at + 10)
    // COMMENTS ARE NOT REQUIREMENTS. The first version of this check passed
    // `cjis` at the `new` rung because the branch's own comment EXPLAINS why
    // CJIS stopped gating — a check that reads prose as evidence confirms
    // exactly the sentence that says the opposite.
    const branch = body.slice(at, next === -1 ? body.length : next)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')
    for (const id of ids) {
      const token = GATE_TOKENS[id]
      if (!token) { problems.push(`GATE_NEED demands "${id}" at ${stage} and this check has no token for it — add one to GATE_TOKENS`); continue }
      pairs.push(`${stage}/${id}`)
      if (!branch.includes(token)) {
        problems.push(`the drawer refuses "${id}" at ${stage}, but hubGateCode_'s branch never reads ${token} — the button is disabled for a move the server would allow`)
      }
    }
  }
  return { problems, pairs }
}

function stageCheck() {
  const read = (p) => { try { return readFileSync(resolve(root, p), 'utf8') } catch { return '' } }
  const talent = read('apps-script/Talent.gs')
  const hubcore = read('apps-script/HubCore.gs')
  const order = (talent.match(/var TALENT_STAGE_ORDER\s*=\s*\[([^\]]*)\]/s)?.[1] ?? '')
    .match(/'([\w-]+)'/g)?.map((x) => x.slice(1, -1)) ?? []
  const mapped = (hubcore.match(/HUB_STAGE_TO_STATUS\s*=\s*\{(.*?)\n\}/s)?.[1]
                  ?? talent.match(/HUB_STAGE_TO_STATUS\s*=\s*\{(.*?)\n\}/s)?.[1] ?? '')
    .match(/'([\w-]+)'\s*:/g)?.map((x) => x.replace(/['\s:]/g, '')) ?? []
  let spa = []
  for (const f of files) {
    if (!/registry\/apps/.test(f)) continue
    for (const blk of readFileSync(f, 'utf8').matchAll(/stages:\s*\[(.*?)\]\s*,/gs)) {
      const ids = [...blk[1].matchAll(/id:\s*'([\w-]+)'/g)].map((m) => m[1])
      if (ids.includes('onboarding') && ids.includes('phone-screen')) spa = ids
    }
  }
  const problems = []
  if (!order.length || !mapped.length || !spa.length) {
    problems.push('could not read all three stage lists — the check is blind, not clean')
  } else {
    for (const s of spa) if (!order.includes(s)) problems.push(`the SPA draws "${s}" but the board does not order it`)
    for (const s of order) if (!spa.includes(s)) problems.push(`the backend orders "${s}" but no screen draws it — a card there is invisible`)
    for (const s of order) if (!mapped.includes(s)) problems.push(`"${s}" has no status to be written as`)
  }
  return { order, mapped, spa, problems }
}

/**
 * EVERY URGENCY LEVEL THE SERVER CAN RETURN IS DRAWN BY SOMETHING.
 *
 * This check exists because of a two-day failure found on the screen and not
 * by any of the other nine: `hubCardUrgency_` learned to return `amber` from a
 * second source, the slice carried it correctly on three real cards, and the
 * client drew NOTHING — `UrgencyChip` returned null for everything that was not
 * `red`, on a comment that had been true when amber had one source.
 *
 * Nothing failed. The board simply went quiet about three people who were
 * stuck, which is the exact failure the colour was built to prevent.
 *
 * It is deliberately crude: the level literals the server can return, against
 * the level literals the chip mentions. A chip that names a level and draws it
 * badly still passes — but a level no component has ever heard of cannot.
 */
function urgencyCheck() {
  const read = (p) => { try { return readFileSync(resolve(root, p), 'utf8') } catch { return '' } }
  const fn = read('apps-script/Packet.gs').match(/function hubCardUrgency_[\s\S]*?\n\}/)?.[0] ?? ''
  const chip = read('src/engine/templates/pipeline/UrgencyChip.tsx')
  const problems = []
  if (!fn || !chip) return { levels: [], problems: ['could not read hubCardUrgency_ or UrgencyChip — the check is blind, not clean'] }
  const levels = [...new Set([...fn.matchAll(/level:\s*'([a-z]+)'/g)].map((m) => m[1]))]
  if (!levels.length) problems.push('hubCardUrgency_ returned no level literals — the extractor is wrong, not the code')
  for (const l of levels) {
    // `none` is the absence of a colour and is correctly drawn by nothing.
    if (l === 'none') continue
    if (!chip.includes(`'${l}'`)) {
      problems.push(`the server can return urgency "${l}" and UrgencyChip never mentions it — that card renders no colour at all`)
    }
  }

  /**
   * And every RETURN carries a source.
   *
   * `source` is what tells the client which chip owns the sentence. A branch
   * that forgets it does not fail — it falls back to the pre-2026-08-08 rule
   * meant only for stale slices, which is wrong for exactly the case the field
   * was added to fix. Silent, and it looks like the bug that was just closed.
   */
  const returns = [...fn.matchAll(/\{\s*level:\s*'([a-z]+)'([\s\S]{0,220}?)\}/g)]
  for (const [, lvl, rest] of returns) {
    if (lvl !== 'none' && !/source:\s*'[a-z-]+'/.test(rest)) {
      problems.push(`a "${lvl}" branch of hubCardUrgency_ returns no source — the client falls back to guessing`)
    }
  }
  return { levels, problems }
}

/**
 * A PER-PERSON RESOURCE MAY NEVER BE MIRRORED INTO A SLICE.
 *
 * `ownedBy` (Main.gs) says the rows belong to individuals. A slice is one
 * static file, built by a service identity and served to every session — so
 * mirroring such a resource publishes everybody's rows to everybody. It is not
 * a leak that shows up in testing: each person sees plausible data, and the
 * only symptom is that they see other people's too.
 *
 * `tasks.json` was exactly that file until 2026-08-08. The two declarations
 * must agree, and neither is readable from the other's file.
 */
function ownedCheck() {
  const read = (p) => { try { return readFileSync(resolve(root, p), 'utf8') } catch { return '' } }
  const main = read('apps-script/Main.gs')
  const snap = read('src/lib/snapshot.ts')
  const problems = []
  if (!main || !snap) return { owned: [], problems: ['could not read Main.gs or snapshot.ts — the check is blind, not clean'] }
  // resource keys whose RESOURCES entry declares ownedBy
  const owned = [...main.matchAll(/(\w+)\s*:\s*\{[^{}]*ownedBy\s*:/g)].map((m) => m[1])
  const never = (snap.match(/NEVER_SNAPSHOT[^=]*=\s*\[([\s\S]*?)\]/)?.[1] ?? '')
    .match(/'([\w-]+)'/g)?.map((x) => x.slice(1, -1)) ?? []
  for (const r of owned) {
    if (!never.includes(r)) {
      problems.push(`"${r}" declares ownedBy but is not in NEVER_SNAPSHOT — its slice would publish every person's rows to everyone`)
    }
  }
  return { owned, problems }
}

/**
 * DOES THE CLIENT WEAR THE VISIT THE SAME WAY THE SERVER DOES?
 *
 * The fourth boundary, and the one that cost 2026-08-19 six rounds. The member
 * visit was real on the server — `doPost` rebuilds the session user with the
 * visited person's role and badges — and INVISIBLE on the client, which drew
 * every screen from `useAuthStore.user` and short-circuited on `isMaster`. A
 * master visiting a staff member kept all 66 apps. Nothing was looking,
 * because each side was correct read alone.
 *
 * Three questions, all statically answerable, all cross-file:
 *   RANK    — the clamp ranks roles; two files hold that table now
 *             (Members.gs HUB_ROLE_RANK, effectiveUser.ts ROLE_RANK) and a
 *             drift makes the drawn workspace wider than the answered one;
 *   CHECKER — the ONE access checker must read the EFFECTIVE identity. It read
 *             the signed-in account, and that single line was the whole bug;
 *   MASTER  — the visiting branch must drop the master's blanket pass, or the
 *             clamp is decoration.
 */
function visitCheck() {
  const read = (p) => { try { return readFileSync(resolve(root, p), 'utf8') } catch { return '' } }
  const gs = read('apps-script/Members.gs')
  const eff = read('src/lib/effectiveUser.ts')
  const acc = read('src/lib/appAccess.ts')
  const problems = []
  if (!gs || !eff || !acc) {
    return { ranks: 0, problems: ['could not read Members.gs, effectiveUser.ts or appAccess.ts — the check is blind, not clean'] }
  }
  const table = (src, name) => {
    const body = src.match(new RegExp(name + '\\s*(?::\\s*Record<[^>]*>\\s*)?=\\s*\\{([^}]*)\\}'))?.[1] ?? ''
    const out = {}
    for (const m of body.matchAll(/(\w+)\s*:\s*(\d+)/g)) out[m[1].toLowerCase()] = Number(m[2])
    return out
  }
  const server = table(gs, 'HUB_ROLE_RANK')
  const client = table(eff, 'ROLE_RANK')
  const keys = [...new Set([...Object.keys(server), ...Object.keys(client)])].sort()
  if (!keys.length) problems.push('neither role-rank table could be parsed — the drift check is not running')
  for (const k of keys) {
    if (server[k] === undefined) problems.push(`role "${k}" is ranked on the client and unknown to Members.gs`)
    else if (client[k] === undefined) problems.push(`role "${k}" is ranked in Members.gs and unknown to effectiveUser.ts`)
    else if (server[k] !== client[k]) problems.push(`role "${k}" ranks ${server[k]} on the server and ${client[k]} on the client — the visit clamps differently on each side`)
  }
  // the ONE checker must ask the effective identity, never the session
  if (!/badgeAllowsApp\(\s*appId\s*,\s*effectiveUser\(\)/.test(acc)) {
    problems.push('lib/appAccess does not hand badgeAllowsApp the EFFECTIVE user — a member visit changes every server answer and nothing on screen (2026-08-19)')
  }
  if (/badgeAllowsApp\([^)]*useAuthStore/.test(acc)) {
    problems.push('lib/appAccess hands badgeAllowsApp the SIGNED-IN user — that exact line is the bug the effective identity was written for')
  }
  // and the visit must never carry the master's blanket pass
  if (!/isMaster:\s*false/.test(eff)) {
    problems.push('effectiveUser.ts never sets isMaster false — a visit carrying the master pass shows more than the visited person can see')
  }
  return { ranks: keys.length, problems }
}

/**
 * AND THEN RUN IT. The table check above proves two files AGREE; it cannot
 * prove either one is right. `effectiveUserFrom` is pure — two plain values in,
 * one plain value out — so it can be executed here, offline, the same way
 * run-selftest.mjs executes the backend's pure half rather than trusting a
 * reading of it. The four cases are the four anybody tries first.
 *
 * The TS is transformed, not bundled: the pure function touches no import, and
 * the hooks below it are never called, so the import lines are dropped rather
 * than resolved. If that ever stops being true this returns a problem instead
 * of a pass — a check that cannot run must not report clean.
 */
async function visitBehaviour() {
  const problems = []
  let fn = null
  try {
    const esbuild = await import('esbuild')
    const src = readFileSync(resolve(root, 'src/lib/effectiveUser.ts'), 'utf8')
    const js = (await esbuild.transform(src, { loader: 'ts', format: 'esm' })).code
      .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
      .replace(/^export\s+/gm, '')
    const ctx = { module: { exports: {} }, String, Object, Array, Boolean, Number }
    vm.createContext(ctx)
    new vm.Script(js + '\n;module.exports = effectiveUserFrom;').runInContext(ctx)
    fn = ctx.module.exports
  } catch (err) {
    return { cases: 0, problems: [`could not execute effectiveUserFrom — the visit law is unproven, not proven (${err.message})`] }
  }
  const master = { id: 'u1', name: 'Owner', role: 'admin', types: ['HM'], isMaster: true }
  const cases = [
    ['no visit keeps the master pass',
      fn(master, null), (r) => r.isMaster === true && r.visiting === false && r.role === 'admin'],
    ['a visit drops the master pass',
      fn(master, { memberId: 'm1', name: 'Staff', role: 'staff', types: [] }), (r) => r.isMaster === false && r.visiting === true],
    ['a visit takes the WEAKER role',
      fn(master, { memberId: 'm1', name: 'Staff', role: 'staff', types: [] }), (r) => r.role === 'staff'],
    ['a visit can never RAISE the role',
      fn({ ...master, role: 'staff', isMaster: false }, { memberId: 'm1', name: 'Boss', role: 'admin', types: [] }),
      (r) => r.role === 'staff'],
    ['a visit carries only badges BOTH wear',
      fn(master, { memberId: 'm1', name: 'Staff', role: 'staff', types: ['HM', 'DIRECTOR'] }),
      (r) => r.types.length === 1 && r.types[0] === 'HM'],
    ['a visit answers with the VISITED identity',
      fn(master, { memberId: 'm1', name: 'Staff', role: 'staff', types: [] }), (r) => r.id === 'm1' && r.name === 'Staff'],
    ['no user is nobody',
      fn(null, { memberId: 'm1', name: 'Staff', role: 'staff', types: [] }), (r) => r === null],
  ]
  for (const [what, got, ok] of cases) {
    let passed = false
    try { passed = ok(got) } catch { passed = false }
    if (!passed) problems.push(`${what} — got ${JSON.stringify(got)}`)
  }
  return { cases: cases.length, problems }
}

/**
 * IS THERE STILL MORE THAN ONE DOOR?
 *
 * The fifth question, and the one written from the sweep of 2026-08-19. Three
 * persisted axes (tenant, world, member) and NINE doors that moved between
 * them, each clearing the set its author happened to remember. Seventeen
 * distinct user-visible consequences came out of that: a "leave" button that
 * rebooted into the world it was leaving, a "My world" card that silently kept
 * you in somebody else's, two green you-are-here dots, three tenant crossings
 * of which one cleared nothing.
 *
 * `standAlone` had said the right thing for a day. It was a closure inside one
 * component, so eight doors could not call it — a law that cannot be reached
 * from the next file is a comment. It is lib/crossPlace now, and this refuses
 * any OTHER file that moves an axis directly. That is the invariant that makes
 * the whole class unrepeatable, rather than seventeen fixes that hold until
 * somebody writes the tenth door.
 */
function oneDoorCheck() {
  const problems = []
  // the modules allowed to touch an axis: the stores themselves, the one
  // crossing, and the sign-out reset (which lands nowhere by design)
  const ALLOWED = new Set([
    'src/lib/crossPlace.ts', 'src/lib/placeReset.ts',
    'src/stores/useWorldStore.ts', 'src/stores/useTenantStore.ts', 'src/stores/useMemberStore.ts',
  ])
  const MOVES = [
    [/\.leaveMember\s*\(/, 'leaveMember()'],
    [/\.enterMember\s*\(/, 'enterMember()'],
    [/\.enterWorld\s*\(/, 'enterWorld()'],
    [/\.switchToWorld\s*\(/, 'switchToWorld()'],
    [/\.switchToCompany\s*\(/, 'switchToCompany()'],
    [/setState\s*\(\s*\{[^}]*currentWorldId/, 'setState({currentWorldId'],
    [/setState\s*\(\s*\{[^}]*currentMemberId/, 'setState({currentMemberId'],
    [/setState\s*\(\s*\{[^}]*currentTenantId/, 'setState({currentTenantId'],
  ]
  const walkAll = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walkAll(full, out) }
      else if (/\.tsx?$/.test(e.name)) out.push(full)
    }
    return out
  }
  let doors = 0
  for (const full of walkAll(resolve(root, 'src'))) {
    const rel = full.replace(root + '/', '')
    if (ALLOWED.has(rel)) continue
    const src = readFileSync(full, 'utf8')
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue      // a comment naming one is not a door
      for (const [re, what] of MOVES) {
        if (re.test(line)) {
          doors++
          problems.push(`${rel}:${i + 1} moves a place axis directly (${what}) — every crossing goes through lib/crossPlace, or the axes it forgets become the next round`)
        }
      }
    }
  }
  return { doors, problems }
}

/**
 * TWO POLARITIES SHARE ONE SHEET, SO NOTHING MAY SHARE A KEY.
 *
 * Feature rules live in the app badge tab because it stores `appid -> badges`
 * with no validation (Prefs.gs) — free, no publish, one vocabulary. The price
 * is that one map now answers two questions with OPPOSITE defaults: no row on
 * an APP means the master's alone, no row on a FEATURE means everyone who
 * opened the page. A collision would therefore not be a clash, it would be a
 * silent inversion — an app that quietly opens for everybody, or a control
 * that quietly shuts. Namespacing is the whole defence, so it is asserted
 * rather than trusted.
 */
function featureKeyCheck() {
  const problems = []
  const src = (p) => { try { return readFileSync(resolve(root, p), 'utf8') } catch { return '' } }
  const feat = src('src/lib/featureAccess.ts')
  if (!feat) return { keys: 0, problems: [] }   // the layer is optional
  const ids = [...feat.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1])
  const appIds = new Set()
  for (const f of readdirSync(resolve(root, 'src/registry')).filter((x) => x.endsWith('.ts'))) {
    for (const m of src(`src/registry/${f}`).matchAll(/^\s*id:\s*'([a-z0-9-]+)',\s*$/gm)) appIds.add(m[1])
  }
  for (const id of ids) {
    if (!id.includes('.')) problems.push(`feature key "${id}" is not namespaced — an unqualified key can collide with an app id, and the two carry opposite defaults`)
    if (appIds.has(id)) problems.push(`feature key "${id}" is ALSO an app id — one row would answer both questions, with opposite meanings`)
  }
  return { keys: ids.length, problems }
}

const featKeys = featureKeyCheck()
console.log(`\nin-page feature gates: ${featKeys.keys} key(s)`)
if (featKeys.problems.length) {
  for (const p of featKeys.problems) console.log(`  \u2717 ${p}`)
} else if (featKeys.keys) {
  console.log('  every one is namespaced, and none collides with an app id.')
}

const oneDoor = oneDoorCheck()
console.log(`\nthe crossing: ${oneDoor.doors} door(s) outside lib/crossPlace`)
if (oneDoor.problems.length) {
  for (const p of oneDoor.problems) console.log(`  \u2717 ${p}`)
} else {
  console.log('  every crossing goes through the one module that knows all three axes.')
}

const visit = visitCheck()
const behaviour = await visitBehaviour()
visit.problems.push(...behaviour.problems)
console.log(`\nthe member visit: ${visit.ranks} roles ranked on both sides, ${behaviour.cases} clamp cases run`)
if (visit.problems.length) {
  for (const p of visit.problems) console.log(`  \u2717 ${p}`)
} else {
  console.log('  client and server clamp a visit the same way, and the checker asks the visited person.')
}

const ownedRes = ownedCheck()
console.log(`\nper-person resources: ${ownedRes.owned.join(', ') || '—'}`)
if (ownedRes.problems.length) {
  for (const p of ownedRes.problems) console.log(`  ✗ ${p}`)
} else if (ownedRes.owned.length) {
  console.log('  each one is held off the snapshot path.')
}

const urgency = urgencyCheck()
console.log(`\nurgency levels: ${urgency.levels.join(', ') || '—'}`)
if (urgency.problems.length) {
  for (const p of urgency.problems) console.log(`  ✗ ${p}`)
} else {
  console.log('  every level the server can return is drawn by the chip.')
}

const stages = stageCheck()
console.log(`\npipeline stages: ${stages.order.length} on the board, ${stages.spa.length} on the screen, ` +
            `${stages.mapped.length} writable`)
if (stages.problems.length) {
  for (const p of stages.problems) console.log(`  \u2717 ${p}`)
} else {
  console.log(`  all three agree: ${stages.order.join(' \u2192 ')}`)
}

/**
 * DOES EVERY CONDITION THE PLATFORM PRODUCES HAVE WORDS?
 *
 * `talentChecklist_` (Talent.gs) emits checklist ids; `CONDITIONS`
 * (conditions.ts) says what each one MEANS and how it gets resolved. On
 * 2026-08-29 three were missing and all three were at the `hired` stage — the
 * phase where the machines have finished and a person has to act. Their own
 * comments in Talent.gs say "will NEVER finish on its own" and "is stamped and
 * NEVER retried", so the conditions that most needed instructions were the
 * ones offering none, and the screen printed the honest blank instead.
 *
 * The blank is still the right fallback. What was wrong is that nothing SAID
 * a producer had outrun the dictionary — so this counts both sides.
 *
 * The reverse (a definition for an id nothing produces) is reported too but is
 * not a failure: an entry can legitimately arrive one commit before its item.
 */
function conditionCheck() {
  const read = (p) => { try { return readFileSync(resolve(root, p), 'utf8') } catch { return '' } }
  const talent = read('apps-script/Talent.gs')
  const dict = read('src/pages/features/hiring/flow/conditions.ts')
  const problems = []

  const fn = talent.slice(talent.indexOf('function talentChecklist_'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
  const produced = new Set([...body.matchAll(/\bid:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]))

  const block = dict.slice(dict.indexOf('export const CONDITIONS'))
  const defined = new Set([...block.matchAll(/^  '?([a-z0-9-]+)'?:\s*\{/gm)].map((m) => m[1]))

  if (!produced.size || !defined.size) {
    return { problems: ['the checklist or the dictionary could not be read'], produced, defined, extra: [] }
  }
  for (const id of produced) {
    if (!defined.has(id)) {
      problems.push(`talentChecklist_ produces "${id}" and conditions.ts does not define it — the card shows the label and nothing about what to do`)
    }
  }
  const extra = [...defined].filter((id) => !produced.has(id))
  return { problems, produced, defined, extra }
}

/**
 * THREE LISTS OF THE SAME SIX PHASES, AND THEY MUST READ THE SAME.
 *
 * `stageCheck` above has compared the stage IDS across three sources since it
 * was written — and it never looked at a single LABEL, which is why it kept
 * reporting "all three agree" while the thing that can actually drift went
 * unwatched. It also does not know two of the lists exist.
 *
 * Renaming a phase is rare and it is an engineer's job: renaming everything in
 * code is the cheaper move, and what in theory must never be touched belongs
 * hardcoded rather than in config. That holds
 * twice: a configuration surface for something nobody does twice a year is
 * work in the wrong place, and it buries the knobs that matter. The backend
 * seed that was a fourth list went with the settings card; these three are
 * what is left, and renaming in two of them and shipping is what must not
 * happen. The
 * cost is cosmetic rather than a broken card — one installation showing two
 * names for one column — but it is the same shape as the drawer's gate mirror,
 * which sat two decisions stale for two months because nothing compared it to
 * anything.
 *
 * So the labels are guarded here, and renaming stays a single commit that the
 * build refuses to let anybody do by halves.
 */
function phaseLabelCheck() {
  const read = (p) => { try { return readFileSync(resolve(root, p), 'utf8') } catch { return '' } }
  // ANCHORED ON THE NAME, not on a prefix of it. The first version used
  // `const STAGES[^=]*=`, which also matched `STAGES_RENAMED` — so a list that
  // had been renamed away still satisfied the check and the "blind is not
  // clean" guard never fired. A checker whose extractor is loose reports clean
  // on exactly the change it exists to catch.
  const pairs = (src, re) => {
    const m = src.match(re)
    if (!m) return null
    return [...m[1].matchAll(/id:\s*'([\w-]+)'\s*,\s*label:\s*'([^']*)'/g)].map((x) => [x[1], x[2]])
  }

  const lists = {
    // the one Flow Admin's fallback and usePhases read
    'flow/shared.ts': pairs(read('src/pages/features/hiring/flow/shared.ts'),
      /export const STAGES(?![\w$])[^=]*=\s*\[([\s\S]*?)\n\]/),
    // THE MAIN BOARD — the kanban's columns come from the app manifest
    'registry/apps.ts': (() => {
      const src = read('src/registry/apps.ts')
      for (const blk of src.matchAll(/stages:\s*\[([\s\S]*?)\n\s{4}\]/g)) {
        const got = [...blk[1].matchAll(/id:\s*'([\w-]+)'\s*,\s*label:\s*'([^']*)'/g)].map((x) => [x[1], x[2]])
        if (got.some(([id]) => id === 'phone-screen')) return got
      }
      return null
    })(),
    // the bench page inside the Simulator app
    'FlowControlPage.tsx': pairs(read('src/pages/features/hiring/FlowControlPage.tsx'),
      /const STAGES(?![\w$])[^=]*=\s*\[([\s\S]*?)\n\]/),
  }

  const problems = []
  const unread = Object.entries(lists).filter(([, v]) => !v || !v.length).map(([k]) => k)
  if (unread.length) {
    // BLIND IS NOT CLEAN. A list this cannot parse must fail loudly rather than
    // quietly shrink the comparison to the ones it happened to read.
    problems.push(`could not read the phase list in: ${unread.join(', ')} — the check is blind, not clean`)
    return { problems, lists }
  }

  const [refName, ref] = Object.entries(lists)[0]
  for (const [name, got] of Object.entries(lists).slice(1)) {
    const a = ref.map(([id]) => id).join(' → ')
    const b = got.map(([id]) => id).join(' → ')
    if (a !== b) {
      problems.push(`${name} has different phases (or a different order) than ${refName}:\n      ${refName}: ${a}\n      ${name}: ${b}`)
      continue
    }
    ref.forEach(([id, label], i) => {
      if (got[i][1] !== label) {
        problems.push(`phase "${id}" is called "${label}" in ${refName} and "${got[i][1]}" in ${name} — one installation, two names for one column`)
      }
    })
  }
  return { problems, lists }
}

/**
 * A DECISION BUTTON MUST REACH A DOOR THAT ANSWERS IT, AND MUST LOOK BUSY WHILE
 * IT WAITS.
 *
 * Two failures met in live use, both invisible to every other
 * check here because the ACTION name was right:
 *
 *  · the Flow view's Actions offered Advance / Decline on the interview
 *    recommendation and sent it to setDecision, whose writer answers two
 *    checkpoints and refused the third with a 400 — "End X's process?" ended
 *    nothing. The checkpoint ids a screen sends are compared with the list the
 *    writer declares (HUB_DECISION_CHECKPOINTS).
 *  · Accept waited on the backend with nothing on screen saying so, and was
 *    pressed twice in one second. The board's decision press holds a
 *    per-candidate guard and every Accept/Decline it draws is disabled while
 *    that candidate's answer is on the way; the scorecard's "still running"
 *    envelope claims no outcome.
 */
function decisionDoorCheck() {
  const read = (p) => { try { return readFileSync(resolve(root, p), 'utf8') } catch { return '' } }
  const problems = []
  const core = read('apps-script/HubCore.gs')
  const talent = read('apps-script/Talent.gs')
  const listOf = (src, re) => {
    const m = src.match(re)
    return m ? [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]) : null
  }
  const answered = listOf(core, /var HUB_DECISION_CHECKPOINTS\s*=\s*\[([^\]]*)\]/)
  const sent = {
    'flow/ActionsView.tsx DECISION_ITEMS': listOf(read('src/pages/features/hiring/flow/ActionsView.tsx'),
      /const DECISION_ITEMS\s*=\s*new Set\(\[([^\]]*)\]\)/),
    'pipeline/ChecklistSection.tsx DECISION_IDS': listOf(read('src/engine/templates/pipeline/ChecklistSection.tsx'),
      /const DECISION_IDS\s*=\s*new Set\(\[([^\]]*)\]\)/),
    'pipeline/CandidatePanel.tsx REJECT_CHECKPOINT': listOf(read('src/engine/templates/pipeline/CandidatePanel.tsx'),
      /const REJECT_CHECKPOINT[^=]*=\s*\{([^}]*)\}/)?.filter((id) => /decision$/.test(id)) ?? null,
    // the table's Decide button takes any checklist id ending in "decision"
    'talentChecklist_ ids ending in "decision"': (() => {
      const fn = talent.slice(talent.indexOf('function talentChecklist_'))
      const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
      const ids = [...body.matchAll(/\bid:\s*'([a-z0-9-]+)'/g)].map((x) => x[1]).filter((id) => /decision$/.test(id))
      return ids.length ? ids : null
    })(),
  }
  if (!answered || !answered.length) {
    problems.push('HUB_DECISION_CHECKPOINTS could not be read in HubCore.gs — the check is blind, not clean')
  } else {
    for (const [where, ids] of Object.entries(sent)) {
      if (!ids || !ids.length) { problems.push(`could not read ${where} — the check is blind, not clean`); continue }
      for (const id of ids) {
        if (!answered.includes(id)) {
          problems.push(`${where} sends "${id}" to setDecision, and the writer answers only ${answered.join(', ')} — the button would end nothing`)
        }
      }
    }
  }

  const board = read('src/engine/templates/pipeline/index.tsx')
  const decide = board.slice(board.indexOf('const decideCheckpoint'), board.indexOf("gasAction", board.indexOf('const decideCheckpoint')))
  if (!/if \(decidingRef\.current\[recId\]\)/.test(decide) || !/decidingRef\.current\[recId\] = true/.test(decide)) {
    problems.push('decideCheckpoint no longer refuses a second press for the same candidate before it calls setDecision — a double click runs two decisions')
  }
  if (!/deciding=\{panelRec \? deciding\[/.test(board)) {
    problems.push('the board does not hand CandidatePanel the candidate\'s in-flight decision — its buttons cannot show that a press is running')
  }
  for (const [file, min] of [['CandidatePanel.tsx', 3], ['ChecklistSection.tsx', 2], ['CandidateFormView.tsx', 3]]) {
    const src = read(`src/engine/templates/pipeline/${file}`)
    const n = (src.match(/disabled=\{[^}]*!!deciding\}/g) ?? []).length
    if (n < min) problems.push(`${file} disables ${n} decision button(s) while a decision is on its way — expected at least ${min}`)
  }

  const modal = read('src/features/hiring/InterviewScorecardModal.tsx')
  // the code only — the comment above the branch quotes the old sentence
  const branch = modal.slice(modal.indexOf('if (accepted(res))'), modal.indexOf('return', modal.indexOf('if (accepted(res))')))
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
  if (!branch) problems.push('the scorecard modal\'s "still running" branch could not be read — the check is blind, not clean')
  else if (/Saved as/.test(branch) || !/pending: true/.test(branch)) {
    problems.push('the scorecard modal tells the interviewer an unanswered scorecard was saved — a refusal would leave the candidate open behind "Saved as Decline"')
  }
  return { problems, answered: answered ?? [], sent }
}

const doors = decisionDoorCheck()
console.log(`\ndecision doors: ${Object.keys(doors.sent).length} screens against the ${doors.answered.length} checkpoint(s) setDecision answers`)
if (doors.problems.length) {
  for (const p of doors.problems) console.log(`  ✗ ${p}`)
} else {
  console.log('  every decision a screen sends is one the writer answers, and every press shows it is running.')
}

const phaseLabels = phaseLabelCheck()
console.log(`\nphase names: ${Object.keys(phaseLabels.lists).length} lists of the same six`)
if (phaseLabels.problems.length) {
  for (const p of phaseLabels.problems) console.log(`  ✗ ${p}`)
  console.log('  renaming a phase is one commit across all of them, never three of four.')
} else {
  console.log(`  all of them agree: ${(phaseLabels.lists['flow/shared.ts'] ?? []).map(([, l]) => l).join(' · ')}`)
}

const conds = conditionCheck()
console.log(`\ncondition dictionary: ${conds.defined.size} defined for ${conds.produced.size} the checklist produces`)
if (conds.extra.length) console.log(`  (defined and not produced, which is allowed: ${conds.extra.join(', ')})`)
if (conds.problems.length) {
  for (const p of conds.problems) console.log(`  ✗ ${p}`)
} else {
  console.log('  every condition on a card can say what it means.')
}

const gate = gateCheck()
console.log(`\nstage gate mirror: ${gate.pairs.length} requirement(s) the drawer enforces`)
if (gate.problems.length) {
  for (const p of gate.problems) console.log(`  ✗ ${p}`)
  console.log('  a drawer that refuses more than the server does not fail — it just stops somebody, quietly.')
} else {
  console.log('  every one of them is something hubGateFor_ actually asks for.')
}

process.exit(strict && (realUnknown.length || stages.problems.length || urgency.problems.length ||
                        ownedRes.problems.length || visit.problems.length || gate.problems.length ||
                        conds.problems.length || phaseLabels.problems.length ||
                        oneDoor.problems.length || featKeys.problems.length ||
                        doors.problems.length) ? 1 : 0)
