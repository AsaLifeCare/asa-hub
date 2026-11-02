// THE CARD'S OWN SPREADSHEET — where expanding a card usually opens notes, here it creates a spreadsheet instead.
// The Task Board's card opens onto a box you type in.
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ExternalLink, FileSpreadsheet, Loader2, Plus } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { useFeatureAllowed } from '@/lib/featureAccess'
import { toast } from '@/stores/useToastStore'

export type SheetFieldSpec = {
  // the action that makes or finds the file — declared so a second board with a different lane needs no new…
  action?: string
  label?: string
}

type Made = { spreadsheet_id?: string; spreadsheet_url?: string; spreadsheet_name?: string; created?: boolean }

export function SheetField({
  spec,
  record,
  onSaved,
}: {
  spec: SheetFieldSpec
  // the card, as the panel holds it — only the four fields this touches are named, so a board with a different row…
  record: { id?: string; title?: string; spreadsheet_url?: string; spreadsheet_name?: string } & Record<string, unknown>
  onSaved: (row: Record<string, unknown>) => void
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const mayAddMore = useFeatureAllowed('taskboard-sheet.multipleSheets')
  const url = String(record?.spreadsheet_url ?? '')
  const name = String(record?.spreadsheet_name ?? record?.title ?? '')

  const make = async (another: boolean) => {
    if (busy || !record?.id) return
    setBusy(true)
    try {
      const r = await gasAction<Made>(spec.action ?? 'sheetBoardCreate',
        { id: record.id, another }, { timeoutMs: 60_000 })
      // the panel keeps showing what the SERVER says it made, never what this screen hoped it would — the same law…
      onSaved({ ...record, spreadsheet_id: r?.spreadsheet_id ?? '', spreadsheet_url: r?.spreadsheet_url ?? '',
                spreadsheet_name: r?.spreadsheet_name ?? '' })
      toast({
        type: 'success',
        title: r?.created ? 'Spreadsheet created' : 'Opening the card’s spreadsheet',
        body: r?.created
          ? `“${r?.spreadsheet_name}” is kept in the Hub’s own database, under your card.`
          : 'This card already had one — nothing new was made.',
      })
      // INSIDE THE PLATFORM, not in Drive.
      if (r?.spreadsheet_id) navigate(`/app/taskboard-sheet/sheet?card=${encodeURIComponent(String(record.id))}`)
    } catch (e) {
      toast({ type: 'danger', title: 'Could not make the spreadsheet',
              body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-tint-mint text-tint-fg-mint">
          <FileSpreadsheet size={15} />
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-text-1">{spec.label ?? 'Spreadsheet'}</p>
          <p className="clamp-1 text-[12px] text-text-3">
            {url ? name : 'This card does not have one yet.'}
          </p>
        </div>
      </div>

      {url ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(`/app/taskboard-sheet/sheet?card=${encodeURIComponent(String(record.id))}`)}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
          >
            <ExternalLink size={14} /> Open the spreadsheet
          </button>
          {mayAddMore && (
            <button
              type="button"
              onClick={() => void make(true)}
              disabled={busy}
              title="Your badge carries the extra-sheets feature"
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-60"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Another sheet
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void make(false)}
          disabled={busy}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
          Create this card’s spreadsheet
        </button>
      )}

      <p className="mt-2.5 text-[11.5px] leading-[16px] text-text-3">
        It is kept in the Hub&apos;s own database (Postgres) — its tabs and cells stored under this card, read and
        written only through it, never a Google sheet. Nobody but the card&apos;s people opens it.
      </p>
    </div>
  )
}
