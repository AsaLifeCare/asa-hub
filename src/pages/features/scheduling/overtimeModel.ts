// Scheduling › Overtime, the pure half: the answer of GET /hub-lanes/scheduling/overtime (app/overtime_lanes.py) shaped
// so a missing or mistyped field draws as nothing instead of breaking the table, PsiAnywhere's pay-period grid, the day
// Scheduling stands on, and the filters the screen applies to the people it was sent. Nothing here reads or writes.
//
// Two week conventions meet on this screen and must not be mixed: Scheduling draws Saturday→Friday weeks inside 28-day
// periods, while overtime is counted the way PsiAnywhere pays it — Sunday→Saturday weeks inside 14-day pay periods.
// Every week and period below is PsiAnywhere's; Scheduling's own only chooses which pay period opens first.
import { addDays, dayIndex } from './schedulingModel'

/* ---------- PsiAnywhere's pay periods ---------- */

// The grid app/psi_periods.py computes (PERIOD_ANCHOR, PERIOD_DAYS): 14 days from a Sunday, on the dates PsiAnywhere's
// own Imported batches follow. The server is the authority — its `periods` fill the picker — and this copy only lets
// the first read ask for the right period before any answer has arrived. Change both or neither.
export const PSI_PERIOD_ANCHOR = '2026-06-07'
export const PSI_PERIOD_DAYS = 14
/** The screen's own address keys: the dates on screen, a pay period or custom. */
export const OT_FROM = 'ot_from'
export const OT_TO = 'ot_to'
/** The longest span the overtime lane answers (it refuses more with a 400). */
export const OVERTIME_MAX_DAYS = 62
/** The weekly line when the answer does not say its own. */
export const OVERTIME_THRESHOLD = 40

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
export const isIsoDay = (v: string): boolean => ISO_DAY.test(v) && !Number.isNaN(dayIndex(v))

/** PsiAnywhere's text for a span: "10/25/26 – 11/07/26" (psi_periods.label). */
export function psiLabel(from: string, to: string): string {
  const one = (iso: string) => {
    const [y, m, d] = iso.split('-')
    return y && m && d ? `${m}/${d}/${y.slice(2)}` : iso
  }
  return `${one(from)} – ${one(to)}`
}

/** The pay period holding `day` (psi_periods.period_start), or null for something that is not a day. */
export function psiPeriodOf(day: string): { from: string; to: string } | null {
  if (!isIsoDay(day)) return null
  const back = Math.floor((dayIndex(day) - dayIndex(PSI_PERIOD_ANCHOR)) / PSI_PERIOD_DAYS) * PSI_PERIOD_DAYS
  const from = addDays(PSI_PERIOD_ANCHOR, back)
  return { from, to: addDays(from, PSI_PERIOD_DAYS - 1) }
}

/** True when the span is exactly one pay period of the grid. */
export function isPsiPeriod(from: string, to: string): boolean {
  const p = psiPeriodOf(from)
  return Boolean(p && p.from === from && p.to === to)
}

/**
 * The day Scheduling stands on, for a screen that opens on the pay period holding it (the embedded Time Reconciliation
 * and Overtime): the day a link asked for, when it is drawn; else today, when it is drawn; else the first day drawn —
 * moved past a Saturday start, because Scheduling's weeks begin on the Saturday that ENDS a PsiAnywhere week, and the
 * six days drawn after it belong to the next one. '' while nothing is drawn.
 */
export function psiAnchorDay(drawn: { from: string; to: string }, today: string, day = ''): string {
  const inside = (d: string) => isIsoDay(d) && d >= drawn.from && d <= drawn.to
  if (inside(day)) return day
  if (inside(today)) return today
  if (!isIsoDay(drawn.from)) return isIsoDay(today) ? today : ''
  const saturday = new Date(dayIndex(drawn.from) * 86_400_000).getUTCDay() === 6
  const next = addDays(drawn.from, 1)
  return saturday && next <= drawn.to ? next : drawn.from
}

/**
 * The address change for moving to Scheduling screen `screen`: Overtime's dates are dropped whenever it is left, so
 * coming back opens the pay period holding Scheduling's day again instead of the span picked before.
 */
export function screenParams(screen: string): Record<string, string | null> {
  return { view: screen === 'house' ? null : screen, ...(screen === 'overtime' ? {} : { [OT_FROM]: null, [OT_TO]: null }) }
}

