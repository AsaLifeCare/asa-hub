// Meal Tracker — one day at a time.
// The day leads, because the question this app answers is always "how am I doing today".
import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Droplet, Loader2, Pill, Plus, Trash2, UtensilsCrossed } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Skeleton from '@/components/shared/Skeleton'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { ohioToday } from '@/lib/ohio'

type Entry = {
  id: string; kind: string; day: string; at: string; description: string
  mealTime: string; amountOz: number; notes: string
  calories: number; protein: number; carbs: number; fat: number; fiber: number
}
type Totals = { calories: number; protein: number; carbs: number; fat: number; fiber: number; waterOz: number }
type Profile = {
  id: string; goalCalories: number; goalProtein: number; goalCarbs: number
  goalFat: number; goalFiber: number; goalWaterOz: number
}
type Day = { day: string; entries: Entry[]; totals: Totals; profile: Profile; times?: string[] }

// Today on OHIO's calendar — meals are logged where the houses are, and the platform-wide company-clock law applies…
const todayLocal = ohioToday
function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const n = new Date(y, m - 1, d + by)
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (day === todayLocal()) return 'Today'
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const field = 'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

// A goal bar.
function GoalBar({ label, value, goal, unit }: { label: string; value: number; goal: number; unit?: string }) {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0
  const over = goal > 0 && value > goal
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{label}</span>
        <span className="text-[12.5px] tabular-nums text-text-2">
          <strong className="text-text-1">{Math.round(value)}</strong>
          {goal > 0 && <span className="text-text-3"> / {Math.round(goal)}</span>}
          {unit && <span className="text-text-3"> {unit}</span>}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={cn('h-full rounded-full transition-all', over ? 'bg-tint-fg-amber' : 'bg-primary')}
          style={{ width: `${goal > 0 ? pct : 0}%` }} />
      </div>
    </div>
  )
}

