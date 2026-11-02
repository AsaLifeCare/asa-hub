/**
 * FORGOT PASSWORD, ON THIS SIDE — the ask from the sign-in page goes out with
 * no session and takes any sign-in (an address or a number), the screen gives
 * one answer whatever came back, and a sign-in with the temporary password
 * lands on a PAGE that owns the window until the person has a password of
 * their own: never a modal, never closed by anything but the server's yes.
 * The doors behind it are answered here at `fetch`.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { useAuthStore } from '@/auth/useAuthStore'
import type { AuthUser } from '@/auth/types'
import MustChangePasswordGate from '@/features/auth/MustChangePasswordGate'
import {
  CHOOSE_PASSWORD_WHY, FORGOT_ANSWER, askForTemporaryPassword, saveOwnPassword,
} from '@/features/auth/passwordReset'
import { COPYRIGHT } from '@/components/shared/SiteFooter'

const ROOT = resolve(process.cwd())
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')

const PAT: AuthUser = {
  id: 'u-pat', name: 'Pat', email: 'pat@example.org', role: 'staff', avatar: '', title: '', types: [],
}

type Env = { status: number; data?: unknown; message?: string }
type Sent = { action: string; token: string; payload: Record<string, unknown>; hasToken: boolean }
const sent: Sent[] = []
let answer: (s: Sent) => Env | 'throw' = () => ({ status: 200, data: { sent: true } })
const realFetch = globalThis.fetch

before(() => {
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const raw = String(init?.body ?? '').replace(/^body=/, '')
    let body: { action?: string; token?: string; payload?: Record<string, unknown> } = {}
    try { body = JSON.parse(decodeURIComponent(raw)) } catch { body = {} }
    const s: Sent = { action: String(body.action ?? ''), token: String(body.token ?? ''),
                      payload: body.payload ?? {}, hasToken: 'token' in body }
    sent.push(s)
    const got = answer(s)
    if (got === 'throw') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(got), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => {
  sent.length = 0
  answer = () => ({ status: 200, data: { sent: true } })
})

function signIn(user: AuthUser | null, token: string | null = 'tok-pat'): void {
  useAuthStore.setState({ user, beAnother: null, token, hydrated: true })
}

/** renderToString reads a zustand store's INITIAL state; the page must see the live one. */
function draw(node: ReactNode): string {
  Object.assign(useAuthStore.getInitialState(), {
    user: useAuthStore.getState().user, beAnother: useAuthStore.getState().beAnother,
  })
  const g = globalThis as unknown as Record<string, unknown>
  const held = { add: g.addEventListener, remove: g.removeEventListener }
  g.addEventListener = held.add ?? (() => {})
  g.removeEventListener = held.remove ?? (() => {})
  try {
    return renderToString(node).replace(/<!-- -->/g, '')
  } finally {
    g.addEventListener = held.add
    g.removeEventListener = held.remove
  }
}

describe('the ask from the sign-in page', () => {
  it('goes out as authForgot with no session, even while this browser still holds a token', async () => {
    signIn(null, 'tok-stale')
    await askForTemporaryPassword('  Pat@Example.org ')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].action, 'authForgot')
    assert.equal(sent[0].hasToken, false, 'a stale token must never turn the ask into "Session expired"')
    assert.deepEqual(sent[0].payload, { identifier: 'Pat@Example.org' })
  })

  it('takes the number a number-only account signs in with', async () => {
    await askForTemporaryPassword('3305550143')
    assert.deepEqual(sent[0].payload, { identifier: '3305550143' })
    const form = read('src/pages/LoginPage.tsx')
    const forgot = form.slice(form.indexOf('function ForgotForm'), form.indexOf('export default function LoginPage'))
    assert.match(forgot, /type="text"/, 'an e-mail-only field would refuse a number')
    assert.doesNotMatch(forgot, /type="email"/)
  })

  it('settles the same whatever came back — sent, refused, a failure or no network at all', async () => {
    for (const reply of [
      () => ({ status: 200, data: { sent: true } }),
      () => ({ status: 500, message: 'Internal error' }),
      () => ({ status: 429, message: 'Too many attempts' }),
      () => 'throw' as const,
    ]) {
      answer = reply
      assert.equal(await askForTemporaryPassword('pat@example.org'), undefined)
    }
    const form = read('src/pages/LoginPage.tsx')
    const forgot = form.slice(form.indexOf('function ForgotForm'), form.indexOf('export default function LoginPage'))
    assert.match(forgot, /await askForTemporaryPassword\(ident\)\s*setBusy\(false\)\s*setSent\(true\)/,
      'the form reads nothing back from the ask')
    assert.match(forgot, /\{FORGOT_ANSWER\}/)
    assert.doesNotMatch(forgot, /reset link/i)
  })

  it('the one answer names both ways the temporary password travels and never says whether an account exists', () => {
    assert.match(FORGOT_ANSWER, /^If that sign-in belongs to an account/)
    assert.match(FORGOT_ANSWER, /temporary password/)
    assert.match(FORGOT_ANSWER, /by e-mail to the address on the account/)
    assert.match(FORGOT_ANSWER, /by text to the phone on the account/)
    assert.match(FORGOT_ANSWER, /works once/)
  })
})

