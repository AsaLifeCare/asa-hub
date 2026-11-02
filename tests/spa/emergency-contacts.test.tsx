/**
 * Emergency Contacts · the directory. Python keeps it in the Hub's database (emergencyContactsRead); while the app is
 * not on Python, or on any failure, the page draws the compiled DEFAULT_GROUPS exactly as before: the 911 banner,
 * every lane with every number on it, and tel: links that dial 911 too. The master or a holder of its edition (the
 * read's can_edit) sees the edit affordances; nobody else does. No App Control row ships with it — the app is the
 * master's alone until released (lib/badgeAccess). The doors are answered at `fetch` with their own envelopes.
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { useAuthStore } from '@/auth/useAuthStore'
import { appManifests } from '@/registry/apps'
import { EMERGENCY_CONTACTS_APP_ID, emergencyContactsManifests } from '@/registry/apps-emergencycontacts'
import { CUSTOM_PAGES } from '@/pages/AppRoutePage'
import { badgeAllowsApp } from '@/lib/badgeAccess'
import { EDITION_IDS } from '@/lib/editions'
import { DEFAULT_GROUPS } from '@/pages/features/suggestions/HelpfulContacts'
import EmergencyContactsPage, { DirectoryView } from '@/pages/features/emergencycontacts/EmergencyContactsPage'
import {
  EMERGENCY_CONTACTS_EVENT, KEPT_DIRECTORY_PREFIX, keptDirectory, saveDirectory, useDirectory,
} from '@/pages/features/emergencycontacts/emergencyContactsLane'
import {
  CHIP_CHOICES, COMPILED, contactRemoval, directoryFrom, directoryOfRefusal, filterDirectory, groupRemoval,
} from '@/pages/features/emergencycontacts/emergencyContactsModel'
import { mountHook } from './react-host'

const flat = (html: string) => html.replace(/<!-- -->/g, '')
const realFetch = globalThis.fetch
let sent: { action: string; payload: unknown }[] = []
let answer: () => Response = () => new Response(JSON.stringify({ status: 200, data: { source: 'compiled' } }))

const PY = {
  source: 'python', can_edit: true,
  groups: [
    { id: 'emergency', label: 'Emergency', icon: 'siren', chip: 'bg-tint-pink text-tint-fg-pink', order: 1, contacts: [
      { id: 'emergency-1', name: 'Police, Fire, Medical', note: '', phone: '911', order: 1 },
      { id: 'emergency-2', name: 'Canton Police', note: 'Non-Emergency', phone: '(330) 649-5800', order: 2 }] },
    { id: 'gabc', label: 'Pharmacies', icon: 'pill', chip: 'bg-tint-violet text-tint-fg-violet', order: 2, contacts: [
      { id: 'c1', name: 'Night pharmacy', note: 'Open late', phone: '(330) 555-0100', order: 1 }] },
  ],
}
const signIn = (id: string) => useAuthStore.setState({ user: { id, name: id, role: 'staff', types: [], isMaster: false }, token: `tok-${id}` } as never)

before(() => {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(decodeURIComponent(String(init?.body ?? '').replace(/^body=/, '')))
    sent.push({ action: String(body.action), payload: body.payload })
    return answer()
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => { signIn('u-ann') })
afterEach(() => {
  sent = []
  useAuthStore.setState({ user: null, token: null } as never)
  try { localStorage.clear() } catch { /* a test's clean slate */ }
})

describe('emergency contacts', () => {
  it('is one app with one directory page, registered once', () => {
    assert.equal(emergencyContactsManifests.length, 1)
    const manifest = emergencyContactsManifests[0]
    assert.equal(manifest.id, EMERGENCY_CONTACTS_APP_ID)
    assert.deepEqual(manifest.pages.map((p) => p.id), ['directory'])
    assert.equal(appManifests.filter((a) => a.id === EMERGENCY_CONTACTS_APP_ID).length, 1)
  })

  it('its CUSTOM_PAGES route resolves to the page', async () => {
    assert.equal(await CUSTOM_PAGES['emergency-contacts/directory'].load(), EmergencyContactsPage)
  })

  it('ships master-only: no badge row opens it to nobody else', () => {
    assert.equal(badgeAllowsApp(EMERGENCY_CONTACTS_APP_ID, { types: ['STAFF'], role: 'staff' }, {}), false)
    assert.equal(badgeAllowsApp(EMERGENCY_CONTACTS_APP_ID, { types: ['ADMIN'], role: 'admin' }, {}), false)
    assert.equal(badgeAllowsApp(EMERGENCY_CONTACTS_APP_ID, { isMaster: true }, {}), true)
    // a row the master writes releases it by badge, as for every app
    assert.equal(badgeAllowsApp(EMERGENCY_CONTACTS_APP_ID, { types: ['STAFF'], role: 'staff' }, { [EMERGENCY_CONTACTS_APP_ID]: ['STAFF'] }), true)
  })

  it('draws the 911 banner, every lane and every number as a tel: link', () => {
    const html = renderToString(createElement(EmergencyContactsPage))
    assert.ok(html.includes('Call 911 first.'), 'the banner')
    assert.ok(html.includes('tel:911'), '911 dials')
    for (const group of DEFAULT_GROUPS) {
      assert.ok(html.includes(group.label), `lane ${group.id}`)
      for (const contact of group.contacts) {
        assert.ok(html.includes(contact.name), contact.name)
        assert.ok(html.includes(`tel:${contact.phone.replace(/[^\d+]/g, '')}`), `tel ${contact.phone}`)
      }
    }
    assert.ok(!html.includes('data-edit-contact') && !html.includes('data-add-lane'), 'the compiled page edits nothing')
  })
})

