// PSI Log › Reset Password: give an employee a new PsiAnywhere password (app/psi_log.py reset, /hub-lanes/psi-log/reset)
// — the default one, built to pass PsiAnywhere's rule and different every time, or one typed here. It is PsiAnywhere's
// own admin reset, done under the signed-in admin session, so you must be signed in with an admin account. The new
// password is shown so you can tell the person; it is never kept. App Control's psi-log.passwordReset row opens it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Check, Copy, KeyRound, Loader2, Power, RotateCcw, Search } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import SidePanel from '@/components/shared/SidePanel'
import { psiLane, PSI_LOG_HOME, signedOut, SESSION_ENDED } from './psiLane'
import { toast } from '@/stores/useToastStore'
import { useFeatureAllowed } from '@/lib/featureAccess'
import { cn } from '@/lib/utils'

export type ResetUser = { id: string; name: string; active: boolean; term: string }
export type ResetView = {
  signedIn: boolean; psiUser?: string; platform?: boolean; minLength?: number; users?: ResetUser[]
  /** signed out because PsiAnywhere let go of the session, in its words */
  ended?: string
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export function resetViewFrom(raw: unknown): ResetView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>
  if (typeof d.signedIn !== 'boolean') return null
  return {
    signedIn: d.signedIn, psiUser: text(d.psiUser), platform: d.platform === true, ended: text(d.ended),
    minLength: typeof d.minLength === 'number' ? d.minLength : 8,
    users: Array.isArray(d.users) ? d.users.map((u) => {
      const r = (u ?? {}) as Record<string, unknown>
      return { id: text(r.id), name: text(r.name), active: r.active !== false, term: text(r.term) }
    }).filter((u) => u.id) : [],
  }
}

const chip = 'inline-flex h-[20px] items-center rounded-full px-2 text-[11px] font-semibold'
const btn = 'flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold disabled:opacity-50'
const input = 'h-10 w-full rounded-sm border border-border bg-surface px-3 text-[13.5px] text-text-1 outline-none focus:border-primary'

