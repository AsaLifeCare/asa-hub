/**
 * Settings → My Work → Support Requests: nine switches, one per automation, each shipping off and running nothing
 * when it cannot be read; drawn in the same card after the My Work switches, under their own heading, only once the
 * config was read; saved one at a time through hiringAlertsSet; found by Settings search.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import MyWorkDisplaySection from '@/pages/settings/MyWorkDisplaySection'
import SupportAutomationsBody, { SupportAutomationsView } from '@/pages/settings/SupportAutomationsBody'
import {
  AUTO_LANDS, AUTO_NOT_KNOWN, AUTOS_FOOTNOTE, AUTOS_OFF, SUPPORT_AUTOMATIONS, autoWord, type AutoPart,
} from '@/pages/settings/supportAutomations'
import { MY_WORK_SWITCHES } from '@/pages/settings/myWorkDisplay'
import { AUTO_PARTS } from '@/pages/features/supportdesk/supportDeskModel'
import { gasAction } from '@/features/hiring/shared'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const noop = () => {}
const ALL = SUPPORT_AUTOMATIONS.map((s) => s.part)

const KEYS = [
  'mywork_auto_sr_late_show', 'mywork_auto_sr_no_call_no_show', 'mywork_auto_sr_punch_missing', 'mywork_auto_sr_incident',
  'mywork_auto_sr_general_requests', 'mywork_auto_sr_vehicle', 'mywork_auto_sr_payroll', 'mywork_auto_sr_adp_update',
  'mywork_auto_sr_time_off',
]

describe('support automations — the keys', () => {
  it('nine, in the backend\'s order, every one a mywork_auto_ key; the parts are the list\'s own', () => {
    assert.deepEqual(SUPPORT_AUTOMATIONS.map((s) => s.key), KEYS)
    assert.deepEqual(SUPPORT_AUTOMATIONS.map((s) => s.part), [...AUTO_PARTS])
    assert.ok(SUPPORT_AUTOMATIONS.every((s) => /^mywork_auto_sr_/.test(s.key)))
    assert.deepEqual(Object.keys(AUTOS_OFF).sort(), [...ALL].sort())
    assert.ok(Object.values(AUTOS_OFF).every((v) => v === false), 'every one ships off')
    assert.deepEqual(SUPPORT_AUTOMATIONS.map((s) => s.label), [
      'Late Show warnings', 'No Call No Show warnings', 'Missing punch warnings', 'Incident alerts',
      'General requests to Arthur and Wellington', 'Vehicle requests to the directors', 'Payroll requests to Ty',
      'ADP information updates', 'My Calendar vacation requests into Scheduling',
    ])
  })

  it('none joins the My Work hide switches', () => {
    const hide = new Set(MY_WORK_SWITCHES.map((s) => s.key))
    assert.ok(KEYS.every((k) => !hide.has(k)))
    assert.equal(MY_WORK_SWITCHES.length, 11)
  })

  it('only a plain yes runs', () => {
    assert.equal(autoWord(' YES '), true)
    assert.equal(autoWord('on'), true)
    for (const v of ['', 'no', 'maybe', undefined]) assert.equal(autoWord(v), false, String(v))
  })

  it('the catalogue carries the same keys, in the same order, when the backend\'s copy is in the tree', (t) => {
    const file = resolve(ROOT, 'tools/hiring-alerts-catalogue.json')
    const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (!text.includes('mywork_auto_sr_')) { t.skip('the catalogue rows arrive with the Apps Script package'); return }
    const at = KEYS.map((k) => text.indexOf(`"${k}"`))
    assert.ok(at.every((i) => i > 0), 'every key is catalogued')
    assert.deepEqual([...at].sort((a, b) => a - b), at, 'in the same order')
  })
})

describe('support automations — the block', () => {
  const view = (known: readonly AutoPart[] = ALL, values = AUTOS_OFF) =>
    flat(renderToString(<SupportAutomationsView values={values} known={known} busy={false} onFlip={noop} />))

  it('one switch per automation, each saying what it does and whether it runs', () => {
    const html = view(ALL, { ...AUTOS_OFF, vehicle: true })
    assert.equal((html.match(/role="switch"/g) ?? []).length, 9)
    assert.match(html, /data-auto-word="vehicle">On — runs</)
    assert.match(html, /data-auto-word="late_show">Off — does not run</)
    assert.ok(html.includes('aria-label="Run Late Show warnings"'))
    assert.ok(html.includes('aria-label="Run My Calendar vacation requests into Scheduling"'))
    assert.ok(html.includes(AUTOS_FOOTNOTE))
    assert.equal(AUTOS_FOOTNOTE, 'Three gates for every text: this switch, the Smart Comms situation, then test mode. If this setting cannot be read, no automation runs.')
  })

  it('a key the backend does not list yet is not offered, and does not run', () => {
    const html = view(ALL.filter((p) => p !== 'time_off'))
    assert.equal((html.match(/role="switch"/g) ?? []).length, 8)
    assert.match(html, /data-auto-not-known="time_off">/)
    assert.ok(AUTO_NOT_KNOWN.endsWith('Until then it does not run.'))
  })

  it('reads before it offers anything, under its own heading in the My Work card', () => {
    const html = flat(renderToString(<SupportAutomationsBody />))
    assert.ok(html.includes('data-switch-group="Support Requests"') && html.includes('>Support Requests</h3>'))
    assert.ok(html.includes('Reading the automations…') && !html.includes('role="switch"'))
    const card = flat(renderToString(<MyWorkDisplaySection />))
    assert.ok(card.includes('My Work — what everyone else sees') && card.includes('data-switch-group="Support Requests"'))
    assert.ok(!card.includes('role="switch"'))
    const src = read('src/pages/settings/MyWorkDisplaySection.tsx')
    assert.equal((src.match(/<SupportAutomationsBody \/>/g) ?? []).length, 1)
    assert.ok(src.indexOf('<MyWorkDisplayBody') < src.indexOf('<SupportAutomationsBody />'))
  })

  it('a save writes yes or no to its key and says when the app follows', () => {
    const src = read('src/pages/settings/SupportAutomationsBody.tsx')
    assert.ok(src.includes("gasAction('hiringAlertsSet', { values: { [sw.key]: on ? 'yes' : 'no' } })"))
    assert.ok(src.includes('body: AUTO_LANDS'))
    assert.equal(AUTO_LANDS, 'Support Requests follows it from its next pass.')
    assert.equal(typeof gasAction, 'function')
  })

  it('Settings search finds it, and the words before it stay', () => {
    const page = read('src/pages/SettingsPage.tsx')
    assert.ok(page.includes('hours scheduling'))
    assert.ok(page.includes('support automations late show no call punch incident vehicle payroll adp time off'))
  })
})

describe('support automations — a save, at the door', () => {
  const realFetch = globalThis.fetch
  const sent: { action: string; payload: unknown }[] = []
  before(() => {
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: unknown }
      sent.push({ action: env.action, payload: env.payload })
      return new Response(JSON.stringify({ status: 200, data: { ok: true } }))
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })

  it('hiringAlertsSet carries the one key', async () => {
    await gasAction('hiringAlertsSet', { values: { [SUPPORT_AUTOMATIONS[2].key]: 'yes' } })
    assert.deepEqual(sent, [{ action: 'hiringAlertsSet', payload: { values: { mywork_auto_sr_punch_missing: 'yes' } } }])
  })
})