describe('the directory as the page holds it', () => {
  it('the compiled directory is DEFAULT_GROUPS, lane by lane and contact by contact', () => {
    assert.deepEqual(COMPILED.groups.map((g) => [g.id, g.label, g.icon, g.chip, g.contacts.map((c) => [c.name, c.note, c.phone])]),
      DEFAULT_GROUPS.map((g) => [g.id, g.label, g.icon, g.chip, g.contacts.map((c) => [c.name, c.note ?? '', c.phone])]))
    assert.equal(COMPILED.canEdit, false)
    assert.ok(CHIP_CHOICES.some((c) => c.chip === DEFAULT_GROUPS[0].chip))
  })

  it('the relay\'s compiled marker, or anything unreadable, is the compiled directory; Python\'s answer is kept as sent', () => {
    assert.equal(directoryFrom({ source: 'compiled' }), COMPILED)
    assert.equal(directoryFrom(null), COMPILED)
    assert.equal(directoryFrom({ source: 'python' }), COMPILED)
    const d = directoryFrom(PY)
    assert.equal(d.source, 'python')
    assert.equal(d.canEdit, true)
    assert.deepEqual(d.groups.map((g) => [g.id, g.order, g.contacts.map((c) => c.id)]), [['emergency', 1, ['emergency-1', 'emergency-2']], ['gabc', 2, ['c1']]])
    assert.equal(directoryFrom({ ...PY, can_edit: 'yes' }).canEdit, false, 'only a plain true opens editing')
    const refused = Object.assign(new Error('Changed since the panel was opened — reloaded, nothing was written.'),
      { envelope: { status: 409, data: { directory: PY, current: { name: 'X' } } } })
    assert.equal(directoryOfRefusal(refused)?.groups.length, 2)
  })

  it('a search finds a note in the team lane alone, kept or compiled', () => {
    assert.deepEqual(filterDirectory(directoryFrom(PY), 'open late').map((g) => g.id), [])
    assert.deepEqual(filterDirectory(COMPILED, 'non-emergency').map((g) => g.id), [])
    assert.deepEqual(filterDirectory(COMPILED, 'finance').map((g) => g.id), ['team'])
  })

  it('a removal carries the witness the panel showed; a lane with contacts says they go with it', () => {
    const d = directoryFrom(PY)
    assert.deepEqual(contactRemoval(d.groups[0], d.groups[0].contacts[1]), { op: 'contact.remove', id: 'emergency-2',
      expected: { name: 'Canton Police', phone: '(330) 649-5800', note: 'Non-Emergency', group: 'emergency', order: '2' } })
    assert.deepEqual(groupRemoval(d.groups[1]), { op: 'group.remove', id: 'gabc', expected: { label: 'Pharmacies', contacts: '1' },
      with_contacts: true })
  })

  it('an editor sees a pencil on every lane and contact, Add contact in each lane and Add lane; a reader none', () => {
    const editor = flat(renderToString(createElement(DirectoryView, { directory: directoryFrom(PY), query: '', onQuery: () => {}, onPanel: () => {} })))
    for (const id of ['emergency', 'gabc']) {
      assert.match(editor, new RegExp(`data-edit-lane="${id}"`))
      assert.match(editor, new RegExp(`data-add-contact="${id}"`))
    }
    for (const id of ['emergency-1', 'emergency-2', 'c1']) assert.match(editor, new RegExp(`data-edit-contact="${id}"`))
    assert.match(editor, /data-add-lane/)
    assert.ok(!/Non-Emergency/.test(editor), 'a note outside the team lane stays hidden')
    assert.match(editor, /Call 911 first\./)
    const reader = flat(renderToString(createElement(DirectoryView, { directory: directoryFrom({ ...PY, can_edit: false }), query: '', onQuery: () => {}, onPanel: () => {} })))
    assert.ok(!/data-edit-|data-add-/.test(reader))
    assert.match(reader, /Night pharmacy/)
    assert.match(reader, /tel:3305550100/)
  })

  it('the edition is in the catalogue the screens know', () => {
    assert.ok((EDITION_IDS as readonly string[]).includes('emergencyContacts.directory'))
  })
})

