// PSI Log › Time entries: every punch PsiAnywhere holds between two days, as the attendance lane keeps them
// (the full punches' house on app.resource_rows, read by /hub-lanes/psi-log/entries) — who, when, where, the code,
// the people present, the hours and the place the phone was. App Control's psi-log.collection row opens it.
// Whoever App Control's psi-log.approve row names may also approve the hours awaiting approval (adminUpdateSingleEntry
// Status: Awaiting approval → Submitted), signed in to PsiAnywhere with an admin account.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CheckCheck, Loader2, Search, X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import SidePanel from '@/components/shared/SidePanel'
import { relayLane } from '@/lib/noticesApi'
import { psiLane, PSI_LOG_HOME, signedOut, SESSION_ENDED } from './psiLane'
import { toast } from '@/stores/useToastStore'
import { useFeatureAllowed } from '@/lib/featureAccess'
import { cn } from '@/lib/utils'

export type PsiPunch = Record<string, unknown>
const text = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : String(v))
const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const STATUS: Record<string, string> = {
  A: 'Awaiting approval', P: 'Pending', R: 'Rejected', I: 'Imported', S: 'Submitted', D: 'Duplicate',
}
const input = 'h-10 rounded-sm border border-border bg-surface px-3 text-[13.5px] text-text-1 outline-none focus:border-primary'
const chip = 'inline-flex h-[20px] items-center rounded-full px-2 text-[11px] font-semibold'

