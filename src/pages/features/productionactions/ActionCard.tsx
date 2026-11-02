import { Link } from 'react-router'
import { CheckCircle2, Eye, ExternalLink, History, Pencil, Play, RotateCcw, TestTube2 } from 'lucide-react'
import { TINT_PAIR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { OPEN_RED } from '@/pages/features/shifts/houseCalTypes'
import {
  HANDLER_LABEL, STATUS_META, eventLine, runLabel, runnable,
  type HandlerId, type PAction, type PRun, type Status, type TestSwitch,
} from '@/lib/productionActions'

export function ActionLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  if (href.startsWith('/')) return <Link to={href} className={className}>{children}</Link>
  return <a href={href} target="_blank" rel="noreferrer" className={className}>{children}</a>
}

const BTN = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40'

export default function ActionCard({ action, status, last, sw, busy, now, onPreview, onRun, onMark, onHistory, onEdit }: {
  action: PAction
  status: Status | null
  last: PRun | null
  sw: TestSwitch | null | undefined
  busy: boolean
  now: number
  onPreview: () => void
  onRun: () => void
  onMark: (done: boolean) => void
  onHistory: () => void
  onEdit: () => void
}) {
  const meta = status ? STATUS_META[status] : null
  const auto = action.kind === 'automatic'
  const handler = action.handler as HandlerId
  const done = status === 'done'
  const label = runLabel(sw)
  const red = label === 'Run now' && status !== null
  return (
    <article className={cn('rounded-[14px] border bg-surface p-4 shadow-1',
      status === 'failed' ? 'border-[#8b0000]/40' : 'border-border')} data-action={action.id} data-status={status ?? 'unread'}>
      <div className="flex items-start gap-2.5">
        <span className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 px-1.5 font-stat text-[13px] text-text-1">
          {action.number || '·'}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold leading-5 text-text-1">{action.title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {action.system && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-2">{action.system}</span>
            )}
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', auto ? TINT_PAIR('info') : TINT_PAIR('slate'))}>
              {auto ? `Automatic · ${HANDLER_LABEL[handler] ?? (action.handler || 'no handler')}` : 'Manual'}
            </span>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', TINT_PAIR(meta?.tint ?? 'slate'))}>
              {meta ? meta.label : 'Not read'}
            </span>
          </div>
        </div>
      </div>

      {action.effect && <p className="mt-2.5 text-[12.5px] leading-[1.5] text-text-2">{action.effect}</p>}
      {action.requires && (
        <p className="mt-1.5 text-[12px] leading-[1.45] text-tint-fg-amber">Requires: {action.requires}</p>
      )}
      {auto && !runnable(action) && (
        <p className="mt-1.5 text-[12px] text-tint-fg-amber">
          {action.params_error || `No handler "${action.handler}" — choose one in Edit.`}
        </p>
      )}
      <p className="mt-1.5 text-[11.5px] text-text-3">
        {status === null ? 'The History could not be read' : last ? eventLine(last, now) : 'Nothing done yet'}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button type="button" className={BTN} onClick={onPreview} disabled={busy}>
          <Eye size={13} /> Preview
        </button>
        {auto && !done && (
          <button type="button" onClick={onRun} disabled={busy || !runnable(action)}
            className={cn(BTN, red && cn('border-[#8b0000]', OPEN_RED))}>
            {label === 'Run now' ? <Play size={13} /> : <TestTube2 size={13} />} {label}
          </button>
        )}
        {!auto && action.link && (
          <ActionLink href={action.link} className={BTN}><ExternalLink size={13} /> Open</ActionLink>
        )}
        <button type="button" className={BTN} onClick={() => onMark(!done)} disabled={busy || status === null}
          title={status === null ? 'The History could not be read, so it is not known whether this is done.' : undefined}>
          {done ? <><RotateCcw size={13} /> Reopen</> : <><CheckCircle2 size={13} /> Mark done</>}
        </button>
        <button type="button" className={BTN} onClick={onHistory}>
          <History size={13} /> History
        </button>
        <button type="button" onClick={onEdit} aria-label="Edit" title="Edit"
          className="ml-auto grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1">
          <Pencil size={14} />
        </button>
      </div>
    </article>
  )
}
