// Credentials › Password resets (the master's alone — the whole app is in MASTER_ONLY_APPS, and the lane answers the
// master alone): pick anyone, give them the workspace default password or one typed here, and at their next sign-in
// they choose their own, exactly as on a first sign-in (MustChangePasswordGate). Their open sessions end at once.
// No password is ever read back from the server; a typed one leaves this screen with the reset and is forgotten.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, RotateCcw, Search } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import SidePanel from '@/components/shared/SidePanel'
import { useAuthStore } from '@/auth/useAuthStore'
import { relayLane } from '@/lib/noticesApi'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

export const RESETS_PATH = '/hub-lanes/credentials-resets'

export type ResetAccount = {
  id: string
  name: string
  email: string
  role: string
  active: boolean
  mustChange: boolean
  lastLogin: string
  master: boolean
}
export type ResetsView = { accounts: ResetAccount[]; defaultReady: boolean; minLength: number }

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The lane's answer as this screen draws it; null when it is not the list. */
export function resetsViewFrom(raw: unknown): ResetsView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>
  if (!Array.isArray(d.accounts)) return null
  return {
    accounts: d.accounts.map((a) => {
      const r = (a ?? {}) as Record<string, unknown>
      return { id: text(r.id), name: text(r.name), email: text(r.email), role: text(r.role) || 'staff',
        active: r.active !== false, mustChange: r.mustChange === true, lastLogin: text(r.lastLogin),
        master: r.master === true }
    }).filter((a) => a.id),
    defaultReady: d.defaultReady === true,
    minLength: typeof d.minLength === 'number' && d.minLength > 0 ? d.minLength : 8,
  }
}