/** Why a span cannot be asked for ('' when it can): the lane answers whole days, in order, at most 62 of them. */
export function rangeProblem(from: string, to: string): string {
  if (!isIsoDay(from) || !isIsoDay(to)) return 'Pick both days.'
  if (from > to) return 'The first day is after the last.'
  const days = dayIndex(to) - dayIndex(from) + 1
  if (days > OVERTIME_MAX_DAYS) return `At most ${OVERTIME_MAX_DAYS} days at a time — this is ${days}.`
  return ''
}

/* ---------- the answer ---------- */

export type OtWeek = { from: string; to: string; label: string }
export type OtPeriod = { id: string; from: string; to: string; label: string; current: boolean; weeks: OtWeek[] }
/** One Sunday week of one person: the WHOLE week's hours, also its days outside the dates asked for. */
export type OtPersonWeek = {
  from: string; planned: number; actual: number; over: boolean; plannedOver: boolean; overtime: number
}
export type OtDay = { planned: number; actual: number }
export type OtPerson = {
  key: string; employeeId: string; employeeName: string; weeks: OtPersonWeek[]
  planned: number; actual: number; overtime: number; days: Record<string, OtDay>
}
export type OtTotals = { people: number; peopleOver: number; overtimeHours: number }
export type OtEmployee = { key: string; name: string }
export type OvertimeData = {
  from: string; to: string; threshold: number; weeks: OtWeek[]
  /** where the planned hours came from: Scheduling's own calendars, or the house books when it has none */
  plannedSource: string
  people: OtPerson[]; totals: OtTotals; periods: OtPeriod[]; employees: OtEmployee[]
}

const str = (v: unknown): string => (v == null ? '' : String(v))
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const list = (v: unknown): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : []).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
const obj = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

const weekOf = (w: Record<string, unknown>): OtWeek => ({ from: str(w.from), to: str(w.to), label: str(w.label) })

function dayOf(v: unknown): OtDay {
  // a bare number is a worked figure (the Time Reconciliation overtime answers days that way)
  if (typeof v === 'number' || typeof v === 'string') return { planned: 0, actual: num(v) }
  const d = obj(v)
  return { planned: num(d.planned), actual: num(d.actual) }
}

/** The lane's data, every field typed; anything unreadable is empty, never a throw. */
export function overtimeFrom(raw: unknown): OvertimeData {
  const d = obj(raw)
  const threshold = num(d.threshold) || OVERTIME_THRESHOLD
  const people = list(d.people).map((p): OtPerson => {
    const days: Record<string, OtDay> = {}
    for (const [k, v] of Object.entries(obj(p.days))) if (isIsoDay(k)) days[k] = dayOf(v)
    return {
      key: str(p.key), employeeId: str(p.employeeId), employeeName: str(p.employeeName) || str(p.key),
      weeks: list(p.weeks).map((w) => {
        const planned = num(w.planned)
        const actual = num(w.actual)
        // the flags as sent, and the numbers behind them, so a flag the server leaves out still colours the cell
        return {
          from: str(w.from), planned, actual, overtime: num(w.overtime),
          over: Boolean(w.over) || actual > threshold, plannedOver: Boolean(w.plannedOver) || planned > threshold,
        }
      }),
      planned: num(p.planned), actual: num(p.actual), overtime: num(p.overtime), days,
    }
  })
  const t = obj(d.totals)
  return {
    from: str(d.from), to: str(d.to), threshold, weeks: list(d.weeks).map(weekOf),
    plannedSource: str(d.plannedSource),
    people,
    totals: { people: num(t.people), peopleOver: num(t.peopleOver), overtimeHours: num(t.overtimeHours) },
    periods: list(d.periods).map((p) => ({
      id: str(p.id), from: str(p.from), to: str(p.to), label: str(p.label) || psiLabel(str(p.from), str(p.to)),
      current: p.current === true, weeks: list(p.weeks).map(weekOf),
    })).filter((p) => p.id && isIsoDay(p.from) && isIsoDay(p.to)),
    employees: list(d.employees).map((e) => ({ key: str(e.key), name: str(e.name) || str(e.key) })).filter((e) => e.key),
  }
}

/** The lane's address for a span; the employees are picked on screen, from everybody it answers. */
export function overtimePath(from: string, to: string): string {
  return `/hub-lanes/scheduling/overtime?${new URLSearchParams({ from, to })}`
}

/** The note under the table: where the planned hours were read. */
export function plannedSourceLine(source: string): string {
  return source === 'schedule' ? 'Planned hours from the schedule.'
    : source === 'house calendars' ? 'Planned hours from the house calendars.'
      : source ? `Planned hours from ${source}.` : ''
}

