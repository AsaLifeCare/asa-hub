#!/usr/bin/env node
// A width cap of 800px or more on a listing screen fails; under 800px is a form or empty state and may centre.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src/pages', 'src/engine']
const MIN = 800

/** file → why it may keep a centred column ≥ MIN */
const ALLOWED = {
  'src/pages/features/onboarding/OnboardingHome.tsx':
    'the new hire fills this in — a form is a column, not a table',
  'src/engine/templates/TimelineTemplate.tsx':
    'a timeline is read top to bottom; full width makes it a wall of text',
  'src/pages/WelcomePage.tsx':
    'the signed-out landing page — a centred column IS the design there',
}

/**
 * THE SCALE CLASSES COUNT TOO (2026-08-28).
 *
 * This gate read `max-w-[Npx]` and nothing else, so a screen capped with
 * Tailwind's own scale walked straight through it — which is how Potential
 * Clients — Unique sat at `mx-auto max-w-6xl` (1152px) drawing three cards in
 * the middle of an empty window until somebody pointed at it. A rule that
 * only sees one of the two ways to write the same thing is not a rule.
 */
const SCALE_PX = {
  '3xl': 768, '4xl': 896, '5xl': 1024, '6xl': 1152, '7xl': 1280,
  screen: 4096, full: 4096, prose: 640,
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const strict = process.argv.includes('--strict')
const offenders = []
let scanned = 0

for (const root of ROOTS) {
  for (const file of walk(root)) {
    scanned++
    const src = readFileSync(file, 'utf8')
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/className="([^"]*)"/g)) {
        const cls = m[1]
        if (!/\bmx-auto\b/.test(cls)) continue
        // both spellings of a cap: the explicit pixels and the scale name
        const px = cls.match(/\bmax-w-\[(\d+)px\]/)
        const scale = cls.match(/\bmax-w-(3xl|4xl|5xl|6xl|7xl|screen|full|prose)\b/)
        const width = px ? Number(px[1]) : scale ? SCALE_PX[scale[1]] : null
        if (width === null || width < MIN) continue
        if (ALLOWED[file]) continue
        offenders.push({ file, line: i + 1, cap: px ? `${px[1]}px` : `max-w-${scale[1]}` })
      }
    })
  }
}

console.log(`page width: ${scanned} screen(s) scanned, ${offenders.length} centred wide column(s)`)
if (!offenders.length) {
  console.log('  every data screen uses the window it is given.')
  for (const [f, why] of Object.entries(ALLOWED)) console.log(`  (allowed) ${f} — ${why}`)
  process.exit(0)
}
for (const o of offenders) {
  console.log(`  ✗ ${o.file}:${o.line} — mx-auto with ${o.cap}`)
}
console.log('  A screen that lists things should fill the window. If this one is')
console.log('  meant to be a column, add it to ALLOWED in this file with the reason.')
process.exit(strict ? 1 : 0)
