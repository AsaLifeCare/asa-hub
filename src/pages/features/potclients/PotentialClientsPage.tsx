// Potential Clients — the referral pipeline, mounted as the static route /app/potential-clients/pipeline in App.tsx…
// It used to open with an "API connection — Demo mode" card carrying a placeholder URL.
import { useEffect, useMemo, useState } from 'react'
import { Check, Settings2 } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import PageRenderer from '@/engine/PageRenderer'
import { potentialClientsPipelinePage } from '@/registry/apps-potclients'
import {
  POTCLIENTS_VIEWS,
  type PotClientsViewId,
  usePotClientsPolicyStore,
  usePotClientsViewsStore,
} from '@/stores/usePotClientsViewsStore'
import type { PageSchema } from '@/engine/types'
import { cn } from '@/lib/utils'
import { useCandidatesOpen, withCandidateLink } from '@/pages/features/clientcandidates/candidateLink'
import ReferralsHero from './ReferralsHero'
import { useReferralAnalysis } from './useReferralAnalysis'

const VIEW_KEY = 'asa:potclients-view'
type LeadView = 'drawer' | 'profile'

// Each option names its policy view, so a view `potclients_views_master` removed is neither offered nor obeyed.
const VIEW_OPTIONS: { id: LeadView; view: PotClientsViewId; label: string }[] = [
  { id: 'drawer', view: 'pipeline', label: 'Details drawer' },
  { id: 'profile', view: 'unique', label: 'Unique profile' },
]

// The toggles a person has over their own sidebar.
const SIDEBAR_ROW_LABEL: Record<(typeof POTCLIENTS_VIEWS)[number], string> = {
  pipeline: 'Pipeline in sidebar',
  funnel: 'Funnel in sidebar',
  compare: 'Compare in sidebar',
  unique: 'Unique in sidebar',
}

function ViewChooser({ view, onPick }: { view: LeadView; onPick: (v: LeadView) => void }) {
  const [open, setOpen] = useState(false)
  // the same two configs every viewed app carries: the master's policy decides what EXISTS; these toggles are the…
  const master = usePotClientsPolicyStore((s) => s.views)
  const enabled = usePotClientsViewsStore((s) => s.enabled)
  const setEnabled = usePotClientsViewsStore((s) => s.setEnabled)
  const lawful = POTCLIENTS_VIEWS.filter((v) => (master as string[]).includes(v))
  const lastOn = lawful.filter((v) => enabled[v] ?? true).length <= 1
  const options = VIEW_OPTIONS.filter((o) => (master as string[]).includes(o.view))
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2"
      >
        <Settings2 size={13} /> View
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-border bg-surface p-1 shadow-2">
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => { onPick(o.id); setOpen(false) }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
            >
              <Check size={14} className={cn('shrink-0', view === o.id ? 'text-primary' : 'text-transparent')} />
              <span className="text-[12.5px] font-semibold text-text-1">{o.label}</span>
            </button>
          ))}
          {lawful.length > 1 && (
            <>
              <div className="my-1 border-t border-border/60" />
              {lawful.map((v) => {
                const on = enabled[v] ?? true
                return (
                  <button
                    key={v}
                    onClick={() => { if (!(on && lastOn)) setEnabled(v, !on) }}
                    className={cn('flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-surface-2', on && lastOn && 'cursor-not-allowed opacity-60')}
                    title={on && lastOn ? 'The last view cannot be hidden' : undefined}
                  >
                    <span className="text-[12.5px] text-text-2">{SIDEBAR_ROW_LABEL[v]}</span>
                    <span className={cn('h-4 w-7 rounded-full p-0.5 transition-colors', on ? 'bg-primary' : 'bg-surface-3')}>
                      <span className={cn('block h-3 w-3 rounded-full bg-white transition-transform', on && 'translate-x-3')} />
                    </span>
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function PotentialClientsPage() {
  const [view, setView] = useState<LeadView>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'profile' ? 'profile' : 'drawer' } catch { return 'drawer' }
  })
  const pick = (v: LeadView) => {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* the choice just won't survive the tab */ }
  }

  // THE MASTER'S POLICY IS READ HERE TOO — this page must not depend on the sidebar having mounted to know what…
  const master = usePotClientsPolicyStore((s) => s.views)
  const ensure = usePotClientsPolicyStore((s) => s.ensure)
  useEffect(() => { ensure() }, [ensure])

  // A removed view's stored preference is ignored, not erased — it returns if the view is restored.
  const effective: LeadView = useMemo(() => {
    const allowed = VIEW_OPTIONS.filter((o) => (master as string[]).includes(o.view))
    if (!allowed.length) return 'drawer'
    return allowed.some((o) => o.id === view) ? view : allowed[0].id
  }, [master, view])

  // The profile view is the SAME schema with the drawer swapped for a page navigation — filters, columns, tints and…
  const candidatesOpen = useCandidatesOpen()
  const schema = useMemo<PageSchema>(() => {
    const base: PageSchema = effective === 'drawer' ? potentialClientsPipelinePage : {
      ...potentialClientsPipelinePage,
      config: {
        ...potentialClientsPipelinePage.config,
        detailPanel: undefined,
        rowNavigate: '/app/potential-clients/unique?record=:id',
        rowActions: [{ id: 'view', label: 'Open profile', icon: 'eye' }],
      },
    }
    return candidatesOpen ? withCandidateLink(base) : base
  }, [effective, candidatesOpen])

  const referrals = useReferralAnalysis()

  return (
    <div className="w-full">
      <ReferralsHero read={referrals.read} on="pipeline" onRetry={referrals.retry} />
      <PageHeader
        title="Potential Clients"
        subtitle="Open referrals from the county portal — rated, and ordered by who to call first."
        actions={<ViewChooser view={effective} onPick={pick} />}
      />
      <PageRenderer schema={schema} />
    </div>
  )
}
