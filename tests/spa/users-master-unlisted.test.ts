/**
 * The master account is never a row in a list of users: the directory every list reads drops it, by the row's
 * own flag or by the auth answer, and the relay's copy of the account stays the one fixed in Auth.gs.
 */
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useAuthStore } from '@/auth/useAuthStore'
import { cachedUsers, isMasterAccountRow } from '@/lib/usersDirectory'

const ROOT = resolve(process.cwd())
const MASTER = { id: 'u-m', email: 'master@example.org', display_name: 'Master', role: 'admin' }
const ANN = { id: 'u-a', email: 'ann@example.org', display_name: 'Ann Roe', role: 'staff' }

describe('the users directory never lists the master account', () => {
  afterEach(() => {
    sessionStorage.clear()
    useAuthStore.setState({ user: null } as never)
  })

  it('drops a row the backend flags as the master, for any viewer', () => {
    sessionStorage.setItem('asa-users-directory-v1', JSON.stringify([{ ...MASTER, is_master: true }, ANN]))
    assert.deepEqual((cachedUsers() ?? []).map((r) => r.id), ['u-a'])
  })

  it('drops the master session\'s own row by the auth answer, and nobody else\'s', () => {
    useAuthStore.setState({ user: { id: 'u-m', email: 'Master@example.org', name: 'Master', role: 'admin',
                                    isMaster: true } } as never)
    assert.equal(isMasterAccountRow(MASTER), true)
    assert.equal(isMasterAccountRow({ ...MASTER, id: 'u-other' }), true)
    assert.equal(isMasterAccountRow(ANN), false)
    useAuthStore.setState({ user: { id: 'u-a', email: ANN.email, name: 'Ann', role: 'staff', isMaster: false } } as never)
    assert.equal(isMasterAccountRow(ANN), false)
  })

  it('the relay\'s copy of the master account is the one fixed in Auth.gs', () => {
    const gs = /var HUB_MASTER_ACCOUNT = '([^']+)'/.exec(readFileSync(resolve(ROOT, 'apps-script/Auth.gs'), 'utf8'))
    const py = /^HUB_MASTER_ACCOUNT = "([^"]+)"/m.exec(readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8'))
    assert.ok(gs && py, 'both copies are found')
    assert.equal(py?.[1], gs?.[1])
  })
})
