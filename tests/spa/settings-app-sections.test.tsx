/**
 * THE CLIENTS AND HIRING APP SETTINGS ARE GRANTED BY BADGE, so their cards do
 * not call themselves the master's; and a config read that failed is said in
 * place with a retry, never a "Reading the config…" line that never ends.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { renderToString as renderBare } from 'react-dom/server'
import { MASTER_ONLY_SECTIONS } from '@/lib/settingsNav'
import ClientsMasterSection from '@/pages/settings/ClientsMasterSection'
import HiringMasterSection from '@/pages/settings/HiringMasterSection'
import PotClientsMasterSection from '@/pages/settings/PotClientsMasterSection'
import ConfigReadFailed from '@/pages/settings/ConfigReadFailed'

/** The sections animate in, and the animation asks the window for listeners the test window does not keep. */
function renderToString(node: ReactNode): string {
  const g = globalThis as unknown as Record<string, unknown>
  const held = { add: g.addEventListener, remove: g.removeEventListener }
  g.addEventListener = held.add ?? (() => {})
  g.removeEventListener = held.remove ?? (() => {})
  try {
    return renderBare(node).replace(/<!-- -->/g, '')
  } finally {
    g.addEventListener = held.add
    g.removeEventListener = held.remove
  }
}

describe('the app settings a badge opens', () => {
  it('are not the master\'s — only the app matrix, who else opens it, the platform roster, what My Work shows everybody, who makes each edition, the Hub containers and which engine answers each app are', () => {
    assert.deepEqual([...MASTER_ONLY_SECTIONS].sort(),
      ['appcontrol', 'appcontrolaccess', 'backends', 'editions', 'hubcontainers', 'members', 'mywork', 'routes'])
  })

  it('the Client Care card names what it governs, not whose it is', () => {
    const html = renderToString(<ClientsMasterSection />)
    assert.match(html, /Client Care app — views and toolbar/)
    assert.doesNotMatch(html, /\(master\)/)
    assert.match(html, /Reading the config…/)
  })

  it('the Hiring card names what it governs, not whose it is', () => {
    const html = renderToString(<HiringMasterSection />)
    assert.match(html, /Hiring app — views/)
    assert.doesNotMatch(html, /\(master\)/)
    assert.match(html, /Reading the config…/)
  })

  it('the Potential Clients card is drawn the same way', () => {
    const html = renderToString(<PotClientsMasterSection />)
    assert.match(html, /Potential Clients app/)
    assert.match(html, /Reading the config…/)
  })
})

describe('a config read that failed', () => {
  it('says so, with why and the way to ask again — never a reading line', () => {
    const html = renderToString(<ConfigReadFailed why="hiringAlertsGet timed out" onRetry={() => {}} />)
    assert.match(html, /The config could not be read — hiringAlertsGet timed out\./)
    assert.match(html, /These switches stay hidden until it can be/)
    assert.match(html, /Try again/)
    assert.doesNotMatch(html, /Reading the config/)
  })
})
