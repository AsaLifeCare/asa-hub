// The side panel a Requests row opens (useDetailPanelStore), built only from relay-cut values; a field not sent is…
// Pure builders for `openDetail`.
import type { DetailPanelPayload } from '@/stores/useDetailPanelStore'
import { ohioDateTime } from '@/lib/ohio'
import { houseCalLink } from './houseCalTypes'
import {
  ABOVE_ONE, KIND_LABEL, STATE_LABEL, STATE_TINT, TIME_OFF_STATUS_LABEL, TIME_OFF_STATUS_TINT, calledOffLine, clockOf,
  dayLabel, decisionLine, displacedLine, placeLine, reasonLine, shiftLine, shiftStateWord, timeOffLegLine,
  trainingLine, urgentLine, waitingLine, windowLine,
  type Essentials, type RequestRow, type ShiftCard, type ShiftDetail, type TimeOffRow,
} from './requestsLogic'

type Field = { icon?: string; label: string; value: string; multiline?: boolean }
type ListItem = { title: string; meta?: string; icon?: string; href?: string }

const STATE_TINTS: Record<string, string> = {
  Open: 'amber', Reserved: 'amber', Closed: 'blue', Assign: 'blue', Filled: 'mint',
  ...Object.fromEntries(Object.entries(STATE_LABEL).map(([k, v]) => [v, STATE_TINT[k] ?? 'blue'])),
  ...Object.fromEntries(Object.entries(TIME_OFF_STATUS_LABEL).map(([k, v]) => [v, TIME_OFF_STATUS_TINT[k] ?? 'blue'])),
}

function fields(title: string, list: (Field | null | false | undefined)[]) {
  const kept = list.filter(Boolean) as Field[]
  return kept.length ? [{ kind: 'fields', title, fields: kept }] : []
}

function list(title: string, items: ListItem[], empty?: string) {
  if (!items.length && !empty) return []
  return [{ kind: 'list', title, items: items.length ? items : [{ title: empty ?? '', icon: 'info' }] }]
}

function managerValue(e: Essentials): string {
  if (e.managers.length) return e.managers.join(' and ')
  return e.managers_readable
    ? `No house manager on the hotline calendar — ${e.deciders || 'the managers above the house'} decide`
    : 'Who manages this house could not be read'
}

function place(e: Essentials, today: string): Field[] {
  return [
    { icon: 'house', label: 'House', value: placeLine(e) || e.house },
    { icon: 'calendar', label: 'Day and shift', value: shiftLine(e, today) || e.col_iso },
    { icon: 'user', label: 'House manager', value: managerValue(e) },
  ]
}

function panel(record: Record<string, unknown>, sections: unknown[], footer: unknown[] = [],
               stats?: unknown[]): DetailPanelPayload {
  return {
    record,
    config: {
      header: { avatar: 'initials', title: 'title', subtitle: 'subtitle',
                statusChip: { field: 'state', tintBy: STATE_TINTS } },
      ...(stats ? { stats } : {}),
      sections,
      footer,
    },
  }
}

