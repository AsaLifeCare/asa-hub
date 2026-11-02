// MY WORK for a client-role account — what the account itself filed, with its status: its own suggestions, its own…
// Nothing is asked of a client or a guardian, so there is no actions card; a row's app is named as a link only…
import { useCallback, useEffect } from 'react'
import { Link } from 'react-router'
import AppHero from '@/components/shared/AppHero'
import { useAuthStore } from '@/auth/useAuthStore'
import type { HeroFigure, HeroRead } from '@/lib/appHero'
import { badgeAllowsApp, useBadgeAccessStore } from '@/lib/badgeAccess'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { ohioTime } from '@/lib/ohio'
import { keptWords } from '@/components/FreshnessStamp'
import { useStampsHidden } from '@/lib/stamps'
import { FamilyReadLine, FamilyRefused, FamilyUnlinked, RetryButton, SourceCard } from '@/pages/features/family/FamilyParts'
import {
  useFamilyRead, whose, type FamilySource, type FamilyState, type FamilyWork, type FamilyWorkRow,
} from '@/pages/features/family/myFamily'
import { dayWords, myWorkPath, readHeaderHidden, saveHeaderHidden } from './myWorkModel'

/** A request already concluded: Settings › My Work's "Concluded requests" keeps it off the screen. */
const CONCLUDED = /^(done|sent|closed|completed|resolved)$/i

/** Where each source's rows live, and the app a row opens in. */
export const FAMILY_WORK_APPS: Record<string, { app: string; href: string; label: string }> = {
  suggestions: { app: 'suggestions', href: '/app/suggestions/box', label: 'Suggestions' },
  tasks: { app: 'taskboard', href: '/app/taskboard/board', label: 'Task Board' },
  sheet_tasks: { app: 'taskboard-sheet', href: '/app/taskboard-sheet/board', label: 'Task Board Sheet' },
  repairs: { app: 'house-repair', href: '/app/house-repair/orders', label: 'House Repair' },
}

export function FamilyWorkPage() {
  const signedIn = useAuthStore((s) => !!s.user)
  const eff = useEffectiveUser()
  const { state, refresh } = useFamilyRead<FamilyWork>(signedIn && !eff?.visiting, myWorkPath(''))
  const rules = useBadgeAccessStore((s) => s.rules)
  const opens = useCallback((appId: string) => !!appId && badgeAllowsApp(appId, eff, rules), [eff, rules])
  return <FamilyWorkScreen state={state} opens={opens} onRetry={() => void refresh()} />
}

/** The two figures a client-role account has: its open requests, and the sources that could not be read. */
export function familyWorkFigures(view: FamilyWork | null): HeroFigure[] {
  const sources = view?.sources ?? []
  const unread = sources.filter((s) => s.state === 'unreadable')
  const open = (view?.rows ?? []).filter((r) => !/^(done|sent|closed|completed|resolved)$/i.test(r.status.trim()))
  return [
    {
      label: 'Open requests',
      value: view && !unread.length ? open.length : null,
      note: !view ? '' : unread.length ? `Not counted: ${unread.map((s) => s.label).join(', ')} could not be read`
        : 'Filed by this account and not finished',
    },
    {
      label: 'Sources unread',
      value: view ? unread.length : null,
      note: unread.length ? unread.map((s) => s.label).join(', ') : 'Every source answered',
      tint: 'danger',
    },
  ]
}

function heroRead<T>(state: FamilyState<T>): HeroRead {
  if (state.data) return { state: 'ready' }
  if (state.status === 'failed') return { state: 'failed', reason: state.error }
  return { state: 'loading' }
}

export function FamilyWorkScreen({ state, opens, onRetry }: {
  state: FamilyState<FamilyWork>
  opens: (appId: string) => boolean
  onRetry: () => void
}) {
  const stampsHidden = useStampsHidden()
  const accountId = useAuthStore((s) => s.user?.id || s.user?.email || '')
  const view = state.data
  // Settings › My Work's hides, as staff get them; before the first read the header follows this account's last one
  const hidden = view?.display?.hidden ?? {}
  const headerHidden = view ? hidden.header === true : readHeaderHidden(accountId)
  useEffect(() => {
    if (view) saveHeaderHidden(accountId, hidden.header === true)
  }, [view, hidden.header, accountId])
  if (state.status === 'refused') return <FamilyRefused title="My Work" error={state.error} />
  if (view && !view.linked) return <FamilyUnlinked why={view.why} />
  const viewer = view?.viewer ?? 'client'
  // hidden notes: a source App Control keeps shut is not drawn at all (a card holding only that line); one that could
  // not be read is still said
  const sources = (view?.sources ?? []).filter((s) => !(hidden.source_notes && s.state === 'not_applicable'))
  const rows = (view?.rows ?? []).filter((r) => !(hidden.completed && CONCLUDED.test(r.status.trim())))
  return (
    <div className="w-full pb-16" data-family-work="">
      {!headerHidden && <AppHero
        eyebrow="My Work · Requests"
        label="My Work"
        read={heroRead(state)}
        figures={familyWorkFigures(view)}
        reading="Reading what this account has filed…"
        failed="My Work could not be read, so these figures are unknown."
        sentence={state.kept ? keptWords(state.readAt)
          : state.readAt && !stampsHidden ? `Read ${ohioTime(new Date(state.readAt))}` : undefined}
        onRetry={onRetry}
      />}
      {!view && state.status === 'failed' && (
        <FamilyReadLine state={state} reading="" failed="My Work could not be read" onRetry={onRetry} />
      )}
      {view && state.status === 'failed' && (
        <p role="alert" className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--warning)]">
          The last refresh failed: {state.error || 'no answer'}. The rows below are from the read before.
          <RetryButton onRetry={onRetry} busy={state.refreshing} />
        </p>
      )}
      {view && (
        <div className="grid gap-5">
          {sources.map((s) => (
            <SourceCard key={s.key} title={sourceTitle(s, viewer, view.ward.name)} source={s} quietEmpty={hidden.source_notes === true}>
              <FamilyRows rows={rows.filter((r) => r.source === s.key)} source={s} opens={opens} />
            </SourceCard>
          ))}
          {view.capped && <p className="text-[12px] text-[var(--warning)]">Only the newest rows are listed.</p>}
        </div>
      )}
    </div>
  )
}

/** "Repairs at your house" for a client, "Repairs at Jane’s house" for a guardian; the others keep their own label. */
export function sourceTitle(s: FamilySource, viewer: FamilyWork['viewer'], ward: string): string {
  if (s.key !== 'repairs') return s.label
  const who = whose(viewer, ward)
  return `Repairs at ${who.startsWith('Your') ? `y${who.slice(1)}` : who} house`
}

function FamilyRows({ rows, source, opens }: { rows: FamilyWorkRow[]; source: FamilySource; opens: (appId: string) => boolean }) {
  if (!rows.length) return null
  const where = FAMILY_WORK_APPS[source.key]
  return (
    <>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} data-row={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="min-w-0 flex-1 break-words text-[13.5px] leading-5 text-text-1">{r.title}</span>
            <span className="text-[12px] font-semibold text-text-2">{r.status}</span>
            <span className="w-[110px] text-right text-[12px] text-text-3">{r.at ? dayWords(r.at) : '—'}</span>
          </li>
        ))}
      </ul>
      {where && (opens(where.app)
        ? <Link to={where.href} className="mt-2 inline-block text-[12.5px] font-semibold text-primary hover:underline">Open in {where.label}</Link>
        : <p className="mt-2 text-[12px] text-text-3">Kept in {where.label}.</p>)}
    </>
  )
}
