// Compliance — the scorecard, the documents matrix and the review queue.
// The server has answered all three for a long time and nothing asked.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Pencil, Plus, RefreshCw, ShieldCheck, Users, X } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import Avatar from '@/components/shared/Avatar'
import EmptyState from '@/components/shared/EmptyState'
import PersonComplianceDrawer from '@/pages/features/compliance/PersonComplianceDrawer'
import DragPerson from '@/components/shared/DragPerson'
import Pager from '@/components/shared/Pager'
import SheetEditor from '@/components/shared/SheetEditor'
import { PAGE_SIZE, usePager } from '@/lib/pager'
import { gasAction } from '@/features/hiring/shared'
import { trackerRowsOf, type TrackerAnswer } from '@/lib/certUploads'
import { useAuthStore } from '@/auth/useAuthStore'
import { askPrompt } from '@/stores/useDialogStore'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

type Counts = { ok: number; warning: number; missing: number; na: number; other: number; blank: number }
type Item = {
  id: string
  label: string
  category?: string
  source: string
  state: 'readable' | 'unreadable'
  counts: Counts
  expired?: { name: string; date?: string }[]
  expiring?: { name: string; date?: string }[]
}
// WHOSE ROWS ANSWERED (Compliance.gs complianceWhose_): 'all' for the master in its own session, 'own' for anyone…
type Scoped = { scope?: 'all' | 'own'; self?: string; note?: string }
type Scorecard = Scoped & {
  metrics: { activeEmployees: number; fullyCompliant: number; withWarnings: number; withExpired: number }
  items: Item[]
  unreadableItems: string[]
  skippedLabels: string[]
}
type MatrixCell = { state: string; text?: string }
type MatrixEmployee = {
  name: string; phone: string; email: string; allCompleted: string
  expired: number; warning: number; cells: Record<string, MatrixCell>
}
type Matrix = Scoped & {
  tab: string
  items: { id: string; label: string; source: string }[]
  employees: MatrixEmployee[]
  total: number; offset: number; limit: number
  unreadableItems: string[]; skippedLabels: string[]
}
type QueueItem = {
  id: string; submitter: string; docType: string; dateField: string
  aiConfidence: string; aiExpDate: string; aiName: string
  readability: string; docTypeMatch: boolean; isCandidate: boolean
  thumbnail: string; uploadedAt: string
  // What `dateField` holds on the Master right now, and why it could not be read when it could not.
  masterNow: string; masterNowWhy: string
}
type Queue = {
  pending: QueueItem[]
  counts: { pending: number; resolvedHere: number; resolvedInLegacyPortal: number }
  message?: string
}

const CELL_TINT: Record<string, string> = {
  ok: 'bg-tint-mint text-tint-fg-mint',
  warning: 'bg-tint-amber text-tint-fg-amber',
  missing: 'bg-tint-pink text-tint-fg-pink',
  na: 'bg-surface-2 text-text-3',
  blank: 'bg-surface-2 text-text-3',
  other: 'bg-surface-2 text-text-3',
}

/** A number nobody measured is never drawn — see the file header. */
function Tile({ icon, label, value, tint }: { icon: React.ReactNode; label: string; value: number | string; tint: string }) {
  return (
    <div className="rounded-[16px] border border-border bg-surface p-3.5">
      <span className={cn('mb-2 grid h-8 w-8 place-items-center rounded-[10px]', tint)}>{icon}</span>
      <div className="font-stat text-[20px] font-bold leading-7 text-text-1">{value}</div>
      <div className="text-[11.5px] text-text-3">{label}</div>
    </div>
  )
}

// WHICH TILES SHOW (T14b): the scorecard tiles are the reader's, per person and per browser — the myasa layout.ts…
const TILE_IDS = ['active', 'compliant', 'warnings', 'expired'] as const
type TileId = (typeof TILE_IDS)[number]
const TILE_LABEL: Record<TileId, string> = {
  active: 'Active employees',
  compliant: 'Fully compliant',
  warnings: 'With warnings',
  expired: 'With expired',
}
const tilesKey = (userId: string) => `asa-compliance-tiles-v1:${userId}`
function loadTiles(userId: string): TileId[] {
  try {
    const raw = localStorage.getItem(tilesKey(userId))
    if (!raw) return [...TILE_IDS]
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [...TILE_IDS]
    // canonical order, unknown ids dropped — a stale key never draws a hole
    return TILE_IDS.filter((id) => parsed.includes(id))
  } catch {
    return [...TILE_IDS]
  }
}
function saveTiles(userId: string, ids: TileId[]): void {
  try {
    localStorage.setItem(tilesKey(userId), JSON.stringify(ids))
  } catch {
    /* storage blocked — the choice lasts for this visit */
  }
}