/** An open shift or call-off; `detail` null while read, `detailWhy` when unreadable. */
export function shiftPanel(card: ShiftCard, opts: {
  today: string; nowMs: number; detail?: ShiftDetail | null; detailWhy?: string
}): DetailPanelPayload {
  const { today, nowMs, detail, detailWhy } = opts
  const reading = detail === undefined || (detail === null && !detailWhy)
  const heavy = (n: number | undefined) => (detail ? n ?? 0 : reading ? '…' : '—')
  const title = `${KIND_LABEL[card.kind] ?? card.kind} · ${card.house}`
  const record = { id: card.ref, title, subtitle: shiftLine(card, today), state: shiftStateWord(card.state, card.window) }

  const applicants: ListItem[] = (detail?.applicants ?? []).map((a) => ({
    title: a.person,
    icon: a.live ? 'hand' : 'history',
    meta: [
      STATE_LABEL[a.state] ?? a.state,
      a.ist.ok ? 'IST here' : 'no IST here — a training',
      a.regular ? 'a regular' : 'not a regular',
      `${a.week_hours}h that week`,
      a.overlap ? `overlap: ${a.overlap}` : 'no overlap',
      `applied ${clockOf(a.at) || a.at}${a.via && a.via !== 'app' ? ` by ${a.via}` : ''}`,
      // THE MARK: this panel is where a house manager reads an applicant before deciding
      ...(a.rehearsal ? ['PLAYED BY THE SHIFT REHEARSAL — nobody asked for it'] : []),
    ].join(' · '),
  }))

  const sections = [
    ...fields('Where and when', place(card, today)),
    ...fields('Applications', [
      { icon: 'clock', label: 'Window', value: windowLine(card.state, card.window, nowMs) },
      { icon: 'users', label: 'Applied', value: String(card.applicant_count) },
      detailWhy
        ? { icon: 'alert-triangle', label: 'Who could still take it', value: `could not be read — ${detailWhy}` }
        : { icon: 'users', label: 'Who could still take it',
            value: detail
              ? `${detail.eligible.may_apply_now} may apply now · ${detail.eligible.free} of ${detail.eligible.of} on the calendars are free for its hours`
                + (detail.eligible.why ? ` — ${detail.eligible.why}` : '')
              : 'reading…' },
    ]),
    ...(card.called_off
      ? fields('The call-off', [
          { icon: 'phone-off', label: 'Who, when and how', value: calledOffLine(card.called_off) },
          { icon: 'message-square', label: 'Reason', value: reasonLine(card.called_off), multiline: true },
        ])
      : []),
    ...(card.urgent ? fields('URGENT OPEN SHIFT', [
      { icon: 'send', label: 'To all staff', value: urgentLine(card.urgent) },
      card.urgent.why && !['sent'].includes(card.urgent.state ?? '')
        ? { icon: 'info', label: 'Why', value: card.urgent.why, multiline: true } : null,
    ]) : []),
    ...(detail && detail.applicants.length ? list('Applicants', applicants) : []),
    ...(detail?.manager_availability?.length
      ? list('The house manager then', detail.manager_availability.map((m) => ({
          title: m.name, icon: m.free ? 'check' : 'clock', meta: m.why })))
      : []),
    ...(detail?.eligible.names?.length
      ? list('May apply now', detail.eligible.names.map((n) => ({ title: n, icon: 'user' })))
      : []),
    ...(card.decision ? fields('Decision', [
      { icon: 'check', label: 'Given to', value: decisionLine(card.decision) },
    ]) : []),
  ]
  const stats = [
    { label: 'Applied', value: card.applicant_count, icon: 'users', tint: 'amber' },
    { label: 'May apply now', value: heavy(detail?.eligible.may_apply_now), icon: 'hand', tint: 'mint' },
    { label: 'Free for it', value: heavy(detail?.eligible.free), icon: 'user-check', tint: 'blue' },
    { label: 'Hours', value: typeof card.hours === 'number' ? card.hours : '—', icon: 'clock', tint: 'lavender' },
  ]
  const footer = [{ label: 'Open the red square', icon: 'arrow-up-right', variant: 'secondary',
                    href: houseCalLink(card.location, { ref: card.ref }) }]
  return panel(record, sections, footer, stats)
}

/** A SWAP — the transfer of one shift between two people. */
export function swapPanel(r: RequestRow, today: string): DetailPanelPayload {
  const e = r.essentials
  const record = { id: r.id, title: `Swap · ${r.house}`, subtitle: e ? shiftLine(e, today) : `${r.col_iso} · ${r.shift}`,
                   state: STATE_LABEL[r.state] ?? r.state }
  const consent = (state?: string, via?: string, at?: string, by?: string) =>
    [(state || '—').replace(/_/g, ' '), by, via ? `by ${via}` : '', at ? ohioStamp(at) : ''].filter(Boolean).join(' · ')
  const approver = r.approval?.mode === 'above'
    ? ABOVE_ONE
    : (r.approval?.names?.length ? r.approval.names.join(' or ') : r.house_manager || 'the house manager')
  const board = r.directors?.length ? r.directors.join(' or ') : 'the director'
  const sections = [
    ...(e ? fields('Where and when', place(e, today)) : []),
    /* THREE CONSENTS, THREE LINES — the director's is read from its own field like the others. */
    ...fields('Who', [
      { icon: 'user', label: 'Giving it', value: r.from_staff ?? '' },
      { icon: 'user', label: 'Taking it', value: r.to_staff ?? '' },
      { icon: 'check', label: `${r.to_staff || 'The receiver'} said`, value: consent(r.staff_state, r.staff_via, r.staff_at, r.staff_by) },
      { icon: 'check', label: 'The house manager said', value: consent(r.manager_state, r.manager_via, r.manager_at, r.manager_by) },
      { icon: 'check', label: 'The director said', value: consent(r.director_state ?? 'pending', r.director_via, r.director_at, r.director_by) },
      { icon: 'badge-check', label: 'Who approves', value: `${approver}${r.approval?.why ? ` — ${r.approval.why}` : ''}, and ${board}` },
      { icon: 'info', label: 'Now', value: waitingLine({ state: r.state, staff_state: r.staff_state ?? '',
          manager_state: r.manager_state ?? '', to_staff: r.to_staff ?? '', approval: r.approval ?? { mode: '', names: [], why: '' },
          house_manager: r.house_manager ?? '', why: r.why,
          director_state: r.director_state, directors: r.directors }) },
    ]),
    ...(r.first_shift?.needed ? fields('Training', [
      { icon: 'graduation-cap', label: 'A first shift there',
        value: r.first_shift.request_state === 'approved'
          ? 'The training is approved'
          : (r.first_shift.why || 'Approving the transfer takes the house manager\'s training on') },
      r.first_shift.trainer?.why ? { icon: 'user', label: 'Who trains', value: r.first_shift.trainer.why } : null,
    ]) : []),
  ]
  const footer = r.location ? [{ label: 'Open the calendar', icon: 'arrow-up-right', variant: 'secondary',
                                 href: swapLink(r) }] : []
  return panel(record, sections, footer)
}

