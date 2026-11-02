// `schedule` template (design/schedule.md — home-care staff schedule).
// Week grid: one column per teammate (avatar + name + role header), pastel event blocks by type with overlap…
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addDays, addMonths, addWeeks, endOfMonth, format, startOfMonth, startOfWeek } from 'date-fns'
import { AnimatePresence, motion } from 'framer-motion'
import { RotateCcw } from 'lucide-react'
import type { TemplateProps } from '@/engine/PageRenderer'
import { ZONE, ohioOffsetLabel, ohioWall } from '@/lib/ohio'
import Avatar from '@/components/shared/Avatar'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { toast } from '@/stores/useToastStore'
import { api } from '@/lib/api'
import { peopleByIds, personById } from '@/lib/people-lookup'
import { writePersonDrag } from '@/lib/focus'
import { useDragFocusEnabled } from '@/lib/dragFocus'
import { useCan } from '@/auth/permissions'
import { EASE_OUT_EXPO, staggerContainer, staggerItem } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { CalEvent } from '@/engine/types'
import type { BlockedTime, DragState, Draft, EventTypeMap, Laid, Resource } from './types'
import { HOUR_PX, clampNum, endLabel, fromMin, toMin } from './utils'
import { useScheduleView } from './use-schedule-view'
import { useScheduleDrag } from './use-schedule-drag'
import { buildEventDetail } from './event-detail'
import { EventBlock } from './EventBlock'
import { WeekTimeGrid } from './WeekTimeGrid'
import { MonthGrid } from './MonthGrid'
import { QuickCreate } from './QuickCreate'
import { DayEventsPopover } from './DayEventsPopover'
import { MessageStaffModal } from './MessageStaffModal'
import { ToolbarActions } from './ToolbarActions'
import { ScheduleAside } from './ScheduleAside'