describe('useDirectory', () => {
  it('paints the compiled directory first, adopts Python\'s and keeps it for the next visit', async () => {
    answer = () => new Response(JSON.stringify({ status: 200, data: PY }))
    const h = mountHook(() => useDirectory(), {})
    assert.equal(h.current.directory.source, 'compiled', 'drawn before any answer')
    await h.settle(() => h.current.directory.source === 'python')
    assert.equal(h.current.directory.groups.length, 2)
    assert.ok(sent.every((s) => s.action === 'emergencyContactsRead'))
    assert.equal(keptDirectory('u-ann')?.groups[1].label, 'Pharmacies')
    h.unmount()
    const again = mountHook(() => useDirectory(), {})
    assert.equal(again.current.directory.source, 'python', 'the kept copy paints at once')
    again.unmount()
  })

  it('a failure, a refusal or the compiled marker draws the compiled directory and forgets the kept copy', async () => {
    answer = () => new Response(JSON.stringify({ status: 200, data: PY }))
    const h = mountHook(() => useDirectory(), {})
    await h.settle(() => h.current.directory.source === 'python')
    answer = () => new Response(JSON.stringify({ status: 503, message: 'The directory could not be read just now.' }))
    h.run(() => h.current.reload())
    await h.settle(() => h.current.directory.source === 'compiled')
    assert.equal(h.current.directory, COMPILED)
    answer = () => new Response(JSON.stringify({ status: 200, data: { source: 'compiled' } }))
    const asked = sent.length
    h.run(() => h.current.reload())
    await h.settle(() => sent.length > asked && keptDirectory('u-ann') === null)
    assert.equal(h.current.directory, COMPILED)
    assert.equal(keptDirectory('u-ann'), null)
    assert.equal(localStorage.getItem(`${KEPT_DIRECTORY_PREFIX}u-ann`), null)
    h.unmount()
  })

  it('a save\'s answer replaces the directory with no read of its own; the save names its op', async () => {
    answer = () => new Response(JSON.stringify({ status: 200, data: PY }))
    const h = mountHook(() => useDirectory(), {})
    await h.settle(() => h.current.directory.source === 'python')
    const reads = sent.length
    const next = { ...PY, groups: [PY.groups[1]] }
    answer = () => new Response(JSON.stringify({ status: 200, data: { removed: { group: 'emergency', contacts: 2 }, directory: next } }))
    const got = await saveDirectory({ op: 'group.remove', id: 'emergency', expected: { label: 'Emergency', contacts: '2' }, with_contacts: true })
    h.run(() => h.current.absorb(got))
    assert.deepEqual(h.current.directory.groups.map((g) => g.id), ['gabc'])
    assert.equal(sent.length, reads + 1)
    assert.deepEqual(sent.at(-1), { action: 'emergencyContactsSave', payload: { op: 'group.remove', id: 'emergency',
      expected: { label: 'Emergency', contacts: '2' }, with_contacts: true } })
    h.unmount()
  })

  it('never polls: it reads again on the app\'s ring and the stream\'s open', () => {
    assert.equal(EMERGENCY_CONTACTS_EVENT, 'emergency-contacts')
    const src = readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(), 'src/pages/features/emergencycontacts/emergencyContactsLane.ts'), 'utf8')
    assert.match(src, /onLiveEvent\(EMERGENCY_CONTACTS_EVENT, read\)/)
    assert.match(src, /onLiveEvent\('open', read\)/)
    assert.ok(!/setInterval|setTimeout/.test(src))
  })

  it('every form sits in the standard right panel, and a removal is confirmed inside it', () => {
    const src = readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(), 'src/pages/features/emergencycontacts/EmergencyContactsForms.tsx'), 'utf8')
    assert.match(src, /<SidePanel open=/)
    assert.ok(!/\bwide\b|window\.confirm|confirm\(|role="dialog"|aria-modal/.test(src))
    assert.match(src, /data-remove-confirm/)
  })
})
