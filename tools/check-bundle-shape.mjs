#!/usr/bin/env node
/**
 * DOES THE BUNDLE SAY WHAT A SLICE SAYS?
 *
 * WHY THIS EXISTS. On 2026-08-19 the JSON lane served a bundle AS a slice and
 * `documents.json` went out with `addedat` where every screen reads
 * `added_at`: a page drawing blanks over data sitting right there in its own
 * file. The bundle had been read with `readTabNormalized_`, which lowercases
 * the header and strips its punctuation, while every verb in the platform
 * reads through `readAll_` and keeps the sheet's own column names. The same
 * wrong reader is why the personal half grouped nobody — `cfg.ownedBy` names
 * a RAW column, `ownerId`.
 *
 * WHAT THIS CHECKS THAT THE SELF-TEST CANNOT. SelfTest.gs asserts the SOURCE:
 * that these functions call readAll_ and never the normalised reader. That is
 * worth having and it breaks on a rename. This looks at the ARTIFACTS — a
 * bundle that was actually produced and a slice that is actually served — and
 * asks whether they agree. A gate that reads one side of a boundary cannot
 * see a disagreement across it, which is the whole lesson of the day this was
 * written.
 *
 * THE FAILURE IT NAMES, precisely: a bundle key that is the PARAPHRASE of a
 * slice key — same letters once you lowercase and drop the punctuation, not
 * the same string. That cannot false-positive on a legitimate difference (a
 * derived slice, a column added since the last build), because those differ
 * by more than their punctuation.
 *
 * ABSENT ARTIFACTS ARE NOT A FAILURE. The lane may be off, or this may be a
 * checkout with no deposit; there is nothing to disagree about and it says so.
 *
 * Run: node tools/check-bundle-shape.mjs [--strict]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const strict = process.argv.includes('--strict')
const BUNDLES = process.env.HUB_BUNDLE_DIR_LOCAL ||
  resolve(root, 'bundles')
const SLICES = process.env.HUB_SLICE_DIR_LOCAL ||
  '/opt/docker/asa-hub/web/snapshot'

/** The paraphrase of a header: what readTabNormalized_ would have made of it. */
const flat = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '')

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

if (!existsSync(BUNDLES) || !existsSync(SLICES)) {
  console.log('bundle shape: no deposit or no slices on this machine — nothing to compare.')
  process.exit(0)
}

const bundleFiles = readdirSync(BUNDLES).filter((n) => n.endsWith('.json'))
if (!bundleFiles.length) {
  console.log('bundle shape: the deposit is empty (the lane may be off) — nothing to compare.')
  process.exit(0)
}

/** resource -> the keys the SERVED slice carries. */
const sliceKeys = new Map()
for (const f of readdirSync(SLICES).filter((n) => n.endsWith('.json'))) {
  const s = readJson(resolve(SLICES, f))
  const rows = s && Array.isArray(s.rows) ? s.rows : null
  if (!rows || !rows.length) continue
  const keys = new Set()
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r || {})) keys.add(k)
  sliceKeys.set(f.replace(/\.json$/, ''), keys)
}

const paraphrased = [], unseen = []
let compared = 0, stamped = 0, unstamped = []

for (const f of bundleFiles) {
  const b = readJson(resolve(BUNDLES, f))
  if (!b || typeof b.resources !== 'object' || b.resources === null) continue
  // every file must say which reader made it — a deposit that cannot be dated
  // by shape is how three files built by the broken reader survived the fix
  if (b.reader === undefined) unstamped.push(f); else stamped++
  for (const [resource, rows] of Object.entries(b.resources)) {
    if (!Array.isArray(rows) || !rows.length) continue
    const theirs = sliceKeys.get(resource)
    if (!theirs) continue                     // no served slice to compare against
    compared++
    const mine = new Set()
    for (const r of rows.slice(0, 50)) for (const k of Object.keys(r || {})) mine.add(k)
    const byFlat = new Map()
    for (const k of theirs) byFlat.set(flat(k), k)
    for (const k of mine) {
      if (theirs.has(k)) continue
      const twin = byFlat.get(flat(k))
      if (twin) paraphrased.push({ file: f, resource, bundle: k, slice: twin })
      else unseen.push({ file: f, resource, key: k })
    }
  }
}

console.log(`bundle shape: ${bundleFiles.length} bundle(s), ${compared} resource(s) ` +
            `compared against a served slice`)

if (unstamped.length) {
  console.error(`\n${unstamped.length} bundle(s) carry no reader stamp:`)
  for (const f of unstamped) console.error(`  ✗ ${f}`)
  console.error('  a file whose shape cannot be dated is served as confidently as a fresh one.')
}
if (paraphrased.length) {
  console.error(`\n${paraphrased.length} key(s) the bundle PARAPHRASED:`)
  for (const p of paraphrased.slice(0, 20)) {
    console.error(`  ✗ ${p.resource}: bundle says "${p.bundle}", the slice says "${p.slice}"  (${p.file})`)
  }
  console.error('  the bundle is served AS a slice, so a renamed header is a blank screen.')
  console.error('  read with readAll_, never readTabNormalized_ (apps-script/Bundle.gs).')
}
if (!paraphrased.length && !unstamped.length) {
  console.log(`  every compared key matches the served slice, and all ${stamped} bundle(s) are stamped.`)
}
if (unseen.length) {
  const names = [...new Set(unseen.map((u) => `${u.resource}.${u.key}`))]
  console.log(`\n  · ${names.length} key(s) in a bundle with no twin in the slice — a column added`)
  console.log(`    since the last build, or a derived slice: ${names.slice(0, 8).join(', ')}`)
}

process.exit(strict && (paraphrased.length || unstamped.length) ? 1 : 0)
