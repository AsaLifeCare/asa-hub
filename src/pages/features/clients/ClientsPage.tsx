// Clients — ONE page, three views.
// The three become one, with a select on the left side; the views button chooses between them, and Unique is the…
import { useEffect, useState } from 'react'
import { Check, ChevronDown, Settings2 } from 'lucide-react'
import PageRenderer from '@/engine/PageRenderer'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { CLIENT_VIEWS, pickClientView, useClientViewsStore, type ClientViewId } from '@/stores/useClientViewsStore'
import { useClientsPolicyStore } from '@/stores/useClientsPolicyStore'
import { cn } from '@/lib/utils'
import ClientRecordPage from './ClientRecordPage'
import ClientUniquePage from './ClientUniquePage'
import { DirectoryToolbar } from './ClientsToolbar'

// The Views selector — now the SWITCHER the unified page is built around.
export function ViewsChooser() {
  const [open, setOpen] = useState(false)
  const selected = useClientViewsStore((s) => s.selected)
  const setSelected = useClientViewsStore((s) => s.setSelected)
  const masterViews = useClientsPolicyStore((s) => s.views)
  const ensure = useClientsPolicyStore((s) => s.ensure)
  useEffect(() => { ensure() }, [ensure])
  const offered = CLIENT_VIEWS.filter((v) => masterViews.includes(v.id))
  // Views is ALWAYS available — it is the one control that must never go away; only an empty lawful set hides it…
  if (offered.length === 0) return null
  const active = pickClientView(selected, offered.map((v) => v.id))
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Switch among the Client Care views — in place, yours alone"
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2"
      >
        <Settings2 size={14} />
        Views
        <span className="text-text-3">·</span>
        <span className="text-text-1">{CLIENT_VIEWS.find((v) => v.id === active)?.label}</span>
        <ChevronDown size={13} className={cn('text-text-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-44 rounded-lg border border-border bg-surface p-1 shadow-2">
          {offered.map((v) => (
            <button
              key={v.id}
              onClick={() => { setSelected(v.id); setOpen(false) }}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[13px] text-text-1 hover:bg-surface-2',
                v.id === active && 'font-semibold',
              )}
            >
              {v.label}
              {v.id === active && <Check size={14} className="text-primary" />}
            </button>
          ))}
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] leading-4 text-text-3">
            Swaps the view in place. Your choice is remembered.
          </p>
        </div>
      )}
    </div>
  )
}

export default function ClientsPage({ initialView }: { initialView?: ClientViewId }) {
  const selected = useClientViewsStore((s) => s.selected)
  const setSelected = useClientViewsStore((s) => s.setSelected)
  const masterViews = useClientsPolicyStore((s) => s.views)
  const ensure = useClientsPolicyStore((s) => s.ensure)
  useEffect(() => { ensure() }, [ensure])

  // A DEEP LINK PRESELECTS ITS VIEW: /app/clients/record opens the unified page with Record on screen (and becomes…
  useEffect(() => {
    if (initialView) setSelected(initialView)
  }, [initialView, setSelected])

  const view = pickClientView(selected, masterViews)

  // The Directory is the engine sheet — its schema comes off the registry (the runtime truth), its toolbar is the…
  const apps = useRegistryStore((s) => s.apps)
  const directorySchema = apps.find((a) => a.id === 'clients')?.pages.find((p) => p.id === 'directory')

  return (
    <div className={cn(view !== 'directory' && 'relative')}>
      {/* THE CHOOSER FLOATS on the self-titling views — there was an orphan
          row above "Unique": Unique and Record draw
          their own PageHeader, so a row holding only this chip pushed the
          title down for nothing. The Hiring page's own float pattern —
          absolute over the header line's empty right corner, every press
          passing through except the chooser's own. The Directory keeps the
          row: its toolbar shares it, so the row earns its 36px. */}
      {view === 'directory' ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <ViewsChooser />
          <DirectoryToolbar />
        </div>
      ) : (
        <div className="pointer-events-none absolute right-0 top-0 z-10 flex justify-end [&>*]:pointer-events-auto">
          <ViewsChooser />
        </div>
      )}
      {view === 'directory' && (directorySchema ? <PageRenderer schema={directorySchema} /> : null)}
      {view === 'record' && <ClientRecordPage />}
      {view === 'unique' && <ClientUniquePage />}
    </div>
  )
}
