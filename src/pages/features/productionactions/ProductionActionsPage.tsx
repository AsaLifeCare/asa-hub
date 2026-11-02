/** PRODUCTION ACTIONS — the go-live runbook, the master's alone; every door checks again on the server. */
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, ChevronDown, Plus, RefreshCw, Rocket, TestTube2 } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { activeTenantId } from '@/stores/useTenantStore'
import { activeWorldId } from '@/stores/useWorldStore'
import { askConfirm } from '@/stores/useDialogStore'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { OPEN_RED } from '@/pages/features/shifts/houseCalTypes'
import {
  PHASES, cardStatus, effective, goLiveBanner, grouped, heroFigures, historyRead, markAsks, openAt, opensTab,
  phaseActive, previewBlock, previewFetches, readablyOff, rehearsalWords, runAllLabel, runAllList, runLabel,
  runPayload, runSequence, newClientId, undoWords,
  type GoLiveBanner, type HouseState, type PAction, type Phase, type PreviewItem, type PRun, type RunbookView,
  type TestSwitch,
} from '@/lib/productionActions'
import ProductionActionsHero from './ProductionActionsHero'
import ActionCard from './ActionCard'
import PreviewSheet from './PreviewSheet'
import HistorySheet from './HistorySheet'
import EditActionSheet, { type Problem } from './EditActionSheet'
import { useProductionActions } from './useProductionActions'

export const MASTER_ONLY_TITLE = "Production Actions is the master's tool"

export function runbookGate(user: { isMaster?: boolean } | null | undefined, away: boolean): { open: boolean; why: string } {
  if (away) return { open: false, why: 'It runs at headquarters only — return to headquarters first.' }
  if (user?.isMaster !== true) return { open: false, why: 'Only the master can open the go-live runbook.' }
  return { open: true, why: '' }
}

export function useRunbook() {
  const user = useEffectiveUser()
  const gate = runbookGate(user, !!activeWorldId() || !!activeTenantId())
  return { gate, pa: useProductionActions(gate.open) }
}

export type Runbook = ReturnType<typeof useProductionActions>

const BLOOD_SURFACE = cn(OPEN_RED, 'hover:bg-[#8b0000]')

export function StepBar({ view }: { view: RunbookView }) {
  const sw = view.test_mode
  const { phases } = grouped(view.actions)
  const read = historyRead(view)
  return (
    <ol className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {phases.map(({ phase, actions }, i) => {
        const done = read ? String(actions.filter((a) => effective(a, view.runs).done).length) : '—'
        const active = phaseActive(phase.id, sw)
        return (
          <li key={phase.id} className="flex min-w-0 items-center gap-2">
            <div className={cn('min-w-0 flex-1 rounded-[12px] border px-3 py-2',
              active ? 'border-primary bg-tint-primary' : 'border-border bg-surface')}>
              <p className={cn('text-[12.5px] font-semibold', active ? 'text-tint-fg-primary' : 'text-text-2')}>{phase.label}</p>
              <p className="text-[11.5px] text-text-3">
                <span className="font-stat">{done}/{actions.length}</span> done
                {!active && phase.idle ? ` · ${phase.idle}` : ''}
              </p>
            </div>
            {i < phases.length - 1 && <span className="hidden text-text-3 sm:inline" aria-hidden>→</span>}
          </li>
        )
      })}
    </ol>
  )
}

