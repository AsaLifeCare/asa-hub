/** Time Off, screen 2: every request this reader may see; `?tab=` and `?ref=` come from the address. */
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { motion } from 'framer-motion'
import { CalendarPlus, RefreshCw } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import SearchInput from '@/components/shared/SearchInput'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { timeOffReach, type TimeOffReach } from '@/lib/timeOffAccess'
import TimeOffHero from './TimeOffHero'
import TimeOffPanel from './TimeOffPanel'
import { RequestCard } from './TimeOffCards'
import {
  BOARD_ROUTE, STATUS_LABEL, TAB_LABEL, VIA_LABEL, cutsFrom, dayWords, editAsked, filterRows, focusedAction, openRefOf,
  scopeWords, tabFrom, tabsFor, unreadDirectorsLine, type Cuts, type Tab,
} from './timeOffModel'
import { useTimeOff, type FeedState } from './useTimeOff'

const SELECT = 'h-9 rounded-md border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none focus:border-primary'

export default function TimeOffRequestsPage() {
  const user = useEffectiveUser()
  const reach = useMemo(() => timeOffReach(user), [user])
  const { state, refresh } = useTimeOff()
  if (!reach.opens) {
    return (
      <div className="w-full pb-16">
        <EmptyState title="Time Off is the staff's screen" body="This account has no time off to file or read." />
      </div>
    )
  }
  return <TimeOffRequestsView reach={reach} state={state} refresh={refresh} />
}

export function TimeOffRequestsView({ reach, state, refresh }: {
  reach: TimeOffReach
  state: FeedState
  refresh: () => void | Promise<void>
}) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const feed = state.data
  const openRef = openRefOf(params)
  const focus = focusedAction(params.get('act'))
  const tabs = useMemo(() => (feed ? tabsFor(feed.me) : (['waiting', 'scheduled', 'history'] as Tab[])), [feed])
  const tab = tabFrom(params.get('tab'), tabs)
  const [cuts, setCuts] = useState<Cuts>({})

  const rows = useMemo(() => feed?.rows ?? [], [feed])
  const shown = useMemo(() => filterRows(rows, tab, cuts), [rows, tab, cuts])
  const choices = useMemo(() => cutsFrom(rows), [rows])
  const counts = useMemo(() => Object.fromEntries(tabs.map((t) => [t, filterRows(rows, t, {}).length])), [rows, tabs])
  // "Waiting on me" is decided by the directors list; one that did not land is "—" and its sentence, never 0
  const mineUnknown = feed?.directors_readable === false
  const countOf = (t: Tab) => (t === 'mine' && mineUnknown ? '—' : String(counts[t] ?? 0))

  const open = (r: string) => {
    const p = new URLSearchParams(params)
    p.set('ref', r)
    p.delete('act')
    setParams(p, { replace: false })
  }
  const close = () => {
    const p = new URLSearchParams(params)
    p.delete('ref')
    p.delete('act')
    p.delete('edit')
    setParams(p, { replace: true })
  }
  const pick = (t: Tab) => {
    const p = new URLSearchParams(params)
    p.set('tab', t)
    setParams(p, { replace: true })
  }

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="Time Off · Requests"
          subtitle="Every request you may see, with both approvals"
          actions={(
            <>
              <button type="button" onClick={() => navigate(BOARD_ROUTE)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover">
                <CalendarPlus size={14} /> Request time off
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
        ? <Skeleton className="mb-5 h-[140px] w-full rounded-[16px]" />
        : <TimeOffHero feed={feed} failed={state.status === 'failed' ? state.error : ''} isAdmin={reach.settings}
            reachScope={reach.scope} compact onOpen={open} onRetry={() => void refresh()} />}

      {feed && feed.readable && (
        <>
          <SegmentedTabs className="mb-4 w-fit max-w-full flex-wrap"
            tabs={tabs.map((t) => ({ id: t, label: `${TAB_LABEL[t]} · ${countOf(t)}` }))}
            value={tab} onChange={(t) => pick(t as Tab)} />

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SearchInput value={cuts.q ?? ''} onChange={(q) => setCuts((c) => ({ ...c, q }))}
              className="w-full max-w-full sm:w-[240px]" placeholder="Search person, house, ref…" />
            <select value={cuts.house ?? 'all'} onChange={(e) => setCuts((c) => ({ ...c, house: e.target.value }))}
              className={SELECT} aria-label="House">
              <option value="all">Every house</option>
              {choices.houses.map((h) => <option key={h.code} value={h.code}>{h.label}</option>)}
            </select>
            <select value={cuts.person ?? 'all'} onChange={(e) => setCuts((c) => ({ ...c, person: e.target.value }))}
              className={SELECT} aria-label="Person">
              <option value="all">Everybody</option>
              {choices.people.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={cuts.status ?? 'all'} onChange={(e) => setCuts((c) => ({ ...c, status: e.target.value }))}
              className={SELECT} aria-label="Status">
              <option value="all">Any status</option>
              {choices.statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
            </select>
            <select value={cuts.via ?? 'all'} onChange={(e) => setCuts((c) => ({ ...c, via: e.target.value }))}
              className={SELECT} aria-label="Filed via">
              <option value="all">Filed any way</option>
              {choices.vias.map((v) => <option key={v} value={v}>{VIA_LABEL[v] ?? v}</option>)}
            </select>
            <input type="date" value={cuts.day && cuts.day !== 'all' ? cuts.day : ''} aria-label="Off on this day"
              onChange={(e) => setCuts((c) => ({ ...c, day: e.target.value || 'all' }))} className={SELECT} />
            <span className="ml-auto text-[12px] text-text-3">
              {shown.length} of {countOf(tab)} · {scopeWords(feed.me.scope, feed.me.manages, feed.houses)}
            </span>
          </div>

          {tab === 'mine' && mineUnknown ? (
            <p role="alert" className="rounded-lg border-2 border-danger bg-danger/[0.05] px-4 py-2.5 text-[12.5px] leading-[18px] text-text-1">
              {unreadDirectorsLine(feed.directors_why)}
            </p>
          ) : shown.length ? (
            <ul className="grid gap-2">
              {shown.map((r) => <RequestCard key={r.ref} row={r} onOpen={open} focused={r.ref === openRef} />)}
            </ul>
          ) : (
            <EmptyState title={counts[tab] ? 'Nothing matches those cuts' : `Nothing in ${TAB_LABEL[tab]}`}
              body={tab === 'mine' ? 'No request is waiting on your approval.' : 'Requests appear here the moment they are filed.'} />
          )}

          {tab === 'review' && (feed.orphan_ro?.length ?? 0) > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 font-display text-[15px] font-semibold text-text-1">R/O on a calendar with no time off behind it</h2>
              <ul className="grid gap-1.5">
                {(feed.orphan_ro ?? []).map((o) => (
                  <li key={`${o.house}|${o.person}|${o.col_iso}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-[12.5px] text-text-2">
                    <span className="font-medium text-text-1">{o.person}</span>
                    <span>{dayWords(o.col_iso)} · {o.label}</span>
                    <button type="button"
                      onClick={() => navigate(`${BOARD_ROUTE}?house=${encodeURIComponent(o.house)}&person=${encodeURIComponent(o.person)}&start=${o.col_iso}`)}
                      className="ml-auto rounded-md border border-border px-2.5 py-1 text-[12px] font-semibold text-text-2 hover:bg-surface-2">
                      File as time off
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {openRef && <TimeOffPanel refId={openRef} focus={focus} edit={editAsked(params)} onClose={close} onChanged={() => void refresh()} />}
    </div>
  )
}