/** The staffCerts record, as the Sheet view draws it (T14a). */
type StaffCertRow = { personName?: string; certName?: string; status?: string; expiresAt?: string }

/** How each tile draws — one place, so the editable grid stays one loop. */
const TILE_DRAW: Record<TileId, { tint: string; icon: React.ReactNode; value: (m: Scorecard['metrics']) => number }> = {
  active: { tint: 'bg-tint-blue', icon: <Users size={15} className="text-tint-fg-blue" />, value: (m) => m.activeEmployees },
  compliant: { tint: 'bg-tint-mint', icon: <CheckCircle2 size={15} className="text-tint-fg-mint" />, value: (m) => m.fullyCompliant },
  warnings: { tint: 'bg-tint-amber', icon: <AlertTriangle size={15} className="text-tint-fg-amber" />, value: (m) => m.withWarnings },
  expired: { tint: 'bg-tint-pink', icon: <ShieldCheck size={15} className="text-tint-fg-pink" />, value: (m) => m.withExpired },
}

/** An own answer says whose it is, and that the view over everyone is the master's alone. */
function OwnScope({ answer, what }: { answer: Scoped; what: string }) {
  if (answer.scope !== 'own') return null
  return (
    <div className="space-y-2">
      <p className="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[12.5px] leading-5 text-text-2">
        Your own record{answer.self ? ` (${answer.self})` : ''} — the {what} over every employee is the master&apos;s alone,
        and every other person&apos;s is private to them.
      </p>
      {answer.note ? (
        <p className="rounded-md border border-tint-amber bg-tint-amber/40 px-3 py-2.5 text-[12.5px] leading-5 text-tint-fg-amber">
          {answer.note}
        </p>
      ) : null}
    </div>
  )
}

/** The caller's own items that are expired or due, from an own scorecard — no count over everyone is drawn. */
function OwnItems({ score }: { score: Scorecard }) {
  const short = score.items.filter((i) => i.state === 'readable' && (i.counts.missing > 0 || i.counts.warning > 0))
  return (
    <Card>
      <CardHeader title="Your items" sub="Expired or due on the Employee Database Master" />
      <div className="space-y-1.5">
        {short.map((it) => {
          const expired = it.counts.missing > 0
          const on = (expired ? it.expired?.[0]?.date : it.expiring?.[0]?.date) || ''
          return (
            <div key={it.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="clamp-1 block text-[13px] font-medium text-text-1">{it.label}</span>
                <span className="clamp-1 block text-[11px] text-text-3">{it.source}</span>
              </span>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold',
                expired ? 'bg-tint-pink text-tint-fg-pink' : 'bg-tint-amber text-tint-fg-amber')}>
                {expired ? 'expired' : 'due'}{on ? ` ${on}` : ''}
              </span>
            </div>
          )
        })}
        {!short.length && <p className="py-4 text-center text-[13px] text-text-3">Nothing of yours is expired or due on the items the Master could be read for.</p>}
      </div>
    </Card>
  )
}

function Unreadable({ items, skipped }: { items?: string[]; skipped?: string[] }) {
  if (!items?.length && !skipped?.length) return null
  return (
    <div className="rounded-md border border-tint-amber bg-tint-amber/40 px-3 py-2.5 text-[12.5px] leading-5 text-tint-fg-amber">
      {items?.length ? (
        <p>
          <span className="font-semibold">{items.length} item(s) could not be read</span> — the Master has no
          such column: {items.join(', ')}. These are unknown, not compliant.
        </p>
      ) : null}
      {skipped?.length ? (
        <p className={cn(items?.length && 'mt-1')}>
          <span className="font-semibold">{skipped.length} row(s) skipped:</span> {skipped.slice(0, 6).join(', ')}
          {skipped.length > 6 ? ` and ${skipped.length - 6} more` : ''}.
        </p>
      ) : null}
    </div>
  )
}

