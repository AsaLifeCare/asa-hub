// SETTINGS → PROFILE, under Language: "Be Another?" and "Be Back".
// Drawn ONLY when the last auth answer carried the server's Be Another block, which BeAnother.gs attaches for the…
import { useMemo, useState } from 'react'
import { ChevronDown, Loader2, Search, VenetianMask } from 'lucide-react'
import { useAuthStore } from '@/auth/useAuthStore'
import type { BeAnotherBlock, Role } from '@/auth/types'
import RoleBadge, { TypeBadges } from '@/components/shared/RoleBadge'
import { isAwayTenant, useTenantStore } from '@/stores/useTenantStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { useWorldStore } from '@/stores/useWorldStore'
import {
  actingName, beBack, clockOf, listAccounts, startActing, type BeAnotherAccount,
} from '@/lib/beAnother'
import { cn } from '@/lib/utils'

export type AccountsRead =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; accounts: BeAnotherAccount[]; ttlMinutes: number }
  | { state: 'failed'; error: string }

export default function BeAnotherControls() {
  const block = useAuthStore((s) => s.beAnother)
  const visiting = useMemberStore((s) => Boolean(s.currentMemberId))
  const inWorld = useWorldStore((s) => Boolean(s.currentWorldId))
  const away = useTenantStore((s) => isAwayTenant(s))
  const [open, setOpen] = useState(false)
  const [read, setRead] = useState<AccountsRead>({ state: 'idle' })
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<BeAnotherAccount | null>(null)
  const [busy, setBusy] = useState<'' | 'start' | 'back'>('')
  const [error, setError] = useState('')

  if (!block) return null

  const blocker = visiting ? 'Leave the visit first — Be Another starts from your own workspace.'
    : inWorld || away ? 'Be Another starts from headquarters — go home first.'
      : ''

  const load = () => {
    setRead({ state: 'loading' })
    listAccounts()
      .then((d) => setRead({ state: 'ready', accounts: d.accounts, ttlMinutes: d.ttl_minutes }))
      .catch((e: unknown) => setRead({
        state: 'failed',
        error: e instanceof Error ? e.message : 'The accounts could not be read.',
      }))
  }

  return (
    <BeAnotherControlsView
      block={block}
      blocker={blocker}
      open={open}
      read={read}
      query={query}
      picked={picked}
      busy={busy}
      error={error}
      onToggle={() => {
        const next = !open
        setOpen(next)
        if (next && (read.state === 'idle' || read.state === 'failed')) load()
      }}
      onQuery={setQuery}
      onPick={(a) => { setPicked(a); setOpen(false); setError('') }}
      onCancel={() => { setPicked(null); setError('') }}
      onConfirm={() => {
        if (!picked) return
        setBusy('start')
        setError('')
        startActing(picked.id).catch((e: unknown) => {
          setBusy('')
          setError(e instanceof Error ? e.message : 'The server did not start it.')
        })
      }}
      onBack={() => {
        setBusy('back')
        void beBack().finally(() => setBusy(''))
      }}
    />
  )
}

function matches(a: BeAnotherAccount, q: string): boolean {
  if (!q) return true
  const hay = [a.display_name, a.email, a.role, a.title, ...a.types].join(' ').toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}

const label = 'mb-1.5 block text-[12px] font-medium text-text-2'
const note = 'mt-1 block text-[11px] text-text-3'

// What the relay's write guard means on screen: the doors that write straight to the platform's own store never…
export const VIEW_ONLY_NOTE = 'While acting, screens that save outside the logged lane — time off, shift ' +
  'requests and handoffs, house calendars, notice read marks, the assistant — are view-only, and a save ' +
  'accepted in the last seconds before Be Back may not land.'

