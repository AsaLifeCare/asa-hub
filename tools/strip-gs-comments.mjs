// Prints a JSON map {name: source} of the given .gs files with every comment removed, lines kept.
// A file whose token stream would change is printed as it is (never altered blind).
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const isDoc = (n) => n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode
const KEEP = /^\/\/\s*@|^\/\*\s*@|eslint-|@ts-/

function parse(name, text) { return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) }

function comments(sf) {
  const text = sf.getFullText()
  const seen = new Map()
  const add = (list) => { for (const c of list || []) if (!seen.has(c.pos)) seen.set(c.pos, c) }
  const visit = (node) => {
    add(ts.getLeadingCommentRanges(text, node.getFullStart()))
    add(ts.getTrailingCommentRanges(text, node.getEnd()))
    for (const k of node.getChildren(sf)) if (!isDoc(k)) visit(k)
  }
  visit(sf)
  return [...seen.values()].sort((a, b) => b.pos - a.pos)
}

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

function strip(name, text) {
  const sf = parse(name, text)
  let out = text
  for (const c of comments(sf)) {
    const raw = text.slice(c.pos, c.end)
    if (KEEP.test(raw)) continue
    const lines = raw.split('\n').length - 1
    out = out.slice(0, c.pos) + '\n'.repeat(lines) + out.slice(c.end)
  }
  out = out.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n')
  const a = tokens(sf), b = tokens(parse(name, out))
  return a.length === b.length && a.every((t, i) => t === b[i]) ? out : text
}

const result = {}
for (const file of process.argv.slice(2)) result[path.basename(file, '.gs')] = strip(file, fs.readFileSync(file, 'utf8'))
process.stdout.write(JSON.stringify(result))
