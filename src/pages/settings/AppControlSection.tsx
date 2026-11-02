// Settings → App control (the master only — MASTER_ONLY_SECTIONS, anchor #appcontrol).
// v10.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowRight, FolderPlus, RotateCcw, SlidersHorizontal, Sparkles, WandSparkles } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import ManageCategoriesModal from '@/components/pages/ManageCategoriesModal'
import ProgressBar from '@/components/shared/ProgressBar'
import SearchInput from '@/components/shared/SearchInput'
import { Switch } from '@/components/ui/switch'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useCategoryStore } from '@/stores/useCategoryStore'
import { categoryDefById, effectiveCategoryId, mergedCategoryDefs, type CategoryDef } from '@/lib/categories'
import { HIGH_CONFIDENCE, suggestCategory, type CategorySuggestion } from '@/lib/categorySuggest'
import { AppIcon } from '@/lib/icons'
import { TINT_PAIR } from '@/lib/tints'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { AppManifest } from '@/engine/types'

type Row = {
  app: AppManifest
  currentId: string
  currentDef?: CategoryDef
  overridden: boolean
  suggestion: CategorySuggestion
  mismatch: boolean
}

function confidenceTone(c: number): string {
  if (c >= HIGH_CONFIDENCE) return 'text-tint-fg-mint'
  if (c >= 0.5) return 'text-tint-fg-amber'
  return 'text-text-3'
}