export default function ScheduleTemplate({ config, data, schema }: TemplateProps) {
  const [events, setEvents] = useState<CalEvent[]>(data as CalEvent[])

  // The slices turn over quietly and PageRenderer re-serves the data prop.
  useEffect(() => {
    const incoming = data as CalEvent[]
    setEvents((prev) => {
      const ids = new Set(incoming.map((e) => e.id))
      return [...incoming, ...prev.filter((e) => !ids.has(e.id))]
    })
  }, [data])

  const configured = (config.resources ?? []) as Resource[]
  // Shifts wave: `resourcesFrom: 'data'` derives the teammate columns from the event rows themselves — the real DSP…
  const fromData = config.resourcesFrom === 'data'
  const allResources = useMemo<Resource[]>(() => {
    if (!fromData) return configured
    const seen = new Map<string, Resource>()
    for (const e of events as (CalEvent & { personName?: string })[]) {
      if (!e.personId || seen.has(e.personId)) continue
      const known = personById(e.personId)
      seen.set(e.personId, {
        id: e.personId,
        name: e.personName ?? known?.name ?? e.personId,
        avatar: known?.avatar ?? '',
        role: known?.role ?? 'Direct Support Pro',
      })
    }
    const out = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
    return out.length ? out : configured
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromData, events])

  // Which derived teammates are on screen — a 90-person week grid is a wall, so the person picker keeps a handful…
  const PICK_KEY = 'asa-schedule-people'
  const [picked, setPicked] = useState<string[] | null>(() => {
    try {
      const raw = localStorage.getItem(PICK_KEY)
      return raw ? (JSON.parse(raw) as string[]) : null
    } catch {
      return null
    }
  })
  const [pickQ, setPickQ] = useState('')
  const resources = useMemo<Resource[]>(() => {
    if (!fromData) return allResources
    if (!picked || picked.length === 0) return allResources.slice(0, 5)
    const set = new Set(picked)
    const chosen = allResources.filter((r) => set.has(r.id))
    return chosen.length ? chosen : allResources.slice(0, 5)
  }, [fromData, allResources, picked])
  // The day chips keep the whole Resource, not just a label.
  const dayChips = useMemo(
    () => [
      { id: 'all', label: 'All' } as { id: string; label: string; person?: Resource },
      ...resources.map((r) => ({ id: r.id, label: r.name.split(' ')[0], person: r })),
    ],
    [resources],
  )
  const togglePicked = (id: string) =>
    setPicked((prev) => {
      const cur = new Set(prev ?? resources.map((r) => r.id))
      if (cur.has(id)) cur.delete(id)
      else cur.add(id)
      const arr = [...cur]
      try {
        localStorage.setItem(PICK_KEY, JSON.stringify(arr))
      } catch { /* private mode — the choice just doesn't persist */ }
      return arr
    })

  // "Drag & drop name": admin toggle per app (Settings).
  const dragNames = useDragFocusEnabled(String(config.appId ?? ''))
  const [startH, endH] = (config.timeRange ?? [8, 19]) as [number, number]
  const slot = (config.slotMinutes as number) ?? 30
  const eventTypes = (config.eventTypes ?? {}) as EventTypeMap
  const blockedTimes = (config.blockedTimes ?? []) as BlockedTime[]
  const typeIds = Object.keys(eventTypes)
  const allowViews = ((config.allowViews as string[] | undefined) ?? ['week', 'month']).filter(Boolean)

  /* RBAC: only schedule.edit holders (admins) mutate the schedule */
  const canEdit = useCan('schedule.edit')
  const pushNotification = useNotificationStore((s) => s.push)

  const [weekOffset, setWeekOffset] = useState(0)
  const [view, setView] = useScheduleView(allowViews, config.view)
  const [weekdayIdx, setWeekdayIdx] = useState(() => ((ohioWall(new Date()) as Date).getDay() + 6) % 7)
  const [dayResource, setDayResource] = useState<string>('all')
  const [monthCursor, setMonthCursor] = useState<Date>(() => startOfMonth(ohioWall(new Date()) as Date))
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())
  const [drag, setDrag] = useState<DragState | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [anchor, setAnchor] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [lastType, setLastType] = useState<string>(typeIds[0] ?? 'shift')
  const [tip, setTip] = useState<{ x: number; y: number; title: string; sub: string; names: string } | null>(null)
  const [dayList, setDayList] = useState<{ day: Date; x: number; y: number } | null>(null)
  const [msgOpen, setMsgOpen] = useState(false)

  const openDetail = useDetailPanelStore((s) => s.openDetail)
  const panel = useDetailPanelStore((s) => s.panel)

  const gridRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navDir = useRef(1)

  const startMin0 = startH * 60
  const endMin0 = endH * 60
  const gridH = (endH - startH) * HOUR_PX
  const snap = (min: number) => Math.round(min / slot) * slot

  const weekStart = useMemo(() => addWeeks(startOfWeek(ohioWall(new Date()) as Date, { weekStartsOn: 1 }), weekOffset), [weekOffset])
  const weekEnd = addDays(weekStart, 6)
  const weekLabel = `Week of ${format(weekStart, 'EEE MMM d')} – ${format(addDays(weekStart, 4), 'EEE MMM d, yyyy')}`
  const inWeek = (dateStr: string) => {
    const d = new Date(`${dateStr}T00:00:00`)
    return d >= weekStart && d <= weekEnd
  }
  const selectedDate = addDays(weekStart, weekdayIdx)
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd')

  /* events with live drag overrides applied (move = retime/reassign, resize = new duration) */
  const effEvents = useMemo(
    () =>
      events.map((e) => {
        if (drag?.kind === 'move' && drag.id === e.id) return { ...e, personId: drag.personId, start: fromMin(drag.startMin) }
        if (drag?.kind === 'resize' && drag.id === e.id) return { ...e, durationMin: Math.max(slot, drag.endMin - toMin(e.start)) }
        return e
      }),
    [events, drag, slot],
  )

  const weekEvents = useMemo(() => effEvents.filter((e) => inWeek(e.date)), [effEvents, weekStart]) // eslint-disable-line react-hooks/exhaustive-deps
  const monthEvents = useMemo(() => {
    const ms = startOfMonth(monthCursor)
    const me = endOfMonth(monthCursor)
    return effEvents.filter((e) => {
      const d = new Date(`${e.date}T00:00:00`)
      return d >= ms && d <= me
    })
  }, [effEvents, monthCursor])
  /* events in the currently visible scope (drives legend counts, modal pickers) */
  const scopedEvents = view === 'month' ? monthEvents : view === 'week' ? weekEvents : effEvents.filter((e) => e.date === selectedDateStr)
  const scopedSorted = useMemo(
    () => [...scopedEvents].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)),
    [scopedEvents],
  )

  /* entrance stagger order: day → start time (the week "fills up" Mon→Fri) */
  const orderIdx = useMemo(() => {
    const sorted = [...weekEvents].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    return new Map(sorted.map((e, i) => [e.id, i]))
  }, [weekEvents])

  const hiddenEventCount = scopedEvents.filter((e) => hiddenTypes.has(e.type)).length
  const countByType = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of scopedEvents) m.set(e.type, (m.get(e.type) ?? 0) + 1)
    return m
  }, [scopedEvents])

  // now line (only when the visible week contains today) — drawn on OHIO's clock, because the shifts under it are…
  const now = ohioWall(new Date()) as Date
  const nowY = ((now.getHours() * 60 + now.getMinutes() - startMin0) / 60) * HOUR_PX
  const todayInWeek = inWeek(format(now, 'yyyy-MM-dd'))
  const showNow = config.showNowLine !== false && view !== 'month' && todayInWeek &&
    // in day view the red line belongs ONLY to Ohio's today — any other day of the current week must not wear it
    (view !== 'day' || selectedDateStr === format(now, 'yyyy-MM-dd')) &&
    nowY > 0 && nowY < gridH

  /* scroll the grid so "now" is visible on first mount */
  useEffect(() => {
    if (showNow && scrollRef.current) scrollRef.current.scrollTop = Math.max(0, nowY - 160)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Esc cancels the quick-create popover */
  useEffect(() => {
    if (!draft) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDraft(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft])

  // The grid runs on the COMPANY's clock — the label must name Ohio's zone, never the browser's…
  const tz = ZONE
  const gmtLabel = ohioOffsetLabel()

  const nav = (dir: number) => {
    navDir.current = dir
    if (view === 'month') {
      setMonthCursor((c) => startOfMonth(addMonths(c, dir)))
    } else if (view === 'day') {
      // one DAY at a time — the arrows used to jump a whole week here, skipping six days nobody asked to skip.
      const d = addDays(selectedDate, dir)
      const base = startOfWeek(ohioWall(new Date()) as Date, { weekStartsOn: 1 })
      const ws = startOfWeek(d, { weekStartsOn: 1 })
      setWeekOffset(Math.round((ws.getTime() - base.getTime()) / (7 * 864e5)))
      setWeekdayIdx((d.getDay() + 6) % 7)
      setMonthCursor(startOfMonth(d))
    } else {
      setWeekOffset((w) => w + dir)
      setMonthCursor(startOfMonth(addWeeks(weekStart, dir)))
    }
  }
  const goToday = () => {
    navDir.current = weekOffset > 0 ? -1 : 1
    const t = ohioWall(new Date()) as Date
    setWeekOffset(0)
    setWeekdayIdx((t.getDay() + 6) % 7)
    setMonthCursor(startOfMonth(t))
  }
  const pickDay = (d: Date) => {
    if (view === 'month') {
      navDir.current = d >= monthCursor ? 1 : -1
      setMonthCursor(startOfMonth(d))
      return
    }
    const base = startOfWeek(ohioWall(new Date()) as Date, { weekStartsOn: 1 })
    const ws = startOfWeek(d, { weekStartsOn: 1 })
    navDir.current = ws.getTime() >= addWeeks(base, weekOffset).getTime() ? 1 : -1
    setWeekOffset(Math.round((ws.getTime() - base.getTime()) / (7 * 864e5)))
    setWeekdayIdx((d.getDay() + 6) % 7)
  }

  /* ---------------- detail panel ---------------- */

  const openEvent = (e: CalEvent) => openDetail(buildEventDetail(e, eventTypes, resources))

  /* ---------------- create ---------------- */

  const commitDraft = () => {
    if (!draft || !canEdit) return
    const t = eventTypes[draft.type]
    const ev: CalEvent = {
      id: `local-${Date.now()}`,
      title: draft.title.trim() || t?.label || 'New event',
      personId: draft.personId,
      date: draft.date,
      start: fromMin(draft.startMin),
      durationMin: draft.durationMin,
      type: draft.type,
      attendees: [],
    }
    setEvents((prev) => [...prev, ev])
    setLastType(draft.type)
    setDraft(null)
    setDrag(null)
    api
      .create<CalEvent>('events', { ...ev })
      .then((row) => setEvents((prev) => prev.map((x) => (x.id === ev.id ? { ...x, id: row.id } : x))))
      .catch(() => {})
    toast({ type: 'success', title: 'Event created', body: `${ev.title} · ${format(new Date(`${ev.date}T00:00:00`), 'EEE MMM d')} ${ev.start}` })
  }

  const openNewEvent = (e: React.MouseEvent) => {
    if (!canEdit) return
    const r0 = resources[0]
    if (!r0) return
    const date = view === 'day' ? selectedDateStr
      : todayInWeek ? format(now, 'yyyy-MM-dd') : format(weekStart, 'yyyy-MM-dd')
    const busy = events
      .filter((x) => x.personId === r0.id && x.date === date)
      .map((x) => [toMin(x.start), toMin(x.start) + x.durationMin] as const)
    const dateIsToday = date === format(now, 'yyyy-MM-dd')
    let s = dateIsToday ? snap(now.getHours() * 60 + now.getMinutes() + slot) : startMin0 + 60
    s = clampNum(s, startMin0, endMin0 - slot)
    while (busy.some(([a, b]) => s < b && s + slot > a) && s + slot < endMin0) s += slot
    setDraft({ personId: r0.id, date, startMin: s, durationMin: slot, type: lastType, title: '' })
    setAnchor({ x: e.clientX, y: e.clientY + 12 })
  }

  /* month day-cell click: admins get a prefilled quick-create, staff the read-only day list */
  const monthDayClick = (d: Date, x: number, y: number) => {
    if (!canEdit) {
      setDayList({ day: d, x, y })
      return
    }
    const r0 = resources[0]
    if (!r0) return
    setDraft({ personId: r0.id, date: format(d, 'yyyy-MM-dd'), startMin: startMin0 + 120, durationMin: 60, type: lastType, title: '' })
    setAnchor({ x, y })
  }

  /* ---------------- staff quick actions ---------------- */

  const publishWeek = () => {
    if (!canEdit) return
    pushNotification({
      type: 'system',
      title: `Schedule published for week of ${format(weekStart, 'MMM d')}`,
      body: `The confirmed staff schedule for ${format(weekStart, 'EEE MMM d')} – ${format(weekEnd, 'EEE MMM d, yyyy')} is now visible to the team.`,
      priority: 'normal',
      appId: 'schedule',
      href: '/app/schedule/week',
    })
    toast({ type: 'success', title: 'Week published', body: `Schedule published for week of ${format(weekStart, 'MMM d')}.` })
  }

  /* ---------------- pointer drags ---------------- */

  const { startCreateDrag, startMoveDrag, startResizeDrag, suppressClick } = useScheduleDrag({
    canEdit,
    view,
    slot,
    snap,
    startMin0,
    endMin0,
    gridRef,
    resources,
    todayInWeek,
    now,
    weekStart,
    lastType,
    setDrag,
    setDraft,
    setAnchor,
    setEvents,
  })

  /* ---------------- tooltip (400ms hover intent) ---------------- */

  const showTip = (el: HTMLElement, e: CalEvent) => {
    if (tipTimer.current) clearTimeout(tipTimer.current)
    tipTimer.current = setTimeout(() => {
      const r = el.getBoundingClientRect()
      const names = peopleByIds(e.attendees).map((p) => p.name).join(', ')
      setTip({
        x: r.left + r.width / 2,
        y: r.top - 8,
        title: e.title,
        sub: `${format(new Date(`${e.date}T00:00:00`), 'EEE MMM d')} · ${e.start}–${endLabel(e)}`,
        names,
      })
    }, 400)
  }
  const hideTip = () => {
    if (tipTimer.current) clearTimeout(tipTimer.current)
    setTip(null)
  }

  /* ---------------- render helpers ---------------- */

  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i)
  const visibleResources = view === 'week' ? resources : resources.filter((r) => dayResource === 'all' || r.id === dayResource)
  const dayViewCols = view === 'day' ? [{ id: '__day__', name: '', avatar: '', role: '' }] : null

  const eventsForColumn = (resId: string) =>
    view === 'week'
      ? weekEvents.filter((e) => e.personId === resId)
      : effEvents.filter((e) => e.date === selectedDateStr && (dayResource === 'all' || e.personId === dayResource))

  const blockedFor = (resId: string) => blockedTimes.filter((b) => b.resourceId === 'all' || b.resourceId === resId)
  const isoWeekday = ((selectedDate.getDay() + 6) % 7) + 1
  const colCount = view === 'week' ? Math.max(visibleResources.length, 1) : 1

  const renderBlock = (laid: Laid) => (
    <EventBlock
      key={laid.e.id}
      laid={laid}
      eventTypes={eventTypes}
      hiddenTypes={hiddenTypes}
      selectedId={(panel?.record as any)?.id}
      drag={drag}
      canEdit={canEdit}
      view={view}
      dayResource={dayResource}
      resources={resources}
      orderIdx={orderIdx}
      suppressClick={suppressClick}
      startMoveDrag={startMoveDrag}
      startResizeDrag={startResizeDrag}
      openEvent={openEvent}
      showTip={showTip}
      hideTip={hideTip}
    />
  )

  /* ---------------- render ---------------- */

  const subtitle =
    view === 'month' ? format(monthCursor, 'MMMM yyyy') : view === 'week' ? weekLabel : format(selectedDate, 'EEEE, MMM d, yyyy')

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="w-full">
      <motion.div variants={staggerItem}>
        <PageHeader
          title={schema.title}
          subtitle={subtitle}
          actions={
            <ToolbarActions
              canEdit={canEdit}
              view={view}
              allowViews={allowViews}
              setView={setView}
              setMsgOpen={setMsgOpen}
              publishWeek={publishWeek}
              nav={nav}
              goToday={goToday}
              openNewEvent={openNewEvent}
            />
          }
        />
      </motion.div>

      <div className="flex items-start gap-5">
        {/* aside: mini month + legend + timezone */}
        {config.showMiniMonth !== false && (
          <ScheduleAside
            monthCursor={monthCursor}
            setMonthCursor={setMonthCursor}
            view={view}
            weekStart={weekStart}
            selectedDate={selectedDate}
            events={events}
            eventTypes={eventTypes}
            pickDay={pickDay}
            hiddenTypes={hiddenTypes}
            setHiddenTypes={setHiddenTypes}
            countByType={countByType}
            tz={tz}
            gmtLabel={gmtLabel}
          />
        )}

        {/* main card: week grid or month grid */}
        <motion.div
          key={`${view}-${weekOffset}-${format(monthCursor, 'yyyy-MM')}-${dayResource}-${weekdayIdx}`}
          initial={{ opacity: 0, x: 12 * navDir.current }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
          className="min-w-0 flex-1"
        >
          <Card padded={false} className="overflow-hidden">
            {/* hidden-types caption */}
            {hiddenEventCount > 0 && (
              <div className="flex items-center justify-end gap-2 border-b border-border px-3 py-1.5">
                <span className="text-[11px] text-text-3">{hiddenEventCount} hidden</span>
                <button onClick={() => setHiddenTypes(new Set())} className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary-hover">
                  <RotateCcw size={11} /> Reset
                </button>
              </div>
            )}

            {/* person picker — data-derived teammates (week view) */}
            {view === 'week' && fromData && allResources.length > resources.length && (
              <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
                <input
                  value={pickQ}
                  onChange={(e) => setPickQ(e.target.value)}
                  placeholder="Find a person…"
                  aria-label="Find a person to show"
                  className="h-7 w-40 shrink-0 rounded-sm border border-border bg-surface px-2 text-[12px] text-text-1 outline-none placeholder:text-text-3"
                />
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {allResources
                    .filter((r) => !pickQ.trim() || r.name.toLowerCase().includes(pickQ.trim().toLowerCase()))
                    .map((r) => {
                      const on = resources.some((v) => v.id === r.id)
                      return (
                        <button
                          key={r.id}
                          onClick={() => togglePicked(r.id)}
                          draggable={dragNames}
                          onDragStart={(e) =>
                            dragNames &&
                            writePersonDrag(e.dataTransfer, { type: 'staff', id: r.id, name: r.name, subtitle: r.role })
                          }
                          title={dragNames ? 'Click to show/hide · drag onto the top-left corner to focus the platform' : undefined}
                          className={cn(
                            'flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-[12px] font-medium transition-colors duration-150',
                            dragNames && 'cursor-grab active:cursor-grabbing',
                            on ? 'bg-primary-soft text-primary-strong' : 'bg-surface-2 text-text-3 hover:text-text-2',
                          )}
                        >
                          <Avatar src={r.avatar} name={r.name} size="xs" className="h-5 w-5 text-[9px]" />
                          {r.name}
                        </button>
                      )
                    })}
                </div>
              </div>
            )}

            {/* day-view resource chips */}
            {view === 'day' && (
              <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-3 py-2">
                {/* A chooser that also drags — the week person-picker thirty
                    lines above has been both since the shifts wave, and these
                    chips are the same teammates spelled shorter. Click still
                    filters the day; the drag is the gesture people try first. */}
                {dayChips.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setDayResource(c.id)}
                    draggable={!!(dragNames && c.person)}
                    onDragStart={(e) => {
                      if (!dragNames || !c.person) return
                      writePersonDrag(e.dataTransfer, {
                        type: 'staff',
                        id: c.person.id,
                        name: c.person.name,
                        avatar: c.person.avatar,
                        subtitle: c.person.role,
                      })
                    }}
                    title={
                      dragNames && c.person
                        ? `${c.person.name} · click to show this day · drag onto the top-left corner to focus the platform`
                        : undefined
                    }
                    className={cn(
                      'shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-colors duration-150',
                      dragNames && c.person && 'cursor-grab active:cursor-grabbing',
                      dayResource === c.id ? 'bg-primary-soft text-primary-strong' : 'bg-surface-2 text-text-3 hover:text-text-2',
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}

            {view === 'month' ? (
              <MonthGrid
                cursor={monthCursor}
                events={monthEvents.filter((e) => !hiddenTypes.has(e.type))}
                eventTypes={eventTypes}
                selectedId={(panel?.record as any)?.id}
                canEdit={canEdit}
                onOpenEvent={openEvent}
                onPickDay={monthDayClick}
                onMore={(d, x, y) => setDayList({ day: d, x, y })}
              />
            ) : (
              <WeekTimeGrid
                scrollRef={scrollRef}
                gridRef={gridRef}
                view={view}
                colCount={colCount}
                gmtLabel={gmtLabel}
                visibleResources={visibleResources}
                selectedDate={selectedDate}
                dayViewCols={dayViewCols}
                gridH={gridH}
                hours={hours}
                startH={startH}
                startMin0={startMin0}
                eventsForColumn={eventsForColumn}
                blockedFor={blockedFor}
                blockedTimes={blockedTimes}
                isoWeekday={isoWeekday}
                canEdit={canEdit}
                startCreateDrag={startCreateDrag}
                renderBlock={renderBlock}
                drag={drag}
                lastType={lastType}
                eventTypes={eventTypes}
                showNow={showNow}
                nowY={nowY}
                now={now}
                resourceDraggable={dragNames}
              />
            )}
          </Card>
        </motion.div>
      </div>

      {/* quick-create popover */}
      <AnimatePresence>
        {draft && (
          <QuickCreate
            anchor={anchor}
            draft={draft}
            setDraft={setDraft}
            resources={resources}
            eventTypes={eventTypes}
            onCancel={() => setDraft(null)}
            onCreate={commitDraft}
          />
        )}
      </AnimatePresence>

      {/* "+N more" / staff day-click popover */}
      <AnimatePresence>
        {dayList && (
          <DayEventsPopover
            day={dayList.day}
            anchor={{ x: dayList.x, y: dayList.y }}
            events={effEvents.filter((e) => e.date === format(dayList.day, 'yyyy-MM-dd') && !hiddenTypes.has(e.type))}
            eventTypes={eventTypes}
            canEdit={canEdit}
            onOpenEvent={(e) => {
              setDayList(null)
              openEvent(e)
            }}
            onQuickCreate={(d, x, y) => {
              setDayList(null)
              monthDayClick(d, x, y)
            }}
            onClose={() => setDayList(null)}
          />
        )}
      </AnimatePresence>

      {/* message staff modal */}
      <AnimatePresence>
        {msgOpen && <MessageStaffModal resources={resources} events={scopedSorted} onClose={() => setMsgOpen(false)} />}
      </AnimatePresence>

      {/* hover tooltip */}
      {tip &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 w-max max-w-[260px] -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-3 py-2 shadow-2"
            style={{ left: tip.x, top: tip.y }}
          >
            <p className="text-[12px] font-semibold text-text-1">{tip.title}</p>
            <p className="text-[11px] text-text-2">{tip.sub}</p>
            {tip.names && <p className="mt-0.5 text-[11px] text-text-3">with {tip.names}</p>}
          </div>,
          document.body,
        )}
    </motion.div>
  )
}
