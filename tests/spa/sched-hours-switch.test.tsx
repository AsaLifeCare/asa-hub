/**
 * SETTINGS > MY WORK: Scheduling's hours column hides from every account but the master's own session, the
 * switch sits under its own Scheduling heading, and a value that is missing or unread hides.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MyWorkDisplayBody } from '@/pages/settings/MyWorkDisplaySection'
import {
  MY_WORK_SWITCHES, SCHED_LANDS, SWITCHES_OFF, SWITCH_GROUPS, hideWordFor, schedHoursHiddenFor,
} from '@/pages/settings/myWorkDisplay'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const noop = () => {}
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('the Scheduling hours switch', () => {
  it('hides from every session but the master\'s own; missing or unread hides, as the switch ships', () => {
    assert.equal(schedHoursHiddenFor(false, true), true)
    assert.equal(schedHoursHiddenFor(false, undefined), true)
    assert.equal(schedHoursHiddenFor(false, false), false)
    assert.equal(schedHoursHiddenFor(true, true), false)
    assert.equal(schedHoursHiddenFor(true, undefined), false)
  })

  it('the Settings screen reads its cell as the backend does: only a plain no shows, a blank or a stray word hides', () => {
    assert.deepEqual(['no', ' Off ', '0', 'false', 'yes', '', 'hide', undefined].map((v) => hideWordFor('sched_hours', v)),
      [false, false, false, false, true, true, true, true])
    assert.deepEqual(['yes', '', 'hide'].map((v) => hideWordFor('header', v)), [true, false, false], 'the other switches: only a plain yes hides')
    const gs = read('apps-script/AlertsConfig.gs')
    assert.match(gs, /var MYWORK_HIDE_FAIL_CLOSED = \{ sched_hours: true \};/, 'the same part fails closed on the server')
  })

  it('is one switch under its own Scheduling heading, after SSA, and never in My Work\'s group', () => {
    const sw = MY_WORK_SWITCHES.find((s) => s.part === 'sched_hours')
    assert.deepEqual([sw?.key, sw?.label, sw?.page],
      ['mywork_hide_sched_hours', 'Scheduling · Hours column', 'Scheduling'])
    assert.ok(sw?.desc.includes('Hrs (week) / Hrs (tab)') && sw.desc.includes('Medication Administration 1/2/3'))
    const group = SWITCH_GROUPS.find((g) => g.heading === 'Scheduling')
    assert.deepEqual(group?.switches.map((s) => s.part), ['sched_hours'])
    assert.ok(SWITCH_GROUPS[0].switches.every((s) => s.page !== 'Scheduling'))
  })

  it('Settings draws the Scheduling heading and the switch with what it does now', () => {
    const html = flat(renderToString(<MyWorkDisplayBody hidden={{ ...SWITCHES_OFF, sched_hours: true }}
      known={MY_WORK_SWITCHES.map((s) => s.part)} catalogue={null} busy={false} onFlip={noop} />))
    const heading = html.indexOf('>Scheduling</h3>')
    assert.ok(heading > html.indexOf('SSA · Role on each client') && heading < html.indexOf('Scheduling · Hours column'), html)
    assert.match(html, /data-switch-group="Scheduling"/)
    assert.match(html, /data-part="sched_hours">Hidden from everyone else</)
    assert.ok(html.includes('aria-label="Hide scheduling · hours column"'))
    assert.equal((html.match(/role="switch"/g) ?? []).length, MY_WORK_SWITCHES.length)
    const off = flat(renderToString(<MyWorkDisplayBody hidden={SWITCHES_OFF}
      known={MY_WORK_SWITCHES.map((s) => s.part)} catalogue={null} busy={false} onFlip={noop} />))
    assert.match(off, /data-part="sched_hours">Shown to everyone</)
  })

  it('a backend that does not know the key yet offers no switch, and says the hours stay hidden', () => {
    const html = flat(renderToString(<MyWorkDisplayBody hidden={SWITCHES_OFF}
      known={MY_WORK_SWITCHES.filter((s) => s.part !== 'sched_hours').map((s) => s.part)} catalogue={null} busy={false}
      onFlip={noop} />))
    assert.match(html, /data-not-known="sched_hours">[^<]*Until then it stays hidden from everyone else\./)
    assert.ok(!html.includes('data-part="sched_hours"') && !html.includes('aria-label="Hide scheduling · hours column"'))
  })

  it('a save says it lands on the next read of a house; the footnote says the hours hide when unread', () => {
    const src = read('src/pages/settings/MyWorkDisplaySection.tsx')
    assert.ok(src.includes("sw.page === 'Scheduling' ? SCHED_LANDS"))
    assert.equal(SCHED_LANDS, 'Everyone else sees it in Scheduling the next time a house is read.')
    const html = flat(renderToString(<MyWorkDisplayBody hidden={SWITCHES_OFF}
      known={MY_WORK_SWITCHES.map((s) => s.part)} catalogue={null} busy={false} onFlip={noop} />))
    assert.ok(html.includes('the Scheduling hours stay hidden from everyone else'), html)
    assert.ok(!html.includes('If this setting cannot be read, nothing is hidden'))
  })

  it('ships yes after the SSA role, in the catalogue the backend falls back to and in the one the migration writes', () => {
    const shipped = read('apps-script/AlertsCatalog.gs')
    assert.ok(shipped.includes('{"key":"mywork_hide_ssa_role","group":"mywork","value":"yes"},\n' +
      '  {"key":"mywork_hide_sched_hours","group":"mywork","value":"yes"}'))
    const migration = JSON.parse(read('tools/hiring-alerts-catalogue.json')) as
      { key: string; group: string; default_value: string; note: string }[]
    const at = migration.findIndex((r) => r.key === 'mywork_hide_sched_hours')
    assert.equal(migration[at - 1]?.key, 'mywork_hide_ssa_role')
    assert.deepEqual([migration[at].group, migration[at].default_value], ['mywork', 'yes'])
    assert.ok(migration[at].note.includes('An unreadable setting hides.'))
  })

  it('the backend reads the part fail closed, and Settings search finds it', () => {
    const cfg = read('apps-script/AlertsConfig.gs')
    assert.ok(cfg.includes("sched_hours: 'mywork_hide_sched_hours'"))
    assert.ok(cfg.includes('function hubSchedHoursHidden_() { try { return hubMyWorkHideRead_().sched_hours !== false; } ' +
      'catch (e) { return true; } }'))
    assert.ok(read('src/pages/SettingsPage.tsx').includes('hours scheduling'))
  })
})
