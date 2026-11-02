#!/usr/bin/env node
/**
 * Every page ends with the copyright line.
 *
 * THE RULE: "© 2026 Asa LifeCare. All rights reserved." is the last line of
 * every surface a person opens as a page — the signed-in shell, each public
 * route of the SPA, a full-window view that covers the shell, the print
 * window, and each static page served beside the SPA.
 *
 * WHY A CHECK: the line lives in many roots, and a new public route or a new
 * static page is added without anyone thinking of the footer. The roots are
 * discovered, not listed: the public routes are read from App.tsx, the static
 * pages from public/ and apps-script/, the full-window views by their
 * classes, the HTML the relay could answer by its response types.
 *
 * EXEMPT, with the reason, so the next person changes them on purpose.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const TEXT = '© 2026 Asa LifeCare. All rights reserved.'
const FOOTER_FILE = 'src/components/shared/SiteFooter.tsx'

/** file → why it carries no footer of its own */
const EXEMPT = {
  'index.html': 'the SPA mount point — only #root; the SPA draws the footer',
  'apps-script/index.html':
    'a frozen, minified single-file build of the old SPA whose body never scrolls, ' +
    'so a line after #root is never seen; the SPA people use is the asamylife one. ' +
    'Carrying the line means re-releasing that whole build, which no tool here makes — an open gap, not a page that is done',
}

const strict = process.argv.includes('--strict')
const problems = []
const seen = []
const read = (f) => readFileSync(f, 'utf8')

function walk(dir, ext) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, ext))
    else if (p.endsWith(ext)) out.push(p)
  }
  return out
}

/** The default export's body, from its declaration to the first closing brace at column 0. */
function defaultExport(src) {
  const at = src.indexOf('export default function')
  if (at < 0) return ''
  const end = src.indexOf('\n}\n', at)
  return src.slice(at, end < 0 ? undefined : end)
}

/** The last element a component opens — the footer must be it. */
function lastOpenedTag(body) {
  const tags = [...body.matchAll(/<([A-Za-z][\w.]*)/g)]
  return tags.length ? tags[tags.length - 1][1] : null
}

/* ---------- 1. the one text ---------------------------------------------- */
{
  const src = read(FOOTER_FILE)
  const m = src.match(/export const COPYRIGHT = '([^']*)'/)
  if (!m) problems.push(`${FOOTER_FILE}: no \`export const COPYRIGHT = '…'\``)
  else if (m[1] !== TEXT) problems.push(`${FOOTER_FILE}: COPYRIGHT reads "${m[1]}", the rule is "${TEXT}"`)
  // a <footer> unless the page already has one (as="p" inside it)
  if (!/as: Tag = 'footer'/.test(src) || !/<Tag\b[^>]*>\s*\{COPYRIGHT\}\s*<\/Tag>/.test(src)) problems.push(`${FOOTER_FILE}: the component does not draw COPYRIGHT in a <footer> by default`)
  if (/\bfixed\b|\babsolute\b|\bsticky\b/.test(src)) problems.push(`${FOOTER_FILE}: the footer must stay in the flow (no fixed/absolute/sticky)`)
  seen.push(FOOTER_FILE)
}

/* ---------- 2. the signed-in shell --------------------------------------- */
{
  const file = 'src/components/Layout.tsx'
  const src = read(file)
  const main = src.slice(src.indexOf('<main id={MAIN_SCROLL_ID}'), src.indexOf('</main>'))
  const outlet = main.indexOf('<Outlet />')
  const footer = main.indexOf('<SiteFooter')
  const close = main.lastIndexOf('</motion.div>')
  if (outlet < 0 || close < 0) problems.push(`${file}: #main-scroll no longer holds <Outlet /> inside the motion.div`)
  else if (footer < 0) problems.push(`${file}: the shell renders no <SiteFooter> in #main-scroll`)
  else if (!(outlet < footer && footer < close)) problems.push(`${file}: <SiteFooter> must come after <Outlet /> and inside the motion.div`)
  else {
    const after = main.slice(main.indexOf('/>', footer) + 2, close)
    if (/<[A-Za-z]/.test(after)) problems.push(`${file}: something is drawn after <SiteFooter> in #main-scroll`)
  }
  seen.push(file)
}