export default function AppControlSection() {
  const navigate = useNavigate()
  const apps = useRegistryStore((s) => s.apps)
  const customCategories = useCategoryStore((s) => s.customCategories)
  const appCategory = useCategoryStore((s) => s.appCategory)
  const assignApp = useCategoryStore((s) => s.assignApp)
  const defs = useMemo(() => mergedCategoryDefs(customCategories), [customCategories])

  const [q, setQ] = useState('')
  const [onlyMismatch, setOnlyMismatch] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  const rows = useMemo<Row[]>(
    () =>
      apps.map((app) => {
        const currentId = effectiveCategoryId(app, appCategory, defs)
        const suggestion = suggestCategory(app, defs, currentId)
        return {
          app,
          currentId,
          currentDef: categoryDefById(defs, currentId),
          overridden: !!appCategory[app.id],
          suggestion,
          mismatch: suggestion.hasSignal && suggestion.categoryId !== currentId,
        }
      }),
    [apps, appCategory, defs],
  )

  const mismatches = rows.filter((r) => r.mismatch)
  const applicable = mismatches.filter((r) => r.suggestion.confidence >= HIGH_CONFIDENCE)

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase()
    return rows
      .filter((r) => (onlyMismatch ? r.mismatch : true))
      .filter((r) =>
        query ? `${r.app.name} ${r.app.id} ${r.currentDef?.label ?? r.currentId}`.toLowerCase().includes(query) : true,
      )
  }, [rows, onlyMismatch, q])

  const apply = (row: Row) => {
    // landing on the manifest category = clearing the override
    assignApp(row.app.id, row.suggestion.categoryId === row.app.category ? null : row.suggestion.categoryId)
    toast({
      type: 'success',
      title: `“${row.app.name}” moved to ${row.suggestion.label}`,
      body: `Confidence ${Math.round(row.suggestion.confidence * 100)}% — sidebar and App Hub updated.`,
    })
  }

  const applyAll = () => {
    for (const r of applicable) {
      assignApp(r.app.id, r.suggestion.categoryId === r.app.category ? null : r.suggestion.categoryId)
    }
    toast({
      type: 'success',
      title: `Applied ${applicable.length} high-confidence ${applicable.length === 1 ? 'suggestion' : 'suggestions'}`,
      body: `Everything at ≥ ${Math.round(HIGH_CONFIDENCE * 100)}% confidence was reassigned.`,
    })
  }

  return (
    <motion.section
      id="appcontrol"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader
          title="App control"
          sub="Every registered app, its current category and a smart suggestion for where it belongs — with confidence."
          extra={
            <span className="flex items-center gap-1.5">
              <button
                onClick={() => setManageOpen(true)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                <FolderPlus size={13} /> Manage categories
              </button>
              <button
                onClick={() => navigate('/app/app-control/board')}
                className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98]"
              >
                <SlidersHorizontal size={13} /> Open App Control →
              </button>
            </span>
          }
        />

        {/* summary band */}
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md bg-surface-2 px-3 py-2.5 text-[12px] text-text-2">
          <span>
            <b className="font-semibold text-text-1">{rows.length}</b> apps
          </span>
          <span>
            <b className="font-semibold text-text-1">{rows.filter((r) => r.overridden).length}</b> manual overrides
          </span>
          <span>
            <b className="font-semibold text-text-1">{mismatches.length}</b> suggested moves
          </span>
          <span className="flex items-center gap-1 text-text-3">
            <Sparkles size={12} className="text-primary-strong" />
            {applicable.length} at ≥ {Math.round(HIGH_CONFIDENCE * 100)}% confidence
          </span>
          <button
            onClick={applyAll}
            disabled={applicable.length === 0}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
          >
            <WandSparkles size={13} /> Apply high-confidence
          </button>
        </div>

        {/* filters */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <SearchInput value={q} onChange={setQ} placeholder="Search apps…" className="w-[220px]" />
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12px] font-medium text-text-2">
            <Switch checked={onlyMismatch} onCheckedChange={setOnlyMismatch} aria-label="Only suggested moves" />
            Only suggested moves
          </label>
        </div>

        {/* rows */}
        <div className="divide-y divide-border rounded-md border border-border">
          {visible.length === 0 && (
            <p className="px-3 py-6 text-center text-[13px] text-text-3">
              {onlyMismatch ? 'No suggested moves — every app already sits where the engine would put it.' : 'No apps match.'}
            </p>
          )}
          {visible.map((row) => {
            const suggestedDef = categoryDefById(defs, row.suggestion.categoryId)
            return (
              <div key={row.app.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <AppIcon name={row.app.icon} size={15} className="shrink-0 text-text-3" />
                <span className="min-w-0 w-[180px]">
                  <span className="clamp-1 block text-[13px] font-medium text-text-1">{row.app.name}</span>
                  <span className="font-mono text-[10px] text-text-3">{row.app.id}</span>
                </span>

                {/* current */}
                <span className="flex w-[150px] shrink-0 items-center gap-1.5">
                  {row.currentDef && row.currentDef.icon && (
                    <span className={cn('grid h-5 w-5 place-items-center rounded-[6px]', TINT_PAIR(row.currentDef.tint))}>
                      <AppIcon name={row.currentDef.icon} size={11} />
                    </span>
                  )}
                  <span className="text-[12px] text-text-2">{row.currentDef?.label ?? row.currentId}</span>
                  <span className="text-[10px] uppercase tracking-wide text-text-3">
                    {row.overridden ? 'override' : 'default'}
                  </span>
                </span>

                <ArrowRight size={13} className="shrink-0 text-text-3" />

                {/* suggestion */}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    {suggestedDef && suggestedDef.icon && (
                      <span
                        className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-[6px]', TINT_PAIR(suggestedDef.tint))}
                      >
                        <AppIcon name={suggestedDef.icon} size={11} />
                      </span>
                    )}
                    <span className="text-[12px] font-medium text-text-1">{row.suggestion.label}</span>
                    <span className={cn('text-[11px] font-semibold tabular-nums', confidenceTone(row.suggestion.confidence))}>
                      {Math.round(row.suggestion.confidence * 100)}%
                    </span>
                  </span>
                  <ProgressBar
                    value={row.suggestion.confidence}
                    tint={suggestedDef?.tint ?? 'mint'}
                    height={4}
                    className="mt-1 max-w-[220px]"
                    animate={false}
                  />
                  <span className="mt-1 block truncate text-[11px] text-text-3" title={row.suggestion.reasons.join(' · ')}>
                    {row.suggestion.reasons.join(' · ')}
                  </span>
                </span>

                {/* actions */}
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => apply(row)}
                    disabled={!row.mismatch}
                    className={cn(
                      'flex h-8 items-center gap-1 rounded-md px-3 text-[12px] font-semibold transition-colors',
                      row.mismatch
                        ? 'bg-primary-soft text-primary-strong hover:bg-primary hover:text-on-primary'
                        : 'cursor-default bg-surface-2 text-text-3',
                    )}
                  >
                    <Sparkles size={12} /> {row.mismatch ? 'Apply' : 'Aligned'}
                  </button>
                  {row.overridden && (
                    <button
                      onClick={() => assignApp(row.app.id, null)}
                      aria-label={`Reset ${row.app.name} to default category`}
                      title="Reset to manifest default"
                      className="grid h-8 w-8 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        <p className="mt-3 text-[11px] leading-4 text-text-3">
          Suggestions come from a local keyword heuristic over each app’s name, tagline and pages — deterministic,
          nothing leaves the browser. Applying writes the same assignment overrides as Manage categories.
        </p>
      </Card>

      <ManageCategoriesModal open={manageOpen} onOpenChange={setManageOpen} />
    </motion.section>
  )
}
