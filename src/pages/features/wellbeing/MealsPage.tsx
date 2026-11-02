// Ideal Meals — the cortex picks each client's ideal plate from their dietary profile; an AI renders the plate.
// Card grid of generated plate illustrations with dietary tags + ready/pending generation status.
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Card from '@/components/shared/Card'
import SafeImg, { tintForName } from '@/components/shared/SafeImg'
import { AppIcon } from '@/lib/icons'
import { mealIdeals } from '@/lib/seed-wellbeing'
import type { MealIdeal } from '@/lib/seed-wellbeing'
import { Chip, ClientNameRow, SearchInput, SkeletonCards, StatusChip, WellbeingHeader, useScopedRows } from './components'
import { useContextStore } from '@/stores/useContextStore'
import { useWellbeingRows } from './useWellbeingRows'
import { useWellbeingGenerate } from './useWellbeingGenerate'
import type { WellbeingImageStatus } from './useWellbeingGenerate'
import { useCloseClientDetailPanel } from './useCloseClientDetailPanel'

export type MealRow = MealIdeal & { status: WellbeingImageStatus }

/* ---------------- recipe modal ---------------- */

/** `onRecord`: drawn on the client's own record, where a name row would only repeat the page. */
export function RecipeModal({ meal, onClose, onRecord = false }: { meal: MealRow; onClose: () => void; onRecord?: boolean }) {
  const r = meal.recipe
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        aria-modal="true"
        aria-label={`${meal.dishName} recipe`}
        className="scroll-thin relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-surface shadow-3"
        onClick={(e) => e.stopPropagation()}
      >
        <SafeImg
          src={meal.image}
          icon="utensils"
          tint={tintForName(meal.dishName)}
          shape="square"
          size="aspect-[16/9] w-full rounded-none"
          alt={meal.dishName}
          loading={meal.status === 'generating'}
        />
        <button
          onClick={onClose}
          aria-label="Close recipe"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 shadow-1 transition-colors hover:bg-surface-2 hover:text-text-1"
        >
          <AppIcon name="x" size={15} />
        </button>

        <div className="p-5 sm:p-6">
          <p className="font-mono text-[12px] font-semibold uppercase tracking-wide text-tint-fg-info">
            {meal.dishName}
          </p>
          {!onRecord && (
            <h2 className="mt-0.5 font-display text-[20px] font-bold leading-6 text-text-1">
              <ClientNameRow name={meal.clientName} id={meal.clientId} />
            </h2>
          )}
          <p className="mt-1.5 text-[13px] leading-5 text-text-2">{meal.description}</p>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Chip tint="blue">{meal.mealType}</Chip>
            {meal.dietaryTags.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
            <section>
              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-text-3">
                Ingredients
              </h3>
              <ul className="mt-2.5 space-y-2">
                {r.ingredients.map((ing, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[13px] leading-5 text-text-1">
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border border-border-strong bg-surface-2">
                      <AppIcon name="check" size={11} className="text-tint-fg-mint" />
                    </span>
                    {ing}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-text-3">
                Steps
              </h3>
              <ol className="mt-2.5 space-y-2.5">
                {r.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[13px] leading-5 text-text-1">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-tint-blue font-stat text-[10px] font-bold text-tint-fg-blue">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-1.5 border-t border-border pt-4">
            <span className="mr-1 inline-flex items-center gap-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-tint-fg-warning">
              <AppIcon name="triangle-alert" size={12} /> Allergens
            </span>
            {r.allergens.length > 0 ? (
              r.allergens.map((a) => (
                <span
                  key={a}
                  className="inline-flex items-center rounded-full bg-tint-warning px-2 py-0.5 text-[11px] font-semibold leading-4 text-tint-fg-warning"
                >
                  {a}
                </span>
              ))
            ) : (
              <span className="text-[12px] text-text-3">None declared</span>
            )}
            <span className="ml-auto inline-flex items-center gap-3 font-stat text-[12px] font-semibold text-text-2">
              <span className="inline-flex items-center gap-1">
                <AppIcon name="clock" size={12} className="text-text-3" /> {r.prepMin} min
              </span>
              <span className="inline-flex items-center gap-1">
                <AppIcon name="users" size={12} className="text-text-3" /> {r.servings} serving
                {r.servings === 1 ? '' : 's'}
              </span>
            </span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ---------------- card ---------------- */

/** `onRecord`: inside the client record's card — a flat box, no name row, no lift. */
export function MealCard({ meal: m, onOpen, onRecord = false }: { meal: MealRow; onOpen: () => void; onRecord?: boolean }) {
  const body = (
    <>
      <SafeImg
        src={m.image}
        icon="utensils"
        tint={tintForName(m.dishName)}
        shape="square"
        size="aspect-[3/2] w-full rounded-none"
        alt={m.dishName}
        loading={m.status === 'generating'}
      />
      <div className="p-4">
        <p className="font-mono text-[12px] font-semibold uppercase tracking-wide text-tint-fg-info">
          {m.dishName}
        </p>
        {!onRecord && (
          <p className="mt-0.5">
            <ClientNameRow name={m.clientName} id={m.clientId} />
          </p>
        )}
        <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-text-2">{m.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Chip tint="blue">{m.mealType}</Chip>
          {m.dietaryTags.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
          <span className="ml-auto">
            <StatusChip status={m.status} />
          </span>
        </div>
      </div>
    </>
  )
  return (
    <button onClick={onOpen} className="text-left" aria-label={`Open ${m.dishName} recipe`}>
      {onRecord ? (
        <div className="h-full overflow-hidden rounded-md bg-surface-2 hover:ring-1 hover:ring-border-strong">{body}</div>
      ) : (
        <Card padded={false} hover className="h-full overflow-hidden">{body}</Card>
      )}
    </button>
  )
}

/* ---------------- page ---------------- */

export default function MealsPage() {
  useCloseClientDetailPanel()
  const [q, setQ] = useState('')
  const [openMeal, setOpenMeal] = useState<MealRow | null>(null)
  const { isGenerating, applyRows, generateMissing } = useWellbeingGenerate('mealIdeals')

  const { rows: source, loading } = useWellbeingRows('mealIdeals', mealIdeals)
  const rows = applyRows(source)
  const visible = useScopedRows(rows, q, ['clientName', 'dishName'])

  const ready = visible.filter((m) => m.status === 'ready').length
  const pending = visible.filter((m) => m.status === 'pending').length

  const focus = useContextStore((s) => s.focus)
  const focusHint =
    focus?.type === 'client' ? `Focus: ${focus.name} — showing their cards only (exit via the chip in the sidebar)` : undefined

  return (
    <div>
      <WellbeingHeader
        appName="MEALS"
        pageLabel="IDEAL PLATES"
        subcopy="The cortex picks each client's ideal meal from their dietary profile — texture, allergens and ISP nutrition goals. GENERATE MISSING renders one new plate illustration per click (cached for the day)."
        stats={`${ready} ready / ${pending} pending`}
        focusHint={focusHint}
        actionLabel="GENERATE MISSING"
        onAction={() => void generateMissing(visible)}
        actionDisabled={isGenerating}
      />
      <div className="mb-5 max-w-[380px]">
        <SearchInput value={q} onChange={setQ} placeholder="Search client or dish…" />
      </div>

      {loading ? (
        <SkeletonCards count={8} withImage />
      ) : (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {visible.map((m) => (
          <MealCard key={m.id} meal={m} onOpen={() => setOpenMeal(m)} />
        ))}
        {visible.length === 0 && (
          <Card className="col-span-full text-center text-[13px] text-text-2">
            No ideal meals match this search or focus.
          </Card>
        )}
      </div>
      )}

      <AnimatePresence>
        {openMeal && <RecipeModal meal={openMeal} onClose={() => setOpenMeal(null)} />}
      </AnimatePresence>
    </div>
  )
}
