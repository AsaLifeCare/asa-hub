/**
 * BE ANOTHER, ON THIS SIDE — the Profile controls exist only when the server's
 * block names the master (never by a flag the client holds), the band is up on
 * every screen exactly while acting, the tokens cross without the in-memory
 * one ever being swapped mid-crossing, a sign-in answer without the block
 * clears a persisted one, and the person's own doors (password gate, push
 * device, read marks, preferences) stay shut while acting. The doors behind all
 * of it are the server's; they are answered here at `fetch`.
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import { renderToString as renderBare } from 'react-dom/server'
import {
  REAL_TOKEN_KEY, readBeAnother, resetRealRestoreForTests, restoreRealSession, sessionMovedUnderThisTab, useAuthStore,
} from '@/auth/useAuthStore'
import type { AuthUser, BeAnotherBlock } from '@/auth/types'
import BeAnotherControls, {
  BeAnotherControlsView, VIEW_ONLY_NOTE, type AccountsRead,
} from '@/pages/settings/BeAnotherControls'
import { api, outboxEntriesForTests, outboxFlushForTests } from '@/lib/api'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import BeAnotherBar, { BeAnotherBarView } from '@/components/shell/BeAnotherBar'
import { HubStripBar } from '@/components/shell/HubStrip'
import MustChangePasswordGate from '@/features/auth/MustChangePasswordGate'
import { beBack, resetBeAnotherForTests, startActing, type BeAnotherAccount } from '@/lib/beAnother'
import { BE_ANOTHER_VAR, SHELL_OFFSET_VAR, writeShellOffset } from '@/lib/hubStatus'
import { ensurePush, resetPushForTests } from '@/lib/webPush'
import { markNotices } from '@/lib/noticesApi'
import { useMemberStore } from '@/stores/useMemberStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { useWorldStore } from '@/stores/useWorldStore'

const ROOT = resolve(process.cwd())
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')
const TOKEN_KEY = 'asa-hub-token'

const person = (over: Partial<AuthUser>): AuthUser => ({
  id: 'u', name: 'U', email: 'u@example.org', role: 'staff', avatar: '', title: '', types: [], ...over,
})
const STAFF = person({ id: 'u-sam', name: 'Sam', email: 'sam@example.org', role: 'staff', types: ['STAFF'] })
const ADMIN = person({ id: 'u-ada', name: 'Ada', email: 'ada@example.org', role: 'admin', types: ['DIRECTOR'] })
const MASTER = person({ id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', isMaster: true })
const CORA = person({ id: 'u-cora', name: 'Cora', email: 'cora@example.org', role: 'client', types: ['CLIENT'] })

const REAL = { id: 'u-boss', email: 'boss@example.org', display_name: 'Boss' }
const MASTER_BLOCK: BeAnotherBlock = { real: REAL, acting: null }
const ACTING_BLOCK: BeAnotherBlock = {
  real: REAL,
  acting: { id: 'u-cora', email: 'cora@example.org', display_name: 'Cora', role: 'client', types: ['CLIENT'],
            until: new Date(Date.now() + 3_600_000).toISOString(), expires_in_ms: 3_600_000,
            local_until: Date.now() + 3_600_000 },
}

const ACCOUNTS: BeAnotherAccount[] = [
  { id: 'u-cora', display_name: 'Cora', email: 'cora@example.org', role: 'client', types: ['CLIENT'], title: '',
    avatar: '', active: true, home_tenant: '', system_hidden: false },
  { id: 'u-ada', display_name: 'Ada', email: 'ada@example.org', role: 'admin', types: ['DIRECTOR', 'HM'], title: '',
    avatar: '', active: true, home_tenant: '', system_hidden: false },
  { id: 'u-bob', display_name: 'Bob', email: 'bob@example.org', role: 'staff', types: [], title: '',
    avatar: '', active: false, home_tenant: '', system_hidden: false },
]

/** renderToString reads a zustand store's INITIAL state; the screens must see the live one. */
function serveLive(): void {
  Object.assign(useAuthStore.getInitialState(), {
    user: useAuthStore.getState().user, beAnother: useAuthStore.getState().beAnother,
  })
  Object.assign(useMemberStore.getInitialState(), { currentMemberId: useMemberStore.getState().currentMemberId })
  Object.assign(useWorldStore.getInitialState(), { currentWorldId: useWorldStore.getState().currentWorldId })
  const t = useTenantStore.getState()
  Object.assign(useTenantStore.getInitialState(), {
    currentTenantId: t.currentTenantId, homeTenantId: t.homeTenantId, tenantsLoaded: t.tenantsLoaded,
  })
}

