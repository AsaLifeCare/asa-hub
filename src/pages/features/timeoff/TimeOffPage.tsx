/** Time Off, screen 1: the black band, the request form directly below it, then the reader's own requests. */
import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { motion } from 'framer-motion'
import { ListChecks, RefreshCw } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { timeOffReach, type TimeOffReach } from '@/lib/timeOffAccess'
import TimeOffHero from './TimeOffHero'
import TimeOffForm from './TimeOffForm'
import { RequestCard } from './TimeOffCards'
import { REQUESTS_ROUTE, myRows } from './timeOffModel'
import { useTimeOff, type FeedState } from './useTimeOff'

export default function TimeOffPage() {
  const user = useEffectiveUser()
  const reach = useMemo(() => timeOffReach(user), [user])
  const [params] = useSearchParams()
  const { state, refresh } = useTimeOff(params.get('house') ?? '')
  if (!reach.opens) {
    return (
      <div className="w-full pb-16">
        <EmptyState title="Time Off is the staff's screen" body="This account has no time off to file or read." />
      </div>
    )
  }
  return <TimeOffBoardView reach={reach} state={state} refresh={refresh} />
}

export function TimeOffBoardView({ reach, state, refresh }: {
  reach: TimeOffReach
  state: FeedState
  refresh: () => void | Promise<void>
}) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const house = params.get('house') ?? ''
  const feed = state.data
  const mine = myRows(feed)
  const open = (ref: string) => navigate(`${REQUESTS_ROUTE}?ref=${encodeURIComponent(ref)}`)

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="Time Off"
          subtitle="Who is off, who is waiting, and a request of your own"
          actions={(
            <>
              <button type="button" onClick={() => navigate(REQUESTS_ROUTE)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2">
                <ListChecks size={14} /> Requests
              </button>
              <button type="button" onClick={() => void refresh()} disabled={state.refreshing}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40">
                <RefreshCw size={14} className={state.refreshing ? 'animate-spin' : ''} /> Refresh
              </button>
            </>
          )}
        />
      </motion.div>

      {state.status === 'loading' && !feed
        ? <Skeleton className="mb-5 h-[236px] w-full rounded-[16px]" />
        : <TimeOffHero feed={feed} failed={state.status === 'failed' ? state.error : ''} isAdmin={reach.settings}
            reachScope={reach.scope} onOpen={open} onRetry={() => void refresh()} />}

      {feed && feed.readable && (
        <TimeOffForm feed={feed} askedHouse={feed.prefill_house || house} askedPerson={params.get('person') ?? ''}
          askedStart={/^\d{4}-\d{2}-\d{2}$/.test(params.get('start') ?? '') ? params.get('start') ?? '' : ''}
          onFiled={() => void refresh()} />
      )}

      {feed && feed.readable && (
        <section>
          <h2 className="mb-2 font-display text-[15px] font-semibold text-text-1">My time off</h2>
          {mine.length ? (
            <ul className="grid gap-2">{mine.map((r) => <RequestCard key={r.ref} row={r} onOpen={open} />)}</ul>
          ) : (
            <p className="rounded-lg border border-border bg-surface px-4 py-3 text-[12.5px] text-text-3">
              No time off of yours is waiting or scheduled.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
