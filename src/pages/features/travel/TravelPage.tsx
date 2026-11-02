// Business Travel — the trips this company takes.
// What leads is the DECISION, not the map.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, Loader2, MapPin, Plus, X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Skeleton from '@/components/shared/Skeleton'
import { Badge } from '@/components/shared/Badge'
import DragPerson from '@/components/shared/DragPerson'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { askPrompt } from '@/stores/useDialogStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { cachedUsers, fetchUsers } from '@/lib/usersDirectory'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'

type Trip = {
  id: string; destination: string; country: string; purpose: string; status: string
  startDate: string; endDate: string; traveller: string; travellerEmail: string; requestedBy: string
  reason: string; outcome: string; decisionNote: string; budget: number; actualCost: number
  variance: number | null; decidedBy: string; decidedAt: string
}
/** a reimbursement filing — real evidence a trip happened, from staff_requests */
type Evidence = { id: string; type: string; person: string; from: string; to: string; details: string; status: string; at: string }
type State = { trips: Trip[]; statuses: string[]; purposes: string[]; evidence?: Evidence[] }

const STATUS_TINT: Record<string, TintName> = {
  proposed: 'amber', approved: 'blue', booked: 'lavender',
  completed: 'mint', cancelled: 'pink', declined: 'pink',
}
const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const field = 'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'
const label = 'mb-1 block text-[11px] font-semibold uppercase tracking-[0.07em] text-text-3'

