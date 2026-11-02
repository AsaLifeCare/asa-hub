/** The black band: actions ready, test mode, what waits for a click, the last run; a figure not read is "—", never 0. */
import { motion } from 'framer-motion'
import { Link } from 'react-router'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { heroBand } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import {
  STATUS_META, STATUS_ORDER, ago, isEnabled, lastRun, resultWord, testWord,
  type HeroFigures, type HouseState, type RunbookView,
} from '@/lib/productionActions'
import type { RunbookState } from './useProductionActions'

function clock(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function Figure({ value, label, sub, tone, extra }: {
  value: string
  label: string
  sub: string
  tone?: 'amber' | 'danger'
  extra?: React.ReactNode
}) {
  const colour = tone ? { color: heroBand(tone) } : undefined
  return (
    <div className="min-w-0">
      <p className="font-stat text-[34px] leading-none text-white" style={colour}>{value}</p>
      <p className="mt-1.5 text-[12px] font-medium text-white/80">{label}</p>
      <p className="mt-0.5 text-[11.5px] leading-[1.45] text-white/50" style={colour}>{sub}</p>
      {extra}
    </div>
  )
}

const TEST_SUB = {
  on: 'Run only rehearses — each run is a row in CommMock',
  off: 'Go-live: a run touches the real systems',
  unreadable: 'Could not be read, so it counts as on',
} as const

export function houseLine(name: string, h: HouseState | undefined, withWhy: boolean): string {
  if (!h || h.state === 'fresh') return ''
  if (h.state === 'missing') return `${name} not set up yet`
  if (h.state === 'pending') return `${name} not copied into the platform yet`
  if (h.state === 'stale') return `${name} copy is behind: ${h.why}`
  return withWhy && h.why ? `${name} could not be read: ${h.why}` : `${name} could not be read`
}

export default function ProductionActionsHero({ state, view, figures, now, onRetry }: {
  state: RunbookState
  view: RunbookView | null
  figures: HeroFigures | null
  now: number
  onRetry: () => void
}) {
  const dash = '—'
  const f = figures
  const actionsRead = !!view?.actions
  const runsRead = !!view?.runs
  const total = view?.actions ? view.actions.filter(isEnabled).length : null
  const test = testWord(view?.test_mode)
  const testValue = !view?.test_mode ? dash : test === 'on' ? 'ON' : test === 'off' ? 'OFF' : dash
  const notRead = actionsRead ? 'History not read' : 'Not read'
  const last = runsRead ? lastRun(view?.runs) : null
  const band = f ? STATUS_ORDER.reduce((n, s) => n + f.band[s], 0) : 0
  const house = view?.house.actions
  const runsHouse = view?.house.runs
  const read = [
    state.readAt ? `Read ${clock(state.readAt)}` : '',
    house?.state === 'fresh' ? 'runbook up to date' : houseLine('runbook', house, false),
    houseLine('History', runsHouse, true),
  ].filter(Boolean).join(' · ')
  const amber = (!!house && house.state !== 'fresh') || (!!runsHouse && runsHouse.state !== 'fresh') ||
    state.status === 'failed'
  return (
    <div className="mb-4 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/45">
        Go-live runbook · {total === null ? dash : `${total} action${total === 1 ? '' : 's'}`}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        <Figure
          value={f ? String(f.ready) : dash}
          label="Actions ready"
          sub={f ? `${f.rehearsed} rehearsed · ${f.done} done of ${f.total}` : notRead}
        />
        <Figure
          value={testValue}
          label="Test mode"
          sub={view?.test_mode ? TEST_SUB[test] : 'Not read yet'}
          tone={test === 'off' ? 'danger' : undefined}
          extra={(
            <Link to="/settings#testmode" className="mt-1 inline-block text-[11.5px] text-white/70 underline-offset-2 hover:underline">
              Settings → Test mode
            </Link>
          )}
        />
        <Figure
          value={f ? String(f.waiting) : dash}
          label="Waiting for a click"
          sub={f ? `${f.automaticWaiting} automatic · ${f.manualWaiting} manual` : notRead}
          tone={f && f.waiting > 0 && test === 'off' ? 'amber' : undefined}
        />
        <Figure
          value={!runsRead ? dash : last ? ago(last.createdAt, now) || dash : 'None yet'}
          label="Last run"
          sub={last ? `#${last.number} ${last.title} · ${resultWord(last)}${last.by_name ? ` · by ${last.by_name}` : ''}`
            : runsRead ? 'Nothing has been rehearsed or run' : notRead}
        />
      </div>

      <div className="mt-6">
        <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-white/10">
          {f && band > 0 && STATUS_ORDER.map((s) => (f.band[s] ? (
            <motion.span
              key={s}
              title={`${f.band[s]} · ${STATUS_META[s].label}`}
              initial={{ width: 0 }}
              animate={{ width: `${(f.band[s] / band) * 100}%` }}
              transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ background: heroBand(STATUS_META[s].tint) }}
            />
          ) : null))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-white/65">
          {STATUS_ORDER.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: heroBand(STATUS_META[s].tint) }} />
              {STATUS_META[s].label}
              <span className="font-stat text-white/90">{f ? f.band[s] : dash}</span>
            </span>
          ))}
        </div>
      </div>

      {view && (
        <div className="mt-5 border-t border-white/10 pt-3.5">
          <p className="text-[12px] leading-[1.6] text-white/55" style={amber ? { color: heroBand('amber') } : undefined}>
            {read}
          </p>
          {actionsRead && amber && (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] leading-[1.55]" style={{ color: heroBand('amber') }}>
              <AlertTriangle size={13} className="shrink-0" />
              {state.status === 'failed' && <span>The last refresh failed: {state.error || 'no answer'}.</span>}
              <button type="button" onClick={onRetry}
                className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11.5px] text-white/85 hover:bg-white/15">
                <RotateCw size={11} /> Try again
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
