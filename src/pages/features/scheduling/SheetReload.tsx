// Scheduling › House calendars' reload (the master's alone — the lane answers anyone else that it does not exist): the
// clock's read of the house calendars from the sheet and its import, run now. The sheet newer than the Hub's copy is
// read again and laid in; a copy as new as the sheet is left as it stands, and so is every cell changed here and every
// period the Builder published (app/main.py _sched_sheet_reload, server/hub_sheet_sync.py read_live_now).
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { relayLane } from '@/lib/noticesApi'
import { cn } from '@/lib/utils'
import { toast, type ToastType } from '@/stores/useToastStore'

export const SHEET_RELOAD_PATH = '/hub-lanes/scheduling-sheet-reload'

export type SheetReload = {
  /** the sheet had changed after the Hub's copy was read, so it was read again */
  ahead: boolean
  sheetAt: string
  copyAt: string
  housesRead: number
  /** why the sheet, though newer, was not read */
  why: string
  added: number
  changed: number
  cleared: number
  rowsAdded: number
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** The lane's answer as this button reads it; null when it is not one. */
export function sheetReloadFrom(raw: unknown): SheetReload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>
  if (typeof d.ahead !== 'boolean') return null
  return {
    ahead: d.ahead, sheetAt: text(d.sheet_at), copyAt: text(d.copy_at), housesRead: num(d.houses_read), why: text(d.why),
    added: num(d.added), changed: num(d.changed), cleared: num(d.cleared), rowsAdded: num(d.rows_added),
  }
}

const clock = (iso: string): string => {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** What the reload did, as its toast says it. */
export function sheetReloadWords(r: SheetReload): { type: ToastType; title: string; body: string } {
  const parts = [
    r.added && `${r.added} added`, r.changed && `${r.changed} changed`, r.cleared && `${r.cleared} cleared`,
    r.rowsAdded && `${r.rowsAdded} ${r.rowsAdded === 1 ? 'person' : 'people'} added`,
  ].filter(Boolean)
  if (parts.length) return { type: 'success', title: 'Updated from the sheet', body: `${parts.join(' · ')}.` }
  if (r.why) return { type: 'warning', title: 'Not read from the sheet', body: `${r.why[0].toUpperCase()}${r.why.slice(1)}.` }
  if (r.ahead) return { type: 'info', title: 'Read from the sheet', body: 'Nothing new for the calendars: every house already matched it.' }
  const sheet = clock(r.sheetAt)
  const copy = clock(r.copyAt)
  return {
    type: 'info', title: 'Already up to date',
    body: sheet && copy
      ? `The sheet has nothing newer — last changed ${sheet}, read here ${copy}.`
      : 'The sheet has nothing newer than the calendars here.',
  }
}

/** The small reload: the house calendars read from the sheet now, then the board read again. */
export default function SheetReloadButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const reload = async () => {
    if (busy) return
    setBusy(true)
    try {
      const got = sheetReloadFrom(await relayLane<unknown>(SHEET_RELOAD_PATH, { method: 'POST', body: '{}' }))
      if (!got) {
        toast({ type: 'danger', title: 'Not read from the sheet', body: 'The answer came back without its counts. Try again.' })
        return
      }
      toast(sheetReloadWords(got))
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not read from the sheet', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={() => void reload()} disabled={busy} aria-busy={busy}
      aria-label="Read the house calendars from the sheet again" title="Read the house calendars from the sheet again"
      data-act="sheet-reload"
      className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:opacity-60">
      <RefreshCw size={14} className={cn(busy && 'animate-spin')} />
    </button>
  )
}
