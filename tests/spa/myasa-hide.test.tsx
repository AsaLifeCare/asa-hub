/**
 * SETTINGS > MY WORK, MY ASA. AND BOOKMARKS: the session's own `my_asa` decides both. An account it says no to has
 * no My asa. app anywhere the access checker answers, no Bookmarks link and no bookmark toggle, and an address to
 * either leaves for My Work; its saved bookmarks stay. The master and an account it says yes to keep all of it, and
 * a backend that does not send the answer changes nothing.
 */
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { mapBackendUser, useAuthStore, type BackendUser } from '@/auth/useAuthStore'
import BookmarkButton from '@/components/shared/BookmarkButton'
import { isAllowedWith } from '@/lib/appAccess'
import { MYASA_APP_ID, MYASA_ELSEWHERE, myAsaOffered, myAsaOfferedTo } from '@/lib/myAsaOffered'
import { MASTER_ONLY_SECTIONS } from '@/lib/settingsNav'
import { ActionsMenu } from '@/pages/features/staffprofiles/StaffActions'
import { MYASA_HIDE_KEY, MYASA_SEEN_KEY, MyAsaHideView } from '@/pages/settings/MyAsaHideBody'
import { useBookmarksStore } from '@/stores/useBookmarksStore'
import { useRegistryStore } from '@/stores/useRegistryStore'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const noop = () => {}
const src = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

const backend = (over: Partial<BackendUser>): BackendUser =>
  ({ id: 'u-bob', email: 'bob@example.org', display_name: 'Bob Roe', role: 'staff', ...over }) as BackendUser
const BOB = mapBackendUser(backend({ my_asa: false }))
const ANN = mapBackendUser(backend({ id: 'u-ann', email: 'ann@example.org', display_name: 'Ann Lee', my_asa: true }))
const OLD = mapBackendUser(backend({ id: 'u-old', email: 'old@example.org', display_name: 'Old Backend' }))
const BOSS = mapBackendUser(backend({ id: 'u-boss', email: 'boss@example.org', display_name: 'Boss', role: 'admin',
  is_master: true, my_asa: true }))

afterEach(() => {
  useAuthStore.setState({ user: null, token: null, hydrated: false } as never)
  useBookmarksStore.setState({ bookmarks: [] })
})

const signIn = (user: typeof BOB) => useAuthStore.setState({ user, token: `tok-${user.id}`, hydrated: true } as never)
const PIN = { type: 'person' as const, refId: 'p1', title: 'Pat', tint: 'blue' as const, href: '/app/users/accounts' }

describe('the session decides', () => {
  it('my_asa false reads as not offered; true, absent and the master read as offered', () => {
    assert.equal(BOB.myAsa, false)
    assert.equal(myAsaOfferedTo(BOB), false)
    assert.equal(myAsaOfferedTo(ANN), true)
    assert.equal(myAsaOfferedTo(OLD), true, 'a backend that does not send it changes nothing')
    assert.equal(myAsaOfferedTo(BOSS), true)
    assert.equal(myAsaOfferedTo({ isMaster: true, myAsa: false }), true)
    signIn(BOB)
    assert.equal(myAsaOffered(), false)
    signIn(ANN)
    assert.equal(myAsaOffered(), true)
  })

  it('the one access checker shuts My asa. for an account it says no to and nobody else', () => {
    const apps = useRegistryStore.getState().apps
    assert.ok(apps.some((a) => a.id === MYASA_APP_ID))
    const opens = (user: typeof BOB) => { signIn(user); return isAllowedWith(apps, user.role, MYASA_APP_ID) }
    assert.equal(opens(BOB), false)
    assert.equal(opens(ANN), true)
    assert.equal(opens(BOSS), true)
  })
})

