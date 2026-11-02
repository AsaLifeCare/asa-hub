/** Cell renderers for every column kind (moved verbatim from SheetTemplate.tsx). */
import { useState } from 'react'
import { format } from 'date-fns'
import { FileText, MapPin, Share2 } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { Badge } from '@/components/shared/Badge'
import ProgressBar from '@/components/shared/ProgressBar'
import SafeImg, { type FallbackTint } from '@/components/shared/SafeImg'
import { AppIcon } from '@/lib/icons'
import { ohioWall } from '@/lib/ohio'
import { TINT_BG_VAR, TINT_VAR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { isAddressKey, openAddressInPlatform } from '@/lib/maps'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { toast } from '@/stores/useToastStore'
import { gasAction } from '@/features/hiring/shared'
import { openFile } from '@/stores/useFileViewerStore'
import { share } from '@/stores/useShareStore'
import type { FocusDragConfig } from '@/lib/focus'
import type { TintName } from '@/engine/types'
import { isPhoneColumn, type Column } from './types'

/** Map sheet tints to SafeImg fallback tints (extended tints fall back to closest). */
const TINT_TO_FALLBACK: Record<string, FallbackTint> = {
  mint: 'mint', peach: 'peach', lavender: 'lavender', pink: 'pink', blue: 'blue', amber: 'amber',
  green: 'mint', primary: 'mint', info: 'blue', warning: 'amber', danger: 'pink', violet: 'lavender', slate: 'blue',
}

/** Thumbnail for `image` cells — SafeImg-backed, never a broken image. */
export function ImageCell({ src, alt, tint, className }: { src?: string; alt: string; tint: TintName; className?: string }) {
  return (
    <SafeImg
      src={src}
      name={alt}
      icon="image"
      shape="square"
      tint={TINT_TO_FALLBACK[tint]}
      className={cn('h-11 w-[72px] rounded-sm border border-border [&>img]:h-full [&>img]:w-full [&>img]:object-cover', className)}
      alt={alt}
    />
  )
}

const docBtnCls =
  'grid h-6 w-6 shrink-0 place-items-center rounded-sm text-text-3 transition-colors duration-150 hover:bg-surface-3 hover:text-primary'

// `doc` cells — download + share for a row's file.
function DocCell({ col, row }: { col: Column; row: any }) {
  const rowId = String(row[col.idKey ?? 'id'] ?? '')
  const [fetched, setFetched] = useState<{ id: string; url: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const fetchAction = col.fetchAction
  const url =
    String(col.urlKey ? (row[col.urlKey] ?? '') : '').trim() ||
    (fetched?.id === rowId ? fetched.url : '')

  // A document opens INSIDE the platform first (FileViewer); the new tab is one click away in the viewer's own…
  const title = String(row[col.titleKey ?? 'name'] ?? row.title ?? col.label)
  if (url) {
    return (
      <span className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Open document"
          title="Open document"
          onClick={(e) => {
            e.stopPropagation()
            openFile({ title, subtitle: col.label, url })
          }}
          className={docBtnCls}
        >
          <FileText size={13} />
        </button>
        <button
          type="button"
          aria-label="Share document"
          title="Share document"
          onClick={(e) => {
            e.stopPropagation()
            share({ title, subtitle: col.label, url, icon: 'file-text' })
          }}
          className={docBtnCls}
        >
          <Share2 size={13} />
        </button>
      </span>
    )
  }
  if (!fetchAction) return <span className="text-[13px] text-text-3">—</span>
  return (
    <button
      type="button"
      disabled={loading}
      aria-label="Fetch document"
      title="Fetch document"
      onClick={async (e) => {
        e.stopPropagation()
        setLoading(true)
        try {
          const { doc_url } = await gasAction<{ doc_url: string }>(fetchAction, { signature_request_id: row[col.idKey ?? 'id'] })
          setFetched({ id: rowId, url: doc_url })
          openFile({ title, subtitle: col.label, url: doc_url })
        } catch (err) {
          toast({ type: 'danger', title: 'Could not fetch document', body: err instanceof Error ? err.message : String(err) })
        } finally {
          setLoading(false)
        }
      }}
      className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm border border-border px-2 text-[11px] font-semibold text-text-2 transition-colors duration-150 hover:bg-surface-3 hover:text-primary disabled:opacity-60"
    >
      {loading ? <AppIcon name="loader-circle" size={12} className="animate-spin" /> : <FileText size={12} />}
      PDF
    </button>
  )
}

export function Cell({ col, row, focusDrag }: { col: Column; row: any; focusDrag?: FocusDragConfig }) {
  const v = row[col.key]
  switch (col.kind) {
    case 'avatar+text':
      // A person's name is the point of the row: with `primary` it stays on one unbroken line at full width and the…
      return (
        <DragPerson
          name={String(v ?? '')}
          // Only when the engine agreed the ROW is a person: on a shifts or tasks sheet `row.id` is the shift's…
          id={focusDrag ? String(row[focusDrag.idKey] ?? row.id ?? '') : undefined}
          type={focusDrag?.type}
          avatar={row.avatar}
          subtitle={col.subKey ? String(row[col.subKey] ?? '') : undefined}
          className="flex items-center gap-3"
        >
          <Avatar src={row.avatar} name={String(v ?? '?')} size="md" />
          <div className="min-w-0">
            <div
              className={cn(
                'text-[14px] leading-5 text-text-1',
                col.primary ? 'whitespace-nowrap font-semibold' : 'clamp-1 font-medium',
              )}
            >
              {v}
            </div>
            {col.subKey && <div className="clamp-1 text-[12px] leading-4 text-text-3">{row[col.subKey]}</div>}
          </div>
        </DragPerson>
      )
    case 'chip': {
      const tint = col.tintBy?.[String(v)] ?? 'blue'
      const label = col.labelBy?.[String(v)] ?? String(v ?? '—')
      // sweep: per-value token styles (e.g. equipment status colors)
      const styled = col.styleBy?.[String(v)]
      if (styled) {
        return (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold capitalize leading-4"
            style={{ background: styled.bg, color: styled.fg }}
          >
            {col.dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: styled.fg }} />}
            {label}
          </span>
        )
      }
      if (col.solidBy?.includes(String(v))) {
        return (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold capitalize leading-4 text-white"
            style={{ background: TINT_VAR[tint] }}
          >
            {label}
          </span>
        )
      }
      if (col.dashedBy?.includes(String(v))) {
        return (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2 py-0.5 text-[12px] font-semibold capitalize leading-4"
            style={{ borderColor: TINT_VAR[tint], color: TINT_VAR[tint] }}
          >
            {label}
          </span>
        )
      }
      if (col.dot) {
        return (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold capitalize leading-4"
            style={{ background: TINT_BG_VAR[tint], color: TINT_VAR[tint] }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: TINT_VAR[tint] }} />
            {label}
          </span>
        )
      }
      return <Badge label={label} tint={tint} />
    }
    case 'chips': {
      const arr: any[] = Array.isArray(v) ? v : v ? [v] : []
      if (arr.length === 0) return <span className="text-[13px] text-text-3">—</span>
      const shown = arr.slice(0, col.max ?? 3)
      // A chip is a keyword, not a paragraph: cap the visible text and let the tooltip carry the full phrase…
      const cap = col.chipMax ?? 28
      return (
        <div className="flex flex-wrap items-center gap-1">
          {shown.map((it, i) => {
            const full = String(it)
            const label = full.length > cap ? full.slice(0, cap - 1).trimEnd() + '…' : full
            return (
              <span key={full} title={full.length > cap ? full : undefined} className="max-w-full">
                <Badge label={label} tint={col.tintBy?.[full] ?? col.tintCycle?.[i % (col.tintCycle.length || 1)] ?? 'blue'} />
              </span>
            )
          })}
          {arr.length > shown.length && <span className="text-[11px] font-medium text-text-3">+{arr.length - shown.length}</span>}
        </div>
      )
    }
    case 'date': {
      // EVERY date cell in the platform lands here, so this is where the Ohio rule is kept: the whole platform…
      const d = ohioWall(v)
      if (col.expiry && d) {
        const now = ohioWall(new Date()) as Date
        const days = Math.ceil((d.getTime() - now.getTime()) / 86_400_000)
        return (
          <span
            className={cn(
              'whitespace-nowrap text-[13px]',
              days < 0 ? 'font-semibold text-tint-fg-pink' : days <= 30 ? 'font-semibold text-tint-fg-amber' : 'text-text-2',
            )}
          >
            {format(d, col.format ?? 'MMM d, yyyy')}
            {days < 0 ? ' · expired' : days <= 30 ? ` · ${days}d left` : ''}
          </span>
        )
      }
      // A date never wraps: "May 7, 2026 · 09:53" broken across three lines is unreadable, and it is always the…
      return (
        <span className="whitespace-nowrap text-[13px] text-text-2">
          {d ? format(d, col.format ?? 'MMM d, yyyy') : '—'}
        </span>
      )
    }
    case 'image': {
      // generic thumbnail cell (image-bank style sheets) — tinted icon tile fallback keeps broken srcs from ever…
      const tint = ((row.tint as TintName) ?? 'blue') as TintName
      return <ImageCell src={v} alt={String(row.title ?? col.label)} tint={tint} />
    }
    case 'doc':
      return <DocCell col={col} row={row} />
    case 'number':
      return <span className="font-stat text-[13px] text-text-1">{Number(v).toLocaleString()}</span>
    case 'progress':
      return (
        <div className="flex w-28 items-center gap-2">
          <ProgressBar value={Number(v) || 0} height={6} />
          <span className="text-[12px] tabular-nums text-text-3">{Math.round((Number(v) || 0) * 100)}%</span>
        </div>
      )
    default: {
      // address-ish columns (address/location — see lib/maps isAddressKey) get a map-pin ghost button opening…
      const addressish = v != null && String(v).trim() !== '' && isAddressKey(col.key)
      // The name column never shrinks and never wraps — it is what people scan the table for.
      const textCls = col.primary
        ? 'whitespace-nowrap text-[14px] font-semibold text-text-1'
        : col.wrap
          ? cn('text-[13px] leading-[1.45] text-text-2', col.wrap === 2 ? 'clamp-2' : 'clamp-3')
          : 'clamp-1 text-[13px] text-text-2'
      const phoneish = v != null && isPhoneColumn(col)
      return (
        <span className={cn('flex gap-1.5', col.wrap ? 'items-start' : 'items-center')}>
          {col.icon && <AppIcon name={col.icon} size={12} className={cn('shrink-0 text-text-3', col.wrap && 'mt-[3px]')} />}
          <span className={textCls} title={col.wrap ? (phoneish ? formatPhoneDisplay(v) : String(v ?? '')) : undefined}>
            {phoneish ? formatPhoneDisplay(v) : String(v ?? '—')}
          </span>
          {addressish && (
            <button
              type="button"
              aria-label="Open the map"
              title="Open the map — inside the platform"
              onClick={(e) => { e.stopPropagation(); openAddressInPlatform(String(v)) }}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-text-3 opacity-0 transition-all duration-150 hover:bg-surface-3 hover:text-primary focus:opacity-100 group-hover/row:opacity-100 max-md:opacity-100"
            >
              <MapPin size={12} />
            </button>
          )}
        </span>
      )
    }
  }
}