/** Everything this section draws, from its state alone. */
export function BeAnotherControlsView({
  block, blocker, open, read, query, picked, busy, error,
  onToggle, onQuery, onPick, onCancel, onConfirm, onBack,
}: {
  block: BeAnotherBlock
  blocker: string
  open: boolean
  read: AccountsRead
  query: string
  picked: BeAnotherAccount | null
  busy: '' | 'start' | 'back'
  error: string
  onToggle: () => void
  onQuery: (q: string) => void
  onPick: (a: BeAnotherAccount) => void
  onCancel: () => void
  onConfirm: () => void
  onBack: () => void
}) {
  const acting = block.acting
  const shown = useMemo(
    () => (read.state === 'ready' ? read.accounts.filter((a) => matches(a, query.trim())) : []),
    [read, query],
  )
  const pickedName = picked ? (picked.display_name || picked.email) : ''
  return (
    <div className="mt-5 space-y-4 border-t border-border pt-4" data-be-another="">
      <div>
        <span className={cn(label, 'flex items-center gap-1.5')}>
          <VenetianMask size={13} aria-hidden /> Be Another?
        </span>
        {acting ? (
          <>
            <p className="text-[12.5px] text-text-2">
              You are acting as <b className="text-text-1">{actingName(block)}</b> — everything on screen is theirs.
              It ends by itself at {clockOf(acting.local_until)}.
            </p>
            <span className={note}>{VIEW_ONLY_NOTE}</span>
          </>
        ) : (
          <>
            <div className="relative max-w-md">
              <button
                type="button"
                onClick={onToggle}
                disabled={Boolean(blocker) || busy !== ''}
                aria-haspopup="listbox"
                aria-expanded={open}
                className="flex h-9 w-full items-center justify-between gap-2 rounded-sm border border-border bg-surface px-3 text-left text-[13px] text-text-1 outline-none focus:border-border-strong disabled:bg-surface-2 disabled:text-text-3"
              >
                <span className="truncate">{pickedName || 'Choose an account…'}</span>
                <ChevronDown size={14} className="shrink-0 text-text-3" />
              </button>
              {open && (
                <div className="absolute left-0 right-0 z-30 mt-1 rounded-md border border-border bg-surface p-2 shadow-3">
                  <label className="mb-2 flex h-8 items-center gap-2 rounded-sm border border-border px-2">
                    <Search size={13} className="shrink-0 text-text-3" />
                    <input
                      value={query}
                      onChange={(e) => onQuery(e.target.value)}
                      placeholder="Name, e-mail or badge"
                      aria-label="Search the accounts"
                      className="h-full w-full bg-transparent text-[12.5px] text-text-1 outline-none placeholder:text-text-3"
                    />
                  </label>
                  {read.state === 'loading' || read.state === 'idle' ? (
                    <p className="flex items-center gap-2 px-1 py-2 text-[12px] text-text-3">
                      <Loader2 size={13} className="animate-spin" /> Reading the accounts…
                    </p>
                  ) : read.state === 'failed' ? (
                    <p className="px-1 py-2 text-[12px] text-danger">
                      {read.error} There is nobody to pick until the list can be read — close and open this again
                      to retry.
                    </p>
                  ) : shown.length === 0 ? (
                    <p className="px-1 py-2 text-[12px] text-text-3">
                      {read.accounts.length ? 'No account matches that search.' : 'The server listed no account to act as.'}
                    </p>
                  ) : (
                    <ul role="listbox" aria-label="Accounts" className="scroll-thin max-h-72 space-y-0.5 overflow-y-auto">
                      {shown.map((a) => (
                        <li key={a.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={picked?.id === a.id}
                            disabled={!a.active}
                            onClick={() => onPick(a)}
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-semibold text-text-1">
                                {a.display_name || a.email}
                              </span>
                              <span className="block truncate text-[11px] text-text-3">{a.email}</span>
                            </span>
                            <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                              <RoleBadge user={{ role: (a.role || 'staff') as Role, isMaster: false }} size="xs" />
                              <TypeBadges user={{ role: (a.role || 'staff') as Role, isMaster: false, types: a.types }} size="xs" />
                              {!a.active && (
                                <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase text-text-3">
                                  blocked
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <span className={note}>
              {blocker || 'Master only. This browser becomes that person — their apps, their screens, their data — ' +
                'until you press Be Back or two hours pass. Their password, their messages and e-mail, their ' +
                'signatures and the platform switches stay out of reach, and every write is logged with both ' +
                'names. ' + VIEW_ONLY_NOTE}
            </span>
            {picked && (
              <div className="mt-3 flex max-w-md flex-wrap items-center gap-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2">
                <span className="min-w-0 flex-1 text-[12.5px] text-text-1">
                  Act as <b>{pickedName}</b>? Every tab of this browser becomes them until you press Be Back.
                </span>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={busy !== ''}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-danger px-3 text-[12.5px] font-semibold text-white disabled:opacity-60"
                >
                  {busy === 'start' && <Loader2 size={13} className="animate-spin" />}
                  Act as {pickedName}
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={busy !== ''}
                  className="h-8 rounded-md px-2.5 text-[12.5px] font-medium text-text-2 hover:bg-surface-2"
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
        {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
      </div>
      <div>
        <span className={label}>Be Back</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            disabled={!acting || busy !== ''}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            {busy === 'back' && <Loader2 size={13} className="animate-spin" />}
            Be Back
          </button>
          <span className="text-[11.5px] text-text-3">
            {acting
              ? `Returns this browser to ${block.real.display_name || block.real.email || 'your own account'}.`
              : 'You are yourself.'}
          </span>
        </div>
      </div>
    </div>
  )
}
