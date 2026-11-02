// WIDGETS — the bank.
// A Widgets app, where a bank of widgets can be built for use across the platform.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import IndicatorCard from '@/pages/features/myasa/IndicatorCard'
import NewIndicatorModal from '@/pages/features/myasa/NewIndicatorModal'
import { loadLayout, saveLayout, type IndicatorSpec } from '@/pages/features/myasa/layout'
import { WIDGET_EXAMPLES, type WidgetExample } from './examplesBank'
import { api } from '@/lib/api'
import { useAuthStore } from '@/auth/useAuthStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useCan } from '@/auth/permissions'
import { toast } from '@/stores/useToastStore'
import { askConfirm } from '@/stores/useDialogStore'
import { myAsaOffered } from '@/lib/myAsaOffered'
import { invalidate } from '@/lib/apiCache'
import type { TintName } from '@/engine/types'

type WidgetRow = {
  id: string
  label?: string
  resource?: string
  field?: string
  value?: string
  icon?: string
  tint?: string
  href?: string
  chart?: string
  createdBy?: string
}

const specOf = (w: WidgetRow): IndicatorSpec => ({
  id: `bank-${w.id}`,
  kind: 'indicator',
  label: String(w.label ?? 'Untitled'),
  resource: String(w.resource ?? ''),
  field: w.field || undefined,
  value: w.value || undefined,
  icon: w.icon || 'activity',
  tint: (w.tint || 'blue') as TintName,
  href: w.href || undefined,
  chart: (w.chart || 'number') as IndicatorSpec['chart'],
})

