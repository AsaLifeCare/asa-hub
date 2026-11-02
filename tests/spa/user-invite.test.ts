/**
 * Settings → Users → Invite, screen side: the answer of HubCore.gs userInvite
 * said as it is — sent, held, already or refused, each with its sentence, and
 * a press a switch stopped naming the switch. The server side is the
 * `user invite door` self-test section (apps-script/SelfTestUserInvite.gs).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inviteToast } from '@/pages/settings/UsersSection'

describe('the invite\'s answer', () => {
  it('a press the invitation\'s switch stopped says nothing was sent, and which switch', () => {
    const off = inviteToast({ state: 'off', situation: 'auth_invitation', planted: true, sent: [], held: [], skipped: [],
      why: 'Nobody was invited: the invitation situation (auth_invitation) is switched off in Smart Comms, and it ' +
           'stops every invitation, this one too.' })
    assert.equal(off.type, 'warning')
    assert.equal(off.title, 'Nothing was sent — the invitation switch (auth_invitation) is switched off')
    assert.match(off.body, /auth_invitation/)
  })
  it('the account invitation\'s own row off is named as its own switch, never as the invitation\'s', () => {
    const own = inviteToast({ state: 'off', situation: 'user_account_invite', planted: true, sent: [], held: [],
      skipped: [], why: 'Nobody was invited: the situation user_account_invite is switched off in Smart Comms — nothing was sent.' })
    assert.equal(own.title, 'Nothing was sent — the account invitation (user_account_invite) is switched off')
    assert.doesNotMatch(own.title, /auth_invitation/)
  })
  it('a row not in Smart Comms yet is said as not there yet, never as switched off', () => {
    const absent = inviteToast({ state: 'off', situation: 'user_account_invite', planted: false, sent: [], held: [],
      skipped: [], why: 'Nobody was invited: the situation user_account_invite is not in the situations tab yet — nothing was sent.' })
    assert.equal(absent.title, 'Nothing was sent — the account invitation (user_account_invite) is not in Smart Comms yet')
    assert.doesNotMatch(absent.title, /switched off/)
    assert.match(absent.body, /not in the situations tab yet/)
  })
  it('an unreadable switch is a hold, said as a hold, naming the switch that could not be read', () => {
    const held = inviteToast({ state: 'held', situation: 'auth_invitation', planted: null, sent: [], held: [], skipped: [],
      why: 'Nobody was invited: the invitation situation (auth_invitation) could not be read, so the invitation is held.' })
    assert.equal(held.title, 'Nothing was sent — the invitation switch (auth_invitation) could not be read, so it is held')
    assert.match(held.body, /could not be read/)
  })
  it('a held letter is never called sent, and the brake is named', () => {
    const t = inviteToast({ state: 'held', sent: [], skipped: [],
      held: [{ name: 'Pat Doe', state: 'held', why: 'the letter held (opted_out): quiet' }] })
    assert.equal(t.type, 'warning')
    assert.equal(t.title, 'Nothing was sent (1 held)')
    assert.match(t.body, /^Pat Doe: held — the letter held/)
    assert.doesNotMatch(t.title, /invitation sent/)
  })
  it('a letter that left beside a held text is sent, and the held text is said', () => {
    const t = inviteToast({ state: 'sent', held: [], skipped: [],
      sent: [{ name: 'Pat Doe', state: 'sent', via: 'email', why: 'the text held (rehearsal): test mode is on' }] })
    assert.equal(t.type, 'success')
    assert.equal(t.title, '1 invitation sent')
    assert.match(t.body, /Pat Doe: sent by email \(the text held \(rehearsal\)/)
  })
  it('several accounts: the title counts each kind, and every held or refused one is named with its reason', () => {
    const t = inviteToast({ state: 'mixed',
      sent: [{ name: 'Pat Doe', state: 'sent', via: 'email+sms', why: '' }],
      held: [{ name: 'Kim Lee', state: 'already', why: 'the text: the same message already went out — not sent again' }],
      skipped: [{ name: 'Lee Roe', why: 'the account is not active yet' }] })
    assert.equal(t.type, 'warning')
    assert.equal(t.title, '1 invitation sent (1 sent · 1 held · 1 refused)')
    assert.match(t.body, /Pat Doe: sent by email and sms/)
    assert.match(t.body, /Kim Lee: already sent earlier — the text: the same message already went out/)
    assert.match(t.body, /Lee Roe: refused — the account is not active yet/)
  })
  it('the dialog speaks through this answer, and no longer calls every non-refusal sent', () => {
    const src = readFileSync(resolve(process.env.SPA_ROOT ?? process.cwd(), 'src/pages/settings/UsersSection.tsx'), 'utf8')
    assert.match(src, /gasAction<InviteAnswer>\('userInvite'/)
    assert.match(src, /toast\(inviteToast\(r\)\)/)
    assert.doesNotMatch(src, /Each one carries the sign-in, the first-time password and what happens next/)
  })
})