export default function PsiResetPage() {
  const canToggle = useFeatureAllowed('psi-log.accounts')
  const [view, setView] = useState<ResetView | null>(null)
  const [why, setWhy] = useState('')
  const [query, setQuery] = useState('')
  const [inactive, setInactive] = useState(false)
  const [toggling, setToggling] = useState('')
  const [picked, setPicked] = useState<ResetUser | null>(null)
  const [useDefault, setUseDefault] = useState(true)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ name: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async (withInactive: boolean) => {
    try {
      const got = resetViewFrom(await psiLane<unknown>(`/hub-lanes/psi-log/reset${withInactive ? '?inactive=1' : ''}`))
      if (!got) throw new Error('the server answered something unexpected')
      setView(got)
      setWhy('')
    } catch (e) {
      setWhy(e instanceof Error ? e.message : 'the accounts could not be read')
    }
  }, [])
  useEffect(() => { void load(inactive) }, [inactive, load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = view?.users ?? []
    return q ? all.filter((u) => u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q)) : all
  }, [view, query])

  const min = view?.minLength ?? 8
  const open = (u: ResetUser): void => { setPicked(u); setUseDefault(true); setTyped(''); setDone(null); setCopied(false) }
  const close = (): void => { if (!busy) { setPicked(null); setTyped(''); setDone(null) } }
  const canReset = !!picked && !busy && !done && (useDefault || typed.length >= min)

  /** The PsiAnywhere session is gone: the sign-in card instead of a page that still looks signed in. */
  const backToSignIn = (e: unknown): void => {
    setPicked(null)
    setTyped('')
    setDone(null)
    setView({ signedIn: false, ended: e instanceof Error && e.message ? e.message : SESSION_ENDED })
  }

  const doReset = async (): Promise<void> => {
    if (!picked || !canReset) return
    setBusy(true)
    try {
      const got = await psiLane<{ password?: string }>('/hub-lanes/psi-log/reset', {
        method: 'POST', body: JSON.stringify(useDefault ? { userId: picked.id, useDefault: true } : { userId: picked.id, password: typed }),
      })
      setDone({ name: picked.name, password: text(got?.password) })
      toast({ type: 'success', title: `${picked.name}'s PsiAnywhere password was reset` })
    } catch (e) {
      if (signedOut(e)) backToSignIn(e)
      else toast({ type: 'danger', title: 'Not reset', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (u: ResetUser): Promise<void> => {
    setToggling(u.id)
    try {
      await psiLane('/hub-lanes/psi-log/account', { method: 'POST', body: JSON.stringify({ userId: u.id, active: !u.active }) })
      toast({ type: 'success', title: `${u.name} is now ${u.active ? 'inactive' : 'active'} in PsiAnywhere` })
      setView((v) => v && { ...v, users: v.users?.map((x) => (x.id === u.id ? { ...x, active: !u.active } : x)) })
    } catch (e) {
      if (signedOut(e)) backToSignIn(e)
      else toast({ type: 'danger', title: 'Not changed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setToggling('')
    }
  }

  const copy = async (pw: string): Promise<void> => {
    try { await navigator.clipboard.writeText(pw); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch { /* no clipboard */ }
  }

  return (
    <div className="w-full">
      <PageHeader title="Reset Password" subtitle="Give an employee a new PsiAnywhere password to sign in with." />
      {why && (
        <div className="mb-3 rounded-md border border-tint-amber bg-tint-amber px-3 py-2 text-[12.5px] leading-[19px] text-text-1">
          The accounts could not be read: {why}
          <button type="button" onClick={() => void load(inactive)} className="ml-2 font-semibold underline">Try again</button>
        </div>
      )}
      {view && !view.signedIn && (
        <div className="rounded-lg border border-border bg-surface p-4 text-[13px] text-text-2">
          {view.ended && <div className="mb-2 font-semibold text-text-1">{view.ended}</div>}
          Sign in to PsiAnywhere on the <Link to={PSI_LOG_HOME} className="font-semibold text-primary hover:underline">PSI Log</Link> page first, with an administrator account. The reset is done under your own PsiAnywhere session.
        </div>
      )}
      {view?.signedIn && view.platform && (
        <div className="mb-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] leading-[19px] text-text-2">
          You are signed in as <span className="font-semibold">{view.psiUser}</span>, the platform's collection account. You can reset others, but not this account itself.
        </div>
      )}
      {view?.signedIn && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-surface-2 px-3">
              <Search size={15} className="text-text-3" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person by name or PsiAnywhere user…"
                className="h-10 w-full bg-transparent text-[14px] text-text-1 outline-none placeholder:text-text-3" />
            </div>
            <label className="flex items-center gap-2 text-[12.5px] text-text-2">
              <input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Include inactive
            </label>
          </div>
          {!view.users ? (
            <div className="flex items-center gap-2 py-8 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading PsiAnywhere’s users…</div>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((u) => (
                <li key={u.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold text-text-1">{u.name}</span>
                      {!u.active && <span className={cn(chip, 'bg-tint-pink text-tint-fg-pink')}>Inactive</span>}
                    </div>
                    <div className="truncate text-[12.5px] text-text-3">{u.id}</div>
                  </div>
                  {canToggle && (
                    <button type="button" onClick={() => void toggleActive(u)} disabled={toggling === u.id}
                      title={u.active ? 'Deactivate this PsiAnywhere account' : 'Reactivate this PsiAnywhere account'}
                      className={cn(btn, 'h-8 border px-3', u.active
                        ? 'border-border bg-surface text-text-2 hover:bg-surface-2'
                        : 'border-tint-mint bg-tint-mint text-tint-fg-mint hover:opacity-90')}>
                      {toggling === u.id ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />} {u.active ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                  <button type="button" onClick={() => open(u)}
                    className={cn(btn, 'h-8 border border-border bg-surface text-text-1 hover:bg-surface-2')}>
                    <RotateCcw size={13} /> Reset password
                  </button>
                </li>
              ))}
              {view.users && shown.length === 0 && <li className="py-8 text-center text-[13px] text-text-3">No account matches.</li>}
            </ul>
          )}
        </div>
      )}

      <SidePanel open={!!picked} onClose={close} label="Reset Password" title={picked?.name ?? ''}
        footer={done ? (
          <div className="flex justify-end"><button type="button" onClick={close} className={cn(btn, 'bg-primary text-on-primary hover:opacity-90')}>Done</button></div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={close} disabled={busy} className={cn(btn, 'border border-border bg-surface text-text-1 hover:bg-surface-2')}>Cancel</button>
            <button type="button" onClick={() => void doReset()} disabled={!canReset} className={cn(btn, 'bg-primary text-on-primary hover:opacity-90')}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Reset password
            </button>
          </div>
        )}>
        {picked && !done && (
          <div className="mt-1 space-y-4">
            <div className="text-[13px] text-text-3">{picked.id}</div>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-text-3">Their new password</legend>
              <label className={cn('flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2.5', useDefault ? 'border-primary bg-surface-2' : 'border-border')}>
                <input type="radio" name="pw" checked={useDefault} onChange={() => setUseDefault(true)} className="mt-1" />
                <span>
                  <span className="block text-[13.5px] font-semibold text-text-1">A standard password</span>
                  <span className="block text-[12.5px] text-text-3">Built to pass PsiAnywhere’s rule, easy to read out — you see it after the reset to tell the person.</span>
                </span>
              </label>
              <label className={cn('flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2.5', !useDefault ? 'border-primary bg-surface-2' : 'border-border')}>
                <input type="radio" name="pw" checked={!useDefault} onChange={() => setUseDefault(false)} className="mt-1" />
                <span className="block text-[13.5px] font-semibold text-text-1">A password I type</span>
              </label>
              {!useDefault && (
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus placeholder={`At least ${min} characters, with a capital, a number and a symbol`} className={input} />
              )}
            </fieldset>
            <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-[19px] text-text-2">
              <li>The person signs in to PsiAnywhere with this password straight away.</li>
              <li>PsiAnywhere has no “change at next sign-in”, so tell them to change it themselves when they can.</li>
              {!picked.active && <li>This account is inactive — reactivate it in PsiAnywhere first, or the new password still cannot sign in.</li>}
            </ul>
          </div>
        )}
        {done && (
          <div className="mt-1 space-y-4">
            <div className="rounded-md border border-border bg-surface-2 p-4 text-center">
              <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-text-3">{done.name}’s new password</div>
              <div className="mt-2 flex items-center justify-center gap-2">
                <code className="select-all text-[20px] font-semibold tracking-wide text-text-1">{done.password}</code>
                <button type="button" onClick={() => void copy(done.password)} aria-label="Copy" className="grid h-8 w-8 place-items-center rounded-md border border-border text-text-2 hover:bg-surface">
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
            </div>
            <p className="text-[12.5px] leading-[19px] text-text-2">Tell the person this password. It is not kept anywhere — once you close this, it is gone. They sign in to PsiAnywhere with it, then change it themselves.</p>
          </div>
        )}
      </SidePanel>
    </div>
  )
}