export default function WidgetsPage() {
  const me = useAuthStore((s) => s.user)
  const userId = String(me?.id ?? '')
  const canCurate = useCan('apps.manage')
  const apps = useRegistryStore((s) => s.apps)
  const [rows, setRows] = useState<WidgetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  /** the row being RE-EDITED — same form, prefilled */
  const [editing, setEditing] = useState<WidgetRow | null>(null)
  /** an example opened as a starting draft — create path, prefilled */
  const [draft, setDraft] = useState<Partial<IndicatorSpec> | null>(null)
  const [onPage, setOnPage] = useState<Set<string>>(() => new Set(
    loadLayout(userId).cards.filter((c) => c.kind === 'indicator').map((c) => c.id),
  ))

  // Only examples whose resource this workspace actually serves — the registry is the same source the creator's…
  const served = useMemo(() => {
    const s = new Set<string>()
    for (const app of apps) for (const p of app.pages) {
      const r = p.dataSource?.resource as string | undefined
      if (r) s.add(r)
    }
    // The estate lanes and personal tables the platform serves WITHOUT a registry dataSource of their own (bespoke…
    ;['drVisits', 'dailyNotes', 'callOffs', 'uiIncidents', 'workOrders',
      'supportQueue', 'travelTrips', 'teamTasks', 'staffCerts', 'clients',
      'people', 'candidates', 'reminders',
      // the sky — the relay's /weather door, not a sheet
      'weather'].forEach((r) => s.add(r))
    return s
  }, [apps])
  const examples = useMemo(() => WIDGET_EXAMPLES.filter((e) => served.has(e.resource)), [served])
  const exampleGroups = useMemo(() => {
    const g = new Map<string, WidgetExample[]>()
    examples.forEach((e) => g.set(e.group, [...(g.get(e.group) ?? []), e]))
    return [...g.entries()]
  }, [examples])

  const exampleSpec = (e: WidgetExample): IndicatorSpec => ({
    id: `ex-${e.resource}-${e.field ?? ''}-${e.value ?? ''}-${e.chart ?? 'n'}`.replace(/[^a-z0-9-]+/gi, '-'),
    kind: 'indicator', label: e.label, resource: e.resource,
    field: e.field, value: e.value, icon: e.icon, tint: e.tint, chart: e.chart,
  })

  const load = useCallback(async () => {
    try {
      const list = await api.list<WidgetRow>('widgets')
      setRows(Array.isArray(list) ? list : [])
    } catch {
      /* the empty state answers */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const addToBank = async (spec: IndicatorSpec) => {
    try {
      // THE CREATE'S ANSWER IS THE ROW.
      const created = await api.create<WidgetRow>('widgets', {
        label: spec.label, resource: spec.resource, field: spec.field ?? '',
        value: spec.value ?? '', icon: spec.icon ?? 'activity', tint: spec.tint ?? 'blue',
        href: spec.href ?? '', chart: spec.chart ?? 'number', createdBy: me?.name ?? '',
      })
      invalidate('widgets')
      setRows((prev) => [created, ...prev])
      toast({ type: 'success', title: 'Widget in the bank', body: 'Anyone can now put it on their page.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  // RE-EDIT — a widget stays editable after it is created: the same form, writing back onto the SAME row, so pages…
  const saveEdit = async (spec: IndicatorSpec) => {
    if (!editing) return
    try {
      // MERGE, never replace: an update may answer with only {id, ...patch}.
      const saved = await api.update<WidgetRow>('widgets', String(editing.id), {
        label: spec.label, resource: spec.resource, field: spec.field ?? '',
        value: spec.value ?? '', icon: spec.icon ?? 'activity', tint: spec.tint ?? 'blue',
        href: spec.href ?? '', chart: spec.chart ?? 'number',
      })
      invalidate('widgets')
      const savedId = String(editing.id)
      setRows((prev) => prev.map((r) => (String(r.id) === savedId ? { ...r, ...saved } : r)))
      setEditing(null)
      toast({ type: 'success', title: 'Widget saved', body: 'The bank offers the new spec; pages that took the old one keep their copy.' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  /** the whole gallery into the bank, one press, dedup by label+resource+style */
  const [bulking, setBulking] = useState(false)
  const bulkBankExamples = async () => {
    if (bulking) return
    setBulking(true)
    try {
      const have = new Set(rows.map((r) =>
        `${String(r.label ?? '').toLowerCase()}|${r.resource}|${r.chart ?? 'number'}`))
      const missing = examples.filter((e) =>
        !have.has(`${e.label.toLowerCase()}|${e.resource}|${e.chart ?? 'number'}`))
      let added = 0
      const banked: WidgetRow[] = []
      for (const e of missing) {
        const spec = exampleSpec(e)
        // sequential on purpose: forty parallel creates against one Apps Script account is how writes start timing…
        banked.push(await api.create<WidgetRow>('widgets', {
          label: spec.label, resource: spec.resource, field: spec.field ?? '',
          value: spec.value ?? '', icon: spec.icon ?? 'activity', tint: spec.tint ?? 'blue',
          href: spec.href ?? '', chart: spec.chart ?? 'number', createdBy: me?.name ?? '',
        }))
        added++
      }
      invalidate('widgets')
      // every create answered with its row; a re-read here would spend one more execution to learn what we were…
      setRows((prev) => [...banked, ...prev])
      toast({
        type: added ? 'success' : 'info',
        title: added ? `${added} example${added === 1 ? '' : 's'} banked` : 'Nothing new to bank',
        body: added
          ? `${examples.length - added} were already there. Everyone can take them now.`
          : 'Every example is already in the bank.',
      })
    } catch (e) {
      toast({ type: 'danger', title: 'The bulk stopped partway', body: e instanceof Error ? e.message : 'What landed stays; press again for the rest.' })
      invalidate('widgets')
      // THIS re-read stays, and it is the only one that should: a loop that stopped partway is the one case where…
      await load()
    } finally {
      setBulking(false)
    }
  }

  const removeFromBank = async (w: WidgetRow) => {
    const ok = await askConfirm({
      title: 'Remove this widget from the bank?',
      body: `"${w.label ?? 'Untitled'}" stops being offered. Pages that already carry it keep their copy.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.remove('widgets', String(w.id))
      invalidate('widgets')
      setRows((prev) => prev.filter((r) => String(r.id) !== String(w.id)))
    } catch (e) {
      toast({ type: 'danger', title: 'Not removed', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  /** Copy the spec onto MY page — per person, per browser, like every layout. */
  const addToMyPage = (w: WidgetRow) => {
    const spec = specOf(w)
    const layout = loadLayout(userId)
    if (layout.cards.some((c) => c.id === spec.id)) {
      toast({ type: 'info', title: 'Already on your page' })
      return
    }
    saveLayout(userId, { ...layout, cards: [...layout.cards, spec] })
    setOnPage((s) => new Set([...s, spec.id]))
    toast(myAsaOffered()
      ? {
          type: 'success',
          title: `"${spec.label}" is on your page`,
          body: 'Open My asa. to move it where you want it.',
          action: { label: 'Open My asa.', href: '/app/myasa/home' },
        }
      : { type: 'success', title: `"${spec.label}" is on your page` })
  }

  return (
    <div>
      <PageHeader
        title="Widgets"
        subtitle="A bank of live numbers — take one for your page; curators add more."
        actions={canCurate ? (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
          >
            <Plus size={15} /> New widget
          </button>
        ) : undefined}
      />

      {loading ? (
        <p className="mt-6 flex items-center gap-2 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Opening the bank…
        </p>
      ) : rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="The bank is empty"
            body={canCurate
              ? 'Press "New widget" — pick a resource, an optional narrowing and a label, and it becomes a live number anyone can take.'
              : 'Admins and managers fill this. What lands here can go straight onto your My asa. page.'}
          />
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((w) => {
            const spec = specOf(w)
            const taken = onPage.has(spec.id)
            return (
              <div key={w.id} className="flex flex-col gap-2">
                {/* the REAL renderer — the bank shows what the page will show */}
                <IndicatorCard spec={spec} />
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => addToMyPage(w)}
                    disabled={taken}
                    className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-60"
                  >
                    {taken ? <><Check size={13} /> On your page</> : <><Plus size={13} /> Add to my page</>}
                  </button>
                  {canCurate && (
                    <>
                      <button
                        onClick={() => setEditing(w)}
                        aria-label="Edit this widget"
                        title="Edit this widget"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-surface text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => void removeFromBank(w)}
                        aria-label="Remove from the bank"
                        title="Remove from the bank"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-surface text-text-3 transition-colors hover:bg-surface-2 hover:text-danger"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
                {w.createdBy && (
                  <p className="px-0.5 text-[10.5px] text-text-3">Added by {w.createdBy}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ---- THE EXAMPLES GALLERY — a broad bank of examples to use first
              and build from later: real specs, drawn
              by the real renderer, filtered to the resources this workspace
              serves. Take one, bank one, or start the creator from one. ---- */}
      {examples.length > 0 && (
        <div className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-bold text-text-1">Examples</h2>
              <p className="mt-0.5 text-[12.5px] text-text-3">
                Live numbers ready to take — or press the pencil to start your own from one.
              </p>
            </div>
          </div>
          {exampleGroups.map(([group, items]) => (
            <section key={group} className="mt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{group}</p>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((e) => {
                  const spec = exampleSpec(e)
                  const taken = onPage.has(spec.id)
                  return (
                    <div key={spec.id} className="flex flex-col gap-2">
                      <IndicatorCard spec={spec} />
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            const layout = loadLayout(userId)
                            if (layout.cards.some((c) => c.id === spec.id)) {
                              toast({ type: 'info', title: 'Already on your page' })
                              return
                            }
                            saveLayout(userId, { ...layout, cards: [...layout.cards, spec] })
                            setOnPage((s) => new Set([...s, spec.id]))
                            toast({ type: 'success', title: `"${spec.label}" is on your page` })
                          }}
                          disabled={taken}
                          className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-60"
                        >
                          {taken ? <><Check size={13} /> On your page</> : <><Plus size={13} /> Add to my page</>}
                        </button>
                        <button
                          onClick={() => setDraft(spec)}
                          aria-label="Start your own from this example"
                          title="Start your own from this example"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-surface text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                        >
                          <Pencil size={13} />
                        </button>
                        {canCurate && (
                          <button
                            onClick={() => void addToBank(spec)}
                            aria-label="Add to the bank"
                            title="Add to the bank — everyone sees it above"
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-surface text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                          >
                            <Plus size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
          {/* THE BULK INSERT — moved BELOW every example: you read the shelf,
              then you take the whole shelf. */}
          {canCurate && (
            <div className="mt-5 flex justify-center">
              <button
                onClick={() => void bulkBankExamples()}
                disabled={bulking}
                className="flex h-10 items-center gap-1.5 rounded-md bg-primary px-5 text-[13px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
              >
                {bulking ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {bulking ? 'Banking…' : `Add all ${examples.length} to the bank`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* create (blank) */}
      <NewIndicatorModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onAdd={(spec) => { void addToBank(spec) }}
      />
      {/* create, seeded from an example */}
      <NewIndicatorModal
        open={draft !== null}
        onOpenChange={(o) => { if (!o) setDraft(null) }}
        initial={draft ?? undefined}
        title="Start from the example"
        submitLabel={canCurate ? 'Add to the bank' : 'Add to my page'}
        onAdd={(spec) => {
          if (canCurate) { void addToBank(spec) } else {
            const layout = loadLayout(userId)
            saveLayout(userId, { ...layout, cards: [...layout.cards, spec] })
            setOnPage((s) => new Set([...s, spec.id]))
            toast({ type: 'success', title: `"${spec.label}" is on your page` })
          }
          setDraft(null)
        }}
      />
      {/* re-edit an existing bank row */}
      <NewIndicatorModal
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null) }}
        initial={editing ? specOf(editing) : undefined}
        title="Edit the widget"
        submitLabel="Save changes"
        onAdd={(spec) => { void saveEdit(spec) }}
      />
    </div>
  )
}