export function GoLiveStrip({ banner, onRunAll, busy, ready }: {
  banner: GoLiveBanner
  onRunAll: () => void
  busy: boolean
  ready: number
}) {
  if (!banner) return null
  if (banner.tone === 'red') {
    return (
      <div role="alert" className={cn('mb-4 flex flex-wrap items-center gap-3 rounded-[12px] px-4 py-3', BLOOD_SURFACE)}>
        <AlertTriangle size={16} className="shrink-0" />
        <p className="min-w-0 flex-1 text-[13px] font-semibold leading-[1.45]">
          Test mode is off. {banner.count} go-live action{banner.count === 1 ? ' is' : 's are'} waiting for a click — the
          old channels stay open until they run.
        </p>
        <button type="button" onClick={onRunAll} disabled={busy || ready < 1}
          title={ready < 1 ? 'No automatic At go-live action is ready — the open ones are marked done by hand.' : undefined}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-[12.5px] font-semibold text-[#8b0000] hover:bg-white/90 disabled:opacity-50">
          <Rocket size={13} /> Run all ready{ready > 0 ? ` (${ready})` : ''}
        </button>
      </div>
    )
  }
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-[12px] bg-tint-amber px-4 py-3 text-tint-fg-amber">
      <AlertTriangle size={16} className="shrink-0" />
      <p className="min-w-0 flex-1 text-[13px] font-semibold leading-[1.45]">
        Test mode is on again, and {banner.count} go-live change{banner.count === 1 ? ' is' : 's are'} still live in the
        outside books. Undo them if the go-live is rolled back.
      </p>
    </div>
  )
}

function PhaseSection({ view, phase, actions, busy, bannerRuns, onRunAll, card }: {
  view: RunbookView
  phase: (typeof PHASES)[number]
  actions: PAction[]
  busy: boolean
  bannerRuns: boolean
  onRunAll: (phase: Phase) => void
  card: (a: PAction) => React.ReactNode
}) {
  const sw = view.test_mode
  const read = historyRead(view)
  const done = read ? String(actions.filter((a) => effective(a, view.runs).done).length) : '—'
  const list = bannerRuns ? [] : runAllList(view, phase.id)
  const openBefore = phase.id === 'after' ? openAt(view).length : 0
  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-text-1">
            {phase.label} <span className="ml-1 font-stat text-[13px] text-text-3">{done}/{actions.length}</span>
          </h2>
          <p className="text-[12.5px] text-text-2">
            {phase.blurb}{!phaseActive(phase.id, sw) && phase.idle ? ` Waiting: ${phase.idle}.` : ''}
          </p>
          {openBefore > 0 && readablyOff(sw) && (
            <p className="mt-0.5 text-[12px] text-tint-fg-amber">At go-live still has {openBefore} open.</p>
          )}
        </div>
        {list.length > 0 && (
          <button type="button" onClick={() => onRunAll(phase.id)} disabled={busy}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold disabled:opacity-40',
              readablyOff(sw) ? OPEN_RED : 'border border-border bg-surface text-text-2 hover:bg-surface-2')}>
            {readablyOff(sw) ? <Rocket size={13} /> : <TestTube2 size={13} />} {runAllLabel(sw)} ({list.length})
          </button>
        )}
      </div>
      {actions.length ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{actions.map(card)}</div>
      ) : (
        <p className="rounded-[12px] border border-dashed border-border px-4 py-3 text-[12.5px] text-text-3">
          No action in this phase.
        </p>
      )}
    </section>
  )
}

function MasterOnly({ why }: { why: string }) {
  return (
    <div className="w-full pb-16">
      <PageHeader title="Production Actions" subtitle="The go-live runbook — every step, rehearsed first, run on a click" />
      <EmptyState title={MASTER_ONLY_TITLE} body={why} />
    </div>
  )
}

export function unreadRunbook(house: HouseState | undefined, error: string): { title: string; body: string } {
  if (house?.state === 'missing') {
    return { title: 'The runbook is not set up yet',
             body: 'Its Google Sheets have not been created in ASA Data yet. This page fills in once they are.' }
  }
  if (house?.state === 'pending') {
    return { title: "The runbook is not in the platform's copy yet",
             body: 'Its Google Sheets exist, and the platform copies them within a few minutes.' }
  }
  return { title: 'The runbook could not be read', body: house?.why || error || 'No answer yet.' }
}

function openBlank(): Window | null {
  try { return window.open('about:blank', '_blank') } catch { return null }
}

