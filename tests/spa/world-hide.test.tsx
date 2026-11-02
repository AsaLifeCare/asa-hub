/**
 * SETTINGS > MY WORK, MY WORLD: the session's own `my_world` decides every world surface. An account it says no to
 * has no My world anywhere — no Settings tab, no tour step, no door that sets the world axis — and a world id left
 * stored is dropped; the master and an account it says yes to keep all of it. The switch and its people picker are
 * drawn in the master-only section and save through hiringAlertsSet.
 */
import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { mapBackendUser, useAuthStore, type BackendUser } from '@/auth/useAuthStore'
import { tourStepsFor } from '@/features/auth/tourSteps'
import { crossToMemberWorld, crossToMyWorld } from '@/lib/crossPlace'
import { MASTER_ONLY_SECTIONS, settingsNavFor } from '@/lib/settingsNav'
import { worldOffered, worldOfferedTo } from '@/lib/worldOffered'
import { SeenPeopleView } from '@/pages/settings/SeenPeopleBody'
import { WORLD_HIDE_KEY, WORLD_SEEN_KEY, WorldHideView, worldHideOn } from '@/pages/settings/WorldHideBody'
import { useMemberStore } from '@/stores/useMemberStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { leaveWorldNotOffered, useWorldStore } from '@/stores/useWorldStore'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const noop = () => {}

const backend = (over: Partial<BackendUser>): BackendUser =>
  ({ id: 'u-bob', email: 'bob@example.org', display_name: 'Bob Roe', role: 'staff', ...over }) as BackendUser
const BOB = mapBackendUser(backend({ my_world: false }))
const ANN = mapBackendUser(backend({ id: 'u-ann', email: 'ann@example.org', display_name: 'Ann Lee', my_world: true }))
const BOSS = mapBackendUser(backend({ id: 'u-boss', email: 'boss@example.org', display_name: 'Boss', role: 'admin',
  is_master: true, my_world: true }))

const g = globalThis as unknown as { location?: unknown }
let reloads = 0
const realFetch = globalThis.fetch
before(() => {
  g.location = { hash: '', pathname: '/', search: '', reload: () => { reloads++ } }
  // the sign-in's own world probe is answered as a backend that cannot be reached: unsure changes nothing
  globalThis.fetch = (async () => { throw new Error('offline in this test') }) as typeof fetch
})
// the location stays stubbed: a crossing's reload lands after the last test
after(() => {
  globalThis.fetch = realFetch
  useAuthStore.setState({ user: null, token: null, hydrated: false } as never)
})
afterEach(() => {
  useAuthStore.setState({ user: null, token: null, hydrated: false } as never)
  useWorldStore.setState({ currentWorldId: '', worldName: '', switching: null })
  useMemberStore.setState({ currentMemberId: '', memberName: '', memberRole: '', memberTypes: [] } as never)
})

const signIn = (user: typeof BOB | null, hydrated = true) =>
  useAuthStore.setState({ user, token: user ? `tok-${user.id}` : null, hydrated } as never)

