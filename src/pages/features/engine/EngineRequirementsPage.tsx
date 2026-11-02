// The requirements catalog, editable.
// Every obligation the platform enforces is a row in the `requirements` tab — this screen is its door: list, add…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import { Badge } from '@/components/shared/Badge'
import { Switch } from '@/components/ui/switch'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { EASE_OUT_EXPO } from '@/engine/motion'
import ScreenSwitcher from '@/pages/features/employeetracker/ScreenSwitcher'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'

type Req = Record<string, string> & { req_id: string; label: string }

const CATEGORIES = ['training', 'documents', 'background', 'onboarding', 'admin'] as const
const CAT_TINT: Record<string, string> = {
  training: 'mint', documents: 'blue', background: 'lavender', onboarding: 'amber', admin: 'peach',
}

const INPUT = 'h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong'

function EditModal({ req, onClose, onSaved }: { req: Partial<Req> | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !req?.req_id
  const [v, setV] = useState<Record<string, string>>(() => ({
    req_id: req?.req_id ?? '',
    label: req?.label ?? '',
    category: req?.category ?? 'training',
    applies_to: req?.applies_to ?? 'staff',
    evidence: req?.evidence ?? '',
    header: req?.header ?? '',
    date_source: req?.date_source ?? '',
    credential: req?.credential ?? '',
    warn_days: req?.warn_days ?? '',
    consequence: req?.consequence ?? '',
    na_eligible: req?.na_eligible ?? 'no',
    enabled: req?.enabled ?? 'yes',
    max_attempts: req?.max_attempts ?? '1',
    frequency: req?.frequency ?? 'once',
    notes: req?.notes ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const set = (k: string, val: string) => setV((s) => ({ ...s, [k]: val }))

  const save = async () => {
    if (!v.req_id.trim() || !v.label.trim()) {
      toast({ type: 'warning', title: 'req_id and label are required' })
      return
    }
    setSaving(true)
    try {
      await gasAction('requirementUpsert', { row: v })
      toast({ type: 'success', title: isNew ? 'Requirement added.' : 'Requirement saved.' })
      onSaved()
      onClose()
    } catch (err) {
      toast({ type: 'danger', title: 'Could not save', body: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
        className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-3"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-[16px] font-bold text-text-1">{isNew ? 'New requirement' : `Edit ${req?.req_id}`}</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1">
            <X size={15} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">req_id</span>
            <input value={v.req_id} disabled={!isNew} onChange={(e) => set('req_id', e.target.value)} className={cn(INPUT, !isNew && 'opacity-50')} placeholder="kebab-case" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">Category</span>
            <select value={v.category} onChange={(e) => set('category', e.target.value)} className={INPUT}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="col-span-2 block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">Label</span>
            <input value={v.label} onChange={(e) => set('label', e.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">Warn days</span>
            <input type="number" min={0} value={v.warn_days} onChange={(e) => set('warn_days', e.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">Consequence (Smart Comms id)</span>
            <input value={v.consequence} onChange={(e) => set('consequence', e.target.value)} className={INPUT} placeholder="cpr_expiring" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">Credential / date column</span>
            <input value={v.credential} onChange={(e) => set('credential', e.target.value)} className={INPUT} placeholder="cpr — or Master column name" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">Estate flag column (header)</span>
            <input value={v.header} onChange={(e) => set('header', e.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">Max # of attempts</span>
            <input type="number" min={1} value={v.max_attempts} onChange={(e) => set('max_attempts', e.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">Frequency</span>
            <select value={v.frequency} onChange={(e) => set('frequency', e.target.value)} className={INPUT}>
              <option value="once">Once</option>
              <option value="daily">Daily</option>
              <option value="every_other_day">Every other day</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pt-5">
            <Switch checked={v.na_eligible === 'yes'} onCheckedChange={(c) => set('na_eligible', c ? 'yes' : 'no')} />
            <span className="text-[12px] font-medium text-text-2">N/A eligible</span>
          </label>
          <label className="flex items-center gap-2 pt-5">
            <Switch checked={v.enabled === 'yes'} onCheckedChange={(c) => set('enabled', c ? 'yes' : 'no')} />
            <span className="text-[12px] font-medium text-text-2">Enabled (the obligation exists)</span>
          </label>
          <label className="col-span-2 block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">Evidence</span>
            <input value={v.evidence} onChange={(e) => set('evidence', e.target.value)} className={INPUT} placeholder="What satisfies it" />
          </label>
          <label className="col-span-2 block">
            <span className="mb-1 block text-[11px] font-semibold text-text-2">Notes</span>
            <input value={v.notes} onChange={(e) => set('notes', e.target.value)} className={INPUT} />
          </label>
        </div>
        <button
          onClick={() => void save()}
          disabled={saving}
          className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          Save
        </button>
      </motion.div>
    </div>
  )
}

// Paints the last kept copy at once and reads behind it; the sheet stays the truth.
const KEPT = 'asa:engine:requirements'

export default function EngineRequirementsPage() {
  const kept = useMemo(() => readKept<{ rows: Req[]; source: string }>(KEPT), [])
  const [rows, setRows] = useState<Req[]>(() => kept?.rows ?? [])
  const [source, setSource] = useState<string>(() => kept?.source ?? '')
  // `loading` is now only about the FIRST ever visit.
  const [loading, setLoading] = useState(!kept)
  const [refreshing, setRefreshing] = useState(false)
  const [editing, setEditing] = useState<Partial<Req> | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (opts?.quiet) setRefreshing(true)
    else setLoading(true)
    // a read still in flight at a sign-out or a crossing keeps nothing (lib/kept)
    const generation = keptGeneration()
    try {
      const res = await gasAction<{ rows?: Req[]; source?: string }>('requirementsList', {})
      const next = { rows: res.rows ?? [], source: res.source ?? '' }
      setRows(next.rows)
      setSource(next.source)
      keepIfCurrent(KEPT, next, generation)
    } catch (err) {
      // A BACKGROUND REFRESH DOES NOT SHOUT.
      if (!opts?.quiet) {
        toast({ type: 'danger', title: 'Could not load the catalog', body: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Quiet when there is something to look at, loud when the screen is empty.
  useEffect(() => { void load({ quiet: !!kept }) }, [load, kept])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => `${r.req_id} ${r.label} ${r.category}`.toLowerCase().includes(q))
  }, [rows, filter])

  const remove = async (reqId: string) => {
    try {
      await gasAction('requirementDelete', { req_id: reqId })
      toast({ type: 'success', title: `${reqId} removed.` })
      setConfirmDelete(null)
      void load()
    } catch (err) {
      toast({ type: 'danger', title: 'Could not delete', body: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="w-full pb-10">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
        className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-bold text-text-1">Requirements</h1>
          <p className="text-[12px] text-text-3">
            Every obligation the platform enforces — as data. Source:{' '}
            <span className={cn('font-semibold', source === 'tab' ? 'text-emerald-600' : 'text-amber-600')}>
              {source === 'tab' ? 'the requirements tab' : source === 'fallback' ? 'code fallback (tab unreadable)' : '…'}
            </span>
            {/* SAY WHEN IT IS THE KEPT COPY. Painting instantly is only honest
                if the screen admits the list may be a moment old — the read
                that confirms it is happening while you read this. */}
            {refreshing && <span className="text-text-3"> · checking for changes…</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} disabled={loading || refreshing}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
            {/* the spinner covers the quiet refresh too: the only honest place
                to say "a read is in flight" once the list no longer waits */}
            <RefreshCw size={13} className={loading || refreshing ? 'animate-spin' : ''} /> Reload
          </button>
          <button onClick={() => setEditing({})}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary hover:bg-primary-hover">
            <Plus size={14} /> New requirement
          </button>
          {/* LAST, ON THE RIGHT — the standing rule for this control, set on
              the tracker and holding everywhere: the thing that changes WHERE
              YOU ARE ends the row. It is also not optional here: Workforce
              Compliance took its pages off the sidebar rail, so a screen without
              this dropdown is a room with no door. */}
          <ScreenSwitcher />
        </div>
      </motion.div>

      <div className="mb-3">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a requirement…" className={cn(INPUT, 'max-w-sm')} />
      </div>

      <Card padded={false}>
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-[12px] text-text-3">
            <RefreshCw size={13} className="animate-spin" /> Loading the catalog…
          </div>
        ) : shown.length === 0 ? (
          <EmptyState title="No requirements" body="The catalog is empty — add the first obligation." />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  <th className="px-3 py-2.5">Requirement</th>
                  <th className="px-3 py-2.5">Category</th>
                  <th className="px-3 py-2.5">Warn days</th>
                  <th className="px-3 py-2.5">Consequence</th>
                  <th className="px-3 py-2.5">Pacing</th>
                  <th className="px-3 py-2.5">Enabled</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.req_id} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                    <td className="px-3 py-2.5">
                      <p className="text-[13px] font-semibold text-text-1">{r.label}</p>
                      <p className="text-[11px] text-text-3">{r.req_id}</p>
                    </td>
                    <td className="px-3 py-2.5"><Badge label={r.category} tint={(CAT_TINT[r.category] ?? 'blue') as never} /></td>
                    <td className="px-3 py-2.5 text-[12.5px] text-text-2">{r.warn_days || '—'}</td>
                    <td className="px-3 py-2.5 text-[12.5px] text-text-2">{r.consequence || '—'}</td>
                    <td className="px-3 py-2.5 text-[12.5px] text-text-2">
                      {(r.max_attempts || '1')}× · {(r.frequency || 'once')}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn('text-[12px] font-semibold', r.enabled === 'yes' ? 'text-emerald-600' : 'text-text-3')}>
                        {r.enabled === 'yes' ? 'on' : 'off'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditing(r)} title="Edit"
                          className="grid h-7 w-7 place-items-center rounded-sm text-text-3 hover:bg-surface hover:text-text-1">
                          <Pencil size={13} />
                        </button>
                        {confirmDelete === r.req_id ? (
                          <>
                            <button onClick={() => void remove(r.req_id)} title="Confirm delete"
                              className="grid h-7 w-7 place-items-center rounded-sm text-rose-500 hover:bg-rose-500/10">
                              <Check size={13} />
                            </button>
                            <button onClick={() => setConfirmDelete(null)} title="Cancel"
                              className="grid h-7 w-7 place-items-center rounded-sm text-text-3 hover:bg-surface">
                              <X size={13} />
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setConfirmDelete(r.req_id)} title="Delete"
                            className="grid h-7 w-7 place-items-center rounded-sm text-text-3 hover:bg-rose-500/10 hover:text-rose-500">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing !== null && (
        <EditModal req={editing.req_id ? (editing as Req) : null} onClose={() => setEditing(null)} onSaved={() => void load()} />
      )}
    </div>
  )
}