/** framer-motion asks the window for listeners the test window does not keep. */
function draw(node: ReactNode): string {
  const g = globalThis as unknown as Record<string, unknown>
  const held = { add: g.addEventListener, remove: g.removeEventListener }
  g.addEventListener = held.add ?? (() => {})
  g.removeEventListener = held.remove ?? (() => {})
  try {
    serveLive()
    return renderBare(node).replace(/<!-- -->/g, '')
  } finally {
    g.addEventListener = held.add
    g.removeEventListener = held.remove
  }
}

function signIn(user: AuthUser | null, beAnother: BeAnotherBlock | null, token: string | null = 'tok-boss'): void {
  useAuthStore.setState({ user, beAnother, token, hydrated: true })
}

function home(): void {
  useTenantStore.setState({ currentTenantId: 'hq', homeTenantId: 'hq', tenantsLoaded: true })
  useWorldStore.setState({ currentWorldId: '' })
  useMemberStore.setState({ currentMemberId: '' } as never)
}

/* ---------- the doors, answered at fetch ---------- */

type Env = { status: number; data?: unknown; message?: string }
type Sent = { url: string; action: string; token: string; payload: unknown }
const sent: Sent[] = []
let answer: (s: Sent) => Env = () => ({ status: 404, message: 'no door here' })
const reply = (env: Env) => new Response(JSON.stringify(env), { status: 200, headers: { 'content-type': 'application/json' } })
const realFetch = globalThis.fetch
const g = globalThis as unknown as { location?: unknown }
let reloads = 0

before(() => {
  globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
    const raw = String(init?.body ?? '').replace(/^body=/, '')
    let body: { action?: string; token?: string; payload?: unknown } = {}
    try { body = JSON.parse(decodeURIComponent(raw)) } catch { body = {} }
    const s = { url: String(url), action: String(body.action ?? ''), token: String(body.token ?? ''), payload: body.payload }
    sent.push(s)
    return reply(answer(s))
  }) as typeof fetch
  g.location = { hash: '', pathname: '/', search: '', reload: () => { reloads++ } }
})
// the location stays stubbed: a crossing's reload lands after the last test
after(() => { globalThis.fetch = realFetch })
beforeEach(() => {
  sent.length = 0
  reloads = 0
  answer = () => ({ status: 404, message: 'no door here' })
  ;(g.location as { hash: string }).hash = ''
  localStorage.clear()
  resetRealRestoreForTests()
  resetBeAnotherForTests()
  home()
})
afterEach(() => signIn(null, null, null))

const settle = async (until: () => boolean) => {
  for (let i = 0; i < 60 && !until(); i++) await new Promise((r) => setTimeout(r, 0))
}

