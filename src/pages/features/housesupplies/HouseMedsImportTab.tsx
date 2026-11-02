// IMPORT — the pharmacy's reports, from the Drive folder or dropped here.
// NOTHING IS READ TWICE.
import { useMemo, useState } from 'react'
import { AlertTriangle, FolderSync, Loader2 } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { FileDropZone, fileToBase64 } from '@/features/hiring/shared'
import { post, LaneError } from '@/pages/features/shifts/laneFetch'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { TINT_PAIR, type ExtendedTintName } from '@/lib/tints'
import {
  batchWords, fmtDay, periodStrip, span,
  type MedsCommitAnswer, type MedsFolderAnswer, type MedsPreview, type MedsVerdict, type MedsView,
} from '@/lib/houseMedsAnalysis'
import { HOUSE_MEDS_PATH } from './useHouseMeds'

// The relay's proxy takes a 1 MB body (base64 grows a file by a third); the reports are 4–41 KB.
const MAX_DROP_BYTES = 600 * 1024

const PILL: Record<MedsVerdict, { label: string; tint: ExtendedTintName }> = {
  new: { label: 'New', tint: 'mint' },
  imported: { label: 'Imported', tint: 'primary' },
  duplicate: { label: 'Already on file', tint: 'slate' },
  held: { label: 'Held — needs a person', tint: 'amber' },
  invalid: { label: 'Not a pharmacy report', tint: 'danger' },
  failed: { label: 'Could not be read', tint: 'warning' },
  unknown: { label: 'No longer waiting', tint: 'slate' },
}

const STRIP_TINT: Record<string, string> = {
  imported: 'bg-tint-mint', missing: 'bg-tint-amber', held: 'bg-tint-danger', future: 'bg-surface-3',
}

function Pill({ verdict }: { verdict: MedsVerdict }) {
  const p = PILL[verdict] ?? PILL.unknown
  return <span className={cn('inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', TINT_PAIR(p.tint))}>{p.label}</span>
}

function keyOf(p: MedsPreview): string {
  return p.stage_id || p.import_id || p.file_name
}

