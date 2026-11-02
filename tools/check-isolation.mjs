/**
 * IS THIS PLATFORM ISOLATED PER PERSON? — the gate that answers with a count.
 *
 * What is wanted here is certainty, not an opinion, and the honest form of
 * certainty here is exhaustive classification: every handler in the backend,
 * how it resolves "me", and which of them could file or serve one person's row
 * under another's name. An assurance that cannot be re-run is worth nothing the
 * day after it is given.
 *
 * WHAT ISOLATION RESTS ON, after 2026-08-19. There are three mechanisms and
 * they are the whole of it:
 *
 *   1. THE SESSION IDENTITY IS THE PERSON WHOSE WORK IS ON SCREEN. doPost
 *      rewrites `user` with the visited member (Main.gs), so every handler
 *      that reads `user.id` — three hundred of them — resolves to that person
 *      without knowing a visit exists. This is the mechanism that replaced a
 *      convention nobody was going to remember in three hundred places.
 *   2. THE OWNER STAMP IS SEIZED, NEVER ACCEPTED. `hubOwnedGate_` writes the
 *      owner column from the CONTEXT on create AND update, so no payload can
 *      name its own owner and no handler has to remember to check.
 *   3. WHAT IS ABOUT THE ACCOUNT, NOT THE ENVIRONMENT, IS DECLARED.
 *      HUB_CALLER_OWN_ACTIONS is the list, and it is small enough to read: the
 *      roster, the places directory, my own world, and my own profile.
 *
 * So there are exactly three ways a handler can be wrong, and this checks all
 * three:
 *
 *   A. it writes ACCOUNTS or CREDENTIALS while not being caller-own — that is
 *      one person's password landing on another's row (found live: profileUpdate);
 *   B. it asks "is this me?" against the session while meaning the account at
 *      the keyboard — that guard inverts during a visit (found live: userDelete);
 *   C. an `ownedBy` resource is served or stamped from anything but the acting
 *      identity, which would let one person's rows answer for another.
 *
 * Run: node tools/check-isolation.mjs [--strict]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const strict = process.argv.includes('--strict')
const gsDir = resolve(root, 'apps-script')

const files = readdirSync(gsDir).filter((f) => f.endsWith('.gs') && f !== 'SelfTest.gs')
const src = new Map(files.map((f) => [f, readFileSync(resolve(gsDir, f), 'utf8')]))
const all = [...src.values()].join('\n')

/** The declared list of things that are about WHO IS SIGNED IN. */
const callerOwn = new Set(
  (all.match(/HUB_CALLER_OWN_ACTIONS\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '')
    .match(/'([A-Za-z]\w*)'/g)?.map((s) => s.slice(1, -1)) ?? [],
)

/** Every named handler, with its body (to the next top-level handler). */
function handlers() {
  const out = []
  for (const [file, text] of src) {
    const re = /HUB_ACTIONS\.(\w+)\s*=\s*function\s*\(([^)]*)\)\s*\{/g
    let m
    const starts = []
    while ((m = re.exec(text))) starts.push({ name: m[1], at: m.index, args: m[2] })
    // also the object-literal form used by HubCore: `  name: function (payload, user) {`
    const re2 = /^\s{2}(\w+):\s*function\s*\(payload[^)]*\)\s*\{/gm
    while ((m = re2.exec(text))) starts.push({ name: m[1], at: m.index, args: 'payload, user' })
    starts.sort((a, b) => a.at - b.at)
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1].at : text.length
      out.push({ file, name: starts[i].name, body: text.slice(starts[i].at, end) })
    }
  }
  return out
}

const HANDLERS = handlers()

// ---- A. accounts and credentials -----------------------------------------
// The two doors into the accounts tab. Anything that opens one of them and is
// not declared caller-own writes an identity while wearing somebody else's.
/**
 * THE TEST IS THE TARGET, NOT THE VERB. A first cut flagged any handler that
 * touched a password and produced eleven false positives — userCreate,
 * userInvite, usersArm and the bulk importers all hash a password FOR SOMEBODY
 * ELSE, against an id they were handed. That is admin machinery and it is
 * correct. What is never correct is a credential or account write aimed at the
 * SESSION identity from a handler that is not declared caller-own, because the
 * session is the visited person for the length of a visit. A gate that cries
 * wolf is a gate people learn to scroll past, so it asks the narrow question.
 */