describe('Settings → Profile: the controls exist only when the server named the master', () => {
  for (const [label, user] of [['staff', STAFF], ['an admin who is not the master', ADMIN],
                               ['isMaster:true with no server block', MASTER]] as const) {
    it(`${label}: nothing of Be Another is in the DOM — not hidden, not disabled, absent`, () => {
      signIn(user, null)
      const html = draw(<BeAnotherControls />)
      assert.equal(html, '')
      assert.doesNotMatch(html, /Be Another\?|Be Back/)
    })
  }

  it('the master with the block: "Be Another?" with a dropdown, and "Be Back" idle below it', () => {
    signIn(MASTER, MASTER_BLOCK)
    const html = draw(<BeAnotherControls />)
    assert.match(html, /Be Another\?/)
    assert.match(html, /Choose an account…/)
    assert.match(html, /aria-haspopup="listbox"/)
    assert.ok(html.indexOf('Be Another?') < html.indexOf('>Be Back<'), 'Be Back sits below')
    assert.match(html, /<button type="button" disabled=""[^>]*>Be Back<\/button>/)
    assert.match(html, /You are yourself\./)
  })

  it('while acting: no dropdown, only Be Back — and it is enabled', () => {
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    const html = draw(<BeAnotherControls />)
    assert.doesNotMatch(html, /Choose an account…|aria-haspopup/)
    assert.match(html, /You are acting as <b[^>]*>Cora<\/b>/)
    assert.match(html, /<button type="button" class="[^"]*">Be Back<\/button>/)
    assert.match(html, /Returns this browser to Boss\./)
  })

  it('away from home or inside a visit the dropdown is disabled and says why', () => {
    signIn(MASTER, MASTER_BLOCK)
    useMemberStore.setState({ currentMemberId: 'mem_1' } as never)
    assert.match(draw(<BeAnotherControls />), /Leave the visit first/)
    home()
    useTenantStore.setState({ currentTenantId: 'fr-1', homeTenantId: 'hq', tenantsLoaded: true })
    const away = draw(<BeAnotherControls />)
    assert.match(away, /starts from headquarters/)
    assert.match(away, /<button type="button" disabled="" aria-haspopup="listbox"/)
  })

  const view = (readState: AccountsRead, extra: Partial<Parameters<typeof BeAnotherControlsView>[0]> = {}) => draw(
    <BeAnotherControlsView block={MASTER_BLOCK} blocker="" open read={readState} query="" picked={null} busy=""
                           error="" onToggle={() => {}} onQuery={() => {}} onPick={() => {}} onCancel={() => {}}
                           onConfirm={() => {}} onBack={() => {}} {...extra} />)

  it('the list is every account with its role and badges; a blocked one is drawn but cannot be picked', () => {
    const html = view({ state: 'ready', accounts: ACCOUNTS, ttlMinutes: 120 })
    for (const a of ACCOUNTS) {
      assert.ok(html.includes(a.display_name) && html.includes(a.email), a.email)
    }
    assert.match(html, />CLIENT</)
    assert.match(html, />DIRECTOR</)
    assert.match(html, />HM</)
    assert.match(html, /disabled=""[^>]*>(?:(?!<\/button>).)*Bob(?:(?!<\/button>).)*blocked/s)
    assert.equal((html.match(/role="option"/g) ?? []).length, 3)
  })

  it('a search narrows by name, e-mail or badge', () => {
    const html = view({ state: 'ready', accounts: ACCOUNTS, ttlMinutes: 120 }, { query: 'director' })
    assert.equal((html.match(/role="option"/g) ?? []).length, 1)
    assert.match(html, /ada@example\.org/)
  })

  it('a list that could not be read says so — never an empty list', () => {
    const html = view({ state: 'failed', error: 'beAnotherList timed out.' })
    assert.match(html, /beAnotherList timed out\. There is nobody to pick until the list can be read/)
    assert.doesNotMatch(html, /role="listbox"/)
  })

  it('a pick asks in the page, never a browser dialog', () => {
    const html = view({ state: 'ready', accounts: ACCOUNTS, ttlMinutes: 120 }, { open: false, picked: ACCOUNTS[0] })
    assert.match(html, /Act as <b>Cora<\/b>\? Every tab of this browser becomes them until you press Be Back\./)
    assert.match(html, />Act as Cora<\/button>/)
    assert.ok(!read('src/pages/settings/BeAnotherControls.tsx').includes('window.confirm'))
  })

  it('the Profile section draws it right after the grid that ends with Language, before Log out', () => {
    const src = read('src/pages/SettingsPage.tsx')
    const language = src.indexOf('More languages soon')
    const controls = src.indexOf('<BeAnotherControls />')
    const logout = src.indexOf('Log out', language)
    assert.ok(language !== -1 && controls > language && controls < logout, `${language} ${controls} ${logout}`)
    assert.ok(!/isMaster[^\n]*<BeAnotherControls/.test(src), 'never gated on the client-side master flag')
  })
})

