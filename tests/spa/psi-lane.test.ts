/**
 * PSI LOG'S LANES, READ BY THE PSI PAGES — a refusal keeps its reason and status, and only PsiAnywhere's own
 * sign-out sends a page back to the PsiAnywhere sign-in card: a 401 whose reason is 'session' is the Hub's own
 * sign-in (the gate's "sign in first") and is said as it is. The platform's stored accounts (the one click) are the
 * master's alone: a lane that names none draws no one click and pre-fills no name. Answered here at `fetch`.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useAuthStore } from '@/auth/useAuthStore'
import { psiLane, PsiLaneError, signedOut } from '@/pages/features/psi/psiLane'
import { psiViewFrom } from '@/pages/features/psi/PsiLogPage'

let envelope: unknown = { status: 200, data: {} }
const realFetch = globalThis.fetch

before(() => {
  globalThis.fetch = (async () => new Response(JSON.stringify(envelope), {
    status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
})
after(() => { globalThis.fetch = realFetch })
beforeEach(() => {
  useAuthStore.setState({ user: null, beAnother: null, token: 'tok-pat', hydrated: true })
})

async function refusal(env: unknown): Promise<unknown> {
  envelope = env
  try {
    await psiLane('/hub-lanes/psi-log')
  } catch (e) {
    return e
  }
  return null
}

describe('a PSI lane refusal', () => {
  it('keeps the lane reason and status', async () => {
    const e = await refusal({ status: 401, reason: 'signed-out', message: 'Your PsiAnywhere session ended — sign in again.' })
    assert.ok(e instanceof PsiLaneError)
    assert.equal(e.reason, 'signed-out')
    assert.equal(e.status, 401)
    assert.equal(e.message, 'Your PsiAnywhere session ended — sign in again.')
  })

  it("PsiAnywhere's own sign-out is a signed-out (the reason, or a 401 that names another reason)", async () => {
    assert.equal(signedOut(await refusal({ status: 401, reason: 'signed-out', message: 'ended' })), true)
    assert.equal(signedOut(await refusal({ status: 409, reason: 'signed-out', message: 'Sign in to PsiAnywhere first.' })), true)
    assert.equal(signedOut(await refusal({ status: 401, message: 'ended' })), true)
  })

  it("the Hub's own 401 (reason 'session') is not PsiAnywhere's sign-out", async () => {
    const e = await refusal({ status: 401, reason: 'session', message: 'sign in first' })
    assert.ok(e instanceof PsiLaneError)
    assert.equal(signedOut(e), false)
    assert.equal(signedOut(new PsiLaneError('sign in first', 'session', 401)), false)
  })

  it('a refusal of the platform accounts to someone not the master is not a sign-out', async () => {
    const e = await refusal({ status: 403, reason: 'master-only', message: "The platform's stored PsiAnywhere accounts sign in for the master alone." })
    assert.equal(signedOut(e), false)
    assert.equal(signedOut(new Error('plain')), false)
  })
})

describe('the one click, the master alone', () => {
  const base = { signedIn: false, needsCode: false, attest: '', log: [], everyone: null }

  it('a lane with no stored accounts gives the page none and no pre-filled name', () => {
    const v = psiViewFrom(base)
    assert.ok(v)
    assert.deepEqual(v.platformAccounts, [])
    assert.equal(v.prefill, '')
  })

  it("the master's lane names them", () => {
    const v = psiViewFrom({ ...base, prefill: 'ADM', platformAccounts: [{ account: 'adm', label: 'ADM', user: 'ADM' }] })
    assert.equal(v?.platformAccounts?.length, 1)
    assert.equal(v?.prefill, 'ADM')
  })

  it('the page draws the one click and the stored-password sign-in only from the lane accounts', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/features/psi/PsiLogPage.tsx'), 'utf8')
    assert.match(src, /\{\(view\.platformAccounts\?\.length \?\? 0\) > 0 && \(/)
    assert.match(src, /const knownAccount = view\?\.platformAccounts\?\.find\(/)
    assert.match(src, /disabled=\{busy \|\| !username\.trim\(\) \|\| \(!password && !knownAccount\)\}/)
    assert.match(src, /if \(!got\.signedIn && got\.prefill\) setUsername/)
  })
})