/** A transfer on Live: the giver's cell that day, where the transfer waits; the house alone when either is unknown. */
export function swapLink(r: Pick<RequestRow, 'location' | 'from_staff' | 'col_iso'>): string {
  return houseCalLink(r.location, r.from_staff && r.col_iso ? { open: `${r.from_staff}|${r.col_iso}` } : {})
}

/** A TRAINING APPROVAL — a first shift in a house, the house manager's to train. */
export function trainingPanel(r: RequestRow, today: string): DetailPanelPayload {
  const e = r.essentials
  const record = { id: r.id, title: `Training approval · ${r.house}`,
                   subtitle: e ? shiftLine(e, today) : `${r.col_iso} · ${r.shift}`,
                   state: STATE_LABEL[r.state] ?? r.state }
  const sections = [
    ...(e ? fields('Where and when', place(e, today)) : []),
    ...fields('The training', [
      { icon: 'user', label: 'Trainee', value: r.person },
      { icon: 'info', label: 'Why', value: r.why || 'no IST on file for this house' },
      r.state === 'approved'
        ? { icon: 'user', label: 'Who trains', value: r.trainer || 'not written down on this approval' }
        : { icon: 'clock', label: 'Who trains, and are they free', value: trainingLine(r.training) || 'not read' },
      r.decided_by ? { icon: 'check', label: 'Decided', value: `${r.decided_by}${r.decided_at ? ` · ${ohioStamp(r.decided_at)}` : ''}` } : null,
    ]),
  ]
  return panel(record, sections)
}

/** TIME OFF — the dates, and every shift they touch. */
export function timeOffPanel(t: TimeOffRow, today: string): DetailPanelPayload {
  const record = { id: t.id, title: `Time off · ${t.person}`,
                   subtitle: `${dayLabel(t.start, today)} → ${dayLabel(t.end, today)} · ${t.days} day${t.days === 1 ? '' : 's'}`,
                   state: t.status ? (TIME_OFF_STATUS_LABEL[t.status] ?? t.status) : (STATE_LABEL[t.state] ?? t.state) }
  const shifts: ListItem[] = t.displaced.map((d) => ({
    title: `${dayLabel(d.col_iso, today)} · ${d.house} · ${d.value}`,
    icon: d.working ? 'alert-triangle' : d.covered ? 'check' : 'clock',
    meta: d.why + (d.open_shifts?.length
      ? ` — ${d.open_shifts.map((o) => `${o.value} ${o.filled_by ? `given to ${o.filled_by}` : o.state === 'filled' ? 'given' : 'open'}`).join(', ')}`
      : ''),
  }))
  const status = t.status ? (TIME_OFF_STATUS_LABEL[t.status] ?? t.status) : (STATE_LABEL[t.state] ?? t.state)
  const sections = [
    ...fields('The request', [
      { icon: 'user', label: 'Person', value: t.person },
      { icon: 'calendar', label: 'Dates', value: `${dayLabel(t.start, today)} → ${dayLabel(t.end, today)}` },
      { icon: 'house', label: 'Houses', value: (t.house_labels ?? t.houses).join(', ') || 'not on a drawn calendar' },
      t.calendar_name ? { icon: 'calendar', label: 'Calendar', value: t.calendar_name } : null,
      { icon: 'clock', label: 'Asked', value: t.asked ? ohioStamp(t.asked) : 'not stamped' },
      { icon: 'badge-check', label: 'House manager', value: timeOffLegLine('House manager', t.hm).replace(/^House manager: /, '') },
      { icon: 'badge-check', label: 'Director', value: timeOffLegLine('Director', t.dir).replace(/^Director: /, '') },
      { icon: 'info', label: 'Status', value: t.decided_why ? `${status} — ${t.decided_why}` : status },
    ]),
    ...list('Decide it in', t.link
      ? [{ title: 'Time Off → Requests', meta: t.ref ?? t.id, icon: 'external-link', href: t.link }] : []),
    ...fields('The shifts it touches', [{ icon: 'info', label: 'In short', value: displacedLine(t) }]),
    ...list('Day by day', shifts),
  ]
  return panel(record, sections)
}

/** An instant on Ohio's clock, date and time; the text itself when it is not one. */
function ohioStamp(iso: string): string {
  return ohioDateTime(iso) || iso
}
