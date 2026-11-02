/**
 * Settings → Alerts I receive: three switches, each the reader's own and each shipping on; the section and its nav
 * entry exist only where the server answers the read (the directors and the master) — a 404 leaves no trace, the door's
 * own 503 is said in place; Access control never offers it, a franchise never has it; each switch saves on its own.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import AlertReceiveSection, { AlertReceiveView, useAlertReceive } from '@/pages/settings/AlertReceiveSection'
import {
  RECEIVE_ALERTS, RECEIVE_ALL_ON, RECEIVE_KEEPS, RECEIVE_LANDS, RECEIVE_PARTS, receiveFrom, type ReceiveRead,
} from '@/pages/settings/alertReceive'
import { SETTINGS_NAV, configAccessSections, settingsNavFor } from '@/lib/settingsNav'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { gasAction } from '@/features/hiring/shared'
import { mountHook } from './react-host'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const noop = () => {}
const TY: ReceiveRead = { as: 'director', receive: { ...RECEIVE_ALL_ON }, saveable: true, why: '' }

describe('alerts I receive — the three alerts', () => {
  it('No Call No Show, is not punching in and Incident filed, every one shipping on', () => {
    assert.deepEqual([...RECEIVE_PARTS], ['no_call', 'punch', 'incident'])
    assert.deepEqual(RECEIVE_ALERTS.map((a) => a.part), [...RECEIVE_PARTS])
    assert.deepEqual(RECEIVE_ALERTS.map((a) => a.label), ['No Call No Show', 'Is not punching in', 'Incident filed'])
    assert.ok(Object.values(RECEIVE_ALL_ON).every((v) => v === true))
    assert.ok(RECEIVE_KEEPS.includes('The staff member an alert is about'))
  })

  it('reads the door\'s answer: a part not plainly false is on, and anything else is no answer', () => {
    assert.deepEqual(receiveFrom({ as: 'master', receive: { no_call: false }, saveable: true, why: '' }),
                     { as: 'master', receive: { no_call: false, punch: true, incident: true }, saveable: true, why: '' })
    assert.equal(receiveFrom({ as: 'staff', receive: {} }), null)
    assert.equal(receiveFrom({ as: 'director' }), null)
    assert.equal(receiveFrom(null), null)
    assert.equal(receiveFrom({ as: 'director', receive: {}, saveable: false, why: 'not set up' })?.saveable, false)
  })
})

describe('alerts I receive — the switches', () => {
  const view = (r: ReceiveRead) => flat(renderToString(<AlertReceiveView read={r} busy={false} onFlip={noop} />))

  it('one switch per alert, each saying whether it reaches you, with the words on what stays as it was', () => {
    const html = view({ ...TY, receive: { ...RECEIVE_ALL_ON, punch: false } })
    assert.equal((html.match(/role="switch"/g) ?? []).length, 3)
    assert.match(html, /data-receive-word="no_call">On — it reaches you</)
    assert.match(html, /data-receive-word="punch">Off — it is not sent to you</)
    assert.ok(html.includes('aria-label="Receive No Call No Show"') && html.includes('aria-label="Receive Incident filed"'))
    assert.ok(html.includes(RECEIVE_KEEPS) && html.includes(RECEIVE_LANDS))
    assert.ok(html.includes('data-receive-as="director"'))
  })

  it('a house that cannot keep a choice says why, and offers no switch to flip', () => {
    const html = view({ ...TY, saveable: false, why: 'The Support Requests settings are not set up yet.' })
    assert.equal((html.match(/<button[^>]*role="switch"[^>]*\sdisabled=""/g) ?? []).length, 3)
    assert.equal((view(TY).match(/<button[^>]*role="switch"[^>]*\sdisabled=""/g) ?? []).length, 0)
    assert.ok(html.includes('data-receive-why="">The Support Requests settings are not set up yet.'))
  })

  it('reads before it offers anything, and a refusal past the gate is said in place with the way to ask again', () => {
    const asking = flat(renderToString(<AlertReceiveSection state={{ phase: 'asking' }} onState={noop} onRetry={noop} />))
    assert.ok(asking.includes('id="alertreceive"') && asking.includes('Alerts I receive') && asking.includes('Reading your alerts…'))
    assert.ok(!asking.includes('role="switch"'))
    const failed = flat(renderToString(
      <AlertReceiveSection state={{ phase: 'failed', why: 'the house did not answer' }} onState={noop} onRetry={noop} />))
    assert.ok(failed.includes('the house did not answer') && failed.includes('Try again') && !failed.includes('role="switch"'))
  })
})

describe('alerts I receive — where the section exists', () => {
  const apps = () => useRegistryStore.getState().apps
  const STAFF = { role: 'staff' as const, types: ['STAFF'], isMaster: false }
  const ids = (alertReceive?: boolean) =>
    settingsNavFor(apps(), { isAdmin: false, isMaster: false, configRules: {}, user: STAFF as never, alertReceive })
      .map((n) => n.id)

  it('only where the server answered — a staff-role director has it, nobody else does, no badge rule hands it out', () => {
    assert.equal(SETTINGS_NAV.find((n) => n.id === 'alertreceive')?.label, 'Alerts I receive')
    assert.ok(ids(true).includes('alertreceive'))
    assert.ok(!ids(false).includes('alertreceive') && !ids().includes('alertreceive'))
    assert.ok(!settingsNavFor(apps(), { isAdmin: true, isMaster: true, configRules: { alertreceive: ['ADMIN'] },
                                         user: { role: 'admin', types: ['ADMIN'], isMaster: true } as never })
      .some((n) => n.id === 'alertreceive'), 'the master too is drawn it only when the server answered')
    assert.ok(!configAccessSections(apps(), true).some((n) => n.id === 'alertreceive'))
    assert.ok(!configAccessSections(apps(), false).some((n) => n.id === 'alertreceive'))
  })

  it('stays home', () => {
    const held = useTenantStore.getState()
    try {
      useTenantStore.setState({ currentTenantId: 'franchise', homeTenantId: 'home', tenantsLoaded: true } as never)
      assert.ok(!ids(true).includes('alertreceive'))
    } finally {
      useTenantStore.setState(held as never)
    }
  })

  it('the Settings page asks first, at home and outside a visit, and draws the section through that one list', () => {
    const page = read('src/pages/SettingsPage.tsx')
    assert.ok(page.includes('useAlertReceive(atHome && !visitingSettings, user?.id ?? \'\')'))
    assert.ok(page.includes('alertReceive: receiveHeld'))
    assert.ok(page.includes("{has('alertreceive') && ("))
    assert.ok(page.includes('alertreceive: \'alerts receive turn off stop no call no show not punching in incident filed'))
  })
})

describe('alerts I receive — at the door', () => {
  const realFetch = globalThis.fetch
  const sent: { action: string; payload: unknown }[] = []
  let answer: { status: number; data?: unknown; message?: string } = { status: 200 }
  before(() => {
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: unknown }
      sent.push({ action: env.action, payload: env.payload })
      return new Response(JSON.stringify(answer))
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })

  const ask = async (status: number, data?: unknown, enabled = true) => {
    answer = status === 200 ? { status, data } : { status, message: status === 404 ? 'Unknown action.' : 'The house did not answer.' }
    sent.length = 0
    const h = mountHook((p: { on: boolean }) => useAlertReceive(p.on, 'u-ty'), { on: enabled })
    await h.settle(() => h.current.state.phase !== 'asking')
    const got = h.current.state
    h.unmount()
    return got
  }

  it('a director\'s read draws the section with their own choices', async () => {
    const got = await ask(200, { as: 'director', receive: { no_call: false, punch: true, incident: true }, saveable: true, why: '' })
    assert.equal(got.phase, 'ready')
    assert.equal(got.phase === 'ready' && got.read.receive.no_call, false)
    assert.ok(sent.length >= 1 && sent.every((s) => s.action === 'alertReceiveGet'), JSON.stringify(sent))
  })

  it('a 404 is the server saying this person does not hold it: no section, no failure', async () => {
    assert.equal((await ask(404)).phase, 'absent')
  })

  it('…and so is a role the door is not for, or a backend that does not know the action yet', async () => {
    assert.equal((await ask(403)).phase, 'absent')
    assert.equal((await ask(501)).phase, 'absent')
  })

  it('the door\'s own 503 is past its gate, so the section says it', async () => {
    const got = await ask(503)
    assert.equal(got.phase, 'failed')
    assert.equal(got.phase === 'failed' && got.why, 'The house did not answer.')
  })

  it('away from home or inside a visit nothing is asked', async () => {
    assert.equal((await ask(200, {}, false)).phase, 'absent')
    assert.equal(sent.length, 0)
  })

  it('a save carries the one switch, true or false', async () => {
    answer = { status: 200, data: { as: 'director', receive: { no_call: true, punch: false, incident: true } } }
    sent.length = 0
    await gasAction('alertReceiveSet', { part: 'punch', receive: false })
    assert.deepEqual(sent, [{ action: 'alertReceiveSet', payload: { part: 'punch', receive: false } }])
    assert.ok(read('src/pages/settings/AlertReceiveSection.tsx')
      .includes("gasAction<unknown>('alertReceiveSet', { part, receive: on })"))
  })
})