describe('the session decides', () => {
  it('my_world false from the server reads as no world; the master always has one', () => {
    assert.equal(BOB.myWorld, false)
    assert.equal(worldOfferedTo(BOB), false)
    assert.equal(worldOfferedTo(ANN), true)
    assert.equal(worldOfferedTo(BOSS), true)
    assert.equal(worldOfferedTo({ isMaster: true, myWorld: false }), true)
    assert.equal(worldOfferedTo(null), false)
    signIn(BOB)
    assert.equal(worldOffered(), false)
    signIn(ANN)
    assert.equal(worldOffered(), true)
  })

  it('Settings has no My world section, and the palette reads the same list, for an account it says no to', () => {
    const apps = useRegistryStore.getState().apps
    const ids = (user: typeof BOB) => {
      signIn(user)
      return settingsNavFor(apps, { isAdmin: user.role === 'admin', isMaster: user.isMaster === true, user })
        .map((n) => n.id)
    }
    assert.ok(!ids(BOB).includes('worldaccess'))
    assert.ok(ids(ANN).includes('worldaccess'))
    assert.ok(ids(BOSS).includes('worldaccess'))
    const palette = readFileSync(resolve(ROOT, 'src/components/shell/CommandPalette.tsx'), 'utf8')
    assert.ok(palette.includes('settingsActions(settingsNavFor('), 'the palette is built from the same list')
    const page = readFileSync(resolve(ROOT, 'src/pages/SettingsPage.tsx'), 'utf8')
    assert.match(page, /\{has\('worldaccess'\) && \(\s*<Section id="worldaccess"/, 'the section renders by the list')
  })

  it('the welcome sequence says nothing about worlds to an account it says no to', () => {
    const words = (user: Parameters<typeof tourStepsFor>[0]) =>
      tourStepsFor(user).map((s) => `${s.id} ${s.title} ${s.body}`).join(' | ')
    const staff = tourStepsFor({ role: 'staff', types: [], myWorld: false }).map((s) => s.id)
    assert.deepEqual(staff, ['stand-in', 'enjoy'])
    assert.doesNotMatch(words({ role: 'staff', types: [], myWorld: false }), /world/i)
    const admin = tourStepsFor({ role: 'admin', types: ['DIRECTOR'], myWorld: false }).map((s) => s.id)
    assert.deepEqual(admin, ['build', 'stand-in', 'akron', 'enjoy'])
    assert.doesNotMatch(words({ role: 'admin', types: ['DIRECTOR'], myWorld: false }), /world/i)
    // the preview's users carry no flag, and the master always has a world: the sequence whole
    const whole = ['build', 'stand-in', 'world-is-a-place', 'update-apps', 'enjoy']
    assert.deepEqual(tourStepsFor({ role: 'staff', types: [] }).map((s) => s.id), whole)
    assert.deepEqual(tourStepsFor({ role: 'staff', types: [], myWorld: true }).map((s) => s.id), whole)
    const master = tourStepsFor({ role: 'admin', types: [], isMaster: true, myWorld: false }).map((s) => s.id)
    assert.ok(['build', 'world-is-a-place', 'update-apps'].every((id) => master.includes(id)), master.join(','))
  })
})

describe('no door sets the world axis', () => {
  it('opening my world, a member\'s world or a world by id does nothing for an account it says no to', () => {
    signIn(BOB)
    crossToMyWorld()
    crossToMemberWorld({ member_id: 'mem_1', name: 'Ann Lee', role: 'staff', scope: 'work_world', world_id: 'wld_ann' })
    useWorldStore.getState().enterWorld('wld_ann', 'Ann\'s world')
    void useWorldStore.getState().switchToWorld()
    const st = useWorldStore.getState()
    assert.equal(st.currentWorldId, '')
    assert.equal(st.switching, null)
    assert.equal(useMemberStore.getState().currentMemberId, '', 'no visit was opened on the way')
    assert.equal(reloads, 0)
  })

  it('an account it says yes to still enters a world it may open', () => {
    signIn(ANN)
    useWorldStore.getState().enterWorld('wld_x', 'X')
    assert.equal(useWorldStore.getState().currentWorldId, 'wld_x')
  })

  it('a stored world is dropped once the session says no — its own or a visited one — and kept otherwise', () => {
    useWorldStore.setState({ currentWorldId: 'wld_bob', worldName: 'Bob\'s world', switching: null })
    signIn(BOB, false)
    assert.equal(leaveWorldNotOffered(), false, 'a stored snapshot alone decides nothing')
    assert.equal(useWorldStore.getState().currentWorldId, 'wld_bob')
    signIn(ANN)
    assert.equal(useWorldStore.getState().currentWorldId, 'wld_bob', 'an account it says yes to keeps its world')
    useMemberStore.setState({ currentMemberId: 'mem_1' } as never)
    signIn(BOB)
    const st = useWorldStore.getState()
    assert.equal(st.currentWorldId, '', 'the session landing drops the world, a visit open or not')
    assert.equal(st.worldName, '')
    assert.deepEqual(st.switching, { to: 'company' })
    assert.equal(leaveWorldNotOffered(), false, 'and once is enough')
  })
})

describe('the rail and the menu', () => {
  it('draw My world and Their world only for an account it says yes to, and never speak of a closed world without it', () => {
    const sidebar = readFileSync(resolve(ROOT, 'src/components/shell/Sidebar.tsx'), 'utf8')
    assert.ok(sidebar.includes('const canWorld = worldOfferedTo(user)'))
    assert.ok(sidebar.includes('if (canWorld) {\n    places.push({\n      key: \'world\''))
    assert.ok(sidebar.includes('if (canWorld && m.world_id) {'))
    assert.ok(sidebar.includes("m.world_id || !canWorld ? '' : ' — their world is closed'"))
    assert.ok(sidebar.includes('const placesEligible = !isRestrictedRole(accountRole)'),
      'the stack itself stands for every account it stood for, so nothing else on it moves')
    const topbar = readFileSync(resolve(ROOT, 'src/components/shell/Topbar.tsx'), 'utf8')
    assert.ok(topbar.includes('const canWorld = worldOfferedTo(user)'))
    assert.ok(topbar.includes('{canWorld && (\n                    <DropdownMenuItem'))
  })
})

describe('the switch in Settings > My Work', () => {
  it('is drawn inside the master-only section and saves through the master-only door', () => {
    assert.ok(MASTER_ONLY_SECTIONS.includes('mywork'))
    const section = readFileSync(resolve(ROOT, 'src/pages/settings/MyWorkDisplaySection.tsx'), 'utf8')
    assert.ok(section.includes('<WorldHideBody />'))
    const body = readFileSync(resolve(ROOT, 'src/pages/settings/WorldHideBody.tsx'), 'utf8')
    assert.match(body, /gasAction\('hiringAlertsSet', \{ values: \{ \[WORLD_HIDE_KEY\]: next \? 'yes' : 'no' \} \}\)/)
    assert.ok(body.includes('<SeenPeopleBody settingKey={WORLD_SEEN_KEY} heading="People who also see it"'))
    const seen = readFileSync(resolve(ROOT, 'src/pages/settings/SeenPeopleBody.tsx'), 'utf8')
    assert.match(seen, /gasAction\('hiringAlertsSet', \{ values: \{ \[settingKey\]: appsCutCell\(next\) \} \}\)/,
      'the people list is saved whole')
    const apps = readFileSync(resolve(ROOT, 'src/pages/settings/AppsCutBody.tsx'), 'utf8')
    assert.ok(apps.includes('<SeenPeopleBody settingKey={APPS_SEEN_KEY}'), 'the app list shares the same picker')
    assert.equal(WORLD_HIDE_KEY, 'mywork_hide_world')
    assert.equal(WORLD_SEEN_KEY, 'mywork_hide_world_seen')
  })

  it('reads the cell as the server does and offers a switch only once the backend knows the key', () => {
    assert.equal(worldHideOn(' Yes '), true)
    assert.equal(worldHideOn('maybe'), false)
    assert.equal(worldHideOn(undefined), false)
    const on = draw(<WorldHideView on known busy={false} onFlip={noop} />)
    assert.ok(on.includes('My World — hidden from everyone else'))
    assert.equal((on.match(/role="switch"/g) ?? []).length, 1)
    assert.ok(on.includes('aria-checked="true"'))
    assert.match(on, /data-world-hide-word="true">Hidden from everyone else</)
    const off = draw(<WorldHideView on={false} known busy={false} onFlip={noop} />)
    assert.match(off, /data-world-hide-word="true">Shown to everyone</)
    const unknown = draw(<WorldHideView on={false} known={false} busy={false} onFlip={noop} />)
    assert.ok(unknown.includes('data-world-not-known') && !unknown.includes('role="switch"'))
  })

  it('the people picker draws a chip with a face and an X per account, and the directory search adds one', () => {
    const people = [
      { id: 'u-ann', name: 'Ann Lee', email: 'ann@example.org', avatar: '' },
      { id: 'u-bob', name: 'Bob Roe', email: 'bob@example.org', avatar: '' },
    ]
    const html = draw(<SeenPeopleView settingKey={WORLD_SEEN_KEY} heading="People who also see it" blurb="b"
      ids={['u-ann']} people={people} query="ro" busy={false} onQuery={noop} onRemove={noop} onAdd={noop} />)
    assert.ok(html.includes('People who also see it'))
    assert.ok(html.includes('data-seen-person="u-ann"') && html.includes('aria-label="Remove Ann Lee"'))
    assert.ok(html.includes('data-seen-add="u-bob"') && !html.includes('data-seen-add="u-ann"'))
    const none = draw(<SeenPeopleView settingKey={WORLD_SEEN_KEY} heading="h" blurb="b" ids={[]} people={people}
      query="" busy={false} onQuery={noop} onRemove={noop} onAdd={noop} />)
    assert.ok(none.includes('data-seen-none') && none.includes('Nobody but you.'))
  })
})
