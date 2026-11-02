/**
 * Find every top-level value that is built from a constant declared LATER.
 *
 * Apps Script runs the top level of each file in PROJECT ORDER — an order
 * that is not alphabetical, is not in the repository, and changes the moment
 * somebody drags a file in the editor. `var` is hoisted across the whole
 * project, so a reference to a constant whose file has not run yet does not
 * throw. It evaluates to `undefined`, quietly, once, at load — and whatever
 * was built from it is wrong for the life of that execution.
 *
 * Two live examples, both found on 2026-08-07:
 *
 *   FILES_ESTATE_IDS = [CERT_SOURCE_ID, …]  — Files is 16th, Certs is 28th,
 *   so the estate's own employee Master was in the list as `undefined` and
 *   classified `unknown` instead of `estate`. It was never moved, because
 *   unknown is only reported — but `estate` is the label that says "belongs
 *   to somebody else", and a safety label that evaluates to nothing is worse
 *   than no label, because the report reads as though the question was
 *   asked and answered.
 *
 *   HUB_OWN_SHEETS = [{id: HUB_PREFS_ID}, …]  — safe TODAY only because
 *   Prefs happens to sit at 11 and Files at 16. Nobody chose that, and
 *   nothing protects it.
 *
 * The fix is always the same and always trivial: read the constant inside a
 * function instead of at the top level. This finds them so the fix can be
 * applied before the reordering does.
 *
 * Run: node tools/check-load-order.mjs [--strict]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gsDir = resolve(root, 'apps-script')
const strict = process.argv.includes('--strict')

/**
 * The real order, as the live project reports it. `tools/project-order.json`
 * is written by push_apps_script.py; without it we fall back to alphabetical
 * and SAY SO, because a check that silently assumes the wrong order gives
 * confident wrong answers — which is the failure it exists to prevent.
 */
const orderFile = resolve(root, 'tools/project-order.json')
let order = null
let orderSource = 'alphabetical (guessed — run push_apps_script.py to record the real one)'
if (existsSync(orderFile)) {
  try {
    order = JSON.parse(readFileSync(orderFile, 'utf8')).order
    orderSource = 'the live project'
  } catch { /* fall through to alphabetical */ }
}
const onDisk = readdirSync(gsDir).filter((f) => f.endsWith('.gs')).map((f) => f.replace(/\.gs$/, ''))
if (!order) order = [...onDisk].sort()
// A file present on disk but absent from the recorded order is new: it will
// be APPENDED last by the push tool, which is the most dangerous position.
const files = [...order.filter((n) => onDisk.includes(n)), ...onDisk.filter((n) => !order.includes(n))]

function blankStrings(src) {
  const out = Array.from(src)
  const blank = (from, to) => { for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ' }
  let i = 0, prev = ''
  while (i < src.length) {
    const c = src[i], next = src[i + 1]
    if (c === '/' && next === '/') { let j = i; while (j < src.length && src[j] !== '\n') j++; blank(i, j); i = j; continue }
    if (c === '/' && next === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? src.length : j + 2; blank(i, e); i = e; continue }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c) break
        if (c !== '`' && src[j] === '\n') break
        j++
      }
      blank(i + 1, j); i = Math.min(j + 1, src.length); prev = c; continue
    }
    if (c === '/' && /[=(,:[!&|?{};+\-*%<>~^]/.test(prev)) {
      let j = i + 1, cls = false
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '[') cls = true
        else if (src[j] === ']') cls = false
        else if (src[j] === '/' && !cls) break
        else if (src[j] === '\n') { j = i; break }
        j++
      }
      if (j > i) { blank(i + 1, j); i = Math.min(j + 1, src.length); prev = '/'; continue }
    }
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out.join('')
}

/**
 * EVERY top-level declaration, whatever keyword makes it.
 *
 * A name is claimed by the project's single global scope the same way no
 * matter how it is written: `var X`, `function X()`, `const X`, `let X`. The
 * scan used to see only `var`, so the most common declaration in this
 * codebase — the top-level function — was invisible to the duplicate check
 * that exists precisely to catch a name claimed twice. It was not a
 * theoretical gap: `perfSheet_` was defined in Performance.gs AND in
 * StaffPerformance.gs, and the later file's one-argument version won for
 * everybody, including Performance.gs's own six calls.
 *
 * Column 0 is the whole test for "top level": everything nested is indented
 * in this codebase, and a scan that guessed at brace depth would report on
 * its own guesses.
 */