describe('the band: "Acting as <name> — Be Back" on every screen, exactly while acting', () => {
  it('is absent when not acting — for the plain master too', () => {
    signIn(MASTER, MASTER_BLOCK)
    assert.equal(draw(<BeAnotherBar />), '')
    signIn(STAFF, null)
    assert.equal(draw(<BeAnotherBar />), '')
  })

  it('is up while acting: the name, the badges, the clock and Be Back, above every overlay', () => {
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    const html = draw(<BeAnotherBar />)
    assert.match(html, /Acting as <b class="font-bold">Cora<\/b>/)
    assert.match(html, />CLIENT</)
    assert.match(html, /you see exactly what they see · ends \d\d:\d\d/)
    assert.match(html, />Be Back<\/button>/)
    assert.match(html, /role="status"/)
    const z = Number(/z-\[(\d+)\]/.exec(html)?.[1] ?? 0)
    assert.ok(z > 9999, 'above the swapped-session curtain (z-9999)')
    assert.match(html, new RegExp(`height:var\\(${BE_ANOTHER_VAR}`))
  })

  it('is mounted over every route, beside the curtain and the strip', () => {
    const app = read('src/App.tsx')
    assert.ok(app.indexOf('<BeAnotherBar />') > app.indexOf('<HubStrip />') &&
              app.indexOf('<BeAnotherBar />') < app.indexOf('<Routes>'))
  })

  it('one writer moves the shell by both bands, and places each', () => {
    const props: Record<string, string> = {}
    const style = { setProperty: (k: string, v: string) => { props[k] = v }, removeProperty: (k: string) => { delete props[k] } }
    writeShellOffset(style, true, false)
    assert.deepEqual(props, { [SHELL_OFFSET_VAR]: 'calc(22px + env(safe-area-inset-top, 0px))' })
    writeShellOffset(style, false, true)
    assert.deepEqual(props, { [SHELL_OFFSET_VAR]: 'calc(30px + env(safe-area-inset-top, 0px))',
                              [BE_ANOTHER_VAR]: 'calc(30px + env(safe-area-inset-top, 0px))' })
    writeShellOffset(style, true, true)
    assert.equal(props[SHELL_OFFSET_VAR], 'calc(52px + env(safe-area-inset-top, 0px))')
    writeShellOffset(style, false, false)
    assert.deepEqual(props, {})
  })

  it('under the band, the strip stands right below it', () => {
    const under = renderBare(<HubStripBar shown web="" refused={false} onLoad={() => {}} under />)
    assert.match(under, new RegExp(`top:var\\(${BE_ANOTHER_VAR}, 0px\\);height:22px;padding-top:0`))
    const alone = renderBare(<HubStripBar shown web="" refused={false} onLoad={() => {}} />)
    assert.doesNotMatch(alone, new RegExp(BE_ANOTHER_VAR))
  })

  it('the view keeps its button live and its words exact', () => {
    const html = renderBare(<BeAnotherBarView acting={ACTING_BLOCK.acting!} busy={false} onBack={() => {}} />)
    assert.match(html, /<button type="button" class="[^"]*">.*Be Back<\/button>/s)
  })
})

