// IST RECORDS — the app view AND the raw sheet, one page: a button that shows the records in sheet form without…
// The default view is the app's own sheet template (avatars, chip tints, the row actions) rendered with the…
import { useEffect, useMemo, useState } from 'react'
import { LayoutGrid, Table2, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { TEMPLATES } from '@/engine/PageRenderer'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { cn } from '@/lib/utils'
import {
  fetchIstConfig, istRecordsConfig, istRowsAsFiled, IST_CONFIG_FALLBACK, type IstConfig,
} from '@/lib/istConfig'

type Row = Record<string, unknown>

/** Every key any row carries, first-appearance order, internals skipped. */
function sheetColumns(rows: Row[]): string[] {
  const out: string[] = []
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (k.startsWith('_') || out.includes(k)) continue
      out.push(k)
    }
  }
  return out
}

export default function IstRecordsPage() {
  // THE SCHEMA COMES FROM THE APP THAT SERVES THIS PAGE.
  const schema = useRegistryStore((s) =>
    s.apps.find((a) => a.id === 'employee-tracker')?.pages.find((p) => p.id === 'records')
    ?? s.apps.find((a) => a.id === 'ist')?.pages[0])
  const [view, setView] = useState<'app' | 'sheet'>('app')
  const [rows, setRows] = useState<Row[]>([])
  // `null` while the answer is on its way — NOT the fallback.
  const [cfg, setCfg] = useState<IstConfig | null>(null)

  useEffect(() => {
    void api.list<Row>('istRecords')
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch(() => {})
    // The reader never rejects — a door that did not answer comes back as the shipped configuration, named as such.
    void fetchIstConfig().then(setCfg).catch(() => setCfg(IST_CONFIG_FALLBACK))
  }, [])

  const cols = useMemo(() => sheetColumns(rows), [rows])
  // the app view files a lapsed IST (ist_valid_days) as owed, like Workforce Compliance; the sheet view is raw
  const filed = useMemo(() => (cfg ? istRowsAsFiled(rows, cfg) : rows), [rows, cfg])
  const config = useMemo(
    () => (schema && cfg ? istRecordsConfig(schema.config as Record<string, unknown>, cfg) : schema?.config),
    [schema, cfg],
  )
  const SheetTemplate = TEMPLATES.sheet
  if (!schema) return null

  return (
    <div className="w-full">
      {/* no PageHeader here — the template draws its own title; a second one
          is what broke the title */}
      <div className="mb-3 flex justify-end">
        <div className="flex rounded-md border border-border">
          {(['app', 'sheet'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'flex h-9 items-center gap-1.5 px-3 text-[13px] font-semibold transition-colors',
                v === 'app' ? 'rounded-l-md' : 'rounded-r-md border-l border-border',
                view === v ? 'bg-primary text-on-primary' : 'bg-surface text-text-1 hover:bg-surface-2',
              )}
            >
              {v === 'app' ? <LayoutGrid size={14} /> : <Table2 size={14} />}
              {v === 'app' ? 'App view' : 'Sheet view'}
            </button>
          ))}
        </div>
      </div>

      {/* THE COLUMNS ARE NOT THE ONES IN THE TAB — said once, above the table,
          and only while it is true. Silence here is how somebody edits a cell
          all afternoon and never learns the platform could not read it. */}
      {view === 'app' && cfg?.blind && (
        <div className="mb-3 rounded-md border border-tint-amber bg-tint-amber px-3 py-2.5 text-[12px] leading-5 text-tint-fg-amber">
          <p className="flex items-center gap-1.5 font-semibold">
            <TriangleAlert size={13} /> Showing the columns this screen ships with
          </p>
          <p className="mt-0.5">
            {cfg.reason || `The ${cfg.tab} tab could not be read, so the IST settings on this screen are the shipped ones.`}
          </p>
          <p className="mt-0.5">
            The rows below are the real ones. Nothing about who owes a training changed — a settings
            read that failed is not a person without training.
          </p>
        </div>
      )}

      {view === 'app' ? (
        <SheetTemplate config={config as Record<string, unknown>} data={filed} schema={schema} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-surface-2">
                <th className="sticky left-0 bg-surface-2 px-2 py-1.5 text-left text-[11px] font-bold text-text-3">#</th>
                {cols.map((c) => (
                  <th key={c} className="whitespace-nowrap border-l border-border px-2 py-1.5 text-left text-[11px] font-bold text-text-3">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={String(r.id ?? i)} className="border-t border-border odd:bg-surface even:bg-surface-2/40">
                  <td className="sticky left-0 bg-inherit px-2 py-1 text-text-3">{i + 1}</td>
                  {cols.map((c) => (
                    <td key={c} className="max-w-[260px] truncate border-l border-border px-2 py-1 text-text-1" title={String(r[c] ?? '')}>
                      {String(r[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={cols.length + 1} className="px-3 py-8 text-center text-text-3">No rows.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