describe('the temporary password lands on a page, never a modal', () => {
  it('is a page over the whole window: its own heading and footer, no dialog, no dimmed backdrop', () => {
    signIn({ ...PAT, mustChangePassword: true })
    const html = draw(<MustChangePasswordGate />)
    assert.match(html, /<h1[^>]*id="must-change-title"[^>]*>Choose your password<\/h1>/)
    assert.match(html, /aria-labelledby="must-change-title"/)
    assert.match(html, /fixed inset-0/)
    assert.match(html, /bg-bg/)
    assert.ok(html.includes(COPYRIGHT), 'a page ends with the footer line')
    assert.ok(html.includes(CHOOSE_PASSWORD_WHY))
    assert.doesNotMatch(html, /role="dialog"/)
    assert.doesNotMatch(html, /aria-modal/)
    assert.doesNotMatch(html, /bg-black\//)
    assert.match(html, /Save and continue/)
    assert.match(html, /Sign out instead/)
  })

  it('stands only while the server demands the change', () => {
    signIn({ ...PAT, mustChangePassword: false })
    assert.equal(draw(<MustChangePasswordGate />), '')
    signIn({ ...PAT })
    assert.equal(draw(<MustChangePasswordGate />), '')
  })

  it('makes the shell behind it unreachable while it stands, and has no close button', () => {
    const src = read('src/features/auth/MustChangePasswordGate.tsx')
    assert.match(src, /setAttribute\('inert', ''\)/)
    assert.match(src, /removeAttribute\('inert'\)/)
    assert.doesNotMatch(src, /aria-label="Close"|onEscape|onPointerDownOutside|DialogShell/)
  })

  it('a short password and a mismatch are refused here, and nothing is sent', async () => {
    signIn({ ...PAT, mustChangePassword: true })
    assert.deepEqual(await saveOwnPassword('short', 'short'),
      { ok: false, error: 'Your password needs at least 8 characters.' })
    assert.deepEqual(await saveOwnPassword('long-enough-1', 'long-enough-2'),
      { ok: false, error: 'The two passwords do not match.' })
    assert.equal(sent.length, 0)
    assert.equal(useAuthStore.getState().user?.mustChangePassword, true)
  })

  it('the server\'s yes saves the password through the profile door and lifts the demand', async () => {
    signIn({ ...PAT, mustChangePassword: true })
    answer = () => ({ status: 200, data: { ok: true } })
    assert.deepEqual(await saveOwnPassword('My-Own-Pass-9', 'My-Own-Pass-9'), { ok: true })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].action, 'profileUpdate')
    assert.equal(sent[0].token, 'tok-pat', 'the change rides the session the temporary password opened')
    assert.deepEqual(sent[0].payload, { password: 'My-Own-Pass-9' })
    assert.equal(useAuthStore.getState().user?.mustChangePassword, false)
    assert.equal(draw(<MustChangePasswordGate />), '', 'the page is gone once the password is theirs')
  })

  it('a refusal keeps the page standing with the server\'s own words', async () => {
    signIn({ ...PAT, mustChangePassword: true })
    answer = () => ({ status: 503, message: 'Another update is in progress — try again.' })
    const got = await saveOwnPassword('My-Own-Pass-9', 'My-Own-Pass-9')
    assert.equal(got.ok, false)
    assert.match(got.ok ? '' : got.error, /Another update is in progress/)
    assert.equal(useAuthStore.getState().user?.mustChangePassword, true)
    assert.match(draw(<MustChangePasswordGate />), /Choose your password/)
  })

  it('the shell still mounts it over every route, before the tour', () => {
    const layout = read('src/components/Layout.tsx')
    assert.ok(layout.indexOf('<MustChangePasswordGate />') > 0 &&
      layout.indexOf('<MustChangePasswordGate />') < layout.indexOf('<FirstLoginTour />'))
  })
})