function lastSignIn(iso: string): string {
  if (!iso) return 'Never signed in'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'Never signed in'
    : `Last sign-in ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

const chip = 'inline-flex h-[20px] items-center rounded-full px-2 text-[11px] font-semibold'

export default function PasswordResetsPage() {
  const user = useAuthStore((s) => s.user)
  const [view, setView] = useState<ResetsView | null>(null)
  const [why, setWhy] = useState('')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<ResetAccount | null>(null)
  const [useDefault, setUseDefault] = useState(true)
  const [typed, setTyped] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const got = resetsViewFrom(await relayLane<unknown>(RESETS_PATH))
      if (!got) throw new Error('the server answered something that is not the accounts list')
      setView(got)
      setWhy('')
    } catch (e) {
      setWhy(e instanceof Error ? e.message : 'the accounts could not be read')
    }
  }, [])

  useEffect(() => { if (user?.isMaster) void load() }, [user?.isMaster, load])

  const shownAccounts = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = view?.accounts ?? []
    return q ? all.filter((a) => a.name.toLowerCase().includes(q) || a.email.includes(q)) : all
  }, [view, query])

  const open = (a: ResetAccount): void => {
    setPicked(a)
    setUseDefault(view?.defaultReady !== false)
    setTyped('')
    setShown(false)
  }
  const close = (): void => {
    if (busy) return
    setPicked(null)
    setTyped('')
  }

  const min = view?.minLength ?? 8
  const typedOk = typed.length >= min
  const canReset = !!picked && !busy && (useDefault ? !!view?.defaultReady : typedOk)

  const doReset = async (): Promise<void> => {
    if (!picked || !canReset) return
    setBusy(true)
    try {
      const got = await relayLane<{ how?: string; sessionsEnded?: number }>(RESETS_PATH, {
        method: 'POST',
        body: JSON.stringify(useDefault ? { userId: picked.id, useDefault: true } : { userId: picked.id, password: typed }),
      })
      const ended = Number(got?.sessionsEnded ?? 0)
      toast({
        type: 'success',
        title: `${picked.name || picked.email}'s password was reset`,
        body: `${got?.how === 'typed' ? 'The password you typed' : 'The default password'} opens their next sign-in, `
          + `where they choose their own.${ended ? ` ${ended} open session${ended === 1 ? '' : 's'} ended.` : ''}`,
      })
      setView((v) => v && { ...v, accounts: v.accounts.map((a) => (a.id === picked.id ? { ...a, mustChange: true } : a)) })
      setTyped('')
      setPicked(null)
    } catch (e) {
      toast({ type: 'danger', title: 'Not reset', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  // EVERY HOOK IS ABOVE THIS LINE.
  if (!user?.isMaster) {
    return (
      <div className="mx-auto max-w-[520px] pt-16">
        <EmptyState title="Password resets are the master's tool"
          body="Only the master may reset another person's password." />
      </div>
    )
  }

  return (
    <div className="w-full">
      <PageHeader title="Password resets"
        subtitle="Give anyone a starting password — at their next sign-in they choose their own." />
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3">
          <Search size={15} className="text-text-3" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a person by name or email…"
            className="h-10 w-full bg-transparent text-[14px] text-text-1 outline-none placeholder:text-text-3" />
        </div>
        {why && (
          <div className="mb-3 rounded-md border border-tint-amber bg-tint-amber px-3 py-2 text-[12.5px] leading-[19px] text-text-1">
            The accounts could not be read: {why}
            <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Try again</button>
          </div>
        )}
        {view && !view.defaultReady && (
          <div className="mb-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] leading-[19px] text-text-2">
            No workspace default password is set, so each reset takes a password you type.
          </div>
        )}
        {!view && !why ? (
          <div className="flex items-center gap-2 py-8 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading the accounts…</div>
        ) : (
          <ul className="divide-y divide-border">
            {shownAccounts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-[14px] font-semibold text-text-1">{a.name || a.email}</span>
                    <span className={cn(chip, 'bg-surface-2 text-text-2')}>{a.role}</span>
                    {a.mustChange && <span className={cn(chip, 'bg-tint-amber text-tint-fg-amber')}>Chooses a new password at sign-in</span>}
                    {!a.active && <span className={cn(chip, 'bg-tint-pink text-tint-fg-pink')}>Inactive</span>}
                  </div>
                  <div className="truncate text-[12.5px] text-text-3">{a.email} · {lastSignIn(a.lastLogin)}</div>
                </div>
                <button type="button" disabled={a.master} onClick={() => open(a)}
                  title={a.master ? "The master's own password is changed in your profile, never here" : undefined}
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40">
                  <RotateCcw size={13} /> Reset password
                </button>
              </li>
            ))}
            {view && shownAccounts.length === 0 && (
              <li className="py-8 text-center text-[13px] text-text-3">No account matches “{query}”.</li>
            )}
          </ul>
        )}
      </div>

      <SidePanel open={!!picked} onClose={close} label="Password reset" title={picked ? (picked.name || picked.email) : ''}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={close} disabled={busy}
              className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={() => void doReset()} disabled={!canReset}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-on-primary hover:opacity-90 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Reset password
            </button>
          </div>
        }>
        {picked && (
          <div className="mt-1 space-y-4">
            <div className="text-[13px] text-text-3">{picked.email}</div>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-text-3">Their starting password</legend>
              <label className={cn('flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2.5',
                useDefault ? 'border-primary bg-surface-2' : 'border-border', !view?.defaultReady && 'cursor-not-allowed opacity-50')}>
                <input type="radio" name="pw-kind" checked={useDefault} disabled={!view?.defaultReady}
                  onChange={() => setUseDefault(true)} className="mt-1" />
                <span>
                  <span className="block text-[13.5px] font-semibold text-text-1">The default password</span>
                  <span className="block text-[12.5px] text-text-3">The workspace's own, the one every new account starts with.</span>
                </span>
              </label>
              <label className={cn('flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2.5',
                !useDefault ? 'border-primary bg-surface-2' : 'border-border')}>
                <input type="radio" name="pw-kind" checked={!useDefault} onChange={() => setUseDefault(false)} className="mt-1" />
                <span className="block text-[13.5px] font-semibold text-text-1">A password I type</span>
              </label>
              {!useDefault && (
                <div className="relative">
                  <input type={shown ? 'text' : 'password'} value={typed} autoComplete="new-password" autoFocus
                    onChange={(e) => setTyped(e.target.value)} placeholder={`At least ${min} characters`}
                    className="h-10 w-full rounded-sm border border-border bg-surface pl-3 pr-10 text-[13.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
                  <button type="button" onClick={() => setShown((v) => !v)} aria-label={shown ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-sm text-text-3 hover:text-text-1">
                    {shown ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              )}
            </fieldset>
            <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-[19px] text-text-2">
              <li>At their next sign-in they must choose their own password, as on a first sign-in.</li>
              <li>Every session they have open ends now.</li>
              {!picked.active && <li>This account is inactive: it stays blocked until it is activated in Settings › Users.</li>}
            </ul>
          </div>
        )}
      </SidePanel>
    </div>
  )
}
