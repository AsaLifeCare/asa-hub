// PLATFORM USERS — the multi-user concept of the platform.
// It needs its configuration near the tenants, but it is not a tenant; it sits above one.
import { useEffect, useState } from 'react'
import { Loader2, Send, Trash2, UserPlus } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { useMembersRoster } from '@/stores/useMembersRoster'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { cn } from '@/lib/utils'

type Member = {
  member_id: string
  user_id: string
  email: string
  name: string
  avatar: string
  title: string
  added_at: string
  world_role: string
  role?: string
  types?: string[]
  status?: string
  scope?: string
}

type Candidate = { user_id: string; email: string; name: string; avatar: string }
type Roster = { limit: number; used: number; members: Member[]; candidates?: Candidate[] }
type Check = { eligible: boolean; reason: string; name: string; avatar: string }
type Invite = {
  invite_id: string; email: string; phone: string; name: string
  status: string; invited_at: string; expires_at: string
}
type Invites = { invites: Invite[]; secret_set: boolean }

export default function MembersSection() {
  const [roster, setRoster] = useState<Roster | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [check, setCheck] = useState<Check | null>(null)
  const [checking, setChecking] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = async () => {
    try {
      setRoster(await gasAction<Roster>('platformMembersList', {}))
    } catch {
      setRoster(null)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  // The verdict arrives BEFORE the click — a refusal after pressing Add reads as a failure; the same sentence…
  useEffect(() => {
    const addr = email.trim().toLowerCase()
    if (!addr || !addr.includes('@')) { setCheck(null); return }
    let alive = true
    setChecking(true)
    const t = setTimeout(() => {
      void gasAction<Check>('platformMemberCheck', { email: addr })
        .then((r) => { if (alive) setCheck(r) })
        .catch(() => { if (alive) setCheck(null) })
        .finally(() => { if (alive) setChecking(false) })
    }, 450)
    return () => { alive = false; clearTimeout(t) }
  }, [email])

  const full = Boolean(roster && roster.used >= roster.limit)

  // THE OTHER HALF OF THE DOOR — an app that sends invitation e-mails and messages for registration, alongside the…
  const [invites, setInvites] = useState<Invites | null>(null)
  const [inv, setInv] = useState({ name: '', email: '', phone: '' })
  const [sending, setSending] = useState(false)

  const loadInvites = async () => {
    try { setInvites(await gasAction<Invites>('invitesList', {})) } catch { setInvites(null) }
  }
  useEffect(() => { void loadInvites() }, [])

  const sendInvite = async () => {
    setSending(true)
    try {
      const r = await gasAction<{ sent: { email: boolean; sms: boolean }; why: string }>('inviteSend', {
        name: inv.name.trim(), email: inv.email.trim().toLowerCase(), phone: inv.phone.trim(),
      })
      setInv({ name: '', email: '', phone: '' })
      await loadInvites()
      const lanes = [r?.sent?.email && 'e-mail', r?.sent?.sms && 'SMS'].filter(Boolean).join(' and ')
      toast({
        type: lanes ? 'success' : 'warning',
        title: lanes ? `Invitation sent by ${lanes}` : 'Invitation created, not sent',
        body: lanes
          ? 'They choose their own password on the link — nothing shared.'
          : r?.why || 'The link stands; try sending it again.',
      })
    } catch (e) {
      toast({ type: 'danger', title: 'Could not invite them', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setSending(false) }
  }

  const revokeInvite = async (i: Invite) => {
    try {
      await gasAction('inviteRevoke', { invite_id: i.invite_id })
      await loadInvites()
    } catch (e) {
      toast({ type: 'danger', title: 'Could not revoke it', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  // ASK, NEVER ADD — before an address is entered and a user added, an e-mail has to go out asking for…
  const add = async () => {
    setAdding(true)
    try {
      await gasAction('platformMemberAsk', { email: email.trim().toLowerCase() })
      setEmail(''); setCheck(null)
      await load()
      useMembersRoster.getState().invalidate()   // the places stack draws from the same roster
      toast({
        type: 'success',
        title: 'Authorization requested',
        body: 'They decide by replying WORK or BOTH — nothing of theirs is shared until they do.',
      })
    } catch (e) {
      toast({ type: 'danger', title: 'Could not ask them', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setAdding(false)
    }
  }

  /** Record the answer they gave — the scope is theirs, never assumed. */
  const authorize = async (m: Member, scope: 'work' | 'work_world') => {
    try {
      await gasAction('platformMemberAuthorize', { member_id: m.member_id, scope })
      await load()
      useMembersRoster.getState().invalidate()   // the places stack draws from the same roster
      toast({
        type: 'success',
        // narrowing is not an authorization: nobody granted anything by closing a door, and calling it that would…
        title: scope === 'work_world'
          ? `${m.name || m.email} authorized`
          : `${m.name || m.email} — world closed`,
        body: scope === 'work_world'
          ? 'Their work and their My world are reachable from your stack.'
          : 'Their work is reachable from your stack; their world stays theirs alone.',
      })
    } catch (e) {
      toast({ type: 'danger', title: 'Could not record it', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  const remove = async (m: Member) => {
    try {
      await gasAction('platformMemberRemove', { member_id: m.member_id })
      await load()
      useMembersRoster.getState().invalidate()   // the places stack draws from the same roster
      toast({ type: 'info', title: 'Removed from your platform', body: `${m.name || m.email} keeps their account, world and apps.` })
    } catch (e) {
      toast({ type: 'danger', title: 'Could not remove them', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  return (
    <section id="members" className="scroll-mt-[84px]">
      <div className="rounded-[18px] border border-border bg-surface p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold text-text-1">Platform users</h2>
            <p className="text-[13px] text-text-3">
              Who else stands on this platform. Each keeps their own life — their own world, their own apps —
              and their world says USER here, OWNER on their own ground.
            </p>
          </div>
          {roster && (
            <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold',
              full ? 'bg-tint-amber text-tint-fg-amber' : 'bg-surface-2 text-text-2')}>
              {roster.used} of {roster.limit}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Reading your platform…
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {/* AUTOCOMPLETE OVER THE ACTIVATED.
                  The server already decides who may be invited — signed in
                  once, own world — so the field OFFERS exactly those people
                  instead of asking somebody to remember an address and
                  be refused after the click. A native datalist on purpose:
                  it filters as you type, works on a phone, and needs no
                  popup of our own to go stale. */}
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                list="asa-platform-candidates"
                autoComplete="off"
                placeholder={roster?.candidates?.length
                  ? 'start typing a name or e-mail'
                  : 'their e-mail address'}
                disabled={full}
                className="h-9 min-w-[240px] flex-1 rounded-[10px] border border-border bg-bg px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary disabled:opacity-50"
              />
              <datalist id="asa-platform-candidates">
                {(roster?.candidates ?? []).map((c) => (
                  <option key={c.user_id} value={c.email}>{c.name || c.email}</option>
                ))}
              </datalist>
              <button
                onClick={() => void add()}
                disabled={full || adding || !check?.eligible}
                className="flex h-9 items-center gap-1.5 rounded-[10px] bg-primary px-4 text-[13px] font-semibold text-white transition-opacity disabled:opacity-40"
              >
                {adding ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Ask
              </button>
            </div>

            {/* the verdict, in plain words */}
            {checking && <p className="mb-4 text-[12.5px] text-text-3">Checking…</p>}
            {!checking && check && (
              <p className={cn('mb-4 text-[12.5px]', check.eligible ? 'text-tint-fg-mint' : 'text-tint-fg-amber')}>
                {check.eligible
                  ? `${check.name || 'This person'} has signed in here themselves — ready to add.`
                  : check.reason}
              </p>
            )}
              {/* THE SCREEN DESCRIBED A RULE THE SERVER HAD DROPPED — a
                  client added to the platform simply vanished with nothing
                  happening. memberEligible_ stopped requiring a
                  minted world when the world became everybody's own ground —
                  "active is enough" — and these two sentences still sent a
                  reader hunting for a world that is not asked for. A screen
                  explaining the wrong condition is worse than one explaining
                  none: it makes a correct refusal unfixable. */}
            {!full && !checking && !check && (roster?.candidates?.length ?? 0) === 0 && (
              <p className="mb-4 text-[12.5px] text-text-3">
                Nobody is ready to be added yet — a person becomes addable once they have signed in
                here themselves at least once.
              </p>
            )}
            {full && (
              <p className="mb-4 text-[12.5px] text-tint-fg-amber">
                This platform is full. Remove somebody before adding another.
              </p>
            )}

            {roster && roster.members.length === 0 ? (
              <p className="text-[13px] text-text-3">
                Nobody else yet. A person can only be added after they have signed in here once themselves
                and opened their own world — that is what makes them addable.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {roster?.members.map((m) => (
                  <li key={m.member_id} className="flex items-center gap-3 py-2.5">
                    <DragPerson name={m.name || m.email} id={m.user_id} avatar={m.avatar} subtitle={m.title || m.email} className="shrink-0">
                      <Avatar src={m.avatar} name={m.name || m.email} size="sm" />
                    </DragPerson>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <DragPerson name={m.name || m.email} id={m.user_id} avatar={m.avatar} subtitle={m.title || m.email} className="min-w-0">
                          <span className="clamp-1 text-[13.5px] font-semibold text-text-1">{m.name || m.email}</span>
                        </DragPerson>
                        {/* WHAT THEY ARE: the badge
                            they already carry, never a category this screen
                            invents for them */}
                        <span className="rounded-full bg-tint-blue px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-tint-fg-blue">
                          {(m.types?.[0] || m.role || 'staff').toUpperCase()}
                        </span>
                        {m.status === 'pending' ? (
                          <span className="rounded-full bg-tint-amber px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-tint-fg-amber">
                            waiting for their answer
                          </span>
                        ) : (
                          // A BLANK SCOPE ON AN ACTIVE ROW IS NOT "work only", it is an answer nobody recorded…
                          <span className={cn(
                            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                            m.scope ? 'bg-surface-2 text-text-3'
                                    : 'bg-tint-amber text-tint-fg-amber',
                          )}>
                            {m.scope === 'work_world' ? 'work + world'
                              : m.scope ? 'work only' : 'no answer recorded — reads as work'}
                          </span>
                        )}
                      </div>
                      <p className="clamp-1 text-[12px] text-text-3">{m.email}</p>
                    </div>
                    {/**
                      * THE ANSWER IS RECORDABLE AFTER THE ROW GOES ACTIVE TOO
                      * as well. Until now these two buttons
                      * rendered only while the row was `pending`, so the scope
                      * became a read-only chip the moment somebody replied —
                      * and a row that reached `active` with a BLANK scope, which
                      * this platform has one of, was stuck reading as `work`
                      * with no control anywhere to change it. Their My world
                      * could never open and no screen said why.
                      *
                      * It does not weaken the law that only their own word
                      * opens this. Widening still records an answer THEY gave,
                      * admin-only, stamped with who recorded it; narrowing
                      * needs no consent at all, because taking access away
                      * never did. What changes is that the answer can be
                      * recorded when it arrives rather than only in the window
                      * before it does.
                      */}
                    <span className="flex shrink-0 items-center gap-1">
                      {m.scope !== 'work' && (
                        <button
                          onClick={() => void authorize(m, 'work')}
                          title={m.status === 'pending'
                            ? 'They replied WORK — their work alone'
                            : 'Their work alone — closes their My world. Taking access away needs no answer.'}
                          className="h-7 rounded-[8px] border border-border px-2 text-[11.5px] font-semibold text-text-2 hover:bg-surface-2"
                        >{m.status === 'pending' ? 'They said WORK' : 'Work only'}</button>
                      )}
                      {m.scope !== 'work_world' && (
                        <button
                          onClick={() => void authorize(m, 'work_world')}
                          title="They replied BOTH — their work and their My world. Record what they answered."
                          className="h-7 rounded-[8px] border border-border px-2 text-[11.5px] font-semibold text-text-2 hover:bg-surface-2"
                        >{m.status === 'pending' ? 'BOTH' : 'They said BOTH'}</button>
                      )}
                    </span>
                    <button
                      onClick={() => void remove(m)}
                      title="Remove from this platform — their account, world and apps stay theirs"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-3 transition-colors hover:bg-surface-2 hover:text-tint-fg-pink"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* INVITATIONS — for people the platform has never heard of */}
        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-[14px] font-semibold text-text-1">Invite someone who is not a user yet</h3>
          <p className="mb-3 text-[12.5px] text-text-3">
            They get a letter and an SMS with a personal link, register themselves and choose their own
            password. Once they sign in they are active, they have their own world, and they can be added above.
          </p>

          {invites && !invites.secret_set && (
            <p className="mb-3 text-[12.5px] text-tint-fg-amber">
              Set the <span className="font-mono">INTERVIEW_LINK_SECRET</span> Script Property first — invitation
              links refuse to be minted without a signing key.
            </p>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })}
              placeholder="their name"
              className="h-9 min-w-[150px] flex-1 rounded-[10px] border border-border bg-bg px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
            />
            <input
              value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })}
              placeholder="e-mail"
              className="h-9 min-w-[180px] flex-1 rounded-[10px] border border-border bg-bg px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
            />
            <input
              value={inv.phone} onChange={(e) => setInv({ ...inv, phone: e.target.value })}
              placeholder="mobile (optional)"
              className="h-9 min-w-[140px] rounded-[10px] border border-border bg-bg px-3 font-mono text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
            />
            <button
              onClick={() => void sendInvite()}
              disabled={sending || !inv.email.includes('@') || !inv.name.trim()}
              className="flex h-9 items-center gap-1.5 rounded-[10px] border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-40"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Invite
            </button>
          </div>

          {(invites?.invites.length ?? 0) > 0 && (
            <ul className="divide-y divide-border">
              {invites?.invites.map((i) => (
                <li key={i.invite_id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    {/* i.invite_id names the invitation, not the person — the
                        name and the address are all the identity there is. */}
                    <DragPerson name={i.name || i.email} id={i.email} subtitle={i.email} className="block min-w-0">
                      <span className="clamp-1 block text-[13px] font-medium text-text-1">{i.name || i.email}</span>
                    </DragPerson>
                    <span className="clamp-1 block text-[11.5px] text-text-3">{i.email}</span>
                  </span>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide',
                    i.status === 'registered' ? 'bg-tint-mint text-tint-fg-mint'
                      : i.status === 'expired' || i.status === 'revoked' ? 'bg-surface-2 text-text-3'
                        : 'bg-tint-blue text-tint-fg-blue')}>
                    {i.status}
                  </span>
                  {i.status !== 'registered' && i.status !== 'revoked' && (
                    <button
                      onClick={() => void revokeInvite(i)}
                      title="Revoke this invitation"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-3 hover:bg-surface-2 hover:text-tint-fg-pink"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
