// PSI Log: sign in to PsiAnywhere with YOUR OWN PsiAnywhere account and clock in and out right here, the way its
// Single Entry screen does (app/psi_log.py, /hub-lanes/psi-log). The password goes to PsiAnywhere and is never kept
// by the Hub; PsiAnywhere's session stays on the server. Every step lands in the log below. App Control decides who
// opens the app — with no row it is the master's alone. A session PsiAnywhere let go of (or a restart could not bring
// back) comes back as the sign-in card, with why, never as empty lists or a "said no" toast (psiLane.signedOut).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, Eye, EyeOff, Loader2, LogIn, LogOut, MapPin, RefreshCw, Search } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import SidePanel from '@/components/shared/SidePanel'
import { psiLane, PsiLaneError, signedOut, SESSION_ENDED } from './psiLane'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

export const PSI_LOG_PATH = '/hub-lanes/psi-log'

export type PsiEntry = {
  id: string; date: string; start: string; end: string; hours: string; location: string; workCode: string
  status: string; statusName: string; consumers: string
}
export type PsiCode = { id: string; name: string; billable: boolean; keytimes: string }
export type PsiPlace = { id: string; name: string }
export type PsiStep = {
  at: string; uid: string; psiUser: string; action: string; ok: boolean; word: string; entryId: string
  detail: Record<string, unknown>; unread?: boolean
}
export type PsiAccount = { account: string; label: string; user: string }
export type PsiView = {
  signedIn: boolean; needsCode: boolean; attest: string; name?: string; psiUser?: string; why?: string; platform?: string
  /** signed out because PsiAnywhere let go of the session, in its words */
  ended?: string
  entries?: PsiEntry[]; open?: PsiEntry | null; codes?: PsiCode[]; locations?: PsiPlace[]
  prefill?: string; platformAccounts?: PsiAccount[]
  log: PsiStep[]; everyone: PsiStep[] | null
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const list = <T,>(v: unknown, f: (r: Record<string, unknown>) => T): T[] =>
  Array.isArray(v) ? v.map((r) => f((r ?? {}) as Record<string, unknown>)) : []

function entryFrom(r: Record<string, unknown>): PsiEntry {
  return { id: text(r.id), date: text(r.date), start: text(r.start), end: text(r.end), hours: text(r.hours),
    location: text(r.location), workCode: text(r.workCode), status: text(r.status),
    statusName: text(r.statusName) || text(r.status), consumers: text(r.consumers) }
}
function stepFrom(r: Record<string, unknown>): PsiStep {
  return { at: text(r.at), uid: text(r.uid), psiUser: text(r.psiUser), action: text(r.action), ok: r.ok === true,
    word: text(r.word), entryId: text(r.entryId), unread: r.unread === true,
    detail: (r.detail && typeof r.detail === 'object' ? r.detail : {}) as Record<string, unknown> }
}

/** The lane's answer as this screen draws it; null when it is not the PSI Log. */
export function psiViewFrom(raw: unknown): PsiView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>
  if (typeof d.signedIn !== 'boolean') return null
  return {
    signedIn: d.signedIn, needsCode: d.needsCode === true, attest: text(d.attest), name: text(d.name),
    psiUser: text(d.psiUser), why: text(d.why), platform: text(d.platform), prefill: text(d.prefill), ended: text(d.ended),
    platformAccounts: list(d.platformAccounts, (r) => ({ account: text(r.account), label: text(r.label), user: text(r.user) })).filter((a) => a.user),
    entries: list(d.entries, entryFrom).filter((e) => e.id),
    open: d.open && typeof d.open === 'object' ? entryFrom(d.open as Record<string, unknown>) : null,
    codes: list(d.codes, (r) => ({ id: text(r.id), name: text(r.name), billable: r.billable === true,
      keytimes: text(r.keytimes) })).filter((c) => c.id),
    locations: list(d.locations, (r) => ({ id: text(r.id), name: text(r.name) })).filter((p) => p.id),
    log: list(d.log, stepFrom),
    everyone: Array.isArray(d.everyone) ? list(d.everyone, stepFrom) : null,
  }
}