describe('the auth answers decide the block — a stale or forged copy never survives the next one', () => {
  it('reads the block strictly', () => {
    assert.equal(readBeAnother(undefined), null)
    assert.equal(readBeAnother({ acting: { id: 'u-cora' } }), null, 'no real account, no block')
    assert.deepEqual(readBeAnother({ real: REAL, acting: null }), { real: REAL, acting: null })
    const b = readBeAnother({ real: REAL, acting: { id: 'u-cora', display_name: 'Cora', role: 'client',
                                                    types: ['CLIENT'], until: 'x', expires_in_ms: 60_000 } })
    assert.ok(b?.acting && b.acting.local_until > Date.now() + 50_000 && b.acting.local_until < Date.now() + 70_000)
  })

  it('a sign-in answer without the block clears a persisted one', async () => {
    useAuthStore.setState({ beAnother: ACTING_BLOCK })
    answer = (s) => s.action === 'authLogin'
      ? { status: 200, data: { token: 'tok-sam', user: { id: 'u-sam', email: 'sam@example.org', role: 'staff' } } }
      : { status: 200, data: { user: { id: 'u-sam' } } }
    assert.equal(await useAuthStore.getState().login('sam@example.org', 'pw'), null)
    assert.equal(useAuthStore.getState().beAnother, null)
  })

  it('the master\'s sign-in carries it; a boot answer replaces it either way', async () => {
    localStorage.setItem(REAL_TOKEN_KEY, 'stale-real')
    answer = () => ({ status: 200, data: { token: 'tok-boss', user: { id: 'u-boss', email: 'boss@example.org',
                                                                     role: 'admin', is_master: true },
                                           be_another: { real: REAL, acting: null } } })
    await useAuthStore.getState().login('boss@example.org', 'pw')
    assert.deepEqual(useAuthStore.getState().beAnother, MASTER_BLOCK)
    assert.equal(localStorage.getItem(REAL_TOKEN_KEY), null, 'a fresh sign-in holds no real token beside it')
    answer = () => ({ status: 200, data: { user: { id: 'u-boss', role: 'admin' } } })
    useAuthStore.setState({ token: 'tok-boss' })
    await useAuthStore.getState().bootstrap()
    assert.equal(useAuthStore.getState().beAnother, null)
  })
})

