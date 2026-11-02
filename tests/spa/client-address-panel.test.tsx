/**
 * CLIENT PROFILE · AN ADDRESS OPENS THE ONE RIGHT PANEL: a press on an address in Client details asks for the
 * Clients panel on that address's group — Client Profile over the group's name, whose address it is, the group's
 * details as the card draws them, then the map with Open larger — never a Google tab.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import {
  ADDRESS_GROUPS, isWriteAsk, panelLabel, panelOf, panelParam, panelTitle, profileOf, type ClientAsk, type RosterRow,
} from '@/pages/features/clientprofiles/clientModel'
import { ProfileAddressView, ProfileView } from '@/pages/features/clientprofiles/sections/Profile'
import type { ReadState } from '@/pages/features/clientprofiles/useClientRead'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const draw = (node: ReactNode) => renderToString(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, '')
const C: RosterRow = {
  client_key: 'annettekowal', client_id: 'CLI_annettekowal', name: 'Annette Kowal', status: 'active', house: 'NW4045', avatar: '',
  isp_year: '2026',
}
const P = profileOf({
  client: { client_key: 'annettekowal', name: 'Annette Kowal', status: 'active' },
  home: { house_code: 'NW4045', house_label: 'Arlington', home_address: '908 Arlington Ave NW', house_manager: 'Marcus Reed',
    house_manager_phone: '5550101202', house_manager_email: 'marcus@example.org' },
  guardian: { name: 'Self', relationship: 'n/a', address: '12 Oak St, Canton, OH', ssa_name: 'Holly Minarik' },
  day: { workshop: 'Sunrise Workshop', workshop_address: 'n/a' },
})
const TODAY = '2026-10-18'
const ready = <T,>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })

describe('an address in Client details', () => {
  it('is a press inside the page that asks for its group\'s panel; one that reads n/a is no link', () => {
    const html = draw(<ProfileView client={C} profile={ready(P)} today={TODAY} onAsk={() => {}} onRetry={() => {}} />)
    assert.match(html, /<button type="button" data-address-link=""[^>]*>908 Arlington Ave NW<\/button>/)
    assert.match(html, /<button type="button" data-address-link=""[^>]*>12 Oak St, Canton, OH<\/button>/)
    assert.equal((html.match(/data-address-link=""/g) ?? []).length, 2, 'the n/a workshop address is text')
    assert.ok(!html.includes('google.com/maps') && !html.includes('target="_blank"'), 'no Google tab from the card')
    const page = readFileSync(resolve(ROOT, 'src/pages/features/clientprofiles/sections/Profile.tsx'), 'utf8')
    assert.match(page, /profileItems\(p, client, today, onDoc, opening, \(group\) => onAsk\(\{ kind: 'address', group \}\)\)/)
    for (const [cell, group] of [['home.home_address', 'home'], ['guardian.address', 'guardian'], ['day.workshop_address', 'day']]) {
      assert.ok(page.includes(`address(p.${cell}, at('${group}'))`), cell)
    }
    assert.doesNotMatch(page, /AddressMapLink/, 'the card no longer opens a panel of its own')
  })

  it('rides the address bar, says Client Profile over the group, and is a read every reader may open', () => {
    for (const group of ADDRESS_GROUPS) {
      const ask: ClientAsk = { kind: 'address', group }
      assert.deepEqual(panelOf(panelParam(ask)), ask, group)
      assert.equal(panelLabel(ask), 'Client Profile')
      assert.equal(isWriteAsk(ask), false, 'a read: no edition or master needed')
    }
    assert.equal(panelTitle({ kind: 'address', group: 'home' }, C.name), 'Home & house contacts')
    assert.equal(panelTitle({ kind: 'address', group: 'guardian' }, C.name), 'Guardian & SSA')
    for (const bad of ['address', 'address~identity', 'address~home~x']) assert.equal(panelOf(bad), null, bad)
    const panel = readFileSync(resolve(ROOT, 'src/pages/features/clientprofiles/ClientPanel.tsx'), 'utf8')
    assert.match(panel, /case 'address': return <ProfileAddressBody client=\{client\} group=\{ask\.group\} \/>/)
  })

  it('the panel draws whose it is, the group as the card has it, the address as text, then the map', () => {
    const html = draw(<ProfileAddressView client={C} profile={P} group="home" today={TODAY} />)
    assert.ok(html.includes('data-address-panel="home"'))
    assert.ok(html.indexOf('>Arlington<') < html.indexOf('>House<'), 'whose it is, first')
    for (const label of ['House', 'Address', 'House Manager', 'House Manager #', 'House Manager Email']) {
      assert.ok(html.includes(`>${label}</dt>`), label)
    }
    assert.ok(html.includes('href="/app/staff-profiles/profile?staff=Marcus+Reed"') && html.includes('href="tel:5550101202"'))
    assert.ok(html.includes('>908 Arlington Ave NW</dd>') && !html.includes('data-address-link'), 'the address is text here')
    assert.ok(html.includes('data-address-frame') && html.includes(encodeURIComponent('908 Arlington Ave NW')))
    assert.ok(html.includes('data-address-larger') && html.includes('Open larger'))
    assert.ok(html.lastIndexOf('</dl>') < html.indexOf('data-record-map'), 'the map comes after the details')

    const own = draw(<ProfileAddressView client={C} profile={P} group="guardian" today={TODAY} />)
    assert.ok(own.includes('>Annette Kowal</span>'), 'a Self guardian is the client')
    assert.ok(own.includes(encodeURIComponent('12 Oak St, Canton, OH')))
    const none = draw(<ProfileAddressView client={C} profile={P} group="day" today={TODAY} />)
    assert.ok(none.includes('>Sunrise Workshop</span>') && !none.includes('data-record-map'), 'n/a draws no map')
  })
})
