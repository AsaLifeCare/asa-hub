// Settings → Hiring app.
// THE COMPANY'S WORD OVER THE HIRING PIPELINE: which of its views exist for anybody.
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { EASE_OUT_EXPO } from '@/engine/motion'
import Card, { CardHeader } from '@/components/shared/Card'
import CatalogueNotice, { catalogueOf, type CatalogueState } from '@/components/shared/CatalogueNotice'
import { Switch } from '@/components/ui/switch'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import {
  collapseHiringViews, expandHiringViews, HIRING_VIEWS, hiringViewsAreLegacySafe,
  type HiringViewId,
} from '@/stores/useHiringViewsStore'
import { useHiringPolicyStore } from '@/stores/useHiringPolicyStore'
import { fetchAlerts } from '@/lib/hiringAlerts'
import ConfigReadFailed from './ConfigReadFailed'

type AlertRow = { key: string; value: string; note: string; default_value: string; group: string }

export default function HiringMasterSection() {
  const [views, setViews] = useState<HiringViewId[] | null>(null)
  const [busy, setBusy] = useState(false)
  // Where this key and its note came from — the sheet, or the last-resort copy in the code.
  const [catalogue, setCatalogue] = useState<CatalogueState | null>(null)
  /** why the config read failed; '' while it is being read or once it landed */
  const [failed, setFailed] = useState('')
  const legacyServer = useHiringPolicyStore((s) => s.legacyServer)
  const ensurePolicy = useHiringPolicyStore((s) => s.ensure)
  useEffect(() => { ensurePolicy() }, [ensurePolicy])

  const load = useCallback(async () => {
    try {
      const d = await (fetchAlerts() as Promise<{ rows: AlertRow[] }>)
      setCatalogue(catalogueOf(d))
      const raw = d.rows.find((r) => r.group === 'hiringapp' && r.key === 'hiring_views_master')?.value ?? ''
      const low = raw.trim().toLowerCase()
      const all = HIRING_VIEWS.map((v) => v.id)
      setViews(
        low === 'no' ? []
          // blank or 'yes' means everything, as it always did
          : !low || low === 'yes' ? all
            // the words in the cell, `flow` expanded to the six it stands for
            : expandHiringViews(low.split(/[,;\s]+/).filter(Boolean)),
      )
    } catch (e) {
      // NOT setViews([]): an unreadable config painted as "Disabled for everyone" is a false law one accidental…
      setViews(null)
      setFailed((e instanceof Error ? e.message : String(e)) || 'the read did not come back')
      toast({ type: 'danger', title: 'Config unreadable', body: 'These switches stay hidden until the read succeeds.' })
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async (next: HiringViewId[]) => {
    setBusy(true)
    try {
      // 'no' when empty — a blank cell means "everything" by the legacy reading, and an emptied law must stay…
      const words = collapseHiringViews(next)
      await gasAction('hiringAlertsSet', {
        values: { hiring_views_master: words.length ? words.join(', ') : 'no' },
      })
      // this browser applies the new law immediately; others on next load
      useHiringPolicyStore.setState({ views: next, fetched: true })
      toast({ type: 'success', title: 'Saved', body: 'The Hiring app now obeys this everywhere.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
      void load()
    } finally {
      setBusy(false)
    }
  }

  const toggleView = (id: HiringViewId) => {
    if (!views) return
    const next = views.includes(id) ? views.filter((v) => v !== id) : [...views, id]
    // THE UN-PUBLISHED PARSER: while the serving Apps Script still speaks the two-word vocabulary, a fine-grained…
    if (legacyServer && !hiringViewsAreLegacySafe(next)) {
      toast({
        type: 'info',
        title: 'Not saved — the backend is a version behind',
        body: 'This browser knows the nine views; the serving backend still reads only Pipeline and Flow, and would drop the rest for everybody. Set this once the platform release that carries it is live.',
      })
      return
    }
    setViews(next)
    void save(next)
  }

  return (
    <motion.section
      id="hiringmaster"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-20"
    >
    <Card>
      <CardHeader
        title="Hiring app — views"
        sub="Which views exist for anybody. The per-user Views button picks from inside this. The Archive is a page, not a view — it is not governed here."
      />
      {views === null ? (
        failed
          ? <ConfigReadFailed why={failed} onRetry={() => { setFailed(''); void load() }} />
          : <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the config…</p>
      ) : (
        <div className="space-y-3">
          <CatalogueNotice catalogue={catalogue} />
          {legacyServer && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
              The serving backend is a version behind this screen: it reads only Pipeline and
              Flow. Until its next release, the six Flow views move together and the two Talent
              views cannot be governed here.
            </p>
          )}
          {HIRING_VIEWS.map((v) => (
            <div key={v.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
              <div>
                <p className="text-[13.5px] font-semibold text-text-1">{v.label}</p>
                <p className="text-[12px] text-text-3">
                  {views.includes(v.id) ? 'Exists — users may still hide it from their own sidebar.' : 'Disabled for everyone: sidebar, chooser and deep links refuse it.'}
                </p>
              </div>
              <Switch checked={views.includes(v.id)} disabled={busy} onCheckedChange={() => toggleView(v.id)} />
            </div>
          ))}
        </div>
      )}
    </Card>
    </motion.section>
  )
}