function clock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function HouseMedsImportTab({ view, todayIso, onChanged }: {
  view: MedsView
  todayIso: string
  onChanged: () => void
}) {
  const [rows, setRows] = useState<Map<string, MedsPreview>>(
    () => new Map((view.staged ?? []).map((p) => [keyOf(p), p])))
  const [folder, setFolder] = useState<{ reading: boolean; done: number; total: number; last: MedsFolderAnswer | null; error: string }>(
    { reading: false, done: 0, total: 0, last: null, error: '' })
  const [drops, setDrops] = useState<{ total: number; done: number }>({ total: 0, done: 0 })
  const [committing, setCommitting] = useState(false)

  const previews = useMemo(() => [...rows.values()], [rows])
  const batch = useMemo(() => batchWords(previews), [previews])
  const strip = useMemo(() => periodStrip(view, todayIso), [view, todayIso])
  const remaining = folder.last?.remaining ?? 0
  const busy = folder.reading || remaining > 0 || drops.done < drops.total || committing

  const merge = (list: MedsPreview[], replaceStaged = false) => setRows((old) => {
    const next = new Map(old)
    if (replaceStaged) for (const [k, p] of old) if (p.verdict === 'new' && p.source !== 'upload') next.delete(k)
    for (const p of list) next.set(keyOf(p), p)
    return next
  })

  const readFolder = async () => {
    setFolder({ reading: true, done: 0, total: 0, last: null, error: '' })
    let done = 0
    try {
      for (let call = 0; call < 20; call++) {
        const got = await post<MedsFolderAnswer>(`${HOUSE_MEDS_PATH}/folder`, {})
        done += got.downloaded
        merge([...(got.previews ?? []), ...got.decided], true)
        setFolder({ reading: got.remaining > 0, done, total: done + got.remaining, last: got, error: '' })
        if (got.remaining <= 0) break
      }
    } catch (err) {
      const words = err instanceof LaneError && err.reason === 'busy' ? err.message
        : `The folder could not be read — ${err instanceof Error ? err.message : String(err)}`
      setFolder((f) => ({ ...f, reading: false, error: words }))
    } finally {
      setFolder((f) => ({ ...f, reading: false }))
      onChanged()
    }
  }

  const dropFiles = async (files: File[]) => {
    setDrops({ total: files.length, done: 0 })
    for (const file of files) {
      // `accept` only filters the picker; a drag ignores it, so the name is asked here, before a byte is read or…
      if (!/\.xlsx$/i.test(file.name.trim())) {
        merge([{ stage_id: '', import_id: '', file_name: file.name, source: 'upload', verdict: 'invalid', pill: '',
          reason: 'Only .xlsx pharmacy reports are read — it was not sent.', layers: [], duplicate_of: '', start: '', end: '',
          lines: 0, lines_new: 0, patients: 0 }])
      } else if (file.size > MAX_DROP_BYTES) {
        merge([{ stage_id: '', import_id: '', file_name: file.name, source: 'upload', verdict: 'invalid', pill: '',
          reason: 'Larger than any pharmacy report — it was not sent.', layers: [], duplicate_of: '', start: '', end: '',
          lines: 0, lines_new: 0, patients: 0 }])
      } else {
        try {
          const b64 = await fileToBase64(file)
          merge([await post<MedsPreview>(`${HOUSE_MEDS_PATH}/preview`, { name: file.name, size: file.size, b64 })])
        } catch (err) {
          merge([{ stage_id: '', import_id: '', file_name: file.name, source: 'upload', verdict: 'failed', pill: '',
            reason: `It could not be sent (${err instanceof Error ? err.message : String(err)}). Nothing was imported; drop it again.`,
            layers: [], duplicate_of: '', start: '', end: '', lines: 0, lines_new: 0, patients: 0 }])
        }
      }
      setDrops((d) => ({ ...d, done: d.done + 1 }))
    }
    onChanged()
  }

  const commit = async () => {
    const staged = previews.filter((p) => p.verdict === 'new' && p.stage_id).map((p) => p.stage_id)
    if (!staged.length) return
    setCommitting(true)
    try {
      const got = await post<MedsCommitAnswer>(`${HOUSE_MEDS_PATH}/commit`, { staged })
      merge(got.results)
      const imported = got.results.filter((r) => r.verdict === 'imported')
      const refused = got.results.length - imported.length
      toast({
        type: got.stopped ? 'warning' : 'success',
        title: `Imported ${imported.length} report${imported.length === 1 ? '' : 's'} — ${got.lines_new.toLocaleString()} lines`,
        body: [refused ? `${refused} refused and recorded.` : '', batch.recorded ? `${batch.recorded} duplicate${batch.recorded === 1 ? '' : 's'} recorded and skipped.` : '',
          got.stopped ? 'One file could not be written — the rest waits; try again.' : ''].filter(Boolean).join(' '),
      })
    } catch (err) {
      toast({ type: 'danger', title: 'The import did not finish', body: `${err instanceof Error ? err.message : String(err)} — the ledger below is the truth.` })
    } finally {
      setCommitting(false)
      onChanged()
    }
  }

  const last = folder.last
  const summary = last ? [
    `${last.reports} file${last.reports === 1 ? '' : 's'} in the folder`,
    `${last.known} already on file, not downloaded again`,
    last.failed ? `${last.failed} could not be read` : '',
    `${(last.previews ?? []).filter((p) => p.verdict === 'new').length} new`,
  ].filter(Boolean).join(' · ') : ''

  return (
    <div className="w-full">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Read the Drive folder" sub="Key Meds data points — the pharmacy's biweekly reports" />
          <p className="mt-2 text-[12.5px] leading-5 text-text-2">
            Files already on file are skipped without a download. New files are read once and shown below before anything is imported.
          </p>
          <p className="mt-1 text-[12px] text-text-3">
            {view.folder.at ? `Last read ${clock(view.folder.at)}${view.folder.by ? ` by ${view.folder.by}` : ''}` : 'Not read yet'}
          </p>
          <button type="button" onClick={() => void readFolder()} disabled={folder.reading || committing}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary disabled:opacity-40">
            {folder.reading ? <Loader2 size={14} className="animate-spin" /> : <FolderSync size={14} />}
            {folder.reading ? (folder.total ? `Reading ${folder.done} of ${folder.total}…` : 'Reading the folder…') : 'Read the Drive folder'}
          </button>
          {summary && <p className="mt-2 text-[12.5px] text-text-2">{summary}</p>}
          {last?.empty_warning && (
            <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-tint-fg-amber">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> The folder reads empty, but reports from it are on file — it was not read as “nothing new”.
            </p>
          )}
          {folder.error && (
            <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-tint-fg-amber">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {folder.error}
            </p>
          )}
        </Card>
        <Card>
          <CardHeader title="Drop the reports" sub="One file per request — each read once" />
          <div className="mt-3">
            <FileDropZone
              accept=".xlsx"
              multiple
              headline="Drop the pharmacy's .xlsx reports here, or choose files"
              hint={drops.total && drops.done < drops.total ? `Reading ${drops.done} of ${drops.total}…` : '.xlsx · the KDP sheet · several at once'}
              disabled={committing || drops.done < drops.total}
              onFiles={(files) => void dropFiles(files)}
            />
          </div>
        </Card>
      </div>

      <Card className="mt-4" padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <p className="text-[13.5px] font-semibold text-text-1">Before anything is imported</p>
            <p className="text-[12px] text-text-3">
              {batch.newCount ? batch.note || 'Every file below is new.' : batch.recorded
                ? `Nothing new in this batch — ${batch.note}` : 'Read the folder or drop a report to see what it holds.'}
            </p>
          </div>
          <button type="button" onClick={() => void commit()} disabled={busy || batch.newCount === 0}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary disabled:opacity-40">
            {committing && <Loader2 size={14} className="animate-spin" />}
            {batch.label}
          </button>
        </div>
        {previews.length === 0 ? (
          <p className="px-5 py-6 text-[12.5px] text-text-3">No file is waiting.</p>
        ) : (
          <ul className="divide-y divide-border">
            {previews.map((p) => (
              <li key={keyOf(p)} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <Pill verdict={p.verdict} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-text-1" title={p.file_name}>{p.file_name}</p>
                  <p className="text-[12.5px] leading-5 text-text-2">{p.reason}</p>
                  {p.layers.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {p.layers.map((l) => <span key={l} className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] text-text-3">{l}</span>)}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-[11.5px] text-text-3">
                  {p.start ? span(p.start, p.end) : ''}{p.lines ? ` · ${p.lines} lines` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {strip.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Reports by period" sub="Each cell is one 15-day report" />
          <div className="mt-3 flex flex-wrap gap-1">
            {strip.map((c) => (
              <span key={c.start} title={`${span(c.start, c.end)} · ${c.state}`}
                className={cn('h-5 w-5 rounded-[4px]', STRIP_TINT[c.state])} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11.5px] text-text-3">
            {(['imported', 'missing', 'held', 'future'] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={cn('h-2.5 w-2.5 rounded-[3px]', STRIP_TINT[s])} />
                {s === 'future' ? 'not due yet' : s}
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card className="mt-4" padded={false}>
        <div className="border-b border-border px-5 py-3.5">
          <p className="text-[13.5px] font-semibold text-text-1">The ledger</p>
          <p className="text-[12px] text-text-3">Every file ever decided — imported or refused — and the house copy in ASA Data.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-[12.5px]">
            <thead>
              <tr className="bg-surface-2/60 text-[11px] uppercase tracking-[0.06em] text-text-3">
                {['When', 'Source', 'Who', 'File', 'Period', 'Lines', 'Outcome', 'Layers', 'House copy'].map((c) =>
                  <th key={c} className="px-3 py-2 font-medium">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {(view.ledger ?? []).map((l) => (
                <tr key={l.import_id} className={cn('border-t border-border', l.superseded_by && 'opacity-50')}>
                  <td className="whitespace-nowrap px-3 py-2 text-text-2">{clock(l.received_at)}</td>
                  <td className="px-3 py-2 text-text-2">{l.source}</td>
                  <td className="px-3 py-2 text-text-2">{l.actor_label || '—'}</td>
                  <td className="max-w-[280px] truncate px-3 py-2 text-text-1" title={`${l.file_name}\n${l.reason}`}>{l.file_name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-2">{l.report_start ? span(l.report_start, l.report_end) : '—'}</td>
                  <td className="px-3 py-2 text-text-2">{l.outcome === 'imported' ? l.lines_new : l.lines || '—'}</td>
                  <td className="px-3 py-2"><Pill verdict={l.outcome} /></td>
                  <td className="px-3 py-2 text-[11.5px] text-text-3">
                    {l.layers.join(' · ')}{l.duplicate_of ? ` → ${l.duplicate_of}` : ''}
                  </td>
                  <td className="px-3 py-2 text-[11.5px] text-text-3" title={l.house_error}>
                    {l.outcome === 'failed' ? '—' : l.house_state}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!(view.ledger ?? []).length && <p className="px-5 py-6 text-[12.5px] text-text-3">No file has been decided yet.</p>}
      </Card>
      <p className="mt-2 text-[11.5px] text-text-3">
        Latest report {view.latest ? `${span(view.latest.start, view.latest.end)} (${fmtDay(view.latest.end)})` : 'none yet'} ·
        {' '}{view.summary.house_pending ? `${view.summary.house_pending} row${view.summary.house_pending === 1 ? '' : 's'} waiting for the house copy` : 'the house copy is up to date'}
      </p>
    </div>
  )
}
