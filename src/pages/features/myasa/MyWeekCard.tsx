// MY WEEK — fully editable inside My asa., so reminders and events can be added here.
// Two halves, two truths: - THE SHIFTS are the roster's — the same `shiftCards` slice the Shift Board serves…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, CalendarDays, Check, Loader2, Plus, Star, X } from 'lucide-react'
import Card from '@/components/shared/Card'
import { api } from '@/lib/api'
import { toast } from '@/stores/useToastStore'
import { ohioWall } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import { useShiftData } from '@/pages/features/shifts/useShiftData'
import { sameName } from '@/lib/nameMatch'
import { TINT_PAIR } from '@/lib/tints'
import type { ShiftKind } from '@/lib/seed-shifts2'

/** the SAME chip tints the page always wore for the week strip */
const KIND_TINT: Record<ShiftKind, string> = {
  day: TINT_PAIR('blue'),
  morning: TINT_PAIR('mint'),
  afternoon: TINT_PAIR('amber'),
  evening: TINT_PAIR('lavender'),
  overnight: TINT_PAIR('slate'),
  ro: 'bg-surface-2 text-text-3',
  off: 'bg-surface-2 text-text-3',
  alias: TINT_PAIR('peach'),
}

type WeekItem = {
  id: string
  date?: string
  time?: string
  title?: string
  kind?: string      // 'reminder' | 'event'
  done?: boolean | string
}

function CardHeader({ title, sub, extra }: { title: string; sub?: string; extra?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[14.5px] font-bold text-text-1">{title}</h2>
        {sub && <p className="mt-0.5 text-[12px] leading-4 text-text-3">{sub}</p>}
      </div>
      {extra}
    </div>
  )
}