const BLOCKED = 'The browser blocked the new tab, so nothing ran and nothing was recorded. Allow pop-ups for this site, then run it again.'

export function RunbookScreen({ pa }: { pa: Runbook }) {
  const [busy, setBusy] = useState(false)
  const [previewing, setPreviewing] = useState<{ id: string; item: PreviewItem | null; loading: boolean; error: string } | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [editing, setEditing] = useState<PAction | 'new' | null>(null)
  const [showOff, setShowOff] = useState(false)
  const view = pa.view
  const now = Date.now()
  const figures = useMemo(() => heroFigures(view), [view])

  const sw: TestSwitch | undefined = view?.test_mode
  const byId = (id: string | null) => (id && view?.actions ? view.actions.find((a) => a.id === id) ?? null : null)
  const fail = (err: unknown) => toast({ type: 'danger', title: 'It did not go through',
                                         body: err instanceof Error ? err.message : String(err) })

  const confirmRun = async (a: PAction, item: PreviewItem) => {
    const real = readablyOff(sw)
    return askConfirm({
      title: `${runLabel(sw)} #${a.number} ${a.title}`,
      body: (item.words ?? []).join(' '),
      detail: real ? `Test mode is off: this writes to ${a.system}. ${(item.untouched ?? [])[0] ?? ''}` : rehearsalWords(sw),
      confirmLabel: real ? 'Write it for real' : 'Rehearse',
      tone: real ? 'danger' : 'primary',
    })
  }

  const said = (a: PAction, run: PRun, tab?: Window | null, open?: string) => {
    if (tab) {
      if (open) { tab.opener = null; tab.location.replace(open) } else tab.close()
    }
    const ok = run.result === 'ok' || run.result === 'noop'
    toast({ type: ok ? 'success' : 'danger', title: `#${a.number} ${ok ? (run.act === 'rehearse' ? 'rehearsed' : 'done') : run.result}`,
            body: run.detail })
  }

  const runOne = async (a: PAction, known?: PreviewItem | null) => {
    setBusy(true)
    let tab: Window | null = null
    try {
      const item = known ?? (await pa.preview([a.id])).items[a.id]
      const block = previewBlock(item)
      if (block) {
        setPreviewing({ id: a.id, item: item ?? null, loading: false, error: '' })
        toast({ type: 'warning', title: `#${a.number} cannot run yet`, body: block })
        return
      }
      if (!(await confirmRun(a, item))) return
      if (opensTab(a, sw)) {
        tab = openBlank()
        if (!tab) { toast({ type: 'warning', title: `#${a.number} did not run`, body: BLOCKED }); return }
      }
      const got = await pa.run(runPayload(a, item, sw, newClientId()))
      said(a, got.run, tab, got.open)
      tab = null
      if (previewing?.id === a.id) setPreviewing(null)
    } catch (err) {
      tab?.close()
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const openPreview = async (a: PAction) => {
    if (!previewFetches(a)) {
      setPreviewing({ id: a.id, item: null, loading: false, error: '' })
      return
    }
    setPreviewing({ id: a.id, item: null, loading: true, error: '' })
    try {
      const got = await pa.preview([a.id])
      setPreviewing((p) => (p?.id === a.id ? { id: a.id, item: got.items[a.id] ?? null, loading: false, error: '' } : p))
    } catch (err) {
      setPreviewing((p) => (p?.id === a.id ? { id: a.id, item: null, loading: false,
                                                error: err instanceof Error ? err.message : String(err) } : p))
    }
  }

  const runAll = async (phase?: Phase) => {
    const all = runAllList(view, phase)
    const own = all.filter((a) => opensTab(a, sw))
    const list = all.filter((a) => !opensTab(a, sw))
    if (!list.length) {
      toast({ type: 'info', title: 'Nothing here runs in a batch',
              body: own.length ? 'A link opens from its own Run now, one at a time.' : 'The open actions here are marked done by hand.' })
      return
    }
    setBusy(true)
    try {
      const got = await pa.preview(list.slice(0, 12).map((a) => a.id))
      const clean = list.slice(0, 12).filter((a) => got.items[a.id] && !previewBlock(got.items[a.id]))
      const blocked = list.filter((a) => !clean.includes(a))
      if (!clean.length) {
        toast({ type: 'warning', title: 'Nothing can run yet', body: blocked.map((a) =>
          `#${a.number}: ${previewBlock(got.items[a.id]) || 'more than twelve at once'}`).join(' · ') })
        return
      }
      const real = readablyOff(sw)
      const ok = await askConfirm({
        title: `${runAllLabel(sw)} — ${clean.length} action${clean.length === 1 ? '' : 's'}`,
        body: clean.map((a) => `#${a.number} ${a.title}: ${(got.items[a.id].words ?? []).join(' ')}`).join('\n'),
        detail: [real ? 'Test mode is off: each writes to its real system, one at a time, stopping at the first failure.'
          : rehearsalWords(sw, true),
        blocked.length ? `Left out: ${blocked.map((a) => `#${a.number} (${previewBlock(got.items[a.id]) || 'too many'})`).join(', ')}.` : '',
        own.length ? `A link opens from its own Run now: ${own.map((a) => `#${a.number}`).join(', ')}.` : '']
          .filter(Boolean).join(' '),
        confirmLabel: real ? 'Write them for real' : 'Rehearse all',
        tone: real ? 'danger' : 'primary',
      })
      if (!ok) return
      const done = await runSequence(clean, async (a) => (await pa.run(runPayload(a, got.items[a.id], sw, newClientId()))).run)
      const good = done.ran.filter((s) => !s.error).length
      toast({
        type: done.stopped ? 'danger' : 'success',
        title: done.stopped ? `Stopped at #${done.stopped.item.number}` : `${good} ${real ? 'ran' : 'rehearsed'}`,
        body: done.stopped ? `${good} went through before it; #${done.stopped.item.number}: ${done.stopped.error}`
          : done.ran.map((s) => `#${s.item.number} ${s.run?.result}`).join(' · '),
      })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const mark = async (a: PAction, done: boolean) => {
    if (markAsks(a, done) && !(await askConfirm({
      title: `Mark #${a.number} ${a.title} done without running it?`,
      body: `Nothing is written to ${a.system || 'its system'}, and Run all ready leaves it out from now on.`,
      detail: 'Reopen puts it back in the runbook.',
      confirmLabel: 'Mark done', tone: 'primary',
    }))) return
    setBusy(true)
    try {
      const got = await pa.mark(a.id, done)
      toast({ type: 'success', title: `#${a.number} ${done ? 'marked done' : 'reopened'}`, body: got.run.detail })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const undo = async (a: PAction, run: PRun) => {
    const ok = await askConfirm({
      title: `Undo #${a.number} ${a.title}`,
      body: undoWords(a.handler, run.target),
      detail: [readablyOff(sw) ? '' : `Test mode is on, and an undo still writes to ${a.system || 'the outside system'}: it only takes back the platform's own change.`,
        'It only goes ahead while the target still holds exactly what the run wrote.'].filter(Boolean).join(' '),
      confirmLabel: 'Undo it', tone: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      const got = await pa.undo(run.id)
      said(a, got.run)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const save = async (payload: Record<string, unknown>): Promise<Problem[]> => {
    try {
      const got = await pa.save(payload)
      toast({ type: 'success', title: 'Saved', body: got.run.detail })
      setEditing(null)
      return []
    } catch (err) {
      const env = (err as { envelope?: { problems?: Problem[] } }).envelope
      if (env?.problems?.length) return env.problems
      fail(err)
      return []
    }
  }

  const card = (a: PAction) => (
    <ActionCard key={a.id} action={a} status={cardStatus(a, view)} last={effective(a, view?.runs).last}
      sw={sw} busy={busy} now={now}
      onPreview={() => void openPreview(a)} onRun={() => void runOne(a)} onMark={(d) => void mark(a, d)}
      onHistory={() => setHistoryId(a.id)} onEdit={() => setEditing(a)} />
  )

  const header = (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
      <PageHeader
        title="Production Actions"
        subtitle="The go-live runbook — every step, rehearsed first, run on a click"
        actions={(
          <>
            <button type="button" onClick={() => void pa.refresh()} disabled={pa.state.refreshing}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40">
              <RefreshCw size={14} className={pa.state.refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
            <button type="button" onClick={() => setEditing('new')} disabled={!view?.actions}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-40">
              <Plus size={14} /> New action
            </button>
          </>
        )}
      />
    </motion.div>
  )

  if (pa.state.status === 'refused') return <MasterOnly why="Production Actions opens for the master's own session only." />

  if ((pa.state.status === 'loading' || pa.state.status === 'idle') && !view) {
    return (
      <div className="w-full pb-16">
        {header}
        <Skeleton className="mb-4 h-[236px] w-full rounded-[16px]" />
        {PHASES.map((p) => <Skeleton key={p.id} className="mb-4 h-[160px] w-full rounded-[14px]" />)}
      </div>
    )
  }

  const g = grouped(view?.actions)
  const banner = goLiveBanner(view)
  const unread = !view?.actions ? unreadRunbook(view?.house.actions, pa.state.error) : null
  const previewAction = byId(previewing?.id ?? null)
  const historyAction = byId(historyId)

  return (
    <div className="w-full pb-16">
      {header}
      <ProductionActionsHero state={pa.state} view={view} figures={figures} now={now} onRetry={() => void pa.refresh()} />
      {view?.actions && <StepBar view={view} />}
      <GoLiveStrip banner={banner} busy={busy} ready={runAllList(view, 'at').filter((a) => !opensTab(a, sw)).length}
        onRunAll={() => void runAll('at')} />

      {unread && (
        <EmptyState title={unread.title} body={unread.body}
          action={{ label: 'Try again', onClick: () => void pa.refresh() }} />
      )}

      {view?.actions && g.phases.map(({ phase, actions }) => (
        <PhaseSection key={phase.id} view={view} phase={phase} actions={actions} busy={busy}
          bannerRuns={phase.id === 'at' && banner?.tone === 'red'} onRunAll={(p) => void runAll(p)} card={card} />
      ))}
      {view?.actions && g.stray.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 font-display text-[15px] font-semibold text-text-1">No phase</h2>
          <p className="mb-3 text-[12.5px] text-tint-fg-amber">These rows name no phase the runbook knows — open Edit to place them.</p>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{g.stray.map(card)}</div>
        </section>
      )}
      {view?.actions && g.off.length > 0 && (
        <section className="mb-6">
          <button type="button" onClick={() => setShowOff((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-2 hover:text-text-1">
            <ChevronDown size={14} className={cn('transition-transform', showOff && 'rotate-180')} />
            Switched off ({g.off.length})
          </button>
          {showOff && <div className="mt-3 grid grid-cols-1 gap-3 opacity-70 xl:grid-cols-2">{g.off.map(card)}</div>}
        </section>
      )}

      <PreviewSheet action={previewAction} item={previewing?.item ?? null} loading={!!previewing?.loading}
        error={previewing?.error ?? ''} sw={sw} busy={busy} onClose={() => setPreviewing(null)}
        onRun={() => previewAction && void runOne(previewAction, previewing?.item)} />
      <HistorySheet action={historyAction} runs={view?.runs} now={now} busy={busy} onClose={() => setHistoryId(null)}
        onUndo={(r) => historyAction && void undo(historyAction, r)} />
      <EditActionSheet open={editing !== null} action={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)} onSave={save} />
    </div>
  )
}

export default function ProductionActionsPage() {
  const { gate, pa } = useRunbook()
  if (!gate.open) return <MasterOnly why={gate.why} />
  return <RunbookScreen pa={pa} />
}