describe('the crossing: start and Be Back', () => {
  it('start: the child waits in the token key, the real token beside it; the in-memory token is never swapped', async () => {
    signIn(MASTER, MASTER_BLOCK, 'tok-boss')
    answer = (s) => s.action === 'beAnotherStart'
      ? { status: 200, data: { token: 'tok-child', user: { id: 'u-cora', display_name: 'Cora' },
                               be_another: { real: REAL, acting: { id: 'u-cora' } } } }
      : { status: 404, message: 'no' }
    await startActing('u-cora')
    const start = sent.find((s) => s.action === 'beAnotherStart')
    assert.ok(start && start.token === 'tok-boss' && (start.payload as { id?: string }).id === 'u-cora')
    assert.equal(localStorage.getItem(TOKEN_KEY), 'tok-child')
    assert.equal(localStorage.getItem(REAL_TOKEN_KEY), 'tok-boss')
    assert.equal(useAuthStore.getState().token, 'tok-boss', 'nothing reacts to a swap before the reload')
    assert.equal(useAuthStore.getState().user, null, 'nobody is painted under the wrong token')
    assert.equal((g.location as { hash: string }).hash, '#/apps')
  })

  it('start is refused here, before any door, from inside a visit or while acting', async () => {
    signIn(MASTER, MASTER_BLOCK)
    useMemberStore.setState({ currentMemberId: 'mem_1' } as never)
    await assert.rejects(startActing('u-cora'), /Leave the visit first/)
    home()
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    await assert.rejects(startActing('u-ada'), /press Be Back first/)
    signIn(STAFF, null)
    await assert.rejects(startActing('u-ada'), /master account alone/)
    assert.ok(!sent.some((s) => s.action.startsWith('beAnother')), sent.map((s) => s.action).join())
  })

  it('Be Back ends the child on the server, puts the real token back, resets the place and reboots', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-child')
    localStorage.setItem(REAL_TOKEN_KEY, 'tok-boss')
    localStorage.setItem('asa-tenant', '{"state":{"currentTenantId":"fr-1"}}')
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    answer = (s) => s.action === 'beAnotherStop' ? { status: 200, data: { ok: true } } : { status: 404 }
    await beBack()
    await settle(() => (g.location as { hash: string }).hash === '#/apps')
    const stop = sent.find((s) => s.action === 'beAnotherStop')
    assert.ok(stop && stop.token === 'tok-child', 'the stop travels as the child')
    assert.equal(localStorage.getItem(TOKEN_KEY), 'tok-boss')
    assert.equal(localStorage.getItem(REAL_TOKEN_KEY), null)
    assert.equal(useAuthStore.getState().user, null, 'the target is never painted under the master token')
    assert.equal(useAuthStore.getState().beAnother, null)
    assert.equal(localStorage.getItem('asa-tenant'), null, 'the place was reset')
    assert.equal((g.location as { hash: string }).hash, '#/apps', 'and the tab reboots')
  })

  it('a Be Back the server did not confirm still goes back, and says when the session ends by itself', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-child')
    localStorage.setItem(REAL_TOKEN_KEY, 'tok-boss')
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    answer = () => ({ status: 503, message: 'Backend unreachable' })
    await beBack()
    assert.equal(localStorage.getItem(TOKEN_KEY), 'tok-boss')
    assert.match(String(localStorage.getItem('asa-be-another-note')), /ends by itself at \d\d:\d\d/)
  })

  it('an acting session that died (a 401) is a Be Back, not a sign-out', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-child')
    localStorage.setItem(REAL_TOKEN_KEY, 'tok-boss')
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    useAuthStore.getState().clearSession()
    assert.equal(localStorage.getItem(TOKEN_KEY), 'tok-boss')
    assert.equal(localStorage.getItem(REAL_TOKEN_KEY), null)
    assert.equal(useAuthStore.getState().beAnother, null)
  })

  it('signing out while acting signs out both sessions', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-child')
    localStorage.setItem(REAL_TOKEN_KEY, 'tok-boss')
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    useAuthStore.getState().logout()
    await settle(() => sent.filter((s) => s.action === 'authLogout').length >= 2)
    const outs = sent.filter((s) => s.action === 'authLogout').map((s) => s.token).sort()
    assert.deepEqual(outs, ['tok-boss', 'tok-child'])
    assert.equal(localStorage.getItem(TOKEN_KEY), null)
    assert.equal(localStorage.getItem(REAL_TOKEN_KEY), null)
    assert.ok(!sent.some((s) => s.action === 'prefsSet'), 'nothing is pushed in their name')
  })
})

