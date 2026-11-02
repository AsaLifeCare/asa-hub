// INCIDENTS — the Board view, one of the richer views added beside the plain row list.
// Read-only kanban grouped by incident_category — the ONLY honest workflow axis this data has: the live "UIs and…
import { useEffect, useMemo, useState } from 'react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import Card from '@/components/shared/Card'
import { AppIcon } from '@/lib/icons'
import { api } from '@/lib/api'
import { ohioDayYear } from '@/lib/ohio'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import { cn } from '@/lib/utils'
import type { PageSchema, TintName } from '@/engine/types'

type Row = Record<string, string>

/** The MUI Watch strip's own matcher — long spellings land in the MUI column. */
const MUI_RE = /mui|major unusual/i

export default function IncidentsBoard({ logSchema }: { logSchema?: PageSchema }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const openDetail = useDetailPanelStore((s) => s.openDetail)
  useEffect(() => {
    api.list<Row>('uiIncidents').then((r) => setRows(r ?? [])).catch(() => setRows([]))
  }, [])

  const config = (logSchema?.config ?? {}) as Record<string, any>
  const tintBy: Record<string, TintName> =
    config.columns?.find((c: any) => c.key === 'incident_category')?.tintBy ?? {}
  const categories: string[] =
    config.filters?.find((f: any) => f.key === 'incident_category')?.options ?? Object.keys(tintBy)

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const c of categories) map.set(c, [])
    const other: Row[] = []
    for (const r of rows ?? []) {
      const raw = String(r.incident_category ?? '').trim()
      const target =
        categories.find((c) => c === raw) ??
        (MUI_RE.test(raw) && categories.includes('MUI') ? 'MUI' : null)
      if (target) map.get(target)!.push(r)
      else other.push(r)
    }
    const byDate = (a: Row, b: Row) =>
      String(b.incident_date ?? '').localeCompare(String(a.incident_date ?? ''))
    for (const list of map.values()) list.sort(byDate)
    other.sort(byDate)
    return { map, other }
  }, [rows, categories])

  const open = (row: Row) => {
    if (!config.detailPanel) return
    openDetail({
      config: { ...(config.detailPanel as Record<string, unknown>), resource: 'uiIncidents' },
      record: row,
    })
  }

  if (rows === null) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[220px] w-[250px] shrink-0" />)}
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <Card padded={false}>
        <EmptyState title="No incidents on file" body="The board fills as reports land on the UIs and MUIs sheet." />
      </Card>
    )
  }

  const columns: { label: string; tint: TintName; list: Row[] }[] = [
    ...categories.map((c) => ({ label: c, tint: tintBy[c] ?? ('blue' as TintName), list: grouped.map.get(c) ?? [] })),
    ...(grouped.other.length ? [{ label: 'Other', tint: 'blue' as TintName, list: grouped.other }] : []),
  ]

  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-4">
      {columns.map((col) => (
        <div key={col.label} className="flex w-[260px] shrink-0 flex-col">
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', TINT_BG[col.tint], TINT_FG[col.tint])}>
              {col.label}
            </span>
            <span className="text-[11px] tabular-nums text-text-3">{col.list.length}</span>
          </div>
          <div className="flex min-h-[120px] flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-2">
            {col.list.length === 0 && (
              <p className="px-2 py-5 text-center text-[11px] text-text-3">None on file</p>
            )}
            {col.list.map((r, i) => (
              <button
                key={`${r.id ?? i}`}
                onClick={() => open(r)}
                className="rounded-md border border-border bg-surface p-2.5 text-left shadow-1 transition-colors hover:border-primary/50"
                title="Open the full report"
              >
                <div className="flex items-center gap-2">
                  <DragPerson name={String(r.client_name ?? '')} type="client" className="min-w-0 flex-1 items-center gap-2">
                    <Avatar src="" name={String(r.client_name ?? '—')} size="xs" />
                    <span className="clamp-1 text-[12.5px] font-semibold text-text-1">{r.client_name || '—'}</span>
                  </DragPerson>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-3">
                  <AppIcon name="house" size={11} />
                  <span className="clamp-1">{r.incident_location || '—'}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-text-3">
                  <span>{r.incident_date ? ohioDayYear(String(r.incident_date)) : 'No date'}</span>
                  {r.your_name && (
                    <DragPerson name={String(r.your_name)} className="inline-flex">
                      <span className="clamp-1">{r.your_name}</span>
                    </DragPerson>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
