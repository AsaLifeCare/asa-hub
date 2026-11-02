// Trims comments in .gs/.ts/.tsx/.js/.mjs: a file header to 2 lines, any other comment block to 1 line.
// A file is written only when its token stream is unchanged; directives and trailing comments are kept.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

// HubCore.gs keeps its comments: check-emits' textual graph reads them
const SKIP = new Set(['BeAnother.gs', 'Main.gs', 'Onboarding.gs', 'HubCore.gs'])
const SUFFIX = /\.(gs|ts|tsx|js|mjs)$/
const DIRECTIVE = /eslint-|@ts-|prettier-ignore|biome-ignore|istanbul |c8 |@vite-ignore|#__PURE__|webpack|@jsx|@license|@preserve|^\/\/\/\s*<reference|\bglobal\b\s+\w|jshint|tslint:/
const WIDTH = 118

function kindOf(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.ts')) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

function parse(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kindOf(file))
}

/** Every comment range in the file, each once, in order. */
function comments(sf) {
  const text = sf.getFullText()
  const seen = new Map()
  const add = (list) => { for (const c of list || []) if (!seen.has(c.pos)) seen.set(c.pos, c) }
  const visit = (node) => {
    add(ts.getLeadingCommentRanges(text, node.getFullStart()))
    add(ts.getTrailingCommentRanges(text, node.getEnd()))
    for (const child of node.getChildren(sf)) if (!isDoc(child)) visit(child)
  }
  visit(sf)
  return [...seen.values()].sort((a, b) => a.pos - b.pos)
}

/** The leaf tokens as kind:text, the guard's fingerprint of the code. */
function tokens(sf) {
  const out = []
  const visit = (node) => {
    const kids = node.getChildren(sf).filter((k) => !isDoc(k))
    if (!kids.length) { out.push(node.kind + ':' + node.getText(sf)); return }
    for (const k of kids) visit(k)
  }
  visit(sf)
  return out
}

const isDoc = (n) => n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode

function lineStart(text, pos) { const i = text.lastIndexOf('\n', pos - 1); return i + 1 }
function lineEnd(text, pos) { const i = text.indexOf('\n', pos); return i === -1 ? text.length : i }

function bodyOf(raw) {
  if (raw.startsWith('//')) return raw.replace(/^\/\/+\s?/, '')
  return raw.replace(/^\/\*+/, '').replace(/\*+\/$/, '').split('\n')
    .map((l) => l.replace(/^\s*\*+ ?/, '')).join('\n')
}

function sentences(text) {
  const flat = text.replace(/\s+/g, ' ').trim().replace(/\b(e\.g|i\.e|vs|etc|cf)\./gi, '$1\u2024')
  const out = []
  const re = /(?:[^.!?]|[.!?](?!\s|$))+(?:[.!?]+(?=\s|$)|$)/g
  let m
  while ((m = re.exec(flat)) && m[0].trim()) out.push(m[0].trim())
  return (out.length ? out : [flat]).map((s) => s.replace(/\u2024/g, '.'))
}

function fit(s, max) {
  if (s.length <= max) return s
  const cut = s.lastIndexOf(' ', max - 1)
  return s.slice(0, cut > max / 2 ? cut : max - 1).replace(/[\s,;:—–-]+$/, '') + '…'
}

/** One block (own-line comments that touch) → its new text, or null when it already fits. */
function rewrite(block, text, header) {
  const indent = text.slice(lineStart(text, block[0].pos), block[0].pos)
  const raws = block.map((c) => text.slice(c.pos, c.end))
  const directives = raws.filter((r) => DIRECTIVE.test(r))
  if (raws.some((r) => /@license|@preserve/.test(r))) return null
  const prose = raws.filter((r) => !DIRECTIVE.test(r)).map(bodyOf).join('\n')
  const lines = raws.join('\n').split('\n').length
  const limit = header ? 2 : 1
  if (lines - directives.length <= limit && directives.length === 0) return null
  const max = Math.max(40, WIDTH - indent.length - 4)
  const parts = sentences(prose).filter(Boolean)
  const kept = []
  if (parts.length && parts[0]) kept.push(fit(parts[0], max))
  if (header && parts[1]) kept.push(fit(parts[1], max))
  const out = kept.map((k) => '// ' + k).concat(directives)
  if (!out.length) return null
  return out.join('\n' + indent)
}

function trimFile(file) {
  const text = fs.readFileSync(file, 'utf8')
  const sf = parse(file, text)
  const list = comments(sf)
  const firstToken = sf.statements.length ? sf.statements[0].getStart(sf) : text.length
  // own-line comments only: nothing but whitespace before them on their line, nothing after them on their last line
  const own = list.filter((c) => !text.slice(lineStart(text, c.pos), c.pos).trim() &&
                                 !text.slice(c.end, lineEnd(text, c.end)).trim())
  const blocks = []
  for (const c of own) {
    const last = blocks[blocks.length - 1]
    const prev = last && last[last.length - 1]
    if (prev && !text.slice(prev.end, c.pos).replace(/^[ \t]*\n[ \t]*/, '').length) last.push(c)
    else blocks.push([c])
  }
  let out = text
  for (const block of blocks.reverse()) {
    const header = block[0].pos < firstToken && !text.slice(0, block[0].pos).replace(/^#!.*\n/, '').trim()
    const next = rewrite(block, text, header)
    if (next === null) continue
    out = out.slice(0, block[0].pos) + next + out.slice(block[block.length - 1].end)
  }
  if (out === text) return { file, changed: false }
  const a = tokens(sf), b = tokens(parse(file, out))
  if (a.length !== b.length || a.some((t, i) => t !== b[i])) return { file, changed: false, refused: true }
  return { file, changed: true, out, before: text.split('\n').length, after: out.split('\n').length }
}

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!['node_modules', 'dist', '.git'].includes(e.name)) walk(p, acc) }
    else if (SUFFIX.test(e.name) && !SKIP.has(e.name) && !/\.generated\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) acc.push(p)
  }
  return acc
}

const write = !process.argv.includes('--dry-run')
const roots = process.argv.slice(2).filter((a) => !a.startsWith('--'))
let changed = 0, refused = 0, before = 0, after = 0
for (const root of roots) {
  for (const file of walk(root, [])) {
    const r = trimFile(file)
    if (r.refused) { refused++; console.log('REFUSED (code would change): ' + file); continue }
    if (!r.changed) continue
    changed++; before += r.before; after += r.after
    if (write) fs.writeFileSync(file, r.out)
  }
}
console.log(`${write ? 'trimmed' : 'would trim'} ${changed} file(s), ${before - after} line(s) fewer; refused ${refused}`)