describe('every tab agrees: a tab left behind follows the session another tab set, and signs nobody out', () => {
  it('its own expiry clock firing after another tab went back keeps the restored master token', async () => {
    // tab A already went back: the stored token is the master's and no real token is held beside it
    localStorage.setItem(TOKEN_KEY, 'tok-boss')
    signIn(CORA, ACTING_BLOCK, 'tok-child')     // this tab: the ended child, still in memory
    assert.equal(sessionMovedUnderThisTab(), true)
    await beBack({ expired: true })
    await settle(() => (g.location as { hash: string }).hash === '#/apps')
    assert.equal(localStorage.getItem(TOKEN_KEY), 'tok-boss', 'the master token another tab restored survives')
    assert.ok(!sent.some((s) => s.action === 'authLogout' || s.action === 'beAnotherStop'),
              sent.map((s) => s.action).join())
    assert.equal((g.location as { hash: string }).hash, '#/apps', 'it follows with a reboot, not to the sign-in')
  })

  it('a 401 for the ended child in that tab is not a sign-out either', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-boss')
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    useAuthStore.getState().clearSession()
    await settle(() => (g.location as { hash: string }).hash === '#/apps')
    assert.equal(localStorage.getItem(TOKEN_KEY), 'tok-boss')
    assert.equal((g.location as { hash: string }).hash, '#/apps')
  })

  it('the tab crossing back ignores a sign-out or a 401 until its own reload', () => {
    localStorage.setItem(TOKEN_KEY, 'tok-child')
    localStorage.setItem(REAL_TOKEN_KEY, 'tok-boss')
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    assert.ok(restoreRealSession('Back to your own account…'))
    useAuthStore.getState().logout()
    useAuthStore.getState().clearSession()
    assert.equal(localStorage.getItem(TOKEN_KEY), 'tok-boss')
    assert.ok(!sent.some((s) => s.action === 'authLogout'))
  })

  it('a Log out pressed in a tab left behind ends the session the other tab set as well', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-boss')
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    useAuthStore.getState().logout()
    await settle(() => sent.filter((s) => s.action === 'authLogout').length >= 2)
    assert.deepEqual(sent.filter((s) => s.action === 'authLogout').map((s) => s.token).sort(), ['tok-boss', 'tok-child'])
    assert.equal(localStorage.getItem(TOKEN_KEY), null)
  })

  it('one tab, one session: nothing moved when the stored token is the one in memory', () => {
    localStorage.setItem(TOKEN_KEY, 'tok-boss')
    signIn(MASTER, MASTER_BLOCK, 'tok-boss')
    assert.equal(sessionMovedUnderThisTab(), false)
  })
})

describe('the browser write outbox waits for the hand that queued it', () => {
  const OUTBOX = 'asa:write-outbox'
  const FP = 'asa:pending-fp'
  const entry = (pendingId: string, uid?: string, realUid?: string) => ({
    key: `tasks:${pendingId}`, resource: 'tasks', pendingId, kind: 'update', patch: { title: pendingId },
    fingerprint: { title: 'old' }, queuedAt: new Date().toISOString(), strikes: 0,
    ...(uid === undefined ? {} : { uid }), ...(realUid ? { realUid } : {}),
  })
  const seed = () => {
    const at = new Date().toISOString()
    localStorage.setItem(FP, JSON.stringify({
      'tasks:pending-m': { v: { title: 'old' }, at, realId: 'T_M' },
      'tasks:pending-c': { v: { title: 'old' }, at, realId: 'T_C' },
      'tasks:pending-l': { v: { title: 'old' }, at, realId: 'T_L' },
    }))
    localStorage.setItem(OUTBOX, JSON.stringify([
      entry('pending-m', 'u-boss', ''),        // the master, as themselves, before the start
      entry('pending-c', 'u-cora', 'u-boss'),  // typed while wearing Cora
      entry('pending-l'),                       // written by an older build: nobody named
    ]))
    useApiConfigStore.setState({ driver: 'apps-script' })
    answer = (s) => s.action === 'update'
      ? { status: 200, data: { id: (s.payload as { id?: string }).id } }
      : { status: 404, message: 'no door here' }
  }
  const updates = () => sent.filter((s) => s.action === 'update')
    .map((s) => [s.token, (s.payload as { id?: string }).id])
  const left = () => outboxEntriesForTests().map((e) => e.pendingId).sort()

  it('after Be Back the master sends only what the master queued — never what was typed while acting', async () => {
    seed()
    signIn(MASTER, MASTER_BLOCK, 'tok-boss')
    await outboxFlushForTests()
    assert.deepEqual(updates(), [['tok-boss', 'T_M']])
    assert.deepEqual(left(), ['pending-c'], 'the acting edit waits; the unnamed one is buried with its toast')
  })

  it('while acting, only what was queued wearing that same account lands — under the acting token', async () => {
    seed()
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    await outboxFlushForTests()
    assert.deepEqual(updates(), [['tok-child', 'T_C']])
    assert.deepEqual(left(), ['pending-m'], 'the master\'s own edit waits for the master')
  })

  it('the account signed in as itself never replays what the master typed wearing it', async () => {
    seed()
    signIn(CORA, null, 'tok-cora')
    await outboxFlushForTests()
    assert.deepEqual(updates(), [])
    assert.deepEqual(left(), ['pending-c', 'pending-m'])
  })

  it('nothing is sent before the boot has said who the token is', async () => {
    seed()
    useAuthStore.setState({ user: MASTER, beAnother: MASTER_BLOCK, token: 'tok-boss', hydrated: false })
    await outboxFlushForTests()
    assert.deepEqual(updates(), [])
    assert.equal(outboxEntriesForTests().length, 3)
  })

  it('an edit queued while acting is stamped with both accounts', async () => {
    useApiConfigStore.setState({ driver: 'apps-script' })
    localStorage.setItem(FP, JSON.stringify({ 'tasks:pending-q': { v: { title: 'old' }, at: new Date().toISOString() } }))
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    await api.update('tasks', 'pending-q', { title: 'new' })
    const [queued] = outboxEntriesForTests()
    assert.ok(queued && queued.uid === 'u-cora' && queued.realUid === 'u-boss', JSON.stringify(queued))
    localStorage.removeItem(OUTBOX)
  })
})