/* ---------- the pay-period picker ---------- */

export const CUSTOM_CHOICE = 'custom'

/**
 * The picker's options: the pay periods the server answered (newest first, the current one marked), and the span on
 * screen when it is a pay period the server did not list — a future one Scheduling stands on, an older one a link
 * opened, or the first read's before any answer — so the select never shows a period that is not the one drawn. That
 * extra one takes its place by date, before the first listed period older than it, so the list stays newest first.
 */
export function periodChoices(periods: OtPeriod[], from: string, to: string): { id: string; label: string; from: string; to: string }[] {
  const out = periods.map((p) => ({ id: p.id, label: `${p.label}${p.current ? ' (current)' : ''}`, from: p.from, to: p.to }))
  if (isPsiPeriod(from, to) && !out.some((p) => p.from === from && p.to === to)) {
    const older = out.findIndex((p) => p.from < from)
    out.splice(older < 0 ? out.length : older, 0, { id: `P${from}`, label: psiLabel(from, to), from, to })
  }
  return out
}

/* ---------- who is drawn ---------- */

/** Somebody over the line in some week: worked (red) or planned (amber) — both are what a scheduler acts on. */
export const personOver = (p: OtPerson): boolean => p.overtime > 0 || p.weeks.some((w) => w.over || w.plannedOver)

/** The rows drawn, in the server's order: the employees picked (none picked = everybody), and only those over the line
 * when that switch is on. */
export function shownPeople(people: OtPerson[], picked: { readonly size: number; has(key: string): boolean }, onlyOver: boolean): OtPerson[] {
  return people.filter((p) => (picked.size === 0 || picked.has(p.key)) && (!onlyOver || personOver(p)))
}

/**
 * The employees picked: key → the name they had when picked. A pick outlives a change of dates, and the next answer
 * may not list that person (no hours there) or not have arrived yet, so the name travels with the key and the picker
 * never shows a bare key.
 */
export type OtPicked = ReadonlyMap<string, string>

/** The picker button's words: everybody, the one name picked, or how many. */
export function pickedWords(picked: OtPicked): string {
  if (picked.size === 0) return 'All employees'
  if (picked.size === 1) return [...picked.values()][0] || '1 employee'
  return `${picked.size} employees`
}

/** One line of the picker; `absent`: picked, but not in this answer. */
export type OtPickerLine = OtEmployee & { absent: boolean }

/** The picker's list, by name: everybody the answer lists, and the people picked that it does not — so a pick made on
 * other dates still shows by name and can be unticked here. */
export function pickerEmployees(employees: OtEmployee[], picked: OtPicked): OtPickerLine[] {
  const listed = new Set(employees.map((e) => e.key))
  const away = [...picked].filter(([key]) => !listed.has(key)).map(([key, name]) => ({ key, name, absent: true }))
  return [...employees.map((e) => ({ ...e, absent: false })), ...away].sort((a, b) => a.name.localeCompare(b.name))
}

/** The line above the table, counted from the rows drawn so the filters move it. */
export function summaryOf(rows: OtPerson[]): { people: number; workedOver: number; overtime: number } {
  return {
    people: rows.length,
    workedOver: rows.filter((p) => p.overtime > 0 || p.weeks.some((w) => w.over)).length,
    overtime: Math.round(rows.reduce((n, p) => n + p.overtime, 0) * 100) / 100,
  }
}

/** Hours as words: two decimals at most, no trailing zeros ("38.5", "40", "0.25"). */
export function hoursText(n: number): string {
  return String(Math.round((Number.isFinite(n) ? n : 0) * 100) / 100)
}

/** The seven days of the Sunday week starting `sunday`. */
export function weekDays(sunday: string): string[] {
  return isIsoDay(sunday) ? Array.from({ length: 7 }, (_, i) => addDays(sunday, i)) : []
}

/** The person's figures for one week of the answer (zeros when the server sent none for it). */
export function personWeek(p: OtPerson, from: string): OtPersonWeek {
  return p.weeks.find((w) => w.from === from) ?? { from, planned: 0, actual: 0, over: false, plannedOver: false, overtime: 0 }
}

/** True when the dates asked for cut a week: its column still counts the whole week. */
export function cutsWeeks(data: Pick<OvertimeData, 'from' | 'to' | 'weeks'>): boolean {
  if (!data.weeks.length) return false
  return data.weeks[0].from < data.from || data.weeks[data.weeks.length - 1].to > data.to
}
