/**
 * A release in App Control reaches a tab that stays signed in: the badge matrix is read again when the tab comes back
 * into view, never more than once per BADGE_REFRESH_MS, and never for a tab that is not signed in.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(process.cwd(), 'src/lib/prefsSync.ts'), 'utf8')

describe('the badge matrix follows App Control in an open tab', () => {
  it('is read again when the tab comes back into view', () => {
    assert.match(src, /visibilitychange[\s\S]{0,120}visibilityState === 'visible'\) refreshBadgeRulesOnView\(\)/)
    assert.match(src, /function pullBadgeRules\(token: string \| null, again = false\)/)
    assert.match(src, /if \(!token \|\| \(!again && token === badgePulledForToken\)\) return/)
  })

  it('only for the signed-in token its sign-in pull already served, at most once per few minutes', () => {
    const at = src.indexOf('export function refreshBadgeRulesOnView')
    assert.ok(at !== -1)
    const body = src.slice(at, src.indexOf('\n}\n', at))
    assert.match(body, /if \(!token \|\| token !== badgePulledForToken \|\| now - badgePulledAt < BADGE_REFRESH_MS\) return false/)
    const ms = Number((src.match(/export const BADGE_REFRESH_MS = (\d+) \* 60 \* 1000/) ?? [])[1]) * 60_000
    assert.ok(ms >= 60_000 && ms <= 10 * 60_000)
  })

  it('the boot read of the matrix starts the clock', () => {
    assert.match(src, /if \(parts\.access\) \{ badgePulledForToken = token; badgePulledAt = Date\.now\(\) \}/)
  })
})
