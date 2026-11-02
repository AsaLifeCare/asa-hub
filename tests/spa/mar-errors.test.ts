/**
 * MAR errors and missing-medication reports are clinical rows about every
 * client, so they are never a flat file: both resources are held live by
 * design, no screen asks for either as a slice, and the Med Correlation study
 * is handed their rows in the relay's memory.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { NEVER_SNAPSHOT } from '@/lib/snapshot'

const root = process.env.SPA_ROOT ?? process.cwd()
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

type Entry = { resource: string; mode: string; held?: string; sheet?: string }
const snapshot = JSON.parse(read('public/snapshot-manifest.json')) as { resources: Entry[] }
const resolver = JSON.parse(read('public/resolver-manifest.json')) as { resources: Record<string, { mode: string }> }
const medcorr = read('server/medcorr_slices.py')
const svc = read('server/snapshot_service.py')

const HELD = ['marErrors', 'missingMedications'] as const

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })

for (const name of HELD) {
  describe(`${name} is held live by design`, () => {
    it('NEVER_SNAPSHOT names it', () => {
      assert.ok(NEVER_SNAPSHOT.includes(name))
    })

    it('the snapshot manifest holds it live, so the relay builds no file and its gate refuses the name', () => {
      const entries = snapshot.resources.filter((r) => r.resource === name)
      assert.equal(entries.length, 1)
      assert.equal(entries[0].mode, 'live')
      assert.equal(entries[0].held, 'by-design')
    })

    it('the resolver manifest agrees', () => {
      assert.equal(resolver.resources[name]?.mode, 'live')
    })

    it('no screen reads it: no dataSource names it and no readSlice asks for it', () => {
      for (const file of sources(resolve(root, 'src'))) {
        const text = readFileSync(file, 'utf8')
        assert.doesNotMatch(text, new RegExp(`resource:\\s*['"]${name}['"]`), file)
        assert.doesNotMatch(text, new RegExp(`readSlice\\s*(?:<[^>]*>)?\\(\\s*['"]${name}['"]`), file)
      }
    })
  })
}

describe('the Med Correlation study still gets its rows', () => {
  it('medcorr_slices takes both books from the hand-in and never from a file', () => {
    assert.match(medcorr, /HELD_SOURCES = \{"marErrors": "mar_errors", "missingMedications": "missing_medications"\}/)
    assert.match(medcorr, /SOURCES = tuple\(HELD_SOURCES\)/)
    assert.doesNotMatch(medcorr, /read_text|_SNAPSHOT_DIR|HUB_SNAPSHOT_OUT/)
    const take = medcorr.slice(medcorr.indexOf('def _take('), medcorr.indexOf('def _medcorr_norm('))
    assert.match(take, /_HANDED\.pop\(name, None\) for name in HELD_SOURCES/)
    assert.match(take, /raise RuntimeError/)
  })

  it('the study file carries no free-text examples and no staff board, and the page expects neither', () => {
    assert.doesNotMatch(medcorr, /"examples"|top_error_staff|err_staff/)
    const page = read('src/pages/features/meds/MedCorrelationPage.tsx')
    assert.doesNotMatch(page, /examples: string\[\]|top_error_staff/)
  })

  it('the builder hands the rows in right before it builds the study, in one tab read', () => {
    assert.match(svc, /await _medcorr_hand_in\(\)\n\s+results = list\(results\) \+ _derived_late_slices\(medcorr_slices\)/)
    const hand = svc.slice(svc.indexOf('async def _medcorr_hand_in'), svc.indexOf('async def build_all'))
    assert.match(hand, /_bundle_rows\(resource\)/)
    assert.equal(hand.match(/_tabs_from_backend\(/g)?.length, 1)
    assert.doesNotMatch(hand, /_write_atomic|OUT_DIR/)
  })

  it('a notify naming either book is accepted and rebuilds the study', () => {
    const mark = svc.slice(svc.indexOf('def _mark_dirty('), svc.indexOf('# traffic — the one number'))
    assert.match(mark, /\| set\(medcorr_slices\.SOURCES\)/)
    const wants = svc.slice(svc.indexOf('wants_medcorr = ('), svc.indexOf('wants_coverage = ('))
    assert.match(wants, /only & set\(medcorr_slices\.SOURCES\)/)
  })
})