describe('bookmarks', () => {
  it('no star is drawn for an account it says no to, and its saved bookmarks are left alone', () => {
    useBookmarksStore.getState().toggle(PIN)
    signIn(BOB)
    const star = src('src/components/shared/BookmarkButton.tsx')
    assert.ok(star.includes('const offered = useMyAsaOffered()') && star.includes('if (!offered) return null'))
    assert.equal(useBookmarksStore.getState().bookmarks.length, 1, 'nothing was deleted')
    assert.equal(typeof BookmarkButton, 'function')
  })

  it('the staff favorite is a bookmark and leaves with them; the rest of the menu stays', () => {
    // a signed-out draw is the shipped answer: the favorite is there
    assert.ok(draw(<ActionsMenu favorite={false} onPick={noop} onFavorite={noop} />).includes('data-action="favorite"'))
    const menu = src('src/pages/features/staffprofiles/StaffActions.tsx')
    assert.ok(menu.includes("groups.map((g) => ({ ...g, items: g.items.filter((i) => 'ask' in i) })).filter((g) => g.items.length > 0)"))
    assert.ok(menu.includes('const groups = useMenuGroups(staffKey)') && menu.includes('{anyItem && <div ref={box}'))
  })

  it('the rail, the palette, the widget menu and the route all ask the same answer', () => {
    assert.ok(src('src/components/shell/Sidebar.tsx').includes('!useWorldStore.getState().currentWorldId && bookmarksOffered && <NavLink'))
    assert.ok(src('src/components/shell/CommandPalette.tsx').includes("bookmarksOffered ? list : list.filter((a) => a.id !== 'bookmarks')"))
    assert.ok(src('src/engine/templates/dashboard/WidgetMenu.tsx').includes('{bookmarksOffered && ('))
    const app = src('src/App.tsx')
    assert.ok(app.includes('<Route path="/bookmarks" element={<BookmarksRoute />} />'))
    assert.ok(app.includes('return offered ? <BookmarksPage /> : <NotOfferedRedirect />'))
  })
})

describe('my asa.', () => {
  it('its address leaves for My Work, and the avatar menu does not offer it', () => {
    assert.equal(MYASA_ELSEWHERE, '/app/my-work/actions')
    const page = src('src/pages/AppRoutePage.tsx')
    assert.ok(page.includes('if (appId === MYASA_APP_ID && !myAsa && !activeWorldId()) return <NotOfferedRedirect />'))
    const topbar = src('src/components/shell/Topbar.tsx')
    assert.equal((topbar.match(/&& canMyAsa && \(/g) ?? []).length, 2)
  })
})

describe('the switch in Settings > My Work', () => {
  it('is drawn inside the master-only section and saves through the master-only door', () => {
    assert.ok(MASTER_ONLY_SECTIONS.includes('mywork'))
    assert.ok(src('src/pages/settings/MyWorkDisplaySection.tsx').includes('<MyAsaHideBody />'))
    const body = src('src/pages/settings/MyAsaHideBody.tsx')
    assert.match(body, /gasAction\('hiringAlertsSet', \{ values: \{ \[MYASA_HIDE_KEY\]: next \? 'yes' : 'no' \} \}\)/)
    assert.ok(body.includes('<SeenPeopleBody settingKey={MYASA_SEEN_KEY} heading="People who also see them"'))
    assert.ok(body.includes('These accounts keep My asa. and their Bookmarks exactly as they are. Nobody is told the list exists.'))
    assert.equal(MYASA_HIDE_KEY, 'mywork_hide_myasa')
    assert.equal(MYASA_SEEN_KEY, 'mywork_hide_myasa_seen')
  })

  it('offers a switch only once the backend knows the key', () => {
    const on = draw(<MyAsaHideView on known busy={false} onFlip={noop} />)
    assert.ok(on.includes('My asa. and Bookmarks — hidden from everyone else'))
    assert.equal((on.match(/role="switch"/g) ?? []).length, 1)
    assert.match(on, /data-myasa-hide-word="true">Hidden from everyone else</)
    const off = draw(<MyAsaHideView on={false} known busy={false} onFlip={noop} />)
    assert.match(off, /data-myasa-hide-word="true">Shown to everyone</)
    const unknown = draw(<MyAsaHideView on={false} known={false} busy={false} onFlip={noop} />)
    assert.ok(unknown.includes('data-myasa-not-known') && !unknown.includes('role="switch"'))
  })
})