export default function PsiEntriesPage() {
  const canApprove = useFeatureAllowed('psi-log.approve')
  const today = useMemo(() => new Date(), [])
  const [from, setFrom] = useState(iso(new Date(today.getTime() - 6 * 86400000)))
  const [to, setTo] = useState(iso(today))
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<PsiPunch[] | null>(null)
  const [hours, setHours] = useState(0)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<PsiPunch | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reject, setReject] = useState(false)
  const [reason, setReason] = useState('')
  // the approval found no PsiAnywhere session (it ended there): the way back to the sign-in, not a "not approved" toast
  const [signIn, setSignIn] = useState('')

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const qs = new URLSearchParams({ from, to, ...(q.trim() ? { q: q.trim() } : {}) })
      const got = await relayLane<{ rows?: PsiPunch[]; hours?: number }>(`/hub-lanes/psi-log/entries?${qs}`)
      setRows(Array.isArray(got?.rows) ? got.rows : [])
      setHours(Number(got?.hours) || 0)
      setPicked(new Set())
      setWhy('')
    } catch (e) {
      setWhy(e instanceof Error ? e.message : 'the entries could not be read')
    } finally {
      setBusy(false)
    }
  }, [from, to, q])

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 350)
    return () => window.clearTimeout(t)
  }, [load])

  const awaiting = useMemo(() => (rows ?? []).filter((r) => text(r.status).toUpperCase() === 'A'), [rows])
  const toggle = (id: string): void => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allAwaiting = (): void => setPicked(picked.size === awaiting.length ? new Set() : new Set(awaiting.map((r) => text(r.id))))

  const decide = async (decision: 'approve' | 'reject', why = ''): Promise<void> => {
    const chosen = (rows ?? []).filter((r) => picked.has(text(r.id)) && text(r.status).toUpperCase() === 'A')
    if (chosen.length === 0) return
    const setFlag = decision === 'approve' ? setApproving : setRejecting
    setFlag(true)
    try {
      const got = await psiLane<{ decided?: number; failed?: unknown[] }>('/hub-lanes/psi-log/approve', {
        method: 'POST',
        body: JSON.stringify({ entries: chosen.map((r) => ({ id: text(r.id), status: 'A' })), decision, reason: why }),
      })
      const n = Number(got?.decided) || 0
      const failed = Array.isArray(got?.failed) ? got.failed.length : 0
      const word = decision === 'approve' ? 'approved' : 'rejected'
      toast({ type: failed ? 'danger' : 'success', title: `${n} entr${n === 1 ? 'y' : 'ies'} ${word}`,
        body: failed ? 'Some were refused by PsiAnywhere — refresh and try the rest.'
          : decision === 'approve' ? 'They are Submitted in PsiAnywhere now.' : 'They went back to the staff with your reason.' })
      setReason('')
      setSignIn('')
      await load()
    } catch (e) {
      if (signedOut(e)) setSignIn(e instanceof Error && e.message ? e.message : SESSION_ENDED)
      else toast({ type: 'danger', title: decision === 'approve' ? 'Not approved' : 'Not rejected', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setFlag(false)
    }
  }

  return (
    <div className="w-full">
      <PageHeader title="PSI time entries" subtitle="Every punch PsiAnywhere holds, as the attendance lane collects them." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} aria-label="From" />
        <span className="text-text-3">to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} aria-label="To" />
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-surface-2 px-3">
          <Search size={15} className="text-text-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Employee, house, client, code…"
            className="h-10 w-full bg-transparent text-[14px] text-text-1 outline-none placeholder:text-text-3" />
        </div>
        {busy && <Loader2 size={15} className="animate-spin text-text-3" />}
      </div>
      {why && (
        <div className="mb-3 rounded-md border border-tint-amber bg-tint-amber px-3 py-2 text-[12.5px] leading-[19px] text-text-1">{why}</div>
      )}
      {signIn && (
        <div className="mb-3 rounded-lg border border-border bg-surface p-4 text-[13px] text-text-2">
          <div className="mb-1 font-semibold text-text-1">{signIn}</div>
          Sign in to PsiAnywhere on the <Link to={PSI_LOG_HOME} className="font-semibold text-primary hover:underline">PSI Log</Link> page,
          with an administrator account, then come back and try again.
        </div>
      )}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <div className="flex-1 text-[12.5px] text-text-3">
            {rows ? `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} · ${hours} h` : ''}{rows && rows.length >= 1000 ? ' · the first 1000 — narrow the days' : ''}
            {canApprove && awaiting.length > 0 && <span> · {awaiting.length} awaiting approval</span>}
          </div>
          {canApprove && awaiting.length > 0 && (
            <>
              <button type="button" onClick={allAwaiting} className="text-[12.5px] font-semibold text-primary">
                {picked.size === awaiting.length ? 'Clear' : `Select all ${awaiting.length} awaiting`}
              </button>
              <button type="button" onClick={() => void decide('approve')} disabled={approving || rejecting || picked.size === 0}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-on-primary hover:opacity-90 disabled:opacity-50">
                {approving ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />} Approve{picked.size ? ` ${picked.size}` : ''}
              </button>
              <button type="button" onClick={() => setReject(true)} disabled={approving || rejecting || picked.size === 0}
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50">
                <X size={14} /> Reject
              </button>
            </>
          )}
        </div>
        {reject && (
          <div className="mb-3 rounded-md border border-border bg-surface-2 p-3">
            <div className="mb-2 text-[12.5px] font-semibold text-text-1">Reject {picked.size} entr{picked.size === 1 ? 'y' : 'ies'} — tell the staff why</div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus placeholder="Reason (the staff member sees this)"
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none focus:border-primary" />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => { setReject(false); setReason('') }} disabled={rejecting}
                className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => void decide('reject', reason).then(() => setReject(false))} disabled={rejecting || !reason.trim()}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-on-primary hover:opacity-90 disabled:opacity-50">
                {rejecting ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Reject {picked.size}
              </button>
            </div>
          </div>
        )}
        {!rows ? (
          <div className="flex items-center gap-2 py-8 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading…</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-text-3">No entry in these days.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-text-3">
                  {canApprove && <th className="w-8 px-2 py-2"></th>}
                  {['Date', 'Employee', 'Start', 'End', 'Hours', 'Code', 'House', 'People', 'Status'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const st = text(r.status).toUpperCase()
                  const id = text(r.id)
                  return (
                    <tr key={id || i} className={cn('border-b border-border text-text-1', picked.has(id) && 'bg-surface-2')}>
                      {canApprove && (
                        <td className="px-2 py-1.5">
                          {st === 'A' && <input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id)} aria-label="Select to approve" />}
                        </td>
                      )}
                      <td className="cursor-pointer whitespace-nowrap px-2 py-1.5" onClick={() => setOpen(r)}>{text(r.date)}</td>
                      <td className="max-w-[200px] cursor-pointer truncate px-2 py-1.5 font-semibold" onClick={() => setOpen(r)}>{text(r.employee)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{text(r.start)}</td>
                      <td className={cn('whitespace-nowrap px-2 py-1.5', !text(r.end) && 'text-tint-fg-mint')}>{text(r.end) || 'open'}</td>
                      <td className="px-2 py-1.5">{r.hours == null ? '' : text(r.hours)}</td>
                      <td className="max-w-[140px] truncate px-2 py-1.5">{text(r.workCode)}</td>
                      <td className="max-w-[160px] truncate px-2 py-1.5">{text(r.house) || text(r.location)}</td>
                      <td className="max-w-[220px] truncate px-2 py-1.5">{text(r.consumers)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <span className={cn(chip, st === 'A' ? 'bg-tint-amber text-tint-fg-amber' : st === 'S' ? 'bg-tint-mint text-tint-fg-mint' : 'bg-surface-2 text-text-2')}>
                          {STATUS[st] || text(r.status)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SidePanel open={!!open} onClose={() => setOpen(null)} label="PSI time entry" title={open ? `${text(open.employee)} · ${text(open.date)}` : ''}>
        {open && (
          <dl className="mt-1 divide-y divide-border text-[13px]">
            {Object.entries(open).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[130px_1fr] gap-3 py-1.5">
                <dt className="text-text-3">{k}</dt>
                <dd className="break-words text-text-1">{k === 'status' ? (STATUS[text(v).toUpperCase()] || text(v)) : text(v)}</dd>
              </div>
            ))}
            {text(open.latitude) && text(open.longitude) && (
              <div className="py-2">
                <a href={`https://www.google.com/maps?q=${text(open.latitude)},${text(open.longitude)}`} target="_blank" rel="noreferrer"
                  className="text-[13px] font-semibold text-primary">Open the punch's place on a map</a>
              </div>
            )}
          </dl>
        )}
      </SidePanel>
    </div>
  )
}
