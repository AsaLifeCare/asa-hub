// THE PERSONAL SUITE — twelve product specs: ready-made workouts, a BMI calculation, diets by age and condition…
// Each spec dresses one world app: hero copy, the quick-add form, live stats computed from the owner's own rows…
import { useEffect, useState } from 'react'
import { format, subDays } from 'date-fns'
import { Check, Loader2, Pencil, Plus, UserPlus } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from '@/stores/useToastStore'
import Card from '@/components/shared/Card'
import { ohioToday } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import type { ProductCtx, ProductSpec } from './PersonalProductPage'

const day = (offset: number) => format(subDays(new Date(), offset), 'yyyy-MM-dd')
const onDay = (rows: any[], d: string) => rows.filter((r) => String(r.day ?? '') === d)
const since = (rows: any[], days: number) => rows.filter((r) => String(r.day ?? '') >= day(days))
const num = (v: unknown) => Number(v) || 0

/* ---------------------------------------------------------------- MOVE — */

const MOVE_PLACES = ['Home', 'Gym', 'Pool', 'Outdoor']
const MOVE_LEVELS = ['Beginner', 'Intermediate', 'Senior', 'Low-impact']

// The move profile — one row in `moveProfile` (id 'me'): where the person moves and at what level, so the plans…
function MoveProfileCard({ ctx }: { ctx: ProductCtx }) {
  const profile = (ctx.moveProfile as Record<string, unknown> | null) ?? null
  const loaded = Boolean(ctx.moveProfileLoaded)
  const saveProfile = ctx.saveMoveProfile as (p: Record<string, string>) => Promise<void>
  const showAll = Boolean(ctx.moveShowAll)
  const setShowAll = ctx.setMoveShowAll as (v: boolean) => void
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  if (!loaded) return null

  const startEdit = () => {
    setDraft({
      place: String(profile?.place ?? ''),
      level: String(profile?.level ?? ''),
      goal: String(profile?.goal ?? ''),
      daysPerWeek: String(profile?.daysPerWeek ?? ''),
    })
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await saveProfile(draft)
      toast({ type: 'success', title: 'Profile saved — the plans now pick themselves.' })
      setEditing(false)
    } catch (err) {
      toast({ type: 'danger', title: 'Could not save the profile', body: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  const pickRow = (label: string, key: string, options: string[]) => (
    <div className="mt-3">
      <p className="mb-1 text-[12px] font-semibold text-text-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const on = draft[key] === opt
          return (
            <button
              key={opt}
              type="button"
              onClick={() => setDraft((d) => ({ ...d, [key]: opt }))}
              className={cn(
                'h-8 rounded-full border px-3 text-[12.5px] font-semibold transition-all',
                on ? 'border-transparent bg-tint-green text-tint-fg-green' : 'border-border bg-surface text-text-3 hover:border-border-strong hover:text-text-1',
              )}
            >
              {opt}
            </button>
          )
        })}
      </div>
    </div>
  )

  if (!profile || editing) {
    return (
      <Card className="mt-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Your move profile</p>
        <h3 className="mt-1 font-display text-[16px] font-bold text-text-1">Tell us where you move — plans pick themselves</h3>
        {pickRow('Where', 'place', MOVE_PLACES)}
        {pickRow('Level', 'level', MOVE_LEVELS)}
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="block min-w-40 flex-1">
            <span className="mb-1 block text-[12px] font-semibold text-text-2">Goal</span>
            <input
              value={draft.goal ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, goal: e.target.value }))}
              placeholder="Steady knees, lose 5 kg…"
              className="h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
            />
          </label>
          <label className="block w-32">
            <span className="mb-1 block text-[12px] font-semibold text-text-2">Days / week</span>
            <input
              type="number"
              min={1}
              max={7}
              value={draft.daysPerWeek ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, daysPerWeek: e.target.value }))}
              placeholder="3"
              className="h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save profile
          </button>
          {profile && (
            <button onClick={() => setEditing(false)} className="h-9 rounded-md px-3 text-[13px] font-semibold text-text-3 hover:text-text-1">
              Cancel
            </button>
          )}
        </div>
      </Card>
    )
  }

  const chips = [
    String(profile.place ?? ''),
    String(profile.level ?? ''),
    num(profile.daysPerWeek) > 0 ? `${num(profile.daysPerWeek)}× / week` : '',
    String(profile.goal ?? ''),
  ].filter(Boolean)
  return (
    <Card className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-tint-green px-2.5 py-1 text-[11.5px] font-semibold text-tint-fg-green">{c}</span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAll(!showAll)}
            className={cn(
              'h-8 rounded-full border px-3 text-[12px] font-semibold transition-all',
              showAll ? 'border-transparent bg-tint-green text-tint-fg-green' : 'border-border bg-surface text-text-3 hover:text-text-1',
            )}
          >
            {showAll ? 'Showing all plans' : 'Matched to you'}
          </button>
          <button
            onClick={startEdit} aria-label="Edit" title="Edit"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
          >
            <Pencil size={14} />
          </button>
        </div>
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------- WEIGHT — */

const MEMBER_RELATIONS = ['partner', 'kid', 'other']

type WeightMember = { id: string; name: string }

const memberNames = (ctx: ProductCtx) => {
  const members = (ctx.weightMembers as any[]) ?? []
  const names = members.map((m) => String(m.name ?? '')).filter(Boolean)
  const cur = String(((ctx.weightMember as WeightMember | undefined) ?? { id: 'me', name: 'Me' }).name)
  if (cur && !names.includes(cur)) names.unshift(cur)
  return names
}

// The household switcher — chips from `weightMembers` ('me' always there), plus the mini-form that adds a partner…
function WeightMembers({ ctx }: { ctx: ProductCtx }) {
  const members = (ctx.weightMembers as any[]) ?? []
  const member = (ctx.weightMember as WeightMember | undefined) ?? { id: 'me', name: 'Me' }
  const setMember = ctx.setWeightMember as (m: WeightMember) => void
  const reloadMembers = ctx.reloadMembers as () => Promise<any[]>
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', relation: 'partner', heightCm: '' })
  const [saving, setSaving] = useState(false)

  const list = members.some((m) => String(m.id) === 'me') ? members : [{ id: 'me', name: 'Me' }, ...members]

  const addMember = async () => {
    const name = draft.name.trim()
    if (!name) {
      toast({ type: 'warning', title: 'Name the member' })
      return
    }
    setSaving(true)
    try {
      await api.create('weightMembers' as never, { name, relation: draft.relation, heightCm: draft.heightCm } as never)
      const fresh = await reloadMembers()
      const row = fresh.find((r) => String(r.name) === name)
      setMember({ id: String(row?.id ?? name), name })
      setAdding(false)
      setDraft({ name: '', relation: 'partner', heightCm: '' })
      toast({ type: 'success', title: `${name} is in.` })
    } catch (err) {
      toast({ type: 'danger', title: 'Could not add the member', body: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {list.map((m) => {
          const on = member.id === String(m.id)
          return (
            <button
              key={String(m.id)}
              onClick={() => setMember({ id: String(m.id), name: String(m.name) })}
              className={cn(
                'h-8 rounded-full border px-3 text-[12.5px] font-semibold transition-all',
                on ? 'border-transparent bg-tint-mint text-tint-fg-mint' : 'border-border bg-surface text-text-3 hover:border-border-strong hover:text-text-1',
              )}
            >
              {String(m.name)}
            </button>
          )
        })}
        <button
          onClick={() => setAdding((a) => !a)}
          className="flex h-8 items-center gap-1.5 rounded-full border border-dashed border-border px-3 text-[12.5px] font-semibold text-text-3 transition-colors hover:text-text-1"
        >
          <UserPlus size={12} /> Add member
        </button>
      </div>
      {adding && (
        <Card padded={false} className="mt-2 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-36 flex-1">
              <span className="mb-1 block text-[12px] font-semibold text-text-2">Name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Ana"
                className="h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-text-2">Relation</span>
              <span className="flex gap-1.5">
                {MEMBER_RELATIONS.map((r) => {
                  const on = draft.relation === r
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, relation: r }))}
                      className={cn(
                        'h-9 rounded-full border px-3 text-[12.5px] font-semibold capitalize transition-all',
                        on ? 'border-transparent bg-tint-mint text-tint-fg-mint' : 'border-border bg-surface text-text-3 hover:text-text-1',
                      )}
                    >
                      {r}
                    </button>
                  )
                })}
              </span>
            </label>
            <label className="block w-28">
              <span className="mb-1 block text-[12px] font-semibold text-text-2">Height (cm)</span>
              <input
                type="number"
                value={draft.heightCm}
                onChange={(e) => setDraft((d) => ({ ...d, heightCm: e.target.value }))}
                placeholder="165"
                className="h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
              />
            </label>
            <button
              onClick={() => void addMember()}
              disabled={saving}
              className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Add
            </button>
          </div>
        </Card>
      )}
    </div>
  )
}

