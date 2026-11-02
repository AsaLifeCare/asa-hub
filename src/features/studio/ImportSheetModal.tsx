// App Studio — "Import a Google Sheet" modal (admin-gated).
// ① Paste a Sheets URL → `sheetInspect` → spreadsheet title + tab picker (row count + first headers per tab).
import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Columns3, LayoutDashboard, PanelRight, Table } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import TintTile from '@/components/shared/TintTile'
import { gasAction, inputCls } from '@/features/hiring/shared'
import { AccentSelect, IconGridPicker } from '@/features/studio/StudioFields'
import { buildScaffold, scaffoldPages, type SheetScaffold, type ScaffoldSelection } from '@/features/studio/scaffold'
import { api } from '@/lib/api'
import { loadSheetApps } from '@/lib/sheetApps'
import { initDynamicApps } from '@/stores/useRegistryStore'
import { toast } from '@/stores/useToastStore'
import { useCan } from '@/auth/permissions'
import type { TintName } from '@/engine/types'

type InspectTab = { name: string; headers: string[]; rows: number }
type InspectResult = { spreadsheet_id: string; title: string; tabs: InspectTab[] }
type ImportResult = {
  resource_id: string
  app: { id: string; name: string; pages: { id: string }[] }
}

const labelCls = 'mb-1.5 block text-[12px] font-medium text-text-2'

/** Kebab-case app id root for the published app (`imp-<slug>-<rand>`). */
const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'import'

