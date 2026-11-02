/**
 * Does every action that can reach a person DECLARE that it does?
 *
 * `emits` was declared on all 118 actions and empty on all 118 — a field
 * everybody wrote and nobody filled, which is worse than not having it: it
 * reads as though the question was asked and answered. Meanwhile four
 * senders grew outside the outbound contract entirely (Hired.gs twice,
 * Screening.gs, Scraper.gs) and nothing anywhere noticed, because nothing
 * anywhere was looking.
 *
 * This looks. It builds the call graph of the whole Apps Script project,
 * finds every function that can reach something which actually sends, and
 * compares that against what each action declares.
 *
 * WHAT COUNTS AS SENDING, and why each one is on the list:
 *   rpcCall_ / rpcSend_     the governed path — declared, gated, receipted
 *   hubTeamNotify_          the legacy team alert; ungoverned, still live
 *   MailApp.sendEmail       a mail with no contract at all
 *   api.openphone.com/v1/messages   a raw provider POST
 *
 * TWO FAILURES, and they are different:
 *   UNDECLARED — the handler reaches a sender and `emits` is empty. This is
 *     the one that matters: it is exactly how the four ungated senders came
 *     to exist. Fatal under --strict.
 *   OVERDECLARED — `emits` names a method the handler cannot reach. Also
 *     fatal, because a declaration that claims more than the code does is a
 *     map of a building that was never built.
 *
 * The graph is textual, so it is generous on purpose: a name appearing
 * anywhere inside a function body counts as a call. That over-approximates
 * (a mention in a comment would count — comments are stripped first) rather
 * than under-approximates, because a missed edge here means a sender nobody
 * declared, which is the failure this exists to prevent.
 *
 * Run: node tools/check-emits.mjs [--strict]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
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
  // The object-literal members in HubCore.gs.
  const lit = src.match(/var HUB_ACTIONS\s*=\s*\{/)
  if (lit) {
    for (const m of src.slice(lit.index).matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:\s*function\s*\(/gm)) {
      push('ACTION:' + m[1], lit.index + m.index)
    }
  }
  return out
}

const SENDERS = {
  rpcCall_: 'rpcCall_',
  rpcSend_: 'rpcSend_',
  hubTeamNotify_: 'hubTeamNotify_',
  'MailApp.sendEmail': 'MailApp.sendEmail',
  'v1/messages': 'a raw provider POST',
}

const graph = new Map()   // name -> {text, file}
for (const f of readdirSync(gsDir).filter((n) => n.endsWith('.gs'))) {
  for (const [name, v] of bodies(blank(readFileSync(resolve(gsDir, f), 'utf8')), f)) {
    if (!graph.has(name)) graph.set(name, v)
  }
}
// `v1/messages` lives inside a string, which blank() erased — look for it in
// the RAW source instead, per file, and attribute it to every function there.
const rawProvider = new Set()
for (const f of readdirSync(gsDir).filter((n) => n.endsWith('.gs'))) {
  const raw = readFileSync(resolve(gsDir, f), 'utf8')
  if (!raw.includes('api.openphone.com/v1/messages')) continue
  for (const [name, v] of bodies(blank(raw), f)) {
    // Only the function whose own body holds the URL, found by offset.
    const at = raw.indexOf('api.openphone.com/v1/messages')
    if (raw.indexOf(v.text.slice(0, 40)) <= at && at <= raw.indexOf(v.text.slice(0, 40)) + v.text.length) {
      rawProvider.add(name)
    }
  }
}

/** Which senders can `name` reach? Depth-limited, cycle-safe. */
function reaches(name, seen = new Set()) {
  if (seen.has(name)) return new Set()
  seen.add(name)
  const node = graph.get(name)
  const hit = new Set()
  if (rawProvider.has(name)) hit.add('a raw provider POST')
  if (!node) return hit
  for (const [needle, label] of Object.entries(SENDERS)) {
    if (needle === 'v1/messages') continue
    if (new RegExp(`\\b${needle.replace('.', '\\.')}\\s*\\(`).test(node.text)) hit.add(label)
  }
  for (const m of node.text.matchAll(/\b([A-Za-z_$][\w$]*_)\s*\(/g)) {
    if (m[1] === name) continue
    for (const r of reaches(m[1], seen)) hit.add(r)
  }
  return hit
}

/** What each action declares. */
const declared = new Map()
for (const f of readdirSync(gsDir).filter((n) => n.endsWith('.gs'))) {
  const src = readFileSync(resolve(gsDir, f), 'utf8')
  for (const m of src.matchAll(/HUB_POLICY\.([A-Za-z_$][\w$]*)\s*=\s*\{([\s\S]*?)\n\};/g)) {
    const em = m[2].match(/emits:\s*\[([^\]]*)\]/)
    declared.set(m[1], em && em[1].trim()
      ? em[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
      : [])
  }
}

const undeclaredSenders = []
const overdeclared = []
let sending = 0
for (const [key] of graph) {
  if (!key.startsWith('ACTION:')) continue
  const action = key.slice(7)
  const hits = reaches(key)
  const says = declared.get(action)
  if (says === undefined) continue          // emit-resolver-manifest.mjs owns that failure
  if (hits.size) {
    sending++
    if (!says.length) undeclaredSenders.push({ action, via: [...hits] })
  } else if (says.length) {
    overdeclared.push({ action, says })
  }
}

console.log(`emits: ${sending} action(s) can reach a person, ` +
            `${[...declared.values()].filter((v) => v.length).length} declare it`)

if (undeclaredSenders.length) {
  console.error(`\n${undeclaredSenders.length} action(s) reach a sender and declare emits: []`)
  for (const u of undeclaredSenders) console.error(`  ✗ ${u.action}  — via ${u.via.join(', ')}`)
  console.error('  declare what it sends, or the next ungated sender is invisible too.')
}
if (overdeclared.length) {
  console.error(`\n${overdeclared.length} action(s) declare emits they cannot reach`)
  for (const o of overdeclared) console.error(`  ✗ ${o.action}  — declares ${o.says.join(', ')}`)
}
if (!undeclaredSenders.length && !overdeclared.length) {
  console.log('  every action that can reach a person says so, and no action claims more than it does.')
}

if (strict && (undeclaredSenders.length || overdeclared.length)) process.exit(1)