/** '08:05' → '8:05 AM'. */
export function clockText(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return hhmm
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

const ACTIONS: Record<string, string> = {
  'sign-in': 'Signed in', code: 'Verification code', 'sign-out': 'Signed out', 'clock-in': 'Clocked in',
  'clock-out': 'Clocked out', submit: 'Submitted',
}

function stepLine(s: PsiStep): string {
  const what = ACTIONS[s.action] || s.action
  if (!s.ok) return `${what} — refused${s.word ? ` (${s.word})` : ''}`
  const d = s.detail
  if (s.action === 'clock-in') return `${what} at ${clockText(text(d.start))}${d.workCode ? ` · ${text(d.workCode)}` : ''}`
  if (s.action === 'clock-out') {
    return `${what} at ${clockText(text(d.end))} · ${text(d.hours)} h${s.word === 'submitted' ? ' · submitted' : ''}`
  }
  return what
}

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

type Spot = { latitude: string; longitude: string; accuracy: number }
const isMobile = (): boolean => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

/** The phone's place, as PsiAnywhere's own screen takes it; the reason in words when it cannot. */
function locate(): Promise<Spot> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This browser cannot tell where you are.')); return }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6),
        accuracy: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error(e.code === 1
        ? 'Location is blocked for this page. Allow it in your browser settings — PsiAnywhere needs it.'
        : 'Your location could not be found. Try again.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
  })
}

const input = 'h-10 w-full rounded-sm border border-border bg-surface px-3 text-[13.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary'
const btn = 'flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold disabled:opacity-50'
const card = 'rounded-lg border border-border bg-surface p-4'
const chip = 'inline-flex h-[20px] items-center rounded-full px-2 text-[11px] font-semibold'

function SpotLine({ spot, why, busy, onRetry }: { spot: Spot | null; why: string; busy: boolean; onRetry: () => void }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-[12.5px] leading-[19px]',
      spot ? 'border-border bg-surface-2 text-text-2' : 'border-tint-amber bg-tint-amber text-text-1')}>
      <MapPin size={14} className="mt-0.5 shrink-0" />
      <span className="flex-1">
        {busy ? 'Finding where you are…' : spot ? `Your location is ready (within ${spot.accuracy} m).`
          : why || 'PsiAnywhere needs where you are.'}
      </span>
      {!busy && !spot && <button type="button" onClick={onRetry} className="font-semibold underline">Try again</button>}
    </div>
  )
}