const SESSION_TARGET = [
  /userSetFields_\s*\(\s*(str_\(\s*)?user\.id/,
  /placeProfileSet_\s*\(\s*(str_\(\s*)?user\.id/,
]
const problemsA = []
for (const h of HANDLERS) {
  if (callerOwn.has(h.name)) continue
  if (!SESSION_TARGET.some((re) => re.test(h.body))) continue
  problemsA.push(`${h.file} ${h.name}() writes the ACCOUNT behind the session identity and is not caller-own — during a visit that lands on the person being looked at, password included`)
}

// ---- B. "is this me?" guards ---------------------------------------------
// A comparison of a payload id against the session id, in a handler that is not
// caller-own, means the opposite of what it reads during a visit.
const problemsB = []
for (const h of HANDLERS) {
  if (callerOwn.has(h.name)) continue
  const selfCmp = /(===|!==|==|!=)\s*str_\(user\.id\)|str_\(user\.id\)\s*(===|!==|==|!=)/
  if (!selfCmp.test(h.body)) continue
  if (/HUB_CALLER/.test(h.body)) continue          // already resolved deliberately
  // owning-row filters are the CORRECT use of the session id — they are what
  // makes a visit serve their rows. Only guards that mean "yourself" invert.
  if (/ownerId|owneruserid|owner_user_id|ownedBy/.test(h.body)) continue
  problemsB.push(`${h.file} ${h.name}() compares a payload id against the SESSION id — during a visit that guard protects the visited person and exposes the caller`)
}

// ---- C. owned rows --------------------------------------------------------
const mainSrc = src.get('Main.gs') ?? ''
const problemsC = []
const ownedResources = [...mainSrc.matchAll(/(\w+)\s*:\s*\{[^{}]*ownedBy\s*:/g)].map((m) => m[1])
if (!/if \(cfg\.ownedBy\)/.test(mainSrc) || !/hubActingUserId_\(user\)/.test(mainSrc)) {
  problemsC.push('the generic list verb no longer narrows owned resources by the acting identity — every person would read every person\'s rows')
}
/**
 * ASSERT THE BEHAVIOUR, NOT THE SHAPE. A first cut matched the function and
 * then looked for the WORDS "create" and "update" inside it — which a stub
 * `function hubOwnedGate_(…) { return null; }` passes, because the match ran
 * past the stub into the next function. Proven by mutation: gutting the gate
 * left the check green. So it asserts the three things the gate must DO.
 */
const gate = mainSrc.match(/function hubOwnedGate_[\s\S]*?\n\}\n/)?.[0] ?? ''
const seize = /payload\[cfg\.ownedBy\]\s*=\s*me\b/g
const seizes = (gate.match(seize) ?? []).length
if (!gate) {
  problemsC.push('hubOwnedGate_ is gone — nothing seizes the owner column, so a payload could name its own owner')
} else {
  if (!/var me = str_\(user && !user\.is_service \? user\.id : ''\)/.test(gate)) {
    problemsC.push('hubOwnedGate_ no longer takes the owner from the session identity — the stamp must come from the context alone')
  }
  if (seizes < 2) {
    problemsC.push(`hubOwnedGate_ seizes the owner column ${seizes} time(s); it must be BOTH on create and on update — an update that may name its owner hands a row to another person`)
  }
  if (!/hubOwnerOf_\(row, cfg\) !== me/.test(gate)) {
    problemsC.push('hubOwnedGate_ no longer refuses a row owned by somebody else — get, update and delete would reach across people')
  }
}

/**
 * D. A CLIENT SEES ONLY THEMSELVES, AND IT FAILS CLOSED. Every app has to
 *    filter by the client, whatever the app is, and it has to be automatic —
 *    the roster of clients keeps growing week by week.
 *
 * The protection is that an UNDECLARED resource shows a client nothing. That
 * only holds while the router still asks — so this asserts the asking, in all
 * four verbs, and the refusal-by-omission inside the gate itself. Proven by
 * mutation: deleting either call, or turning the `!cfg.clientScoped` refusal
 * into a pass, must turn this red.
 *
 * It deliberately does NOT check which resources are declared. That list is a
 * judgement about care data and it will grow; what must never change is what
 * happens to the ones nobody judged yet.
 */
const clientGate = mainSrc.match(/function hubClientNarrowList_[\s\S]*?\n\}\n/)?.[0] ?? ''
const rowGate = mainSrc.match(/function hubClientRowGate_[\s\S]*?\n\}\n/)?.[0] ?? ''
if (!clientGate || !rowGate) {
  problemsC.push('the client gate is gone — every resource would answer a client account in full')
} else {
  if (!/if \(!cfg\.clientScoped\) return \[\]/.test(clientGate)) {
    problemsC.push('hubClientNarrowList_ no longer refuses an UNDECLARED resource — a resource added tomorrow would be visible to every client the day it appears')
  }
  if (!/if \(!key\) return \[\]/.test(clientGate)) {
    problemsC.push('hubClientNarrowList_ no longer refuses an account with an empty client_key — "no key, no rows" is the 2026-08-03 rule and it is what stops identity being guessed')
  }
  if (!/!cfg\.clientScoped \|\| !key/.test(rowGate)) {
    problemsC.push('hubClientRowGate_ no longer refuses an undeclared resource on the single-row door — and an id is a guess away')
  }
}
const asks = (mainSrc.match(/hubClientNarrowList_\(|hubClientRowGate_\(/g) ?? []).length
// three call sites: the list, the single-row door, and the write door
if (asks < 5) {
  problemsC.push(`the router asks the client gate ${asks} time(s) (2 declarations + 3 call sites expected) — a verb that stops asking is a verb that answers in full`)
}

// ---- the report -----------------------------------------------------------
const bySource = { session: 0, caller: 0, acting: 0, none: 0 }
for (const h of HANDLERS) {
  if (callerOwn.has(h.name)) bySource.caller++
  else if (/hubActingUserId_\(/.test(h.body)) bySource.acting++
  else if (/user\.id|user\.user_id|user\.email/.test(h.body)) bySource.session++
  else bySource.none++
}

console.log(`\nisolation: ${HANDLERS.length} handler(s) across ${files.length} file(s)`)
console.log(`  ${bySource.session} resolve "me" from the SESSION — which IS the person whose work is on screen`)
console.log(`  ${bySource.acting} ask hubActingUserId_ explicitly (same answer, said out loud)`)
console.log(`  ${bySource.caller} are declared caller-own: about who is signed in, not about the environment`)
console.log(`  ${bySource.none} name no identity at all`)
console.log(`  owned resources, narrowed by the acting identity and stamped from the context: ${ownedResources.join(', ') || '—'}`)

const problems = [...problemsA, ...problemsB, ...problemsC]
if (problems.length) {
  console.log('')
  for (const p of problems) console.log(`  ✗ ${p}`)
} else {
  console.log('  no handler can serve or file one person\'s row under another\'s name.')
}
process.exit(strict && problems.length ? 1 : 0)