// The BMI card — Weight's signature.
function BmiCard({ ctx }: { ctx: ProductCtx }) {
  const rows = ctx.rows
  const reload = ctx.reload
  const member = (ctx.weightMember as WeightMember | undefined) ?? { id: 'me', name: 'Me' }
  const members = (ctx.weightMembers as any[]) ?? []
  const reloadMembers = ctx.reloadMembers as (() => Promise<any[]>) | undefined
  const memberRow = members.find((m) => String(m.id) === member.id)
  const [profileHeight, setProfileHeight] = useState<number | null>(null)
  const [editing, setEditing] = useState('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    void (async () => {
      if (member.id === 'me' && num(memberRow?.heightCm) <= 0) {
        try {
          const prof = await api.list<any>('weightProfile' as never)
          const h = num(prof?.[0]?.heightCm)
          if (h > 0) setProfileHeight(h)
        } catch { /* no profile yet */ }
      }
      setLoaded(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id])
  const heightCm = num(memberRow?.heightCm) > 0 ? num(memberRow?.heightCm) : member.id === 'me' ? profileHeight : null

  const saveHeight = async () => {
    const h = num(editing)
    if (h < 80 || h > 250) {
      toast({ type: 'warning', title: 'Height looks off', body: 'Centimeters, please — between 80 and 250.' })
      return
    }
    try {
      if (memberRow) {
        await api.update('weightMembers' as never, String(memberRow.id), { heightCm: String(h) } as never)
        await reloadMembers?.()
      } else if (member.id === 'me') {
        await api.create('weightProfile' as never, { id: 'me', heightCm: String(h) } as never)
        setProfileHeight(h)
      } else {
        await api.create('weightMembers' as never, { name: member.name, relation: 'other', heightCm: String(h) } as never)
        await reloadMembers?.()
      }
      setEditing('')
      reload()
    } catch (err) {
      toast({ type: 'danger', title: 'Could not save height', body: err instanceof Error ? err.message : String(err) })
    }
  }
  const latest = [...rows].reverse().find((r) => num(r.weightKg) > 0)
  const bmi = latest && heightCm ? num(latest.weightKg) / Math.pow(heightCm / 100, 2) : null
  const band = bmi == null ? null : bmi < 18.5 ? ['Underweight', 'blue'] : bmi < 25 ? ['Healthy range', 'mint'] : bmi < 30 ? ['Overweight', 'amber'] : ['Obese range', 'pink']
  return (
    <Card className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
            {member.id === 'me' ? 'Your BMI' : `${member.name} · BMI`}
          </p>
          {bmi != null ? (
            <>
              <p className="mt-1 font-stat text-[30px] font-bold leading-8 text-text-1">{bmi.toFixed(1)}</p>
              <p className="mt-1 text-[12.5px] font-semibold text-text-2">{band?.[0]} · {heightCm} cm</p>
            </>
          ) : (
            <p className="mt-1 max-w-[300px] text-[13px] leading-5 text-text-2">
              {loaded && !heightCm ? 'Set the height once and every weigh-in computes the BMI.' : 'Log a weigh-in to see the BMI.'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            placeholder={heightCm ? `${heightCm} cm` : 'Height in cm'}
            type="number"
            className="h-9 w-32 rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-1 outline-none focus:border-border-strong"
          />
          <button onClick={() => void saveHeight()} className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary hover:bg-primary-hover">
            {heightCm ? 'Update' : 'Set'}
          </button>
        </div>
      </div>
    </Card>
  )
}

/* --------------------------------------------------------------- MONEY — */

// Bills this month — the `moneyBills` tab (name, amount, dueDay, autopay, lastPaid).
function MoneyBills() {
  const [bills, setBills] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', amount: '', dueDay: '', autopay: 'No' })
  const [saving, setSaving] = useState(false)
  const load = async () => {
    try {
      const r = await api.list<any>('moneyBills' as never)
      setBills(Array.isArray(r) ? r : [])
    } catch { /* the tab arrives with the catalog; until then, an empty shelf */ }
    setLoaded(true)
  }
  useEffect(() => { void load() }, [])
  const month = ohioToday().slice(0, 7)
  const settled = (b: any) => String(b.lastPaid ?? '').startsWith(month)
  const sorted = [...bills].sort((a, b) => num(a.dueDay) - num(b.dueDay))

  const markPaid = async (b: any) => {
    const today = ohioToday()
    try {
      await api.update('moneyBills' as never, String(b.id), { lastPaid: today } as never)
      setBills((bs) => bs.map((x) => (String(x.id) === String(b.id) ? { ...x, lastPaid: today } : x)))
      toast({ type: 'success', title: `${String(b.name)} — paid.` })
    } catch (err) {
      toast({ type: 'danger', title: 'Could not mark it paid', body: err instanceof Error ? err.message : String(err) })
    }
  }

  const addBill = async () => {
    if (!draft.name.trim()) {
      toast({ type: 'warning', title: 'Name the bill' })
      return
    }
    setSaving(true)
    try {
      await api.create('moneyBills' as never, {
        name: draft.name.trim(), amount: draft.amount, dueDay: draft.dueDay, autopay: draft.autopay,
      } as never)
      setDraft({ name: '', amount: '', dueDay: '', autopay: 'No' })
      setAdding(false)
      void load()
    } catch (err) {
      toast({ type: 'danger', title: 'Could not add the bill', body: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return null
  return (
    <div className="mt-8">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="font-display text-[17px] font-bold text-text-1">Bills this month</h2>
          <p className="mt-0.5 text-[13px] text-text-2">The monthly drumbeat — due day, amount, paid or not.</p>
        </div>
        <button onClick={() => setAdding((a) => !a)} className="flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
          <Plus size={13} /> Add a bill
        </button>
      </div>
      {adding && (
        <Card padded={false} className="mb-3 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-36 flex-1">
              <span className="mb-1 block text-[12px] font-semibold text-text-2">Name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Rent"
                className="h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
              />
            </label>
            <label className="block w-28">
              <span className="mb-1 block text-[12px] font-semibold text-text-2">Amount</span>
              <input
                type="number"
                value={draft.amount}
                onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
                placeholder="1200"
                className="h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
              />
            </label>
            <label className="block w-24">
              <span className="mb-1 block text-[12px] font-semibold text-text-2">Due day</span>
              <input
                type="number"
                min={1}
                max={31}
                value={draft.dueDay}
                onChange={(e) => setDraft((d) => ({ ...d, dueDay: e.target.value }))}
                placeholder="5"
                className="h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-text-2">Autopay</span>
              <span className="flex gap-1.5">
                {['Yes', 'No'].map((o) => {
                  const on = draft.autopay === o
                  return (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, autopay: o }))}
                      className={cn(
                        'h-9 rounded-full border px-3 text-[12.5px] font-semibold transition-all',
                        on ? 'border-transparent bg-tint-green text-tint-fg-green' : 'border-border bg-surface text-text-3 hover:text-text-1',
                      )}
                    >
                      {o}
                    </button>
                  )
                })}
              </span>
            </label>
            <button
              onClick={() => void addBill()}
              disabled={saving}
              className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Add
            </button>
          </div>
        </Card>
      )}
      {sorted.length === 0 ? (
        <Card padded={false} className="p-4">
          <p className="text-[12.5px] text-text-3">No bills yet — add the first one above and the month starts making sense.</p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((b) => {
            const paid = settled(b)
            return (
              <Card key={String(b.id)} padded={false} className={cn('p-4', paid && 'opacity-70')}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[14px] font-semibold leading-5 text-text-1">{String(b.name)}</p>
                  {paid ? (
                    <span className="shrink-0 rounded-full bg-tint-mint px-2 py-0.5 text-[10.5px] font-semibold text-tint-fg-mint">Paid</span>
                  ) : String(b.autopay) === 'Yes' ? (
                    <span className="shrink-0 rounded-full bg-tint-blue px-2 py-0.5 text-[10.5px] font-semibold text-tint-fg-blue">Autopay</span>
                  ) : null}
                </div>
                <p className="mt-1 font-stat text-[20px] font-semibold leading-6 text-text-1">{num(b.amount).toFixed(2)}</p>
                <p className="mt-0.5 text-[12px] text-text-3">
                  {num(b.dueDay) > 0 ? `Due day ${num(b.dueDay)}` : 'No due day'}
                  {paid ? ` · paid ${String(b.lastPaid)}` : ''}
                </p>
                {!paid && (
                  <button
                    onClick={() => void markPaid(b)}
                    className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-surface-2 text-[12.5px] font-semibold text-text-1 transition-all hover:bg-surface-3 active:scale-[0.98]"
                  >
                    <Check size={13} /> Mark paid
                  </button>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------- SPECS — */

export const PERSONAL_PRODUCTS: Record<string, ProductSpec> = {
  move: {
    appId: 'move', resource: 'moveWorkouts',
    hero: 'Move a little, every day',
    heroSub: 'Your workouts, your streak, your ready-made plans — pick one below and it lands in your log.',
    cta: 'Log a workout',
    nudge: true,
    fields: [
      { key: 'day', label: 'Day', type: 'date', required: true, def: 'today' },
      { key: 'activity', label: 'Activity', type: 'select', required: true, options: ['Walk', 'Run', 'Gym', 'Bike', 'Swim', 'Yoga', 'Other'] },
      { key: 'minutes', label: 'Minutes', type: 'number', placeholder: '30' },
      { key: 'intensity', label: 'Intensity', type: 'select', options: ['Easy', 'Moderate', 'Hard'] },
      { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'How it went…' },
    ],
    stats: (rows) => [
      { label: 'This week', value: since(rows, 7).length, icon: 'calendar-check', tint: 'green' },
      { label: 'Minutes this week', value: since(rows, 7).reduce((s, r) => s + num(r.minutes), 0), icon: 'timer', tint: 'blue' },
      { label: 'Total sessions', value: rows.length, icon: 'dumbbell', tint: 'lavender' },
      { label: 'Logged today', value: onDay(rows, ohioToday()).length, icon: 'flame', tint: 'amber' },
    ],
    // The profile lives in the spec's extras so both the card and the shelf filter read the same row.
    useExtras: () => {
      const [profile, setProfile] = useState<Record<string, unknown> | null>(null)
      const [loaded, setLoaded] = useState(false)
      const [showAll, setShowAll] = useState(false)
      useEffect(() => {
        void (async () => {
          try {
            const rows = await api.list<any>('moveProfile' as never)
            const me = (Array.isArray(rows) ? rows : []).find((r) => String(r.id) === 'me')
            if (me) setProfile(me)
          } catch { /* no profile tab yet */ }
          setLoaded(true)
        })()
      }, [])
      // world create APPENDS — update when the row exists, create otherwise
      const saveMoveProfile = async (p: Record<string, string>) => {
        if (profile) await api.update('moveProfile' as never, 'me', p as never)
        else await api.create('moveProfile' as never, { id: 'me', ...p } as never)
        setProfile({ id: 'me', ...p })
      }
      return { moveProfile: profile, moveProfileLoaded: loaded, saveMoveProfile, moveShowAll: showAll, setMoveShowAll: setShowAll }
    },
    aboveShelves: (ctx) => <MoveProfileCard ctx={ctx} />,
    shapeLibrary: (resource, items, ctx) => {
      if (resource !== 'movePlans') return items
      const p = (ctx.moveProfile as Record<string, unknown> | null) ?? null
      if (!p || ctx.moveShowAll) return items
      const lvl = String(p.level ?? '')
      const place = String(p.place ?? '')
      if (!lvl && !place) return items
      return items.filter((it) => {
        const il = String(it.level ?? '')
        const ip = String(it.place ?? '')
        if (lvl && il === lvl) return true
        if (place && ip === place) return true
        // gentle plans belong on a beginner's shelf too
        if (lvl === 'Beginner' && (il === 'Senior' || il === 'Low-impact')) return true
        return false
      })
    },
    libraries: [{
      resource: 'movePlans',
      title: 'Ready-made workouts',
      sub: 'Plans written for real life — tap one and it is in your log, minutes and all.',
      mode: 'log',
      cta: 'Log this',
      write: (p) => ({ day: ohioToday(), activity: p.level ?? 'Other', minutes: p.minutes ?? '', intensity: 'Moderate', notes: `Plan: ${p.title}` }),
    }],
  },
  weight: {
    appId: 'weight', resource: 'weightLog',
    hero: 'The trend, not the day',
    heroSub: 'Weigh in, watch the line, let the BMI take care of itself — your height is asked once, never again.',
    cta: 'Log a weigh-in',
    fields: [
      { key: 'day', label: 'Day', type: 'date', required: true, def: 'today' },
      { key: 'member', label: 'Who', type: 'select', optionsFrom: memberNames },
      { key: 'weightKg', label: 'Weight (kg)', type: 'number', required: true, placeholder: '72.4' },
      { key: 'waistCm', label: 'Waist (cm)', type: 'number' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    stats: (rows) => {
      const w = rows.map((r) => num(r.weightKg)).filter((x) => x > 0)
      const latest = w.length ? w[w.length - 1] : null
      const first = w.length ? w[0] : null
      const delta = latest != null && first != null && w.length > 1 ? latest - first : null
      return [
        { label: 'Latest (kg)', value: latest ?? '—', icon: 'scale', tint: 'mint' },
        { label: 'Since the start (kg)', value: delta != null ? (delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)) : '—', icon: 'trending-down', tint: delta != null && delta < 0 ? 'mint' : 'amber' },
        { label: 'Weigh-ins', value: w.length, icon: 'list-checks', tint: 'blue' },
        { label: 'This week', value: since(rows, 7).length, icon: 'calendar-check', tint: 'lavender' },
      ]
    },
    // The household: chips from `weightMembers`, the selected member in the ctx so stats, recent, the quick-add and…
    useExtras: () => {
      const [members, setMembers] = useState<any[]>([])
      const [member, setMember] = useState<WeightMember>({ id: 'me', name: 'Me' })
      const loadMembers = async (): Promise<any[]> => {
        try {
          const rows = await api.list<any>('weightMembers' as never)
          const list = (Array.isArray(rows) ? rows : []).filter((r) => String(r.name ?? '').trim())
          setMembers(list)
          const me = list.find((r) => String(r.id) === 'me')
          if (me) setMember((m) => (m.id === 'me' ? { id: 'me', name: String(me.name) } : m))
          return list
        } catch { /* no members tab yet — everyone is Me */ }
        return []
      }
      useEffect(() => { void loadMembers() }, [])
      return { weightMembers: members, weightMember: member, setWeightMember: setMember, reloadMembers: loadMembers }
    },
    // weigh-ins written before members existed belong to 'me'
    filterRows: (rows, ctx) => {
      const m = (ctx.weightMember as WeightMember | undefined) ?? { id: 'me', name: 'Me' }
      if (m.id === 'me') return rows.filter((r) => !String(r.member ?? '').trim() || String(r.member) === m.name)
      return rows.filter((r) => String(r.member ?? '') === m.name)
    },
    quickAddDefaults: (ctx) => ({ member: String(((ctx.weightMember as WeightMember | undefined) ?? { name: 'Me' }).name) }),
    belowHero: (ctx) => <WeightMembers ctx={ctx} />,
    custom: (ctx) => <BmiCard ctx={ctx} />,
  },
  plate: {
    appId: 'plate', resource: 'plateMeals',
    hero: 'What you eat, written down',
    heroSub: 'Meals, water and guides shaped for your age and your conditions — awareness first, willpower second.',
    cta: 'Log a meal',
    nudge: true,
    fields: [
      { key: 'day', label: 'Day', type: 'date', required: true, def: 'today' },
      { key: 'meal', label: 'Meal', type: 'select', required: true, options: ['Breakfast', 'Lunch', 'Dinner', 'Snack'] },
      { key: 'description', label: 'What you ate', type: 'textarea', required: true, placeholder: 'Eggs, toast, coffee…' },
      { key: 'calories', label: 'Calories', type: 'number' },
    ],
    stats: (rows) => [
      { label: 'Meals today', value: onDay(rows, ohioToday()).length, icon: 'utensils', tint: 'peach' },
      { label: 'This week', value: since(rows, 7).length, icon: 'calendar-check', tint: 'blue' },
      { label: 'Calories today', value: onDay(rows, ohioToday()).reduce((s, r) => s + num(r.calories), 0) || '—', icon: 'flame', tint: 'amber' },
      { label: 'Total entries', value: rows.length, icon: 'notebook-pen', tint: 'lavender' },
    ],
    // a birth year of 65+ puts the seniors guide first; no year, no reorder
    shapeLibrary: (resource, items, ctx) => {
      if (resource !== 'plateGuides') return items
      const y = Number(ctx.hubProfile?.birthYear ?? ctx.hubProfile?.birth_year) || 0
      if (!y || new Date().getFullYear() - y < 65) return items
      const senior = (it: (typeof items)[number]) => /senior|65\+/i.test(`${it.title} ${it.level ?? ''}`)
      return [...items].sort((a, b) => Number(senior(b)) - Number(senior(a)))
    },
    libraries: [{
      resource: 'plateGuides',
      title: 'Guides for your table',
      sub: 'General good-plate guidance by age and condition — your doctor always has the last word.',
      mode: 'read',
    }],
  },
  meds: {
    appId: 'meds', resource: 'medsList',
    hero: 'Never miss a dose',
    heroSub: 'Your medications, their schedules and leaflets — one tap marks today as taken.',
    cta: 'Add a medication',
    fields: [
      { key: 'name', label: 'Medication', type: 'text', required: true },
      { key: 'dose', label: 'Dose', type: 'text', placeholder: '50 mg' },
      { key: 'when', label: 'When', type: 'text', placeholder: 'Morning, Night' },
      { key: 'stock', label: 'Stock', type: 'number' },
      { key: 'leaflet', label: 'Leaflet (URL)', type: 'text', placeholder: 'https://…' },
    ],
    stats: (rows) => [
      { label: 'Medications', value: rows.length, icon: 'pill', tint: 'blue' },
      { label: 'Taken today', value: onDay(rows.map((r) => ({ ...r, day: r.lastTaken })), ohioToday()).length, icon: 'check-circle-2', tint: 'mint' },
      { label: 'Low stock (≤5)', value: rows.filter((r) => num(r.stock) > 0 && num(r.stock) <= 5).length, icon: 'triangle-alert', tint: 'amber' },
      { label: 'With leaflet', value: rows.filter((r) => String(r.leaflet ?? '').trim()).length, icon: 'file-text', tint: 'lavender' },
    ],
  },
  doctors: {
    appId: 'doctors', resource: 'doctorVisits',
    hero: 'Your health team, organized',
    heroSub: 'Appointments, your doctors, and prepped visit notes — walk in knowing what to ask.',
    cta: 'Book an appointment',
    fields: [
      { key: 'day', label: 'Day', type: 'date', required: true },
      { key: 'time', label: 'Time', type: 'text', placeholder: '14:00' },
      { key: 'doctor', label: 'Doctor', type: 'text', required: true },
      { key: 'specialty', label: 'Specialty', type: 'select', options: ['Family medicine', 'Cardiology', 'Dermatology', 'Endocrinology', 'Gastroenterology', 'Gynecology / OB', 'Neurology', 'Ophthalmology', 'Orthopedics', 'Pediatrics', 'Psychiatry', 'Dental', 'Vision', 'Other'] },
      { key: 'place', label: 'Place', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    stats: (rows) => [
      { label: 'Upcoming', value: rows.filter((r) => String(r.day ?? '') >= ohioToday()).length, icon: 'calendar-clock', tint: 'pink' },
      { label: 'Past visits', value: rows.filter((r) => String(r.day ?? '') < ohioToday()).length, icon: 'history', tint: 'blue' },
      { label: 'This month', value: since(rows, 30).length, icon: 'calendar-check', tint: 'mint' },
      { label: 'Total', value: rows.length, icon: 'stethoscope', tint: 'lavender' },
    ],
    libraries: [{
      resource: 'doctorSpecialties',
      title: 'Who does what',
      sub: 'The specialty catalog — what each doctor treats and when to look for one.',
      mode: 'prefill',
      cta: 'Book this',
      prefill: (s) => ({ specialty: s.title }),
    }, {
      resource: 'doctorPrep',
      title: 'Walk in prepared',
      sub: 'The pre-visit notes for each kind of appointment — what to bring, what to ask.',
      mode: 'read',
    }],
  },
  vitals: {
    appId: 'vitals', resource: 'vitalReadings',
    hero: 'The numbers between visits',
    heroSub: 'Pressure, glucose, heart rate — logged in seconds, read against the reference ranges below.',
    cta: 'Log a reading',
    fields: [
      { key: 'day', label: 'Day', type: 'date', required: true, def: 'today' },
      { key: 'kind', label: 'Kind', type: 'select', required: true, options: ['Blood pressure', 'Glucose', 'Heart rate', 'Temperature', 'Oxygen'] },
      { key: 'value', label: 'Reading', type: 'text', required: true, placeholder: '120/80' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    stats: (rows) => {
      const latest = rows.length ? rows[rows.length - 1] : null
      return [
        { label: 'Readings', value: rows.length, icon: 'heart-pulse', tint: 'lavender' },
        { label: 'This week', value: since(rows, 7).length, icon: 'calendar-check', tint: 'blue' },
        { label: 'Latest', value: latest ? `${latest.value}` : '—', icon: 'activity', tint: 'mint' },
        { label: 'Kinds tracked', value: new Set(rows.map((r) => String(r.kind))).size, icon: 'layers', tint: 'amber' },
      ]
    },
    libraries: [{
      resource: 'vitalRanges',
      title: 'What is normal',
      sub: 'The reference ranges, always at hand — log against them, never from memory.',
      mode: 'read',
    }],
  },
  prices: {
    appId: 'prices', resource: 'priceWatch',
    hero: 'Buy at the low, never at the hype',
    heroSub: 'Watch the products, note the price, strike when it drops.',
    cta: 'Watch a product',
    fields: [
      { key: 'product', label: 'Product', type: 'text', required: true },
      { key: 'store', label: 'Store', type: 'text' },
      { key: 'price', label: 'Price', type: 'number' },
      { key: 'url', label: 'Link', type: 'text', placeholder: 'https://…' },
      { key: 'checked', label: 'Last checked', type: 'date', def: 'today' },
    ],
    stats: (rows) => [
      { label: 'Watching', value: rows.filter((r) => r.status === 'Watching').length, icon: 'eye', tint: 'amber' },
      { label: 'Bought', value: rows.filter((r) => r.status === 'Bought').length, icon: 'shopping-bag', tint: 'mint' },
      { label: 'Cheapest watched', value: Math.min(...rows.map((r) => num(r.price)).filter((x) => x > 0), Infinity) === Infinity ? '—' : Math.min(...rows.map((r) => num(r.price)).filter((x) => x > 0)), icon: 'tag', tint: 'blue' },
      { label: 'Tracked', value: rows.length, icon: 'list', tint: 'lavender' },
    ],
  },
  money: {
    appId: 'money', resource: 'moneyMoves',
    hero: 'Your money, told in plain lines',
    heroSub: 'A honest ledger of your own money — the balance is just the sum of telling the truth.',
    cta: 'Log an entry',
    fields: [
      { key: 'day', label: 'Day', type: 'date', required: true, def: 'today' },
      { key: 'description', label: 'Description', type: 'text', required: true, placeholder: 'Groceries' },
      { key: 'category', label: 'Category', type: 'select', options: ['Housing', 'Food', 'Transport', 'Health', 'Fun', 'Other'] },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'direction', label: 'Direction', type: 'select', required: true, options: ['In', 'Out'] },
    ],
    stats: (rows) => {
      const month = since(rows, 30)
      const inSum = month.filter((r) => r.direction === 'In').reduce((s, r) => s + num(r.amount), 0)
      const outSum = month.filter((r) => r.direction === 'Out').reduce((s, r) => s + num(r.amount), 0)
      return [
        { label: 'In (30 days)', value: inSum.toFixed(2), icon: 'arrow-down-left', tint: 'mint' },
        { label: 'Out (30 days)', value: outSum.toFixed(2), icon: 'arrow-up-right', tint: 'pink' },
        { label: 'Balance (30 days)', value: (inSum - outSum).toFixed(2), icon: 'wallet', tint: inSum >= outSum ? 'green' : 'amber' },
        { label: 'Entries', value: rows.length, icon: 'list', tint: 'blue' },
      ]
    },
    aboveShelves: () => <MoneyBills />,
  },
  habits: {
    appId: 'habits', resource: 'habitsLog',
    hero: 'Small things, every day',
    heroSub: 'The chain is the trick: log the habit, keep the streak, watch it grow.',
    cta: 'Log a habit',
    fields: [
      { key: 'day', label: 'Day', type: 'date', required: true, def: 'today' },
      { key: 'habit', label: 'Habit', type: 'text', required: true, placeholder: 'Read 20 minutes' },
      { key: 'done', label: 'Status', type: 'select', options: ['Planned', 'Done', 'Skipped'] },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    stats: (rows) => {
      const doneDays = new Set(rows.filter((r) => r.done === 'Done').map((r) => String(r.day)))
      let streak = 0
      for (let i = 0; doneDays.has(day(i)); i++) streak++
      return [
        { label: 'Done today', value: onDay(rows, ohioToday()).filter((r) => r.done === 'Done').length, icon: 'check-circle-2', tint: 'mint' },
        { label: 'Day streak', value: streak, icon: 'flame', tint: 'amber' },
        { label: 'This week', value: since(rows, 7).filter((r) => r.done === 'Done').length, icon: 'calendar-check', tint: 'blue' },
        { label: 'Habits tracked', value: new Set(rows.map((r) => String(r.habit))).size, icon: 'repeat', tint: 'lavender' },
      ]
    },
  },
  home: {
    appId: 'home', resource: 'homePantry',
    hero: 'The house, handled',
    heroSub: 'The pantry before it runs out, the fixes before they break.',
    cta: 'Add an item',
    fields: [
      { key: 'item', label: 'Item', type: 'text', required: true },
      { key: 'qty', label: 'Qty', type: 'number' },
      { key: 'expires', label: 'Expires', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    stats: (rows) => [
      { label: 'Pantry items', value: rows.length, icon: 'package', tint: 'blue' },
      { label: 'Expiring in 30 days', value: rows.filter((r) => { const e = String(r.expires ?? ''); return e && e <= day(-30) && e >= ohioToday() }).length, icon: 'alarm-clock', tint: 'amber' },
      { label: 'Expired', value: rows.filter((r) => { const e = String(r.expires ?? ''); return e && e < ohioToday() }).length, icon: 'triangle-alert', tint: 'pink' },
      { label: 'In stock', value: rows.filter((r) => num(r.qty) > 0).length, icon: 'check', tint: 'mint' },
    ],
  },
  pets: {
    appId: 'pets', resource: 'petsList',
    hero: 'The little ones, looked after',
    heroSub: 'Profiles, vaccines and the care guides — everything about them, one tap away.',
    cta: 'Add a pet',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'species', label: 'Species', type: 'select', options: ['Dog', 'Cat', 'Bird', 'Other'] },
      { key: 'breed', label: 'Breed', type: 'text' },
      { key: 'vetPhone', label: 'Vet phone', type: 'text', placeholder: '+1…' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    // junk rows (blank names from the old "Note it" button) never count
    stats: (rows) => {
      const pets = rows.filter((r) => String(r.name ?? '').trim())
      return [
        { label: 'Pets', value: pets.length, icon: 'paw-print', tint: 'peach' },
        { label: 'Species', value: new Set(pets.map((r) => String(r.species)).filter(Boolean)).size, icon: 'layers', tint: 'blue' },
        { label: 'With vet phone', value: pets.filter((r) => String(r.vetPhone ?? '').trim()).length, icon: 'phone', tint: 'mint' },
        { label: 'Profiles', value: pets.length, icon: 'heart', tint: 'pink' },
      ]
    },
    libraries: [{
      resource: 'petGuides',
      title: 'The pet corner',
      sub: 'Vaccine schedules, toxic foods, care basics — the stuff every pet parent should have nearby.',
      mode: 'read',
    }],
  },
  vault: {
    appId: 'vault', resource: 'vaultDocs',
    hero: 'Your papers, one tap away',
    heroSub: 'IDs, insurance, health, money — linked, dated and findable in seconds.',
    cta: 'Add a document',
    fields: [
      { key: 'title', label: 'Document', type: 'text', required: true, placeholder: 'Passport' },
      { key: 'kind', label: 'Kind', type: 'select', options: ['ID', 'Insurance', 'Health', 'Money', 'Home', 'Other'] },
      { key: 'url', label: 'Link', type: 'text', placeholder: 'https://drive.google.com/…' },
      { key: 'updated', label: 'Updated', type: 'date', def: 'today' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    stats: (rows) => [
      { label: 'Documents', value: rows.length, icon: 'folder-lock', tint: 'amber' },
      { label: 'Linked', value: rows.filter((r) => String(r.url ?? '').trim()).length, icon: 'link', tint: 'blue' },
      { label: 'Kinds', value: new Set(rows.map((r) => String(r.kind))).size, icon: 'layers', tint: 'lavender' },
      { label: 'Updated this month', value: since(rows.map((r) => ({ ...r, day: r.updated })), 30).length, icon: 'refresh-cw', tint: 'mint' },
    ],
  },
}
