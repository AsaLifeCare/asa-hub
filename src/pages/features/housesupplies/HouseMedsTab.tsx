// MEDICATIONS — what the pharmacy dispensed for each resident, by house, then client, then prescription (one row…
// The relay has already narrowed the rows to this reader: a house manager sees the residents of the houses they…
import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import Card from '@/components/shared/Card'
import SearchInput from '@/components/shared/SearchInput'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import EmptyState from '@/components/shared/EmptyState'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { lane, post, LaneError } from '@/pages/features/shifts/laneFetch'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { TINT_PAIR } from '@/lib/tints'
import {
  cutoffWords, filterRx, fmtDay, groupRx, leftWords, patientLabel, qty, span,
  type MedsPatient, type MedsRx, type MedsView,
} from '@/lib/houseMedsAnalysis'
import { HOUSE_MEDS_PATH } from './useHouseMeds'

type History = {
  rx_root: string
  patient: string
  rows: { report_start: string; report_end: string; drug: string; physician: string; last_dispense: string;
          dispensed_in_period: string; qty_remaining: string; qty_dispensed_to_date: string; cutoff: string }[]
  sum_dispensed: string
  cumulative: string
  not_in_reports: string
}

const COLS = ['Drug', 'Directions', 'Prescriber', 'Written', 'Last dispensed', 'Dispensed this report',
  'Left on Rx', 'Cutoff', 'Reports seen']

