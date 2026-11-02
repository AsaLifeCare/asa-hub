// Settings → Clients app.
// THE COMPANY'S WORD OVER THE CLIENTS APP: which of the three views exist for anybody, and whether the…
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { EASE_OUT_EXPO } from '@/engine/motion'
import Card, { CardHeader } from '@/components/shared/Card'
import CatalogueNotice, { catalogueOf, type CatalogueState } from '@/components/shared/CatalogueNotice'
import { Switch } from '@/components/ui/switch'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { CLIENT_VIEWS, type ClientViewId } from '@/stores/useClientViewsStore'
import type { ClientToolId } from '@/stores/useClientsPolicyStore'
import { useClientsPolicyStore } from '@/stores/useClientsPolicyStore'
import { fetchAlerts, dropAlertsCache } from '@/lib/hiringAlerts'
import ConfigReadFailed from './ConfigReadFailed'

type AlertRow = { key: string; value: string; note: string; default_value: string; group: string }

const TOOLS: { id: ClientToolId; label: string; desc: string }[] = [
  { id: 'share', label: 'Share', desc: 'The share sheet over the visible list.' },
  { id: 'export', label: 'Export', desc: 'CSV of the visible list.' },
  { id: 'add', label: 'Add client', desc: 'The declared clientCreate resolution.' },
]

export default function ClientsMasterSection() {
  const [views, setViews] = useState<ClientViewId[] | null>(null)
  const [tools, setTools] = useState<ClientToolId[]>(['share', 'export', 'add'])
  const [busy, setBusy] = useState(false)
  // Where these two keys and their notes came from — the sheet, or the last-resort copy in the code.
  const [catalogue, setCatalogue] = useState<CatalogueState | null>(null)
  /** why the config read failed; '' while it is being read or once it landed */
  const [failed, setFailed] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await (fetchAlerts() as Promise<{ rows: AlertRow[] }>)
      setCatalogue(catalogueOf(d))
      const rows = d.rows.filter((r) => r.group === 'clients')
      const raw = rows.find((r) => r.key === 'clients_views_master')?.value ?? 'directory, record, unique'
      setViews(
        CLIENT_VIEWS.map((v) => v.id).filter((id) => raw.toLowerCase().includes(id)),
      )
      const rawTools = (rows.find((r) => r.key === 'clients_toolbar_master')?.value ?? 'share, export, add').trim().toLowerCase()
      setTools(
        rawTools === 'no' ? []
          : !rawTools || rawTools === 'yes' ? ['share', 'export', 'add']
            : TOOLS.map((t) => t.id).filter((id) => rawTools.includes(id)),
      )
    } catch (e) {
      // NOT setViews([]): an unreadable config painted as "Disabled for everyone" is a false law one accidental…
      setViews(null)
      setFailed((e instanceof Error ? e.message : String(e)) || 'the read did not come back')
      toast({ type: 'danger', title: 'Config unreadable', body: 'These switches stay hidden until the read succeeds.' })
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async (nextViews: ClientViewId[], nextTools: ClientToolId[]) => {
    setBusy(true)
    try {
      await gasAction('hiringAlertsSet', {
        values: {
          clients_views_master: nextViews.join(', '),
          // 'no' when empty: a blank cell means "everything" by the legacy reading, and an emptied toolbar must…
          clients_toolbar_master: nextTools.length ? nextTools.join(', ') : 'no',
        },
      })
      dropAlertsCache()          // every reader shares one memo of this config
      // this browser applies the new law immediately; others on next load
      useClientsPolicyStore.setState({ views: nextViews, tools: nextTools, fetched: true })
      toast({ type: 'success', title: 'Saved', body: 'The Client Care app now obeys this everywhere.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
      void load()
    } finally {
      setBusy(false)
    }
  }

  const toggleView = (id: ClientViewId) => {
    if (!views) return
    const next = views.includes(id) ? views.filter((v) => v !== id) : [...views, id]
    setViews(next)
    void save(next, tools)
  }
  const toggleTool = (id: ClientToolId) => {
    if (!views) return
    const next = tools.includes(id) ? tools.filter((t) => t !== id) : [...tools, id]
    setTools(next)
    void save(views, next)
  }

  return (
    <motion.section
      id="clientsmaster"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-20"
    >
    <Card>
      <CardHeader
        title="Client Care app — views and toolbar"
        sub="Which views exist for anybody, and whether the selection toolbar exists at all. The per-user Views button picks from inside this."
      />
      {views === null ? (
        failed
          ? <ConfigReadFailed why={failed} onRetry={() => { setFailed(''); void load() }} />
          : <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the config…</p>
      ) : (
        <div className="space-y-3">
          <CatalogueNotice catalogue={catalogue} />
          {CLIENT_VIEWS.map((v) => (
            <div key={v.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
              <div>
                <p className="text-[13.5px] font-semibold text-text-1">{v.label}</p>
                <p className="text-[12px] text-text-3">
                  {views.includes(v.id) ? 'Exists — users may still hide it from their own sidebar.' : 'Disabled for everyone: sidebar, chooser and deep links refuse it.'}
                </p>
              </div>
              <Switch checked={views.includes(v.id)} onCheckedChange={() => toggleView(v.id)} disabled={busy} />
            </div>
          ))}
          <p className="pt-1 text-[12px] font-semibold uppercase tracking-[0.05em] text-text-3">Selection toolbar — per button</p>
          {TOOLS.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
              <div>
                <p className="text-[13.5px] font-semibold text-text-1">{t.label}</p>
                <p className="text-[12px] text-text-3">{t.desc}</p>
              </div>
              <Switch checked={tools.includes(t.id)} onCheckedChange={() => toggleTool(t.id)} disabled={busy} />
            </div>
          ))}
          <p className="text-[12px] leading-4 text-text-3">
            Views has no switch: it is always available — it is how people reach the views at all.
          </p>
          <p className="text-[12px] leading-4 text-text-3">
            Disabling every view removes the app from everyone&apos;s sidebar. Other browsers pick the change up on
            their next load.
          </p>
        </div>
      )}
    </Card>
    </motion.section>
  )
}