describe('while acting, the person\'s own doors stay shut on this side too', () => {
  it('the Profile note says which screens are view-only, and that the last seconds before Be Back may not land', () => {
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    const html = draw(<BeAnotherControls />)
    assert.ok(html.includes(VIEW_ONLY_NOTE), html)
    assert.match(VIEW_ONLY_NOTE, /time off, shift requests and handoffs, house calendars/)
    assert.match(VIEW_ONLY_NOTE, /last seconds before Be Back may not land/)
    signIn(MASTER, MASTER_BLOCK)
    assert.ok(draw(<BeAnotherControls />).includes('are view-only'), 'the master reads it before starting too')
  })

  it('the password gate never opens over the master', () => {
    signIn({ ...CORA, mustChangePassword: true }, ACTING_BLOCK, 'tok-child')
    assert.doesNotMatch(draw(<MustChangePasswordGate />), /password/i)
    signIn({ ...CORA, mustChangePassword: true }, null, 'tok-cora')
    assert.match(draw(<MustChangePasswordGate />), /password/i, 'the same account signed in as itself still gets it')
  })

  it('the push device stays the master\'s: nothing is subscribed, nothing is asked', async () => {
    resetPushForTests()
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    const got = await ensurePush({ force: true })
    assert.equal(got.state, 'not-allowed')
    assert.match(got.why, /acting as another account/)
    assert.ok(!sent.some((s) => s.url.includes('/push/')), sent.map((s) => s.url).join())
  })

  it('their read marks stay theirs: refused before the relay, so the row comes back unread', async () => {
    signIn(CORA, ACTING_BLOCK, 'tok-child')
    await assert.rejects(markNotices([41]), /read marks stay their own/)
    assert.ok(!sent.some((s) => s.url.includes('/notices/read')), sent.map((s) => s.url).join())
  })

  it('opening their chat thread never marks it read', () => {
    assert.match(read('src/pages/features/chat/ChatPage.tsx'), /if \(!isActing\(\)\) \{\s*void gasAction\('chatMarkRead'/)
  })

  it('the tour, the notification card and the preference push step aside', () => {
    assert.match(read('src/features/auth/FirstLoginTour.tsx'), /!visiting && !acting &&/)
    assert.match(read('src/features/auth/NotificationAsk.tsx'), /const open = !acting && /)
    const prefs = read('src/lib/prefsSync.ts')
    assert.match(prefs, /if \(isActing\(\)\) return\s*markDirty\(\)/)
    assert.match(prefs, /wearing another account: this browser's preferences[^\n]*\n\s*if \(isActing\(\)\) return/)
  })
})
