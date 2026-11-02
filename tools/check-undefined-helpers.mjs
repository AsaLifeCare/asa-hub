/**
 * Does every helper this project calls actually exist?
 *
 * On 2026-08-07 a rewrite of screenAiChat_ took the function above it out with
 * it — screenJsonish_, called on the success path of both new providers. The
 * suite's syntax check is `new Function(src)`, which parses without resolving
 * a single name, so 185 assertions passed while every Groq and relay answer
 * died on "screenJsonish_ is not defined". It surfaced in production, hours
 * later, in the evening.
 *
 * Apps Script gives no help here: one global scope, no modules, no imports to
 * go stale. A deleted function is simply a name nothing answers, and nothing
 * says so until the line runs.
 *
 * So this resolves names the way the runtime will. It collects every function
 * DEFINED across the project, then every `helper_(` CALLED, and reports the
 * calls with no definition anywhere.
 *
 * WHY ONLY TRAILING-UNDERSCORE NAMES: that is this codebase's convention for
 * a private helper, and it is the set where a typo or a deletion is invisible.
 * Bare names would drag in every built-in and every Google global, and a check
 * that cries wolf is a check somebody switches off.
 *
 * Run: node tools/check-undefined-helpers.mjs [--strict]
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

const files = readdirSync(gsDir).filter((f) => f.endsWith('.gs')).sort()
const defined = new Set()
const called = new Map()   // name -> Set of "file:line"

for (const name of files) {
  const src = blank(readFileSync(resolve(gsDir, name), 'utf8'))
  // `function helper_(…)` and `var helper_ = function`
  for (const m of src.matchAll(/(?:^|\s)function\s+([A-Za-z_$][\w$]*_)\s*\(/g)) defined.add(m[1])
  for (const m of src.matchAll(/(?:var|const|let)\s+([A-Za-z_$][\w$]*_)\s*=\s*function/g)) defined.add(m[1])
  // a helper handed around as a value, not called: `RPC_TEST_TRANSPORT = fn_`
  for (const m of src.matchAll(/(?:var|const|let)\s+([A-Za-z_$][\w$]*_)\s*=/g)) defined.add(m[1])

  const lines = src.split('\n')
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\b([a-z][\w$]*_)\s*\(/g)) {
      const fn = m[1]
      if (!called.has(fn)) called.set(fn, new Set())
      called.get(fn).add(`${name}:${i + 1}`)
    }
  })
}

/** Names that look like helpers but are declared as parameters or locals. */
const localish = new Set()
for (const name of files) {
  const src = blank(readFileSync(resolve(gsDir, name), 'utf8'))
  for (const m of src.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) {
    for (const p of m[1].split(',')) {
      const t = p.trim()
      if (/^[a-z][\w$]*_$/.test(t)) localish.add(t)
    }
  }
}

const missing = []
for (const [fn, where] of called) {
  if (defined.has(fn) || localish.has(fn)) continue
  missing.push({ fn, where: [...where] })
}
missing.sort((a, b) => a.fn.localeCompare(b.fn))

console.log(`helpers: ${defined.size} defined, ${called.size} called across ${files.length} files`)
if (!missing.length) {
  console.log('  every helper that is called is defined somewhere in the project.')
} else {
  console.error(`\n${missing.length} helper(s) are CALLED and defined NOWHERE:`)
  for (const m of missing) {
    console.error(`  ✗ ${m.fn}  — called at ${m.where.slice(0, 4).join(', ')}${m.where.length > 4 ? ' …' : ''}`)
  }
  console.error('  each one throws "… is not defined" the moment that line runs.')
}

if (strict && missing.length) process.exit(1)