/* ---------- 3. the public routes of the SPA ------------------------------ */
{
  const app = read('src/App.tsx')
  const guard = app.indexOf('<Route element={<RequireAuth />}>')
  if (guard < 0) problems.push('src/App.tsx: cannot find the RequireAuth route — update this check')
  const publicPart = app.slice(app.indexOf('<Routes>'), guard)
  // a page is imported eagerly or declared as a lazy chunk (lib/lazyPage) — both name its file
  const imports = new Map(
    [...app.matchAll(/^(?:import (\w+)(?:,[^\n]*)? from |const (\w+) = lazyPage\(\(\) => import\()'@\/([^']+)'/gm)]
      .map((m) => [m[1] ?? m[2], `src/${m[3]}.tsx`]),
  )
  const routes = [...publicPart.matchAll(/<Route path="([^"]+)" element=\{<(\w+)/g)]
  if (!routes.length) problems.push('src/App.tsx: no public routes found — update this check')
  for (const [, path, comp] of routes) {
    const file = imports.get(comp)
    if (!file) { problems.push(`src/App.tsx: public route ${path} renders ${comp}, which is not a page import`); continue }
    const body = defaultExport(read(file))
    if (!body.includes('<SiteFooter')) problems.push(`${file} (${path}): renders no <SiteFooter>`)
    else if (lastOpenedTag(body) !== 'SiteFooter') problems.push(`${file} (${path}): <SiteFooter> is not the last thing the page draws`)
    seen.push(`${file} (${path})`)
  }
}

/* ---------- 4. full-window views: over the shell, or drawn without it ---- */
/** Every class list in a file: className="…", className={`…`}, and the
 *  string arguments of className={cn(…)}. */
function classLists(src) {
  const out = []
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{cn\(([\s\S]*?)\)\})/g)) {
    const cls = m[1] ?? m[2] ?? [...m[3].matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map((s) => s[1] ?? s[2] ?? s[3]).join(' ')
    out.push({ cls, at: m.index })
  }
  return out
}
// a bare utility, never one behind a variant (max-sm:inset-0 is a dialog on a phone)
const bare = (re) => new RegExp(`(?<![\\w:\\[/-])(?:${re})(?![\\w/-])`)
const FIXED = bare('fixed')
// the whole window: inset-0, or across it with a top and a bottom anchor (a bar pinned to one edge is not a page)
const INSET = bare('inset-0')
const ACROSS = bare('inset-x-0')
const TOP = bare('top-(?:0|\\[[^\\]]+\\])|inset-y-0')
const BOTTOM = bare('bottom-0|inset-y-0')
const COVERS = { test: (cls) => INSET.test(cls) || (ACROSS.test(cls) && TOP.test(cls) && BOTTOM.test(cls)) }
const SCROLLS = bare('overflow-y-auto')
const OPAQUE = bare('bg-(?:bg|surface)(?:-\\d)?(?:/9\\d)?')
const VIEWPORT_HIGH = bare('(?:min-)?h-(?:dvh|screen|\\[100dvh\\])')
for (const file of walk('src', '.tsx')) {
  if (file === 'src/components/Layout.tsx') continue // the shell, section 2
  const src = read(file)
  for (const { cls, at } of classLists(src)) {
    // a curtain over the shell (it scrolls or hides what is under it), or a
    // page drawn outside the shell at the height of the window
    const overShell = FIXED.test(cls) && COVERS.test(cls) && (SCROLLS.test(cls) || OPAQUE.test(cls))
    // a dimmed backdrop is a dialog, not a page
    if (!(overShell || VIEWPORT_HIGH.test(cls)) || /\bbg-black\//.test(cls)) continue
    if (!src.slice(at).includes('<SiteFooter')) problems.push(`${file}: a full-window view (${cls.slice(0, 48)}…) ends with no <SiteFooter>`)
    seen.push(file)
  }
}

/* ---------- 5. HTML written by the SPA ----------------------------------- */
for (const file of walk('src', '.tsx').concat(walk('src', '.ts'))) {
  const src = read(file)
  if (!/\.document\.write\(/.test(src)) continue
  if (!src.includes('${esc(COPYRIGHT)}')) problems.push(`${file}: writes a page with document.write and no COPYRIGHT line`)
  seen.push(file)
}

/* ---------- 6. static pages served beside the SPA and by Apps Script ----- */
const staticPages = ['index.html', ...walk('public', '.html'), ...walk('apps-script', '.html')]
for (const file of staticPages) {
  if (EXEMPT[file]) continue
  const src = read(file)
  if (!/<meta charset="utf-8">/i.test(src)) problems.push(`${file}: no utf-8 charset — the © would not survive`)
  const at = src.indexOf(`<footer class="copy">${TEXT}</footer>`)
  if (at < 0) { problems.push(`${file}: no <footer class="copy">${TEXT}</footer>`); continue }
  // the last line of the page's column: only the column's close may follow
  const next = src.slice(at).replace(/^<footer class="copy">[^<]*<\/footer>\s*/, '')
  if (!next.startsWith('</div>')) problems.push(`${file}: the copyright footer is not the last element of the page column`)
  seen.push(file)
}

/* ---------- 7. HTML the relay could answer -------------------------------- */
for (const file of walk('server', '.py')) {
  const src = read(file)
  if (!/HTMLResponse|text\/html/.test(src)) continue
  if (!src.includes(TEXT)) problems.push(`${file}: answers HTML with no copyright line`)
  seen.push(file)
}

console.log(`footer: ${seen.length} page surface(s) checked, ${problems.length} problem(s)`)
if (!problems.length) {
  for (const s of seen) console.log(`  ✓ ${s}`)
  for (const [f, why] of Object.entries(EXEMPT)) console.log(`  (exempt) ${f} — ${why}`)
  process.exit(0)
}
for (const p of problems) console.log(`  ✗ ${p}`)
console.log(`  Every page ends with "${TEXT}" — the shared <SiteFooter />, or the`)
console.log('  same <footer class="copy"> line on a static page. If a surface is not a')
console.log('  page, add it to EXEMPT in this file with the reason.')
process.exit(strict ? 1 : 0)