function ohioTodayStr(): string {
  const wall = ohioWall(new Date())
  const d = wall ?? new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// "Mon, Aug 17" from a stored day — rendered at noon to dodge the midnight off-by-one, the platform's standing cure.
function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function MyWeekCard({ userName }: { userName: string }) {
  const { cards } = useShiftData()
  const myShift = useMemo(
    // the roster and the account rarely spell a name the same way
    () => cards.find((c) => sameName(String(c.personName ?? ''), userName)),
    [cards, userName],
  )

  const [items, setItems] = useState<WeekItem[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(ohioTodayStr)
  const [time, setTime] = useState('')
  const [kind, setKind] = useState<'reminder' | 'event'>('reminder')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const load = useCallback(() => {
    api.list<WeekItem>('weekItems')
      .then((rows) => setItems(Array.isArray(rows) ? rows : []))
      .catch(() => setItems([]))
  }, [])
  useEffect(() => { load() }, [load])

  const upcoming = useMemo(() => {
    const today = ohioTodayStr()
    return (items ?? [])
      .filter((i) => String(i.date ?? '') >= today)
      .sort((a, b) =>
        String(a.date ?? '').localeCompare(String(b.date ?? '')) ||
        String(a.time ?? '').localeCompare(String(b.time ?? '')))
      .slice(0, 12)
  }, [items])

  const add = async () => {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      await api.create('weekItems', { title: t, date, time, kind, done: false })
      setTitle(''); setTime('')
      setAdding(false)
      load()
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const saveTitle = async (item: WeekItem) => {
    const t = editText.trim()
    setEditingId(null)
    if (!t || t === item.title) return
    try {
      await api.update('weekItems', String(item.id), { title: t })
      load()
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  const toggleDone = async (item: WeekItem) => {
    const next = !(item.done === true || item.done === 'true')
    setItems((prev) => (prev ?? []).map((i) => (i.id === item.id ? { ...i, done: next } : i)))
    try { await api.update('weekItems', String(item.id), { done: next }) } catch { load() }
  }

  const remove = async (item: WeekItem) => {
    setItems((prev) => (prev ?? []).filter((i) => i.id !== item.id))
    try { await api.remove('weekItems', String(item.id)) } catch { load() }
  }

  return (
    <Card>
      <CardHeader
        title="My week"
        sub={myShift
          ? `${myShift.totalShifts} shifts total · next: ${myShift.next.date} · ${myShift.next.code}`
          : 'No roster published for you this week'}
        extra={
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setAdding((v) => !v)}
              title="Add a reminder or an event"
              className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
            >
              <Plus size={15} />
            </button>
            <CalendarDays size={16} className="text-text-3" />
          </div>
        }
      />

      {/* the roster's half — read-only, the board's own rows */}
      <div className="grid grid-cols-7 gap-1.5">
        {(myShift?.week ?? []).map((chip) => (
          <div key={chip.day} className="text-center">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-3">{chip.day}</p>
            <span
              className={cn('block rounded-[8px] px-1 py-1.5 text-[11px] font-semibold leading-4', KIND_TINT[chip.kind])}
              title={chip.code}
            >
              {chip.kind === 'off' ? 'Off' : chip.code}
            </span>
          </div>
        ))}
        {!myShift &&
          ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'].map((d) => (
            <div key={d} className="text-center">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-3">{d}</p>
              <span className="block rounded-[8px] bg-surface-2 px-1 py-1.5 text-[11px] font-semibold leading-4 text-text-3">
                —
              </span>
            </div>
          ))}
      </div>

      {/* your half — reminders and events, fully editable */}
      {adding && (
        <div className="mt-3 space-y-2 rounded-md border border-primary/40 bg-primary-soft/30 p-2.5">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add() }}
            placeholder={kind === 'reminder' ? 'e.g. Hand in the mileage sheet' : 'e.g. Team huddle at Maple'}
            className="h-8 w-full rounded-md border border-border bg-surface px-2.5 text-[12.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex overflow-hidden rounded-md border border-border">
              {(['reminder', 'event'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={cn(
                    'flex h-7 items-center gap-1 px-2 text-[11px] font-semibold transition-colors',
                    kind === k ? 'bg-primary-soft text-primary-strong' : 'bg-surface text-text-3 hover:text-text-1',
                  )}
                >
                  {k === 'reminder' ? <Bell size={11} /> : <Star size={11} />}
                  {k === 'reminder' ? 'Reminder' : 'Event'}
                </button>
              ))}
            </div>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="h-7 rounded-md border border-border bg-surface px-1.5 text-[11.5px] text-text-1 outline-none" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
              className="h-7 rounded-md border border-border bg-surface px-1.5 text-[11.5px] text-text-1 outline-none" />
            <button
              onClick={() => void add()}
              disabled={busy || !title.trim()}
              className="ml-auto flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11.5px] font-semibold text-on-primary disabled:opacity-50"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add
            </button>
          </div>
        </div>
      )}

      {items === null ? (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-text-3">
          <Loader2 size={12} className="animate-spin" /> Reading your week…
        </p>
      ) : upcoming.length === 0 ? (
        !adding && (
          <p className="mt-3 text-[12px] leading-5 text-text-3">
            Nothing planned — press + to add a reminder or an event to your week.
          </p>
        )
      ) : (
        <div className="mt-3 space-y-1">
          {upcoming.map((i) => {
            const done = i.done === true || i.done === 'true'
            return (
              <div key={i.id} className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2">
                <button
                  onClick={() => void toggleDone(i)}
                  title={done ? 'Not done after all' : 'Done'}
                  className={cn(
                    'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors',
                    done ? 'border-tint-fg-mint bg-tint-mint text-tint-fg-mint' : 'border-border text-transparent hover:text-text-3',
                  )}
                >
                  <Check size={11} />
                </button>
                <span className={cn(
                  'shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold',
                  String(i.kind) === 'event' ? 'bg-tint-blue text-tint-fg-blue' : 'bg-tint-amber text-tint-fg-amber',
                )}>
                  {String(i.kind) === 'event' ? 'Event' : 'Reminder'}
                </span>
                {editingId === String(i.id) ? (
                  <input
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={() => void saveTitle(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveTitle(i)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="h-6 min-w-0 flex-1 rounded border border-primary bg-surface px-1.5 text-[12.5px] text-text-1 outline-none"
                  />
                ) : (
                  <button
                    onClick={() => { setEditingId(String(i.id)); setEditText(String(i.title ?? '')) }}
                    title="Edit"
                    className={cn(
                      'clamp-1 min-w-0 flex-1 text-left text-[12.5px] text-text-1',
                      done && 'text-text-3 line-through',
                    )}
                  >
                    {i.title || 'Untitled'}
                  </button>
                )}
                <span className="shrink-0 text-[11px] tabular-nums text-text-3">
                  {dayLabel(String(i.date ?? ''))}{i.time ? ` · ${i.time}` : ''}
                </span>
                <button
                  onClick={() => void remove(i)}
                  title="Delete"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-3 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
