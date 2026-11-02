// Settings → Potential Clients app.
// WHICH OF THE FOUR VIEWS EXIST FOR ANYBODY.
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { EASE_OUT_EXPO } from '@/engine/motion'
import Card, { CardHeader } from '@/components/shared/Card'
import { Switch } from '@/components/ui/switch'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { POTCLIENTS_VIEW_LIST, usePotClientsPolicyStore, type PotClientsViewId } from '@/stores/usePotClientsViewsStore'
import { fetchAlerts } from '@/lib/hiringAlerts'
import ConfigReadFailed from './ConfigReadFailed'

type AlertRow = { key: string; value: string; note: string; default_value: string; group: string }

const ALL = POTCLIENTS_VIEW_LIST.map((v) => v.id)

export default function PotClientsMasterSection() {
  const [views, setViews] = useState<PotClientsViewId[] | null>(null)
  const [busy, setBusy] = useState(false)
  /** why the config read failed; '' while it is being read or once it landed */
  const [failed, setFailed] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await (fetchAlerts() as Promise<{ rows: AlertRow[] }>)
      const raw = d.rows.find((r) => r.key === 'potclients_views_master')?.value ?? ''
      const low = raw.trim().toLowerCase()
      setViews(
        low === 'no' ? []
          : !low || low === 'yes' ? [...ALL]
            : ALL.filter((id) => low.includes(id)),
      )
    } catch (e) {
      // NOT setViews([]): an unreadable config drawn as "off for everyone" is a false law that one accidental flip…
      setViews(null)
      setFailed((e instanceof Error ? e.message : String(e)) || 'the read did not come back')
      toast({ type: 'danger', title: 'Config unreadable', body: 'The switches stay hidden until the read succeeds.' })
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async (next: PotClientsViewId[]) => {
    setBusy(true)
    try {
      // 'no' when empty — a blank cell reads as "everything" by the legacy rule, and a law somebody emptied has to…
      await gasAction('hiringAlertsSet', {
        values: { potclients_views_master: next.length ? next.join(', ') : 'no' },
      })
      // this browser obeys immediately; every other one on its next load
      usePotClientsPolicyStore.setState({ views: next, fetched: true })
      toast({ type: 'success', title: 'Saved', body: 'Potential Clients now obeys this everywhere.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
      void load()
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: PotClientsViewId) => {
    if (!views) return
    // KEPT IN THE DECLARED ORDER, never in click order: this string is what the sidebar reads, and a list that…
    const on = views.includes(id)
    const next = ALL.filter((v) => (v === id ? !on : views.includes(v)))
    setViews(next)
    void save(next)
  }

  return (
    <motion.section
      id="potclientsmaster"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-20"
    >
      <Card>
        <CardHeader
          title="Potential Clients app"
          sub="Which views exist for anybody. The per-user Views button picks from inside this."
        />
        {views === null ? (
          failed ? (
            <ConfigReadFailed why={failed} onRetry={() => { setFailed(''); void load() }} />
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-text-3">
              <Loader2 size={14} className="animate-spin" /> Reading the config…
            </p>
          )
        ) : (
          <div className="space-y-3">
            {POTCLIENTS_VIEW_LIST.map((v) => (
              <div key={v.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
                <div>
                  <p className="text-[13.5px] font-semibold text-text-1">{v.label}</p>
                  <p className="text-[12px] text-text-3">
                    {views.includes(v.id)
                      ? `${v.sub} — users may still hide it from their own sidebar.`
                      : 'Disabled for everyone: sidebar, chooser and deep links refuse it.'}
                  </p>
                </div>
                <Switch checked={views.includes(v.id)} disabled={busy} onCheckedChange={() => toggle(v.id)} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </motion.section>
  )
}