export default function ImportSheetModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const canManage = useCan('apps.manage')
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [url, setUrl] = useState('')
  const [inspecting, setInspecting] = useState(false)
  const [sheet, setSheet] = useState<InspectResult | null>(null)
  const [tab, setTab] = useState('')
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [icon, setIcon] = useState('table')
  const [accent, setAccent] = useState<TintName>('green')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  /* step 2 — the scaffolded pages */
  const [scaffold, setScaffold] = useState<SheetScaffold | null>(null)
  const [sel, setSel] = useState<ScaffoldSelection>({ detailPanel: true, dashboard: true, board: false })
  const [publishing, setPublishing] = useState(false)
  // The one-page stub `sheetImport` always creates, tracked in a ref so the close path can settle it exactly once…
  const stubRef = useRef<{ res: ImportResult; kept: boolean } | null>(null)

  const reset = () => {
    setStep(0)
    setUrl('')
    setInspecting(false)
    setSheet(null)
    setTab('')
    setName('')
    setTagline('')
    setIcon('table')
    setAccent('green')
    setImporting(false)
    setError('')
    setScaffold(null)
    setSel({ detailPanel: true, dashboard: true, board: false })
    setPublishing(false)
    stubRef.current = null
  }

  /** The fallback the flow started from: register the one-page stub app. */
  const keepSimple = async (res: ImportResult) => {
    await initDynamicApps() // pull the new app into the live registry
    toast({
      type: 'success',
      title: `${res.app.name} imported`,
      body: 'The sheet now lives in your workspace as an app.',
      action: { label: 'Open app', href: `/app/${res.app.id}/${res.app.pages[0]?.id ?? 'main'}` },
    })
  }

  const close = (o: boolean) => {
    onOpenChange(o)
    if (!o) {
      // closing with an unpublished stub keeps the simple table — a silent app landing next reload is how…
      const stub = stubRef.current
      if (stub && !stub.kept) {
        stub.kept = true
        void keepSimple(stub.res)
      }
      reset()
    }
  }

  const inspect = async () => {
    setInspecting(true)
    setError('')
    setSheet(null)
    setTab('')
    try {
      const res = await gasAction<InspectResult>('sheetInspect', { url: url.trim() })
      setSheet(res)
      if (res.tabs.length === 1) setTab(res.tabs[0].name)
    } catch (e) {
      // includes the backend 403 message when the account lacks Sheet access
      setError(e instanceof Error ? e.message : 'Could not inspect that spreadsheet.')
    } finally {
      setInspecting(false)
    }
  }

  const doImport = async () => {
    if (!sheet || !tab) return
    setImporting(true)
    setError('')
    try {
      const res = await gasAction<ImportResult>('sheetImport', {
        spreadsheet_id: sheet.spreadsheet_id,
        tab,
        name: name.trim() || tab,
        tagline: tagline.trim() || undefined,
        icon,
        accent,
      })
      // The resource now exists, so real rows can drive the inference — much better than guessing kinds from header…
      let scaf: SheetScaffold | null = null
      try {
        const rows = await api.list<Record<string, unknown>>(res.resource_id, { limit: 60 })
        scaf = buildScaffold(sheet.tabs.find((t) => t.name === tab)?.headers ?? [], Array.isArray(rows) ? rows : [])
      } catch {
        scaf = null
      }
      if (!scaf) {
        stubRef.current = { res, kept: true }
        await keepSimple(res)
        close(false)
        return
      }
      stubRef.current = { res, kept: false }
      setScaffold(scaf)
      setSel({ detailPanel: true, dashboard: true, board: scaf.board !== null })
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setImporting(false)
    }
  }

  const publish = async () => {
    const stub = stubRef.current
    if (!scaffold || !stub) return
    setPublishing(true)
    setError('')
    const appName = name.trim() || tab
    try {
      const pages = scaffoldPages(scaffold, sel, appName)
      const appId = `imp-${slug(appName)}-${Math.random().toString(16).slice(2, 6)}`
      await gasAction('appBuilderUpsert', {
        app: {
          id: appId,
          name: appName,
          tagline: tagline.trim() || 'Imported from Google Sheets',
          icon,
          accent,
          category: 'Imported',
          enabled: true,
          pages: pages.map((p) => ({
            id: p.id,
            type: p.type,
            title: p.title,
            resource: stub.res.resource_id,
            // the DSL columns document the tab shape in app_builder; the rich columns ride in options and win on…
            ...(p.type === 'sheet'
              ? { columns: scaffold.columns.map((c) => ({ key: c.key, label: c.label, kind: c.kind })) }
              : {}),
            options: p.config,
          })),
        },
      })
      // The stub's work is done — the resource mapping it wrote stays, its one-page app row goes, so the hub shows…
      try {
        await gasAction('appDelete', { id: stub.res.app.id })
      } catch {
        toast({
          type: 'warning',
          title: 'The simple table version is still registered',
          body: 'Delete it from the App Hub so the app does not appear twice.',
        })
      }
      stub.kept = true
      // pull the sheet manifest (source:'sheet') into the registry now, so the app routes through the live…
      await loadSheetApps(true)
      toast({
        type: 'success',
        title: `${appName} imported`,
        body: `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} generated from your sheet.`,
        action: { label: 'Open app', href: `/app/${appId}/${pages[0].id}` },
      })
      close(false)
    } catch (e) {
      setError(`${e instanceof Error ? e.message : 'Publish failed.'} The simple table version was kept.`)
    } finally {
      setPublishing(false)
    }
  }

  if (!canManage) return null
  const selectedTab = sheet?.tabs.find((t) => t.name === tab)

  const pageToggles: { key: keyof ScaffoldSelection; icon: typeof Table; title: string; desc: string }[] = scaffold
    ? [
        {
          key: 'detailPanel',
          icon: PanelRight,
          title: 'Record panel',
          desc: 'Opens when a row is clicked — header, stats and every field.',
        },
        ...(scaffold.dashboardWidgets
          ? [
              {
                key: 'dashboard' as const,
                icon: LayoutDashboard,
                title: 'Dashboard',
                desc: `${scaffold.dashboardWidgets.length} widgets — totals, per-status counts, breakdown.`,
              },
            ]
          : []),
        ...(scaffold.board
          ? [
              {
                key: 'board' as const,
                icon: Columns3,
                title: 'Board',
                desc: `Kanban grouped by “${scaffold.board.stageField}” · ${scaffold.board.stages.length} stages.`,
              },
            ]
          : []),
      ]
    : []

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden bg-surface p-0 sm:max-w-[560px]">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">
            Import a Google Sheet
          </DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Turn any spreadsheet tab into a workspace app — no code, no redeploy.
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {step === 0 ? (
            <>
              <label className="block">
                <span className={labelCls}>Google Sheets URL</span>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  className={inputCls}
                  onKeyDown={(e) => e.key === 'Enter' && url.trim() && !inspecting && void inspect()}
                />
              </label>
              <button
                onClick={() => void inspect()}
                disabled={!url.trim() || inspecting}
                className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {inspecting ? 'Inspecting…' : 'Inspect spreadsheet'}
              </button>
              {sheet && (
                <div className="rounded-md border border-border bg-surface-2 p-4">
                  <div className="text-[13px] font-semibold text-text-1">{sheet.title}</div>
                  <div className="mb-3 mt-0.5 text-[12px] text-text-3">
                    {sheet.tabs.length} {sheet.tabs.length === 1 ? 'tab' : 'tabs'} found — pick the one to import.
                  </div>
                  <Select value={tab} onValueChange={setTab}>
                    <SelectTrigger className="h-9 w-full bg-surface text-[13px]" aria-label="Sheet tab">
                      <SelectValue placeholder="Choose a tab…" />
                    </SelectTrigger>
                    <SelectContent>
                      {sheet.tabs.map((t) => (
                        <SelectItem key={t.name} value={t.name} className="text-[13px]">
                          <span className="font-medium">{t.name}</span>
                          <span className="text-[11px] text-text-3">
                            {t.rows} {t.rows === 1 ? 'row' : 'rows'}
                            {t.headers.length > 0 && ` · ${t.headers.slice(0, 4).join(', ')}${t.headers.length > 4 ? '…' : ''}`}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          ) : step === 1 ? (
            <>
              <div className="flex items-start gap-4">
                <div>
                  <span className={labelCls}>Preview</span>
                  <TintTile icon={icon} tint={accent} size="xl" />
                </div>
                <div className="flex-1 space-y-3">
                  <label className="block">
                    <span className={labelCls}>App name</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tab} className={inputCls} />
                  </label>
                  <label className="block">
                    <span className={labelCls}>Tagline (optional)</span>
                    <input
                      value={tagline}
                      onChange={(e) => setTagline(e.target.value)}
                      placeholder="One line for the App Hub card"
                      className={inputCls}
                    />
                  </label>
                </div>
              </div>
              <IconGridPicker value={icon} onChange={setIcon} />
              <div>
                <span className={labelCls}>Accent</span>
                <AccentSelect value={accent} onChange={setAccent} />
              </div>
              {selectedTab && (
                <p className="text-[12px] text-text-3">
                  Importing “{selectedTab.name}” from {sheet?.title} · {selectedTab.rows}{' '}
                  {selectedTab.rows === 1 ? 'row' : 'rows'}.
                </p>
              )}
            </>
          ) : (
            <>
              <div>
                <div className="text-[13px] font-semibold text-text-1">Your app, assembled</div>
                <p className="mt-0.5 text-[12px] text-text-3">
                  The rows were read and the columns typed. Pick the pages to publish — the records table is
                  always included.
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-start gap-3 rounded-md border border-border bg-surface-2 p-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-surface text-text-2">
                    <Table size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-text-1">Records table</div>
                    <div className="text-[12px] text-text-3">
                      {scaffold?.columns.length ?? 0} typed columns · stat tiles above the table.
                    </div>
                  </div>
                  <Checkbox checked disabled aria-label="Records table (always included)" className="mt-1.5" />
                </div>
                {pageToggles.map((p) => (
                  <label
                    key={p.key}
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 transition-colors hover:bg-surface-2"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-surface-2 text-text-2">
                      <p.icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-text-1">{p.title}</span>
                      <span className="block text-[12px] text-text-3">{p.desc}</span>
                    </span>
                    <Checkbox
                      checked={sel[p.key]}
                      onCheckedChange={(v) => setSel((s) => ({ ...s, [p.key]: v === true }))}
                      aria-label={p.title}
                      className="mt-1.5"
                    />
                  </label>
                ))}
              </div>
            </>
          )}
          {error && <p className="text-[12px] font-medium text-danger">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-border px-6 py-4">
          {step === 1 ? (
            <button
              onClick={() => { setStep(0); setError('') }}
              disabled={importing}
              className="flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:opacity-50"
            >
              <ArrowLeft size={14} /> Back
            </button>
          ) : step === 2 ? (
            <button
              onClick={() => close(false)}
              disabled={publishing}
              className="flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:opacity-50"
            >
              Keep simple table
            </button>
          ) : (
            <span />
          )}
          {step === 0 ? (
            <button
              onClick={() => { setName((n) => n || tab); setStep(1); setError('') }}
              disabled={!sheet || !tab}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              Continue <ArrowRight size={14} />
            </button>
          ) : step === 1 ? (
            <button
              onClick={() => void doImport()}
              disabled={importing || !tab}
              className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {importing ? 'Importing…' : 'Import as app'}
            </button>
          ) : (
            <button
              onClick={() => void publish()}
              disabled={publishing}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {publishing ? 'Publishing…' : 'Publish app'} <ArrowRight size={14} />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