const TOP_LEVEL_DECL =
  /^(?:(var|const|let)\s+([A-Za-z_$][\w$]*)\s*=|(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\()/gm

/**
 * Where each top-level `var NAME` is declared, and at what position. VAR
 * ONLY, on purpose: this map feeds the load-order check below, whose whole
 * subject is the silent `undefined` that var's project-wide hoisting
 * produces. A function is a different animal there and would only add noise
 * to a report about constants.
 */
const declaredIn = new Map()
/** EVERY declaration of each name, not just the first, and not only the vars
 *  — see the duplicate check below, which is the whole reason this second
 *  map exists. */
const everyDeclaration = new Map()
const sources = new Map()
files.forEach((name, pos) => {
  const path = resolve(gsDir, name + '.gs')
  if (!existsSync(path)) return
  const src = readFileSync(path, 'utf8')
  sources.set(name, { src, blanked: blankStrings(src), pos })
  for (const m of blankStrings(src).matchAll(TOP_LEVEL_DECL)) {
    const kind = m[1] || 'function'
    const ident = m[2] || m[3]
    if (kind === 'var' && !declaredIn.has(ident)) declaredIn.set(ident, { file: name, pos })
    if (!everyDeclaration.has(ident)) everyDeclaration.set(ident, [])
    const line = src.slice(0, m.index).split('\n').length
    // The VALUE is read from the RAW source, not the blanked copy: what makes
    // a duplicate legible is seeing 'Smart Comms' beside 'comm_bindings', and
    // blankStrings would print two runs of spaces. Indexes line up because
    // blanking preserves length.
    let value
    if (kind === 'function') {
      // For a function the telling difference is the SIGNATURE — perfSheet_(tab)
      // beside perfSheet_(tab, header, seed) says in one glance which callers
      // were written against which.
      value = (src.slice(m.index).match(/^[^\n{]*/) || [''])[0].replace(/\s+$/, '')
    } else {
      value = (src.slice(m.index)
        .match(/^(?:var|const|let)\s+[A-Za-z_$][\w$]*\s*=\s*([^;\n]*)/) || [])[1] || ''
    }
    everyDeclaration.get(ident).push({ file: name, pos, line, kind, value: value.trim() })
  }
})

/**
 * THE SAME NAME DECLARED TWICE.
 *
 * Apps Script has ONE global scope for the whole project and runs every file's
 * top level in project order, so two files declaring `var X` are not two
 * constants — they are one, and the file that loads LAST decides its value for
 * everybody. Nothing warns: each file reads correctly on its own, every gate
 * stays green, and the failure lands in a THIRD file that quietly gets the
 * other lane's answer.
 *
 * It was paid for. `COMM_BINDINGS_TAB` meant 'Smart Comms' in HiringSimConfig
 * (index 110) and 'comm_bindings' in CommIntent (index 139), so the comms
 * lane's value won project-wide: commBindings_ went looking for a tab named
 * `comm_bindings` inside the Generic Configuration book, and
 * commBindingsSeedMaybe_ CREATED one there and seeded 40 rows into it. The
 * served map survived only because the single column that reader uses happened
 * to hold the same values in both tabs.
 *
 * It was paid for TWICE. `perfSheet_` was a function in Performance.gs
 * (index 18, three arguments: tab, header, seed) and a function in
 * StaffPerformance.gs (index 78, one argument), so the staff file's version
 * won project-wide and Performance.gs's own calls — which hand it a header —
 * reached a body that looks the tab up in a table it is not in and throws
 * `no header declared for tab "perf_metrics"`. A function claims the one
 * global scope exactly as a var does; only the scan was blind to it.
 *
 * So: no name is declared at top level in two files. Not as a var, not as a
 * function, not with a different value, and not with the same one — a
 * duplicate that agrees today is a duplicate that disagrees after the next
 * edit, and the disagreement is invisible until something is already writing
 * into the wrong book.
 */
const duplicates = []
for (const [name, list] of everyDeclaration) {
  if (list.length < 2) continue
  duplicates.push({ name, list, winner: list.reduce((a, b) => (b.pos > a.pos ? b : a)) })
}

const findings = []
for (const [name, { src, blanked, pos }] of sources) {
  // Top-level assignments only: a reference inside a function body is
  // evaluated when the function runs, by which time everything has loaded.
  // That is exactly why moving these into a function is the fix.
  for (const m of blanked.matchAll(/^var\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*);/gm)) {
    const [, target, expr] = m
    if (/\bfunction\b|=>/.test(expr)) continue          // a function value is fine
    for (const ref of new Set(expr.match(/[A-Za-z_$][\w$]*/g) || [])) {
      const d = declaredIn.get(ref)
      if (!d || d.file === name) continue
      if (d.pos > pos) {
        const line = src.slice(0, m.index).split('\n').length
        findings.push({
          file: name, line, target, ref,
          from: d.file, detail: `${name}(${pos}) builds ${target} from ${ref}, declared in ${d.file}(${d.pos})`,
        })
      }
    }
  }
}

console.log(`load order: ${files.length} files, order from ${orderSource}`)
if (!duplicates.length) {
  console.log('  no name is declared at top level in two files.')
} else {
  console.log(`\n${duplicates.length} name(s) declared at top level in MORE THAN ONE file — ` +
              'Apps Script has one global scope, so these are one variable:\n')
  for (const d of duplicates) {
    console.log(`  \u2717 ${d.name}`)
    for (const x of d.list) {
      const wins = x.file === d.winner.file ? '  <- loads last, WINS project-wide' : ''
      // A function shows its SIGNATURE where a constant shows its value: that
      // is the line that tells you which callers were written against which.
      const shown = x.kind === 'function' ? x.value : `= ${x.value}`
      console.log(`      ${x.file}.gs:${x.line} (${x.pos}) ${shown}${wins}`)
    }
    if (d.list.every((x) => x.kind === 'function')) {
      console.log('      rename all but one. Every caller of the loser is silently')
      console.log('      calling the winner — same name, other lane, other arguments.')
    } else {
      console.log('      rename all but one. A house name and a tab-in-a-book name are')
      console.log('      different things and must not share an identifier.')
    }
  }
}
if (!findings.length) {
  console.log('  no top-level value depends on a constant that loads later.')
} else {
  console.log(`\n${findings.length} top-level value(s) built from a constant that has NOT loaded yet:\n`)
  for (const f of findings) {
    console.log(`  ✗ ${f.file}.gs:${f.line}  ${f.target} <- ${f.ref}  (declared in ${f.from}.gs, later)`)
    console.log(`      it will be undefined at load. Read ${f.ref} inside a function instead.`)
  }
}
process.exit(strict && (findings.length || duplicates.length) ? 1 : 0)