export default function CompliancePage() {
  const [tab, setTab] = useState('scorecard')
  const [score, setScore] = useState<Scorecard | null>(null)
  const [matrix, setMatrix] = useState<Matrix | null>(null)
  const [queue, setQueue] = useState<Queue | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState<string | null>(null)
  // The person drawer opens over this screen: the matrix says WHO is short, and the next question is always about…
  const [who, setWho] = useState<string | null>(null)
  // The matrix pages on the SERVER (complianceMatrix takes offset/limit), so a page is one read of 20 rows rather…
  const [matrixPage, setMatrixPage] = useState(0)
  // THE SHEET VIEW (T14a): every staffCerts row through the exact spreadsheet replica — fetched once, on the first…
  const [asSheet, setAsSheet] = useState(false)
  const [certRows, setCertRows] = useState<StaffCertRow[] | null>(null)
  // whose records the sheet view holds (Certs.gs certTrackerList), and why it holds none when the read failed
  const [certScope, setCertScope] = useState<'all' | 'own'>('all')
  const [certErr, setCertErr] = useState('')
  // WHICH TILES SHOW (T14b) — the reader's own list, localStorage per person
  const userId = useAuthStore((s) => s.user?.id ?? 'anon')
  const [tiles, setTiles] = useState<TileId[]>(() => loadTiles(userId))
  useEffect(() => setTiles(loadTiles(userId)), [userId])
  const [editingTiles, setEditingTiles] = useState(false)
  const hiddenTiles = TILE_IDS.filter((id) => !tiles.includes(id))
  const removeTile = (id: TileId) =>
    setTiles((t) => { const n = t.filter((x) => x !== id); saveTiles(userId, n); return n })
  const restoreTile = (id: TileId) =>
    setTiles((t) => { const n = TILE_IDS.filter((x) => t.includes(x) || x === id); saveTiles(userId, n); return n })

  useEffect(() => {
    if (!asSheet || certRows !== null) return
    let alive = true
    setCertErr('')
    gasAction<TrackerAnswer>('certTrackerList', { view: 'certs' })
      .then((a) => {
        if (!alive) return
        const rows = trackerRowsOf(a) as StaffCertRow[]
        setCertScope(a?.scope === 'own' ? 'own' : 'all')
        setCertRows(rows)
      })
      .catch((e: unknown) => {
        if (!alive) return
        // an unread tracker is not an empty one: the table is not drawn, the reason is
        const why = e instanceof Error ? e.message : 'Try again.'
        setCertErr(why)
        setCertRows([])
        toast({ type: 'danger', title: 'The records could not be read', body: why })
      })
    return () => { alive = false }
  }, [asSheet, certRows])

  const load = useCallback(async (which: string, page = 0) => {
    setBusy(true)
    setErr('')
    try {
      if (which === 'scorecard') setScore(await gasAction<Scorecard>('complianceScorecard', {}))
      if (which === 'matrix') {
        setMatrix(await gasAction<Matrix>('complianceMatrix', {
          tab: 'documents', limit: PAGE_SIZE, offset: page * PAGE_SIZE,
        }))
      }
      if (which === 'queue') setQueue(await gasAction<Queue>('complianceReviewQueue', {}))
    } catch (e) {
      // The server distinguishes "unreadable" from "empty" and says which; showing its sentence beats inventing one.
      setErr(e instanceof Error ? e.message : 'Could not load compliance.')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { void load(tab, tab === 'matrix' ? matrixPage : 0) }, [tab, matrixPage, load])

  // The review queue arrives whole and is paged here — 20 cards is a sitting's worth of work; four hundred is a…
  const queuePager = usePager(queue?.pending ?? [], PAGE_SIZE, queue?.counts.pending)

  // Approve or reject a review — and, on an approval, actually produce its effect.
  const resolve = async (item: QueueItem, verdict: 'approved' | 'rejected') => {
    let date = ''
    if (verdict === 'approved' && item.dateField && item.masterNowWhy === '') {
      const typed = await askPrompt({
        title: `Approve ${item.docType} for ${item.submitter || 'this person'}?`,
        body: `The confirmed date is written to the Master column “${item.dateField}”, and the sheet recomputes expired / due / ok from it.`,
        detail: item.masterNow
          ? `That column holds ${item.masterNow} today — approving replaces it.`
          : 'That column is empty today.',
        label: 'Expiry date',
        inputType: 'date',
        required: true,
        // The reader's date, for a person to confirm or correct — the cut is deliberate: constructing a Date here…
        defaultValue: /^\d{4}-\d{2}-\d{2}/.exec(item.aiExpDate ?? '')?.[0] ?? '',
        confirmLabel: 'Approve and write the date',
      })
      if (typed === null) return
      date = typed.trim()
    }

    setResolving(item.id)
    try {
      const res = await gasAction<{ legacyStamped?: boolean; masterWritten?: boolean; masterWhy?: string }>(
        'complianceReviewResolve',
        { id: item.id, verdict, ...(date ? { date, expected: item.masterNow ?? '' } : {}) },
      )
      setQueue((q) => (q ? { ...q, pending: q.pending.filter((p) => p.id !== item.id) } : q))
      // Three separate outcomes, said separately: our verdict always lands, the Master date and the legacy stamp…
      const parts = [
        date
          ? res?.masterWritten
            ? `${item.dateField} = ${date} written to the Master.`
            : `The Master was NOT written: ${res?.masterWhy || 'refused'}.`
          : verdict === 'approved'
            ? 'No date was written — this review names no Master column.'
            : '',
        res?.legacyStamped ? 'The legacy queue was stamped.' : 'The legacy queue was NOT stamped, so the old portal may still offer this review.',
        'The uploaded file was not moved.',
      ].filter(Boolean)
      toast({
        type: date && !res?.masterWritten ? 'warning' : 'success',
        title: `${item.docType} — ${verdict}`,
        body: parts.join(' '),
      })
    } catch (e) {
      toast({ type: 'danger', title: 'Not recorded', body: e instanceof Error ? e.message : 'Try again.' })
      // A 409 means the row moved underneath: the queue's witness is stale, so re-read rather than let the next…
      if (e instanceof Error && /changed this row|already resolved/i.test(e.message)) void load('queue')
    } finally {
      setResolving(null)
    }
  }

  const worst = useMemo(
    () => (score?.items ?? []).filter((i) => i.state === 'readable').sort((a, b) => b.counts.missing - a.counts.missing).slice(0, 8),
    [score],
  )

  return (
    <div className="w-full">
      <PageHeader
        title="Compliance"
        subtitle="Every document and certification the estate tracks, and who is short"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAsSheet((v) => !v)}
              title="Every staffCerts record, drawn exactly as the spreadsheet is"
              className="flex h-9 items-center rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
            >
              {asSheet ? 'Normal view' : 'Sheet view'}
            </button>
            <button
              onClick={() => (asSheet ? setCertRows(null) : void load(tab))}
              disabled={busy}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              <RefreshCw size={14} className={busy ? 'animate-spin' : undefined} /> Refresh
            </button>
          </div>
        }
      />

      {/* THE SHEET VIEW (T14a) — every record, both axes scroll in the replica */}
      {asSheet && (
        <div className="mt-5">
          {certRows === null ? (
            <p className="flex items-center gap-2 text-[13px] text-text-3">
              <Loader2 size={14} className="animate-spin" /> Reading the certification records…
            </p>
          ) : certErr ? (
            <p className="rounded-md border border-tint-pink bg-tint-pink/40 px-3 py-2.5 text-[13px] leading-5 text-tint-fg-pink">
              The certification records are not shown — {certErr}
            </p>
          ) : (
            <>
              {certScope === 'own' && (
                <p className="mb-2 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[12.5px] leading-5 text-text-2">
                  Your own records — every person&apos;s records are the master&apos;s alone to see.
                </p>
              )}
              <SheetEditor
          toolbar
                title={certScope === 'own' ? 'staff_certs — your records' : 'staff_certs — every record'}
                columns={[
                  { key: 'personName', label: 'personName' },
                  { key: 'certName', label: 'certName' },
                  { key: 'status', label: 'status' },
                  { key: 'expiresAt', label: 'expiresAt' },
                ]}
                rows={certRows as unknown as Record<string, unknown>[]}
              />
              <p className="mt-2 text-[11.5px] text-text-3">{certRows.length} record(s)</p>
            </>
          )}
        </div>
      )}

      {!asSheet && <div className="mt-4">
        {/* THE DOCUMENTS MATRIX LEFT THIS SCREEN. Its five columns
            are drawn per person inside the Employee Tracker's one table, beside
            the certifications and the IST houses, which is where somebody
            actually decides something with them. Two places showing one matrix
            is two places to check and one of them to forget. The `matrix`
            branch below is kept and still reachable by a saved `?tab=` link —
            what was removed is the invitation, not the screen. */}
        <SegmentedTabs
          tabs={[
            { id: 'scorecard', label: 'Scorecard' },
            { id: 'queue', label: `Review queue${queue ? ` · ${queue.counts.pending}` : ''}` },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>}

      {err && (
        <div className="mt-4 rounded-md border border-tint-pink bg-tint-pink/40 px-3 py-2.5 text-[13px] leading-5 text-tint-fg-pink">
          {err}
        </div>
      )}

      {/* AN OWN SCORECARD counts one person: no tile over "every employee" is drawn from it */}
      {!asSheet && tab === 'scorecard' && score && score.scope === 'own' && (
        <div className="mt-5 space-y-4">
          <OwnScope answer={score} what="scorecard" />
          {!score.note && (
            <>
              <Unreadable items={score.unreadableItems} />
              <OwnItems score={score} />
            </>
          )}
        </div>
      )}

      {!asSheet && tab === 'scorecard' && score && score.scope !== 'own' && (
        <div className="mt-5 space-y-5">
          {/* THE EDITABLE TILES (T14b): the reader's grid. Edit → an X per
              tile; the removed ones wait as chips to come back. */}
          <div>
            <div className="mb-2 flex items-center justify-end">
              <button
                onClick={() => setEditingTiles((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11.5px] font-semibold text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
              >
                <Pencil size={11} /> {editingTiles ? 'Done' : 'Edit tiles'}
              </button>
            </div>
            {tiles.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {tiles.map((id) => (
                  <div key={id} className="relative">
                    {editingTiles && (
                      <button
                        onClick={() => removeTile(id)}
                        aria-label={`Hide the ${TILE_LABEL[id]} tile`}
                        className="absolute -right-1.5 -top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full border border-border bg-surface text-text-3 shadow-1 transition-colors hover:text-danger"
                      >
                        <X size={11} />
                      </button>
                    )}
                    <Tile icon={TILE_DRAW[id].icon} label={TILE_LABEL[id]} value={TILE_DRAW[id].value(score.metrics)} tint={TILE_DRAW[id].tint} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-[12px] text-text-3">
                Every tile is hidden — add them back below.
              </p>
            )}
            {editingTiles && hiddenTiles.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11.5px] text-text-3">Hidden:</span>
                {hiddenTiles.map((id) => (
                  <button
                    key={id}
                    onClick={() => restoreTile(id)}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
                  >
                    <Plus size={11} /> {TILE_LABEL[id]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Unreadable items={score.unreadableItems} skipped={score.skippedLabels} />

          <Card>
            <CardHeader title="Most outstanding" sub="Items with the largest expired count — where the work is" />
            <div className="space-y-1.5">
              {worst.map((it) => (
                <div key={it.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="clamp-1 block text-[13px] font-medium text-text-1">{it.label}</span>
                    <span className="clamp-1 block text-[11px] text-text-3">{it.source}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-tint-pink px-2 py-0.5 text-[11px] font-bold text-tint-fg-pink">{it.counts.missing} expired</span>
                  <span className="shrink-0 rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-bold text-tint-fg-amber">{it.counts.warning} due</span>
                  <span className="shrink-0 rounded-full bg-tint-mint px-2 py-0.5 text-[11px] font-bold text-tint-fg-mint">{it.counts.ok} ok</span>
                </div>
              ))}
              {!worst.length && <p className="py-4 text-center text-[13px] text-text-3">No readable item reported an expiry.</p>}
            </div>
          </Card>
        </div>
      )}

      {!asSheet && tab === 'matrix' && matrix && (
        <div className="mt-5 space-y-4">
          <OwnScope answer={matrix} what="matrix" />
          <Unreadable items={matrix.unreadableItems} skipped={matrix.skippedLabels} />
          <Card className="p-0">
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="sticky left-0 bg-surface px-3 py-2.5 text-left font-semibold text-text-2">Staff</th>
                    {matrix.items.map((it) => (
                      <th key={it.id} title={it.source} className="px-2 py-2.5 text-left font-semibold text-text-3">{it.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.employees.map((emp) => (
                    <tr key={emp.name} className="border-b border-border last:border-0">
                      <td className="sticky left-0 bg-surface px-3 py-2">
                        <DragPerson name={emp.name} title={`Open ${emp.name}'s certifications — or drag them to the top-left to focus the workspace`}>
                          <button
                            onClick={() => setWho(emp.name)}
                            className="flex items-center gap-2 text-left transition-colors hover:text-primary"
                          >
                            <Avatar src="" name={emp.name} size="xs" />
                            <span className="clamp-1 font-medium">{emp.name}</span>
                          </button>
                        </DragPerson>
                      </td>
                      {matrix.items.map((it) => {
                        const cell = emp.cells?.[it.id]
                        return (
                          <td key={it.id} className="px-2 py-2">
                            <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', CELL_TINT[cell?.state ?? 'blank'])}>
                              {cell?.text || cell?.state || '—'}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Pager
            page={matrixPage}
            pages={Math.max(1, Math.ceil(matrix.total / PAGE_SIZE))}
            from={matrix.total ? matrixPage * PAGE_SIZE + 1 : 0}
            to={Math.min((matrixPage + 1) * PAGE_SIZE, matrix.total)}
            total={matrix.total}
            onPage={setMatrixPage}
            noun="staff"
          />
        </div>
      )}

      {!asSheet && tab === 'queue' && queue && (
        <div className="mt-5 space-y-3">
          <p className="text-[12.5px] text-text-3">
            {queue.counts.pending} pending · {queue.counts.resolvedHere} resolved here ·{' '}
            {queue.counts.resolvedInLegacyPortal} settled in the old portal
          </p>
          {!queue.pending.length && (
            <EmptyState title="Nothing waits for review" body={queue.message || 'The queue answered and it is empty.'} />
          )}
          {queuePager.slice.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <DragPerson name={item.submitter || ''}>
                      {item.submitter ? (
                        <button
                          onClick={() => setWho(item.submitter)}
                          className="text-[14px] font-semibold text-text-1 transition-colors hover:text-primary"
                        >
                          {item.submitter}
                        </button>
                      ) : (
                        <span className="text-[14px] font-semibold text-text-1">(no name)</span>
                      )}
                    </DragPerson>
                    <span className="rounded-full bg-tint-blue px-2 py-0.5 text-[10px] font-bold uppercase text-tint-fg-blue">{item.docType}</span>
                    {item.isCandidate && <span className="rounded-full bg-tint-lavender px-2 py-0.5 text-[10px] font-bold uppercase text-tint-fg-lavender">candidate</span>}
                  </span>
                  <span className="mt-1 block text-[12px] text-text-3">
                    {/* the name the reader took off the document — a person,
                        even when it disagrees with the submitter above */}
                    {item.aiName
                      ? <>Read as "<DragPerson name={item.aiName} subtitle={item.docType}>{item.aiName}</DragPerson>"</>
                      : 'No name read'}
                    {item.aiExpDate ? ` · expires ${item.aiExpDate}` : ''}
                    {item.aiConfidence ? ` · confidence ${item.aiConfidence}` : ''}
                    {item.docTypeMatch ? '' : ' · type does NOT match'}
                  </span>
                  {/* What approving will DO, before it is done — and, when it
                      can do nothing, why. A button whose effect is invisible
                      until afterwards is how a queue gets worked blindly. */}
                  <span className="mt-1 block text-[12px]">
                    {item.dateField && item.masterNowWhy === '' ? (
                      <span className="text-text-3">
                        Writes to <span className="font-medium text-text-2">{item.dateField}</span>
                        {item.masterNow
                          ? <> · holds <span className="font-medium text-text-2">{item.masterNow}</span> today</>
                          : ' · empty today'}
                      </span>
                    ) : (
                      <span className="text-tint-fg-amber">
                        No date will be written — {item.masterNowWhy || 'this review names no Master column'}.
                      </span>
                    )}
                  </span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    onClick={() => void resolve(item, 'rejected')}
                    disabled={resolving === item.id}
                    className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-danger transition-colors hover:bg-tint-pink disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => void resolve(item, 'approved')}
                    disabled={resolving === item.id}
                    className="h-9 rounded-md bg-primary px-3 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
                  >
                    Approve
                  </button>
                </span>
              </div>
            </Card>
          ))}
          <Pager {...queuePager} onPage={queuePager.setPage} noun="reviews" />
        </div>
      )}

      {!asSheet && busy && !score && !matrix && !queue && <p className="mt-6 text-[13px] text-text-3">Loading…</p>}

      {who && <PersonComplianceDrawer person={who} onClose={() => setWho(null)} />}
    </div>
  )
}
