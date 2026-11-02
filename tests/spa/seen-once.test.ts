/**
 * THE PLAYGROUND INTRO AND THE WORLD WELCOME ASK THE SHELF ONLY ONCE THE PULL
 * HAS LANDED (lib/seenOnce), so the release's promise holds: a browser still
 * holding the released person's id does not hide the explainer for the visit,
 * and a browser that never had the mark does not flash one already seen.
 *
 * The hook is mounted by React's client renderer; "the pull landed" is the
 * signal prefsSync itself raises (lib/prefsSettled).
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { useAuthStore } from '@/auth/useAuthStore'
import { markSettled } from '@/lib/prefsSettled'
import { seenIdsOf, useSeenOnce } from '@/lib/seenOnce'
import { mountHook } from './react-host'

const KEY = 'asa-playground-intro-seen'
let n = 0
/** A fresh session per test: the settled signal belongs to one token. */
function signIn(): string {
  const token = `tok-seen-${++n}`
  useAuthStore.setState({ token, user: { id: 'u-rin' } } as never)
  return token
}

const g = globalThis as unknown as Record<string, unknown>
const held = { add: g.addEventListener, remove: g.removeEventListener }
before(() => {
  // markSeen carries the mark up through prefsSync, which listens on the window and asks the door;
  // the door stays answered for the life of this file, so its debounced push never leaves the process
  g.addEventListener = held.add ?? (() => {})
  g.removeEventListener = held.remove ?? (() => {})
  globalThis.fetch = (async () => new Response(JSON.stringify({ status: 200, data: {} }),
    { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
})
after(() => {
  g.addEventListener = held.add
  g.removeEventListener = held.remove
  useAuthStore.setState({ token: null, user: null } as never)
})

describe('an intro asks the shelf once the pull has landed', () => {
  beforeEach(() => localStorage.clear())

  it('stays closed until the pull lands, then opens for somebody never shown it', () => {
    const token = signIn()
    const h = mountHook(() => useSeenOnce(KEY, 'u-rin'), {})
    assert.equal(h.current.seen, true, 'closed before the pull — the server may hold the mark')
    h.run(() => markSettled(token))
    assert.equal(h.current.seen, false)
    h.unmount()
  })

  it('a mark the release cleared opens it once the pull lands, though the browser still held it', () => {
    const token = signIn()
    localStorage.setItem(KEY, JSON.stringify(['u-other', 'u-rin']))
    const h = mountHook(() => useSeenOnce(KEY, 'u-rin'), {})
    assert.equal(h.current.seen, true)
    // the pull stands the stale copy down (prefsRelease) and then says it landed
    localStorage.setItem(KEY, JSON.stringify(['u-other']))
    h.run(() => markSettled(token))
    assert.equal(h.current.seen, false, 'read again when the pull landed — never the copy from before it')
    h.unmount()
  })

  it('a mark still on the shelf after the pull keeps it closed', () => {
    const token = signIn()
    localStorage.setItem(KEY, JSON.stringify(['u-rin']))
    const h = mountHook(() => useSeenOnce(KEY, 'u-rin'), {})
    h.run(() => markSettled(token))
    assert.equal(h.current.seen, true)
    h.unmount()
  })

  it('a pull that landed for another session does not open it for this one', () => {
    const earlier = signIn()
    signIn()
    const h = mountHook(() => useSeenOnce(KEY, 'u-rin'), {})
    h.run(() => markSettled(earlier))
    assert.equal(h.current.seen, true)
    h.unmount()
  })

  it('nobody signed in never opens it', () => {
    const token = signIn()
    const h = mountHook(() => useSeenOnce(KEY, ''), {})
    h.run(() => markSettled(token))
    assert.equal(h.current.seen, true)
    h.unmount()
  })

  it('finishing writes the mark and closes it', () => {
    const token = signIn()
    const h = mountHook(() => useSeenOnce(KEY, 'u-rin'), {})
    h.run(() => markSettled(token))
    assert.equal(h.current.seen, false)
    h.run(() => h.current.markSeen())
    assert.equal(h.current.seen, true)
    assert.deepEqual(seenIdsOf(KEY), ['u-rin'])
    h.unmount()
  })

  it('an unreadable shelf is empty — the intro shows once more, the harmless way to fail', () => {
    localStorage.setItem(KEY, '{not a list')
    assert.deepEqual(seenIdsOf(KEY), [])
    localStorage.setItem(KEY, JSON.stringify({ 'u-rin': true }))
    assert.deepEqual(seenIdsOf(KEY), [])
  })
})