// A stored YYYY-MM-DD read as a LOCAL day — never new Date(s), which is UTC midnight and a day early west of London.
function dayLabel(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) return ''
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function TravelPage() {
  const user = useAuthStore((s) => s.user)
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({
    destination: '', country: '', purpose: 'Client visit', traveller: '',
    reason: '', startDate: '', endDate: '', budget: '',
  })
  const [costing, setCosting] = useState<{ id: string; actualCost: string; outcome: string } | null>(null)
  // A PERSON, NOT A STRING: the traveller comes from the directory, so the outcome nudge can actually reach them.
  const [people, setPeople] = useState<{ name: string; email: string }[]>([])
  useEffect(() => {
    const shape = (rows: Record<string, unknown>[]) => rows
      .map((u) => ({ name: String(u.display_name ?? ''), email: String(u.email ?? '') }))
      .filter((u) => u.name)
    const seed = cachedUsers()
    if (seed) setPeople(shape(seed))
    else fetchUsers().then((rows) => setPeople(shape(rows))).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    try { setState(await gasAction<State>('travelList', {})) }
    catch (e) { toast({ type: 'danger', title: 'Could not read trips', body: e instanceof Error ? e.message : 'Try again.' }) }
  }, [])
  useEffect(() => { void load() }, [load])

  const proposed = useMemo(() => (state?.trips ?? []).filter((t) => t.status === 'proposed'), [state])
  const active = useMemo(() => (state?.trips ?? []).filter((t) => t.status === 'approved' || t.status === 'booked'), [state])
  const past = useMemo(() => (state?.trips ?? []).filter((t) => ['completed', 'cancelled', 'declined'].includes(t.status)), [state])
  const owing = useMemo(
    () => (state?.trips ?? []).filter((t) => (t.status === 'completed' || t.status === 'booked') && !t.outcome && t.endDate).length,
    [state],
  )

  const canDecide = user?.role === 'admin' || user?.role === 'manager'

  const save = async () => {
    setBusy('add')
    try {
      const hit = people.find((u) => u.name.trim().toLowerCase() === draft.traveller.trim().toLowerCase())
      const out = await gasAction<{ trips: Trip[] }>('travelSave', { ...draft, travellerEmail: hit?.email ?? '' })
      setState((s) => (s ? { ...s, trips: out.trips } : s))
      setDraft({ destination: '', country: '', purpose: 'Client visit', traveller: '',
                 reason: '', startDate: '', endDate: '', budget: '' })
      setAdding(false)
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const decide = async (t: Trip, status: string) => {
    let note = ''
    if (status === 'declined') {
      // A decline with no reason is the message people remember and nobody can act on, so it is asked for at the…
      const reason = await askPrompt({
        title: `Decline the trip to ${t.destination}?`,
        body: 'This is what the requester will read.',
        label: 'Why it is declined',
        placeholder: 'The reason, in a sentence.',
        required: true,
        multiline: true,
        tone: 'danger',
        confirmLabel: 'Decline the trip',
      })
      if (reason === null || !reason.trim()) return
      note = reason
    }
    setBusy(t.id)
    try {
      const out = await gasAction<{ trips: Trip[] }>('travelDecide', { id: t.id, status, note })
      setState((s) => (s ? { ...s, trips: out.trips } : s))
    } catch (e) {
      toast({ type: 'danger', title: 'Not recorded', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const close = async () => {
    if (!costing) return
    setBusy(costing.id)
    const t = state?.trips.find((x) => x.id === costing.id)
    if (!t) { setBusy(''); return }
    try {
      const out = await gasAction<{ trips: Trip[] }>('travelSave', {
        ...t, id: t.id, status: 'completed',
        actualCost: costing.actualCost, outcome: costing.outcome,
      })
      setState((s) => (s ? { ...s, trips: out.trips } : s))
      setCosting(null)
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const TripCard = ({ t }: { t: Trip }) => (
    <Card className="space-y-2.5">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[14px] font-semibold text-text-1">
            <MapPin size={13} className="shrink-0 text-text-3" />
            {t.destination}{t.country && <span className="font-normal text-text-3">, {t.country}</span>}
          </p>
          <p className="text-[12px] text-text-3">
            {t.purpose}
            {t.traveller && (
              <>
                {' · '}
                <DragPerson name={t.traveller}>
                  <span>{t.traveller}</span>
                </DragPerson>
              </>
            )}
            {t.startDate && ` · ${dayLabel(t.startDate)}`}
            {t.endDate && t.endDate !== t.startDate && ` → ${dayLabel(t.endDate)}`}
          </p>
        </div>
        <Badge label={t.status} tint={STATUS_TINT[t.status] ?? 'blue'} className="text-[10px] capitalize" />
      </div>

      {t.reason && <p className="text-[12.5px] leading-5 text-text-2">{t.reason}</p>}

      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-border pt-2 text-[12.5px]">
        <span className="text-text-3">Budget <strong className="tabular-nums text-text-1">{t.budget > 0 ? money(t.budget) : '—'}</strong></span>
        <span className="text-text-3">Actual <strong className="tabular-nums text-text-1">{t.actualCost > 0 ? money(t.actualCost) : '—'}</strong></span>
        {t.variance !== null ? (
          <span className={cn('font-semibold tabular-nums', t.variance > 0 ? 'text-tint-fg-amber' : 'text-tint-fg-mint')}>
            {t.variance > 0 ? `${money(t.variance)} over` : t.variance < 0 ? `${money(-t.variance)} under` : 'on budget'}
          </span>
        ) : (
          // Said, rather than shown as a zero somebody would read as "on budget".
          <span className="text-[11.5px] text-text-3">not costed yet</span>
        )}
      </div>

      {t.outcome && (
        <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2">
          <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">What came of it</p>
          <p className="text-[12.5px] leading-5 text-text-2">{t.outcome}</p>
        </div>
      )}

      {(canDecide && t.status === 'proposed') && (
        <div className="flex gap-2 border-t border-border pt-2.5">
          <button onClick={() => void decide(t, 'approved')} disabled={busy === t.id}
            className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
            {busy === t.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
          </button>
          <button onClick={() => void decide(t, 'declined')} disabled={busy === t.id}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40">
            <X size={12} /> Decline
          </button>
        </div>
      )}

      {(t.status === 'approved' || t.status === 'booked') && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-2.5">
          {canDecide && t.status === 'approved' && (
            <button onClick={() => void decide(t, 'booked')} disabled={busy === t.id}
              className="h-8 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40">
              Mark booked
            </button>
          )}
          <button onClick={() => setCosting({ id: t.id, actualCost: '', outcome: '' })}
            className="h-8 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
            Close it out
          </button>
          {canDecide && (
            <button onClick={() => void decide(t, 'cancelled')} disabled={busy === t.id}
              className="ml-auto h-8 rounded-md px-3 text-[12.5px] font-semibold text-text-3 transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-40">
              Cancel the trip
            </button>
          )}
        </div>
      )}

      {t.decisionNote && (
        <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2">
          <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">The decision's note</p>
          <p className="text-[12.5px] leading-5 text-text-2">{t.decisionNote}</p>
        </div>
      )}

      {t.decidedBy && (
        <p className="text-[11px] text-text-3">
          {t.status === 'declined' ? 'Declined' : t.status === 'cancelled' ? 'Cancelled' : t.status === 'booked' ? 'Booked' : 'Approved'} by{' '}
          <DragPerson name={t.decidedBy}>
            <span>{t.decidedBy}</span>
          </DragPerson>
        </p>
      )}
    </Card>
  )

  return (
    <div className="w-full px-5 py-6">
      <PageHeader title="Company Travel" subtitle="What the company spends to move — the filings first, the trips beside them." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button onClick={() => setAdding((a) => !a)}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover">
          {adding ? <X size={14} /> : <Plus size={14} />} {adding ? 'Cancel' : 'Propose a trip'}
        </button>
        {owing > 0 && (
          <span className="text-[12.5px] text-text-2">
            <strong className="text-tint-fg-amber">{owing}</strong> finished without a note on what came of it
          </span>
        )}
      </div>

      {/* ── THE SPENDING, FRONT AND CENTER — these are the headline items,
             two squares to a row: every reimbursement filing from Requests
             as its own card. ── */}
      {(state?.evidence ?? []).length > 0 && (
        <div className="mb-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
            Company spending — reimbursement filings · {(state?.evidence ?? []).length}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {(state?.evidence ?? []).map((ev) => (
              <Card key={ev.id} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <DragPerson name={ev.person || '—'}>
                    <span className="text-[13.5px] font-semibold text-text-1">{ev.person || '—'}</span>
                  </DragPerson>
                  <Badge label={ev.type.replace(/^Finances - /, '')} tint="lavender" className="text-[10px]" />
                  {ev.status && <Badge label={ev.status} tint={ev.status.toLowerCase() === 'resolved' ? 'mint' : 'amber'} className="ml-auto text-[10px]" />}
                </div>
                {(ev.from || ev.to) && (
                  <p className="text-[11.5px] text-text-3">
                    {ev.from ? dayLabel(ev.from) || ev.from : ''}{ev.to && ev.to !== ev.from ? ` → ${dayLabel(ev.to) || ev.to}` : ''}
                  </p>
                )}
                {ev.details && <p className="text-[12.5px] leading-5 text-text-2">{ev.details}</p>}
                <p className="text-[10.5px] text-text-3">Filed through the Requests app — a cost with a paper trail.</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {adding && (
        <Card className="mb-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={label}>Destination</label>
              <input autoFocus value={draft.destination} placeholder="City"
                onChange={(e) => setDraft((d) => ({ ...d, destination: e.target.value }))} className={field} /></div>
            <div><label className={label}>Country</label>
              <input value={draft.country} onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value }))} className={field} /></div>
            <div><label className={label}>Purpose</label>
              <select value={draft.purpose} onChange={(e) => setDraft((d) => ({ ...d, purpose: e.target.value }))} className={field}>
                {(state?.purposes ?? []).map((p) => <option key={p}>{p}</option>)}
              </select></div>
            <div><label className={label}>Who is going</label>
              <input value={draft.traveller} list="travel-people" placeholder="Pick from the directory"
                onChange={(e) => setDraft((d) => ({ ...d, traveller: e.target.value }))} className={field} />
              <datalist id="travel-people">
                {people.map((u) => <option key={u.email || u.name} value={u.name} />)}
              </datalist></div>
            <div><label className={label}>Leaves</label>
              <input type="date" value={draft.startDate} onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))} className={field} /></div>
            <div><label className={label}>Returns</label>
              <input type="date" value={draft.endDate} onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))} className={field} /></div>
            <div><label className={label}>Budget ($)</label>
              <input inputMode="decimal" value={draft.budget} onChange={(e) => setDraft((d) => ({ ...d, budget: e.target.value }))} className={field} /></div>
          </div>
          <div>
            {/* THE ONLY REQUIRED FIELD BESIDES THE DESTINATION, and the label
                says why rather than marking it with an asterisk. */}
            <label className={label}>Why is this trip needed</label>
            <input value={draft.reason} placeholder="One line. This is what an approver reads."
              onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} className={field} />
          </div>
          <div className="flex justify-end">
            <button onClick={() => void save()} disabled={!draft.destination.trim() || !draft.reason.trim() || busy === 'add'}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
              {busy === 'add' && <Loader2 size={13} className="animate-spin" />} Propose
            </button>
          </div>
        </Card>
      )}

      {costing && (
        <Card className="mb-4 space-y-3">
          <p className="text-[13px] font-semibold text-text-1">Closing out — what did it cost, and what came of it?</p>
          <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
            <div><label className={label}>Actual cost ($)</label>
              <input autoFocus inputMode="decimal" value={costing.actualCost}
                onChange={(e) => setCosting((c) => c && ({ ...c, actualCost: e.target.value }))} className={field} /></div>
            <div><label className={label}>What came of it</label>
              <input value={costing.outcome} placeholder="The thing you will want to read next year"
                onChange={(e) => setCosting((c) => c && ({ ...c, outcome: e.target.value }))} className={field} /></div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCosting(null)}
              className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2">Cancel</button>
            <button onClick={() => void close()} disabled={busy === costing.id}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
              {busy === costing.id && <Loader2 size={13} className="animate-spin" />} Close out
            </button>
          </div>
        </Card>
      )}

      {!state ? (
        <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : state.trips.length === 0 ? (
        <Card><p className="py-10 text-center text-[13px] text-text-3">No trips recorded yet.</p></Card>
      ) : (
        <div className="space-y-5">
          {[['Awaiting a decision', proposed], ['Coming up', active], ['Been and gone', past]]
            .filter(([, list]) => (list as Trip[]).length > 0)
            .map(([title, list]) => (
              <div key={String(title)}>
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
                  <CalendarDays size={12} /> {String(title)}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {(list as Trip[]).map((t) => <TripCard key={t.id} t={t} />)}
                </div>
              </div>
            ))}
        </div>
      )}

    </div>
  )
}