export default function MealsPage() {
  const [day, setDay] = useState(todayLocal())
  const [data, setData] = useState<Day | null>(null)
  const [busy, setBusy] = useState('')
  const [kind, setKind] = useState<'meal' | 'water' | 'supplement'>('meal')
  const [draft, setDraft] = useState({ description: '', mealTime: 'Snack', amountOz: '',
                                       calories: '', protein: '', carbs: '', fat: '', fiber: '' })
  const [editingGoals, setEditingGoals] = useState(false)
  const [goals, setGoals] = useState<Record<string, string>>({})

  const load = useCallback(async (d: string) => {
    try {
      setData(await gasAction<Day>('mealDay', { day: d }))
    } catch (e) {
      toast({ type: 'danger', title: 'Could not read the day', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }, [])

  useEffect(() => { void load(day) }, [day, load])

  const add = async () => {
    setBusy('add')
    try {
      const out = await gasAction<Day>('mealLogAdd', { ...draft, kind, day })
      setData(out)
      setDraft({ description: '', mealTime: draft.mealTime, amountOz: '',
                 calories: '', protein: '', carbs: '', fat: '', fiber: '' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not logged', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const remove = async (e: Entry) => {
    setBusy(e.id)
    try { setData(await gasAction<Day>('mealLogRemove', { id: e.id, day })) } finally { setBusy('') }
  }

  const saveGoals = async () => {
    setBusy('goals')
    try {
      await gasAction('mealGoalsSet', goals)
      setEditingGoals(false)
      await load(day)
      toast({ type: 'success', title: 'Goals saved' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const t = data?.totals
  const p = data?.profile

  return (
    <div className="w-full px-5 py-6">
      <PageHeader title="Meal Tracker" subtitle="What you ate and drank, against your own goal." />

      <Card className="mb-4 flex items-center gap-1">
        <button onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day"
          className="grid h-8 w-8 place-items-center rounded-md text-text-2 transition-colors hover:bg-surface-2">
          <ChevronLeft size={16} />
        </button>
        <span className="min-w-[140px] text-center text-[14px] font-bold text-text-1">{dayLabel(day)}</span>
        <button onClick={() => setDay(shiftDay(day, 1))} disabled={day >= todayLocal()} aria-label="Next day"
          className="grid h-8 w-8 place-items-center rounded-md text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-30">
          <ChevronRight size={16} />
        </button>
        <button onClick={() => { setEditingGoals((g) => !g); setGoals({
            goalCalories: String(p?.goalCalories ?? ''), goalProtein: String(p?.goalProtein ?? ''),
            goalCarbs: String(p?.goalCarbs ?? ''), goalFat: String(p?.goalFat ?? ''),
            goalFiber: String(p?.goalFiber ?? ''), goalWaterOz: String(p?.goalWaterOz ?? '') }) }}
          className="ml-auto h-8 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
          {editingGoals ? 'Cancel' : 'Goals'}
        </button>
      </Card>

      {editingGoals && (
        <Card className="mb-4 space-y-3">
          <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Your daily goals</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[['goalCalories', 'Calories'], ['goalProtein', 'Protein (g)'], ['goalCarbs', 'Carbs (g)'],
              ['goalFat', 'Fat (g)'], ['goalFiber', 'Fiber (g)'], ['goalWaterOz', 'Water (oz)']].map(([k, label]) => (
              <label key={k} className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{label}</span>
                <input inputMode="decimal" value={goals[k] ?? ''} placeholder="—"
                  onChange={(e) => setGoals((g) => ({ ...g, [k]: e.target.value }))} className={field} />
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <button onClick={() => void saveGoals()} disabled={busy === 'goals'}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
              {busy === 'goals' && <Loader2 size={13} className="animate-spin" />} Save goals
            </button>
          </div>
        </Card>
      )}

      {!data || !t || !p ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <Card className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <GoalBar label="Calories" value={t.calories} goal={p.goalCalories} />
            <GoalBar label="Water" value={t.waterOz} goal={p.goalWaterOz} unit="oz" />
            <GoalBar label="Protein" value={t.protein} goal={p.goalProtein} unit="g" />
            <GoalBar label="Carbs" value={t.carbs} goal={p.goalCarbs} unit="g" />
            <GoalBar label="Fat" value={t.fat} goal={p.goalFat} unit="g" />
            <GoalBar label="Fiber" value={t.fiber} goal={p.goalFiber} unit="g" />
          </Card>

          <Card className="mb-4 space-y-3">
            <div className="flex gap-2">
              {([['meal', UtensilsCrossed, 'Food'], ['water', Droplet, 'Water'],
                 ['supplement', Pill, 'Supplement']] as const).map(([k, Icon, label]) => (
                <button key={k} onClick={() => setKind(k)}
                  className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-[13px] font-semibold transition-colors',
                    kind === k ? 'border-primary bg-tint-blue text-tint-fg-blue' : 'border-border bg-surface text-text-2 hover:bg-surface-2')}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>

            {kind === 'water' ? (
              <div className="flex gap-2">
                <input inputMode="decimal" value={draft.amountOz} placeholder="Ounces"
                  onChange={(e) => setDraft((d) => ({ ...d, amountOz: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') void add() }} className={field} />
                {[8, 16, 24].map((oz) => (
                  <button key={oz} onClick={() => setDraft((d) => ({ ...d, amountOz: String(oz) }))}
                    className="h-9 shrink-0 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2">
                    {oz}oz
                  </button>
                ))}
              </div>
            ) : (
              <>
                <input value={draft.description} placeholder={kind === 'meal' ? 'What did you have?' : 'Which supplement?'}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && kind === 'supplement') void add() }} className={field} />
                {kind === 'meal' && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                    <select value={draft.mealTime} onChange={(e) => setDraft((d) => ({ ...d, mealTime: e.target.value }))}
                      className={field}>
                      {(data.times ?? ['Breakfast', 'Lunch', 'Dinner', 'Snack']).map((x) => <option key={x}>{x}</option>)}
                    </select>
                    {(['calories', 'protein', 'carbs', 'fat', 'fiber'] as const).map((m) => (
                      <input key={m} inputMode="decimal" value={draft[m]} placeholder={m === 'calories' ? 'kcal' : `${m} g`}
                        onChange={(e) => setDraft((d) => ({ ...d, [m]: e.target.value }))} className={field} />
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end">
              <button onClick={() => void add()} disabled={busy === 'add'}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
                {busy === 'add' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />} Log it
              </button>
            </div>
          </Card>

          <Card padded={false}>
            {data.entries.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-text-3">Nothing logged for {dayLabel(day).toLowerCase()}.</p>
            ) : data.entries.map((e) => (
              <div key={e.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-text-2">
                  {e.kind === 'water' ? <Droplet size={13} /> : e.kind === 'supplement' ? <Pill size={13} /> : <UtensilsCrossed size={13} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-text-1">
                    {e.kind === 'water' ? `${e.amountOz} oz of water` : e.description}
                  </p>
                  {e.kind === 'meal' && (
                    <p className="text-[11.5px] text-text-3">
                      {e.mealTime}
                      {e.calories > 0 && ` · ${Math.round(e.calories)} kcal`}
                      {e.protein > 0 && ` · ${Math.round(e.protein)}g protein`}
                    </p>
                  )}
                </div>
                <button onClick={() => void remove(e)} disabled={busy === e.id} aria-label="Remove"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-40">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  )
}