export default function PsiLogPage() {
  const [view, setView] = useState<PsiView | null>(null)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  // sign-in
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [code, setCode] = useState('')
  // the clock panels
  const [panel, setPanel] = useState<'' | 'in' | 'out'>('')
  const [workCode, setWorkCode] = useState('')
  const [place, setPlace] = useState('')
  const [people, setPeople] = useState<PsiPlace[] | null>(null)
  const [peopleWhy, setPeopleWhy] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [find, setFind] = useState('')
  const [note, setNote] = useState('')
  const [spot, setSpot] = useState<Spot | null>(null)
  const [spotWhy, setSpotWhy] = useState('')
  const [spotBusy, setSpotBusy] = useState(false)
  const [submit, setSubmit] = useState(false)
  const [everyone, setEveryone] = useState(false)
  // why the sign-in card is back when a step (not the page's read) found the session gone
  const [ended, setEnded] = useState('')

  const load = useCallback(async () => {
    try {
      const got = psiViewFrom(await psiLane<unknown>(PSI_LOG_PATH))
      if (!got) throw new Error('the server answered something that is not the PSI Log')
      setView(got)
      // the login is pre-set for the master: fill the user name with the platform account (ADM), password left for the
      // stored one — the lane sends no prefill (and no stored accounts) to anyone else
      if (!got.signedIn && got.prefill) setUsername((u) => u || got.prefill || '')
      if (got.signedIn) setEnded('')
      setWhy('')
    } catch (e) {
      setWhy(e instanceof Error ? e.message : 'the PSI Log could not be read')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const post = useCallback(async <T,>(door: string, body: Record<string, unknown> = {}): Promise<T> => (
    psiLane<T>(`${PSI_LOG_PATH}/${door}`, { method: 'POST', body: JSON.stringify(body) })), [])

  /** The session is gone: the side panels close and the page reads again, which draws the sign-in card. */
  const backToSignIn = useCallback(async (e: unknown) => {
    setEnded(e instanceof Error && e.message ? e.message : SESSION_ENDED)
    setPanel('')
    setPeople(null)
    await load()
  }, [load])

  const findSpot = useCallback(async () => {
    setSpotBusy(true)
    setSpot(null)
    setSpotWhy('')
    try { setSpot(await locate()) } catch (e) { setSpotWhy(e instanceof Error ? e.message : '') } finally {
      setSpotBusy(false)
    }
  }, [])

  const chosen = useMemo(() => view?.codes?.find((c) => c.id === workCode) ?? null, [view, workCode])
  useEffect(() => {
    if (panel !== 'in' || !chosen?.billable || people !== null) return
    let gone = false
    post<{ consumers?: unknown }>('consumers').then((got) => {
      if (!gone) setPeople(list(got?.consumers, (r) => ({ id: text(r.id), name: text(r.name) })).filter((p) => p.id))
    }).catch((e) => {
      if (gone) return
      if (signedOut(e)) void backToSignIn(e)
      else setPeopleWhy(e instanceof Error ? e.message : 'the people could not be read')
    })
    return () => { gone = true }
  }, [panel, chosen, people, post, backToSignIn])

  const shownPeople = useMemo(() => {
    const q = find.trim().toLowerCase()
    const all = people ?? []
    return q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all
  }, [people, find])

  const run = async (what: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try { await what() } catch (e) {
      if (signedOut(e)) await backToSignIn(e)
      // a 403 is the Hub's own door (the platform's stored accounts are the master's alone), not PsiAnywhere
      else toast({ type: 'danger', title: e instanceof PsiLaneError && e.status === 403 ? 'Not open to you' : 'PsiAnywhere said no',
        body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy(false) }
  }

  const signIn = (): Promise<void> => run(async () => {
    const got = await post<{ signedIn?: boolean; needsCode?: boolean; name?: string }>('sign-in',
      { username: username.trim(), password })
    setPassword('')
    if (got?.signedIn) toast({ type: 'success', title: `Signed in to PsiAnywhere as ${got.name || username}` })
    await load()
  })
  const sendCode = (): Promise<void> => run(async () => {
    await post('code', { code: code.trim() })
    setCode('')
    toast({ type: 'success', title: 'Signed in to PsiAnywhere' })
    await load()
  })
  const signOut = (): Promise<void> => run(async () => {
    await post('sign-out')
    await load()
  })

  const openIn = (): void => {
    setPanel('in'); setWorkCode(''); setPlace(view?.locations?.length === 1 ? view.locations[0].id : '')
    setPicked([]); setFind(''); setNote(''); void findSpot()
  }
  const openOut = (): void => { setPanel('out'); setSubmit(false); void findSpot() }
  const close = (): void => { if (!busy) setPanel('') }

  const canIn = !!chosen && !!spot && !busy && (chosen.billable ? picked.length > 0 : !!place)
  const clockIn = (): Promise<void> => run(async () => {
    if (!chosen || !spot) return
    const got = await post<{ start?: string; workCode?: string }>('clock-in', {
      workCodeId: chosen.id, locationId: chosen.billable ? '' : place, consumerIds: chosen.billable ? picked : [],
      note: note.trim(), latitude: spot.latitude, longitude: spot.longitude, mobile: isMobile() })
    toast({ type: 'success', title: `Clocked in at ${clockText(text(got?.start))}`,
      body: `${text(got?.workCode)} — saved on PsiAnywhere.` })
    setPanel('')
    await load()
  })
  const clockOut = (): Promise<void> => run(async () => {
    if (!view?.open || !spot) return
    const got = await post<{ end?: string; hours?: string; submitted?: boolean }>('clock-out', {
      singleEntryId: view.open.id, latitude: spot.latitude, longitude: spot.longitude, mobile: isMobile(), submit })
    toast({ type: 'success', title: `Clocked out at ${clockText(text(got?.end))}`,
      body: `${text(got?.hours)} h — ${got?.submitted ? 'submitted for approval' : 'saved on PsiAnywhere'}.` })
    setPanel('')
    await load()
  })

  const steps = everyone && view?.everyone ? view.everyone : view?.log ?? []
  const knownAccount = view?.platformAccounts?.find((a) => a.user.toLowerCase() === username.trim().toLowerCase()) ?? null

  return (
    <div className="mx-auto w-full max-w-[760px]">
      <PageHeader title="PSI Log" subtitle="Sign in to PsiAnywhere and clock in and out, right here." />
      {why && (
        <div className="mb-3 rounded-md border border-tint-amber bg-tint-amber px-3 py-2 text-[12.5px] leading-[19px] text-text-1">
          The PSI Log could not be read: {why}
          <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Try again</button>
        </div>
      )}
      {!view && !why && (
        <div className="flex items-center gap-2 py-8 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading…</div>
      )}

      {view && !view.signedIn && (
        <div className={card}>
          {view.needsCode ? (
            <form onSubmit={(e) => { e.preventDefault(); void sendCode() }} className="space-y-3">
              <div className="text-[14px] font-semibold text-text-1">Verification code</div>
              <p className="text-[12.5px] leading-[19px] text-text-2">PsiAnywhere sent a code to your email or phone. Type it here.</p>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code"
                autoFocus placeholder="Code" className={input} />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => void signOut()} disabled={busy}
                  className={cn(btn, 'border border-border bg-surface text-text-1 hover:bg-surface-2')}>Start over</button>
                <button type="submit" disabled={busy || !code.trim()} className={cn(btn, 'bg-primary text-on-primary hover:opacity-90')}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />} Confirm
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void signIn() }} className="space-y-3">
              <div className="text-[14px] font-semibold text-text-1">Sign in to PsiAnywhere</div>
              {(ended || view.ended) && (
                <div className="rounded-md border border-tint-amber bg-tint-amber px-3 py-2 text-[12.5px] leading-[19px] text-text-1">
                  {ended || view.ended}
                </div>
              )}
              <p className="text-[12.5px] leading-[19px] text-text-2">
                {(view.platformAccounts?.length ?? 0) > 0 ? 'Use a PsiAnywhere account.' : 'Use your own PsiAnywhere account.'}
                {' '}It goes to PsiAnywhere only — the Hub never keeps your password.
              </p>
              {/* the stored platform accounts' one click: the master's alone — the lane names them to no one else */}
              {(view.platformAccounts?.length ?? 0) > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] text-text-3">Stored:</span>
                  {view.platformAccounts?.map((a) => (
                    <button key={a.account} type="button" onClick={() => { setUsername(a.user); setPassword('') }}
                      className={cn('h-7 rounded-full border px-3 text-[12px] font-semibold',
                        username.trim().toLowerCase() === a.user.toLowerCase() ? 'border-primary bg-surface-2 text-text-1' : 'border-border bg-surface text-text-2 hover:bg-surface-2')}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username"
                placeholder="PsiAnywhere user name" className={input} />
              <div className="relative">
                <input type={shown ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password" placeholder={knownAccount ? 'Using the stored password — type to change' : 'Password'}
                  className={cn(input, 'pr-10')} />
                <button type="button" onClick={() => setShown((v) => !v)} aria-label={shown ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-sm text-text-3 hover:text-text-1">
                  {shown ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="text-[12px] leading-[18px] text-text-3">
                {knownAccount
                  ? `${knownAccount.label} is a stored account — leave the password empty to sign in with it. For another account, like Tyler's, clear the name and type theirs.`
                  : 'PsiAnywhere locks an account after three wrong passwords. After two, the Hub stops trying — reset it with Forgot Password on PsiAnywhere.'}
              </p>
              <div className="flex justify-end">
                <button type="submit" disabled={busy || !username.trim() || (!password && !knownAccount)}
                  className={cn(btn, 'bg-primary text-on-primary hover:opacity-90')}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />} Sign in
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {view?.signedIn && (
        <div className="space-y-3">
          <div className={cn(card, 'flex flex-wrap items-center gap-3')}>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-text-3">Signed in to PsiAnywhere</div>
              <div className="truncate text-[15px] font-semibold text-text-1">{view.name}</div>
            </div>
            <button type="button" onClick={() => void load()} disabled={busy} aria-label="Refresh"
              className={cn(btn, 'border border-border bg-surface text-text-1 hover:bg-surface-2')}><RefreshCw size={14} /></button>
            <button type="button" onClick={() => void signOut()} disabled={busy}
              className={cn(btn, 'border border-border bg-surface text-text-1 hover:bg-surface-2')}><LogOut size={14} /> Sign out</button>
          </div>

          {view.why && (
            <div className="rounded-md border border-tint-amber bg-tint-amber px-3 py-2 text-[12.5px] leading-[19px] text-text-1">{view.why}</div>
          )}

          {view.platform ? (
            <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] leading-[19px] text-text-2">{view.platform}</div>
          ) : (
          <div className={cn(card, 'flex flex-wrap items-center gap-4')}>
            <div className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-full',
              view.open ? 'bg-tint-mint text-tint-fg-mint' : 'bg-surface-2 text-text-3')}><Clock size={22} /></div>
            <div className="min-w-0 flex-1">
              {view.open ? (
                <>
                  <div className="text-[16px] font-semibold text-text-1">Clocked in since {clockText(view.open.start)}</div>
                  <div className="truncate text-[13px] text-text-2">
                    {[view.open.workCode, view.open.location].filter(Boolean).join(' · ')}
                  </div>
                </>
              ) : (
                <div className="text-[16px] font-semibold text-text-1">You are not clocked in</div>
              )}
            </div>
            {view.open ? (
              <button type="button" onClick={openOut} disabled={busy}
                className={cn(btn, 'h-11 bg-primary px-5 text-[14px] text-on-primary hover:opacity-90')}><LogOut size={16} /> Clock out</button>
            ) : (
              <button type="button" onClick={openIn} disabled={busy || !view.codes?.length}
                className={cn(btn, 'h-11 bg-primary px-5 text-[14px] text-on-primary hover:opacity-90')}><LogIn size={16} /> Clock in</button>
            )}
          </div>
          )}

          <div className={card}>
            <div className="mb-2 text-[13px] font-semibold text-text-1">Today and yesterday on PsiAnywhere</div>
            {(view.entries ?? []).length === 0 ? (
              <div className="py-3 text-[13px] text-text-3">No entries.</div>
            ) : (
              <ul className="divide-y divide-border">
                {(view.entries ?? []).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                    <span className="w-[92px] shrink-0 text-text-3">{e.date}</span>
                    <span className="font-semibold text-text-1">{clockText(e.start)} – {e.end ? clockText(e.end) : 'open'}</span>
                    <span className="min-w-0 flex-1 truncate text-text-2">{[e.workCode, e.location].filter(Boolean).join(' · ')}</span>
                    {e.hours && e.end && <span className="text-text-2">{e.hours} h</span>}
                    {e.statusName && <span className={cn(chip, 'bg-surface-2 text-text-2')}>{e.statusName}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {view && (
        <div className={cn(card, 'mt-3')}>
          <div className="mb-2 flex items-center gap-2">
            <div className="flex-1 text-[13px] font-semibold text-text-1">{everyone ? 'Everyone’s PSI Log' : 'My PSI Log'}</div>
            {view.everyone && (
              <button type="button" onClick={() => setEveryone((v) => !v)} className="text-[12.5px] font-semibold text-primary">
                {everyone ? 'Only mine' : 'Everyone'}
              </button>
            )}
          </div>
          {steps.some((s) => s.unread) ? (
            <div className="py-3 text-[13px] text-text-3">The log could not be read.</div>
          ) : steps.length === 0 ? (
            <div className="py-3 text-[13px] text-text-3">Nothing yet.</div>
          ) : (
            <ul className="divide-y divide-border">
              {steps.map((s, i) => (
                <li key={`${s.at}-${i}`} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                  <span className="w-[120px] shrink-0 text-text-3">{when(s.at)}</span>
                  <span className={cn('min-w-0 flex-1', s.ok ? 'text-text-1' : 'text-tint-fg-pink')}>{stepLine(s)}</span>
                  {everyone && <span className="text-text-3">{s.psiUser}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <SidePanel open={panel === 'in'} onClose={close} label="PSI Log" title="Clock in"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={close} disabled={busy}
              className={cn(btn, 'border border-border bg-surface text-text-1 hover:bg-surface-2')}>Cancel</button>
            <button type="button" onClick={() => void clockIn()} disabled={!canIn}
              className={cn(btn, 'bg-primary text-on-primary hover:opacity-90')}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />} Clock in
            </button>
          </div>
        }>
        {panel === 'in' && view?.signedIn && (
          <div className="mt-1 space-y-4">
            <label className="block space-y-1">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-text-3">Work code</span>
              <select value={workCode} onChange={(e) => { setWorkCode(e.target.value); setPicked([]) }} className={input}>
                <option value="">Choose…</option>
                {(view.codes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.billable ? ' (billable)' : ''}</option>)}
              </select>
            </label>
            {chosen && !chosen.billable && (
              <label className="block space-y-1">
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-text-3">Where you are working</span>
                <select value={place} onChange={(e) => setPlace(e.target.value)} className={input}>
                  <option value="">Choose…</option>
                  {(view.locations ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
            {chosen?.billable && (
              <div className="space-y-1">
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-text-3">
                  The people you are with{picked.length ? ` · ${picked.length}` : ''}
                </span>
                <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3">
                  <Search size={14} className="text-text-3" />
                  <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a person…"
                    className="h-9 w-full bg-transparent text-[13.5px] text-text-1 outline-none placeholder:text-text-3" />
                </div>
                {peopleWhy ? (
                  <div className="text-[12.5px] text-tint-fg-pink">{peopleWhy}</div>
                ) : people === null ? (
                  <div className="flex items-center gap-2 py-2 text-[12.5px] text-text-3"><Loader2 size={13} className="animate-spin" /> Reading PsiAnywhere’s list…</div>
                ) : (
                  <ul className="max-h-[260px] overflow-y-auto rounded-md border border-border">
                    {shownPeople.map((p) => (
                      <li key={p.id}>
                        <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13.5px] text-text-1 hover:bg-surface-2">
                          <input type="checkbox" checked={picked.includes(p.id)}
                            onChange={(e) => setPicked((v) => (e.target.checked ? [...v, p.id] : v.filter((x) => x !== p.id)))} />
                          {p.name}
                        </label>
                      </li>
                    ))}
                    {shownPeople.length === 0 && <li className="px-3 py-2 text-[12.5px] text-text-3">Nobody matches.</li>}
                  </ul>
                )}
              </div>
            )}
            <label className="block space-y-1">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-text-3">Note (optional)</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] text-text-1 outline-none focus:border-primary" />
            </label>
            <SpotLine spot={spot} why={spotWhy} busy={spotBusy} onRetry={() => void findSpot()} />
            <p className="text-[12px] leading-[18px] text-text-3">The entry starts now and is saved on PsiAnywhere, as its own Single Entry screen saves it.</p>
          </div>
        )}
      </SidePanel>

      <SidePanel open={panel === 'out'} onClose={close} label="PSI Log" title="Clock out"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={close} disabled={busy}
              className={cn(btn, 'border border-border bg-surface text-text-1 hover:bg-surface-2')}>Cancel</button>
            <button type="button" onClick={() => void clockOut()} disabled={busy || !spot}
              className={cn(btn, 'bg-primary text-on-primary hover:opacity-90')}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />} Clock out
            </button>
          </div>
        }>
        {panel === 'out' && view?.open && (
          <div className="mt-1 space-y-4">
            <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-1">
              Since {clockText(view.open.start)} · {[view.open.workCode, view.open.location].filter(Boolean).join(' · ')}
            </div>
            <SpotLine spot={spot} why={spotWhy} busy={spotBusy} onRetry={() => void findSpot()} />
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2.5">
              <input type="checkbox" checked={submit} onChange={(e) => setSubmit(e.target.checked)} className="mt-1" />
              <span>
                <span className="block text-[13.5px] font-semibold text-text-1">Submit it for approval</span>
                <span className="block text-[12.5px] leading-[19px] text-text-3">{view.attest}</span>
              </span>
            </label>
            <p className="text-[12px] leading-[18px] text-text-3">Without it, the entry is saved on PsiAnywhere and you submit it there.</p>
          </div>
        )}
      </SidePanel>
    </div>
  )
}