function MatchPicker({ patient, view, onDone }: { patient: MedsPatient; view: MedsView; onDone: () => void }) {
  const [pick, setPick] = useState(patient.client_key)
  const [busy, setBusy] = useState(false)
  const clients = view.clients ?? []
  const save = async () => {
    if (!pick) return
    setBusy(true)
    try {
      await post(`${HOUSE_MEDS_PATH}/match`, { patid: patient.patid, client_key: pick })
      toast({ type: 'success', title: 'Matched', body: `PatID ${patient.patid} now reads as that client.` })
      onDone()
    } catch (err) {
      toast({ type: 'danger', title: 'The match was not saved', body: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy}
        className="h-8 max-w-[220px] rounded-sm border border-border bg-surface px-2 text-[12px] text-text-1">
        <option value="">Choose the client…</option>
        {clients.map((c) => <option key={c.client_key} value={c.client_key}>{c.name}{c.house ? ` · ${c.house}` : ''}</option>)}
      </select>
      <button type="button" onClick={() => void save()} disabled={busy || !pick}
        className="inline-flex h-8 items-center gap-1 rounded-sm bg-primary px-2.5 text-[12px] font-semibold text-on-primary disabled:opacity-40">
        {busy && <Loader2 size={12} className="animate-spin" />} Match
      </button>
    </span>
  )
}

export default function HouseMedsTab({ view, todayIso, initialLow, onChanged, fixedHouse, readHistory }: {
  view: MedsView
  todayIso: string
  initialLow: boolean
  onChanged: () => void
  /** one house's residents only, with no house picker (Locations › Supplies) */
  fixedHouse?: string
  /** a prescription's history read through another door than this lane's (Locations' own) */
  readHistory?: (key: string) => Promise<unknown>
}) {
  const [house, setHouse] = useState(fixedHouse ?? '')
  const [client, setClient] = useState('')
  const [drug, setDrug] = useState('')
  const [lowOnly, setLowOnly] = useState(initialLow)
  const [which, setWhich] = useState<'current' | 'all'>('current')
  const [open, setOpen] = useState<MedsRx | null>(null)
  const [hist, setHist] = useState<History | null>(null)
  const [histError, setHistError] = useState('')

  const houses = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of view.patients) if (p.house) m.set(p.house, p.house_label || p.house)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [view.patients])
  const clientsHere = useMemo(() => {
    const m = new Map<string, MedsPatient>()
    for (const p of view.patients) if (!house || p.house === house) m.set(p.key, p)
    return [...m.values()].sort((a, b) => patientLabel(a).localeCompare(patientLabel(b)))
  }, [view.patients, house])
  const rx = useMemo(() => filterRx(view, { house, client, drug, lowOnly, current: which === 'current' }),
    [view, house, client, drug, lowOnly, which])
  const groups = useMemo(() => groupRx(view, rx), [view, rx])
  const writer = view.scope.writer

  const openRx = async (r: MedsRx) => {
    setOpen(r)
    setHist(null)
    setHistError('')
    try {
      setHist(readHistory ? await readHistory(r.rx_root) as History
        : await lane<History>(`${HOUSE_MEDS_PATH}/rx?key=${encodeURIComponent(r.rx_root)}`))
    } catch (err) {
      setHistError(err instanceof LaneError && err.status === 404 ? 'This prescription is not on file for you.'
        : err instanceof Error ? err.message : String(err))
    }
  }

  const select = 'h-9 rounded-sm border border-border bg-surface px-2.5 text-[13px] text-text-1'
  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!fixedHouse && houses.length > 1 && (
          <select value={house} onChange={(e) => { setHouse(e.target.value); setClient('') }} className={select}>
            <option value="">Every house</option>
            {houses.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        )}
        <select value={client} onChange={(e) => setClient(e.target.value)} className={select}>
          <option value="">Every client</option>
          {clientsHere.map((p) => <option key={p.key} value={p.key}>{patientLabel(p)}</option>)}
        </select>
        <SearchInput value={drug} onChange={setDrug} placeholder="Search a drug…" className="w-[220px] max-w-full" />
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-border bg-surface px-3 text-[12.5px] text-text-2">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Running low only
        </label>
        <SegmentedTabs
          tabs={[{ id: 'current', label: 'Current' }, { id: 'all', label: 'All reports' }]}
          value={which}
          onChange={(v) => setWhich(v as 'current' | 'all')}
        />
      </div>

      {!groups.length && (
        <Card>
          <EmptyState
            title={view.patients.length ? 'No prescription answers to these filters' : 'No resident to show'}
            body={view.patients.length ? 'Clear a filter, or switch to All reports.'
              : view.scope.why || 'The pharmacy has reported no resident this reader may see.'}
          />
        </Card>
      )}

      {groups.map((g) => (
        <section key={g.id} className="mb-6">
          <h2 className="mb-2 flex items-baseline gap-2 font-display text-[15px] font-semibold text-text-1">
            {g.title}
            <span className="text-[12px] font-normal text-text-3">
              {g.clients.length} {g.kind === 'unmatched' ? 'PatID' : 'client'}{g.clients.length === 1 ? '' : 's'}
            </span>
          </h2>
          {g.clients.map(({ patient, rx: rows }) => (
            <Card key={patient.key} padded={false} className="mb-3 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-text-1">{patientLabel(patient)}</span>
                  {patient.facilities.length > 0 && (
                    <span className="text-[11.5px] text-text-3">{patient.facilities.join(' → ')}</span>
                  )}
                  {patient.match === 'review' && (
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', TINT_PAIR('amber'))}>
                      <AlertTriangle size={11} /> Needs a person — this PatID now reports a different name
                    </span>
                  )}
                  {patient.match === 'ambiguous' && (
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', TINT_PAIR('amber'))}>
                      Needs a person — {patient.note || 'more than one client could be meant'}
                    </span>
                  )}
                </div>
                {writer && patient.group !== 'house' && <MatchPicker patient={patient} view={view} onDone={onChanged} />}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-[12.5px]">
                  <thead>
                    <tr className="bg-surface-2/60 text-[11px] uppercase tracking-[0.06em] text-text-3">
                      {COLS.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const left = qty(r.qty_remaining)
                      const low = left !== null && left <= view.low_left
                      return (
                        <tr key={r.rx_root} onClick={() => void openRx(r)}
                          className={cn('cursor-pointer border-t border-border hover:bg-surface-2/60',
                            r.maybe_same_as && writer && 'bg-tint-amber')}>
                          <td className="px-3 py-2 font-medium text-text-1">
                            {r.drug}
                            {r.labels.length > 1 && (
                              <span className="block text-[11px] font-normal text-text-3">also reported as {r.labels.filter((l) => l !== r.drug).join(', ')}</span>
                            )}
                            {r.maybe_same_as && writer && (
                              <span className="block text-[11px] font-normal text-tint-fg-amber">Possibly the same as another prescription — never merged</span>
                            )}
                          </td>
                          <td className="max-w-[260px] truncate px-3 py-2 text-text-2" title={r.sig}>{r.sig}</td>
                          <td className="px-3 py-2 text-text-2">{r.physician}</td>
                          <td className="px-3 py-2 text-text-2">{fmtDay(r.date_written)}</td>
                          <td className="px-3 py-2 text-text-2">{fmtDay(r.last_dispense)}</td>
                          <td className="px-3 py-2 text-text-2">{r.dispensed_in_period || '—'}</td>
                          <td className={cn('px-3 py-2 font-semibold', low ? 'text-tint-fg-danger' : 'text-text-1')}>{leftWords(r)}</td>
                          <td className="px-3 py-2 text-text-2">{cutoffWords(r.cutoff, todayIso)}</td>
                          <td className="px-3 py-2 text-text-2">{r.reports_seen}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </section>
      ))}

      <p className="mt-2 text-[12px] text-text-3">
        Left on Rx is what the prescription still authorizes, not the stock at the house.
      </p>

      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpen(null) }}>
        <SheetContent className="flex w-full flex-col overflow-y-auto bg-surface sm:w-[384px]">
          <SheetHeader>
            <SheetTitle className="font-display">{open?.drug ?? ''}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            {open && <p className="mb-3 text-[12.5px] text-text-2">{open.sig}</p>}
            {!hist && !histError && <p className="text-[12.5px] text-text-3">Reading the history…</p>}
            {histError && <p className="text-[12.5px] text-tint-fg-danger">{histError}</p>}
            {hist && (
              <>
                <div className="mb-3 grid grid-cols-2 gap-3 text-[12.5px]">
                  <div className="rounded-md bg-surface-2 p-3">
                    <p className="text-text-3">Dispensed to date (the pharmacy's figure)</p>
                    <p className="font-stat text-[20px] text-text-1">{hist.cumulative || '—'}</p>
                  </div>
                  <div className="rounded-md bg-surface-2 p-3">
                    <p className="text-text-3">Summed over the reports on file</p>
                    <p className="font-stat text-[20px] text-text-1">{hist.sum_dispensed || '—'}</p>
                    {qty(hist.not_in_reports) ? (
                      <p className="mt-0.5 text-[11.5px] text-text-3">{hist.not_in_reports} not in the reports on file</p>
                    ) : null}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-left text-[12px]">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-[0.06em] text-text-3">
                        {['Report', 'Label', 'Last dispensed', 'Dispensed', 'Left on Rx', 'To date'].map((c) =>
                          <th key={c} className="px-2 py-1.5 font-medium">{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {[...hist.rows].reverse().map((r) => (
                        <tr key={r.report_start} className="border-t border-border">
                          <td className="px-2 py-1.5 text-text-2">{span(r.report_start, r.report_end)}</td>
                          <td className="px-2 py-1.5 text-text-1">{r.drug}</td>
                          <td className="px-2 py-1.5 text-text-2">{fmtDay(r.last_dispense)}</td>
                          <td className="px-2 py-1.5 text-text-2">{r.dispensed_in_period}</td>
                          <td className="px-2 py-1.5 text-text-2">{r.qty_remaining || '—'}</td>
                          <td className="px-2 py-1.5 text-text-2">{r.qty_dispensed_to_date || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
