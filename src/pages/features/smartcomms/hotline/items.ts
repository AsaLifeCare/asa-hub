// THE PICTURE — every list item the screen can show, built once from the calls index, the four lanes and the hiring…
// Built once so that the same call is the same object whichever tab it is reached from: the Calls tab, the Call…
import type { CallRow, CallsIndex, DailyNote, LineKey } from './hotlineApi'
import {
  callKey, candidateForCall, cell, daysBefore, firstSentence, linkIncidents,
  modalitiesOf, noteRecordsOf, parseStamp, recordsOf, screensOf, statedName, whoOfCall,
  type LaneRecord, type Row, type ScreenRecord, type Stamp, type Who, type WhoSource,
} from './join'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import {
  CHIP_FIELD, LANE_IDS, LINE, MODALITY, MODALITIES, SHEET_LANES, STATE, shownState,
  type LaneId, type Modality, type ScheduleRead,
} from './vocabulary'

// THERE IS NO `ui` TAB, and the reason is worth keeping: it was built and removed the same hour.
export type TabId = 'calls' | LaneId | 'screening'

/** What the lanes answered: rows for the three sheets, typed notes for Daily Notes. */
export type LaneRows = {
  calloffs: Row[] | null
  queue: Row[] | null
  incidents: Row[] | null
  notes: DailyNote[] | null
}

// Where the calls index stands — so a row filed from a call that is not in the picture can say WHY: the index has…
export type IndexState = 'live' | 'kept' | 'loading' | 'failed' | 'refused'

// Whether this session's role reads the 4040's calls: the relay returns them only to the roles the hiring lane's…
export type ScreeningAccess = 'open' | 'withheld' | 'unknown'

export const TABS: { id: TabId; label: string }[] = [
  { id: 'calls', label: 'Calls' },
  { id: 'calloffs', label: 'Call Offs' },
  { id: 'queue', label: 'Support Queue' },
  { id: 'notes', label: 'Daily Notes' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'screening', label: 'Screening' },
]

type Searchable = {
  /** lowercased words a search can hit */
  hay: string
  /** every phone digit on the item, for a search typed as a number */
  digits: string
}

export type CallItem = Searchable & {
  type: 'call'
  key: string
  call: CallRow
  stamp: Stamp | null
  linked: LaneRecord[]
  screen: ScreenRecord | null
  candidate: Row | null
  modalities: Modality[]
  who: Who
  preview: string
}

export type RecordItem = Searchable & {
  type: 'record'
  key: string
  rec: LaneRecord
  /** the call the row came from, when that call is in the index */
  call: CallItem | null
  who: string
  /** which face the row wears: a name gets initials, a bare number a handset */
  face: WhoSource | 'record'
  preview: string
}

export type ScreenItem = Searchable & {
  type: 'screen'
  key: string
  screen: ScreenRecord
  who: string
  preview: string
}

export type Item = CallItem | RecordItem | ScreenItem

export type Picture = {
  calls: CallItem[]
  lanes: Record<LaneId, RecordItem[] | null>
  /** screens with no call in the index — manual screens, or older calls */
  looseScreens: ScreenItem[] | null
  byKey: Map<string, Item>
  tabs: Record<TabId, Item[] | null>
}

const PREVIEW_FIELD: Record<LaneId, string> = {
  calloffs: 'notes',
  queue: 'description_of_request',
  notes: 'response',
  incidents: 'summary_of_incident',
}

const hayOf = (parts: string[]) => parts.filter(Boolean).join(' • ').toLowerCase()
const digitsOf = (phones: string[]) => phones.map((p) => String(p ?? '').replace(/\D/g, '')).filter(Boolean).join(' ')

function recordWords(rec: LaneRecord): string[] {
  const r = rec.row
  return [
    statedName(rec), cell(r, CHIP_FIELD[rec.lane]), cell(r, PREVIEW_FIELD[rec.lane]),
    cell(r, 'client_name'), cell(r, 'urgency'), cell(r, 'status'), cell(r, 'your_name'),
    cell(r, 'employees_involved'), cell(r, 'incident_location'), MODALITY[rec.lane].one,
    // a Daily Note's matched client, the name as written, its category and shift
    cell(r, 'client'), cell(r, 'client_written'), cell(r, 'category_label'), cell(r, 'shift_text'),
  ]
}

const recordPhones = (rec: LaneRecord) => [cell(rec.row, 'requestor_phone'), cell(rec.row, 'caller_phone')]

export function buildPicture(
  index: CallsIndex | null,
  laneRows: LaneRows,
  screenRows: Row[] | null,
  candidateRows: Row[] | null,
  /** how much of the schedule the notes door read, for the notes' shift sentence */
  notesSchedule: ScheduleRead = 'unknown',
): Picture {
  const rawCalls = index?.calls ?? []
  const calls = [...rawCalls].sort((a, b) => {
    const x = Date.parse(a.at)
    const y = Date.parse(b.at)
    if (Number.isFinite(x) && Number.isFinite(y)) return y - x
    if (Number.isFinite(x)) return -1
    if (Number.isFinite(y)) return 1
    return 0
  })

  /* the lanes' records, with the incident link made against the calls */
  const records: Record<LaneId, LaneRecord[] | null> = { calloffs: null, queue: null, notes: null, incidents: null }
  for (const lane of SHEET_LANES) {
    const rows = laneRows[lane]
    if (!rows) continue
    const recs = recordsOf(lane, rows)
    records[lane] = lane === 'incidents' ? linkIncidents(recs, calls) : recs
  }
  if (laneRows.notes) records.notes = noteRecordsOf(laneRows.notes, notesSchedule)

  const linkedByCall = new Map<string, LaneRecord[]>()
  for (const lane of LANE_IDS) {
    for (const rec of records[lane] ?? []) {
      if (!rec.callKey) continue
      const list = linkedByCall.get(rec.callKey)
      if (list) list.push(rec)
      else linkedByCall.set(rec.callKey, [rec])
    }
  }

  const screens = screenRows ? screensOf(screenRows, candidateRows) : null
  const screenByCall = new Map<string, ScreenRecord>()
  for (const sc of screens ?? []) if (sc.callKey && !screenByCall.has(sc.callKey)) screenByCall.set(sc.callKey, sc)

  /* the calls */
  const callItems: CallItem[] = calls.map((call) => {
    const k = callKey(call.call_id)
    const linked = linkedByCall.get(k) ?? []
    const screen = call.line_key === 'screening' ? screenByCall.get(k) ?? null : null
    const candidate = call.line_key === 'screening' ? candidateForCall(call, screen, candidateRows) : null
    const who = whoOfCall(call, linked, candidate)
    const firstLinked = linked.map((r) => cell(r.row, PREVIEW_FIELD[r.lane])).find(Boolean) ?? ''
    const modalities = modalitiesOf(call, linked, screen)
    return {
      type: 'call',
      key: `call:${k}`,
      call,
      stamp: parseStamp(call.at),
      linked,
      screen,
      candidate,
      modalities,
      who,
      preview: firstSentence(call.summary?.text ?? '') || firstSentence(firstLinked) || firstSentence(cell(screen?.row, 'notes')),
      hay: hayOf([
        who.name, call.caller.name, call.caller.line_name, call.caller.phone, formatPhoneDisplay(call.caller.phone),
        call.call_id, LINE[call.line_key].label, ...modalities.map((m) => MODALITY[m].label),
        call.summary?.text ?? '', cell(candidate, 'name'), cell(screen?.row, 'final_result'),
        ...linked.flatMap(recordWords),
      ]),
      digits: digitsOf([call.caller.phone, ...linked.flatMap(recordPhones), cell(candidate, 'phone')]),
    }
  })
  const callByKey = new Map(callItems.map((c) => [callKey(c.call.call_id), c]))

  /* the records */
  const lanes: Record<LaneId, RecordItem[] | null> = { calloffs: null, queue: null, notes: null, incidents: null }
  for (const lane of LANE_IDS) {
    const recs = records[lane]
    if (!recs) continue
    lanes[lane] = recs.map((rec) => {
      const call = rec.callKey ? callByKey.get(rec.callKey) ?? null : null
      const phone = recordPhones(rec).find(Boolean) ?? ''
      const stated = statedName(rec)
      const who = stated
        ? { name: stated, face: 'record' as const }
        : phone
          ? { name: formatPhoneDisplay(phone), face: 'unknown' as const }
          : call
            ? { name: call.who.name, face: call.who.source }
            : { name: 'No name on the row', face: 'unknown' as const }
      return {
        type: 'record',
        key: rec.key,
        rec,
        call,
        who: who.name,
        face: who.face,
        preview: firstSentence(cell(rec.row, PREVIEW_FIELD[lane])) || firstSentence(cell(rec.row, 'how_late')),
        hay: hayOf([...recordWords(rec), phone, phone ? formatPhoneDisplay(phone) : '', rec.callKey, call?.who.name ?? '']),
        digits: digitsOf([...recordPhones(rec), call?.call.caller.phone ?? '']),
      }
    })
  }

  /* screens no call in the index carries */
  const looseScreens: ScreenItem[] | null = screens
    ? screens
        .filter((sc) => !sc.callKey || !callByKey.has(sc.callKey))
        .map((sc) => {
          const name = cell(sc.candidate, 'name')
          return {
            type: 'screen',
            key: sc.key,
            screen: sc,
            who: name || 'Candidate not on file',
            preview: firstSentence(cell(sc.row, 'notes')),
            hay: hayOf([name, cell(sc.row, 'final_result'), cell(sc.row, 'qualification'), cell(sc.row, 'notes'), cell(sc.candidate, 'stage')]),
            digits: digitsOf([cell(sc.candidate, 'phone')]),
          }
        })
    : null

  const byKey = new Map<string, Item>()
  for (const c of callItems) byKey.set(c.key, c)
  for (const lane of LANE_IDS) for (const r of lanes[lane] ?? []) byKey.set(r.key, r)
  for (const s of looseScreens ?? []) byKey.set(s.key, s)

  const screeningCalls = callItems.filter((c) => c.call.line_key === 'screening')
  const screeningTab: Item[] | null = index || looseScreens
    ? [...screeningCalls, ...(looseScreens ?? [])].sort((a, b) => sortMs(b) - sortMs(a))
    : null

  return {
    calls: callItems,
    lanes,
    looseScreens,
    byKey,
    tabs: {
      calls: index ? callItems : null,
      calloffs: lanes.calloffs,
      queue: lanes.queue,
      notes: lanes.notes,
      incidents: lanes.incidents,
      screening: screeningTab,
    },
  }
}

/** The DOM id of a list row — how the page brings a row back into view. */
export const rowDomId = (key: string) => `hotline-row-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`

/** One comparable number for any item: its Ohio wall clock. */
export function sortMs(item: Item): number {
  const st = item.type === 'call' ? item.stamp : item.type === 'record' ? item.rec.stamp : item.screen.stamp
  return st ? st.sort : -Infinity
}

export function stampOf(item: Item): Stamp | null {
  return item.type === 'call' ? item.stamp : item.type === 'record' ? item.rec.stamp : item.screen.stamp
}

// ------------------------------------------------------------------ chips and search…

// The chip values an item answers to on a tab — cut from the data itself.
export function chipsFor(tab: TabId, item: Item, screensRead = true): string[] {
  if (tab === 'calls' && item.type === 'call') {
    const out: string[] = [LINE[item.call.line_key].label]
    const st = shownState(item.call.hotline)
    if (st === 'waiting' || st === 'filing' || st === 'blocked' || st === 'held' || st === 'unlogged') out.push(STATE[st].label)
    return out
  }
  if (tab === 'screening') {
    if (item.type === 'call') {
      return [cell(item.screen?.row, 'final_result') || (item.screen ? 'No result written' : screensRead ? 'No screen filed' : 'Screen not known')]
    }
    if (item.type === 'screen') return [cell(item.screen.row, 'final_result') || 'No result written']
    return []
  }
  // THE INCIDENTS TAB ALSO CHIPS ON THE WORD OHIO USES — the half of the removed reports tab that was worth keeping.
  if (tab === 'incidents' && item.type === 'record' && item.rec.lane === 'incidents') {
    const category = cell(item.rec.row, CHIP_FIELD.incidents)
    const c = category.toLowerCase()
    const severity = /\bmui\b|major unusual/.test(c) ? 'MUI'
      : /\bui\b|unusual/.test(c) ? 'UI' : ''
    return [severity, category || 'Not typed'].filter(Boolean)
  }
  if (item.type === 'record' && item.rec.lane === tab) {
    return [cell(item.rec.row, CHIP_FIELD[tab]) || 'Not typed']
  }
  return []
}

// Does an item answer a search?
export function matchesSearch(item: Item, needle: string): boolean {
  const q = needle.trim().toLowerCase()
  if (!q) return true
  if (/^[\d\s()+.-]+$/.test(q)) {
    const d = q.replace(/\D/g, '')
    if (d.length >= 3) return item.digits.includes(d)
  }
  return q.split(/\s+/).every((w) => item.hay.includes(w))
}

// ------------------------------------------------------------------ the hero's arithmetic…

export type LineStats = { today: number; week: number; lastMs: number | null; total: number }

export type HeroStats = {
  /** null for a line this session does not read — never a line of zeros */
  lines: Record<LineKey, LineStats | null>
  // `count` null is "not known": the screens behind Screening were not read, or the screening line is not open to…
  mix: { modality: Modality; count: number | null }[]
  /** the known counts only */
  mixTotal: number
  /** calls not filed yet — waiting for the read, or being filed right now */
  waiting: number
}

export function heroStats(
  calls: CallItem[],
  today: string,
  reads: { screensRead: boolean; screening: ScreeningAccess },
): HeroStats {
  const lines: Record<LineKey, LineStats | null> = {
    hotline: { today: 0, week: 0, lastMs: null, total: 0 },
    screening: reads.screening === 'open' ? { today: 0, week: 0, lastMs: null, total: 0 } : null,
  }
  const mix = new Map<Modality, number>()
  let waiting = 0
  for (const c of calls) {
    const l = lines[c.call.line_key]
    if (!l) continue
    l.total += 1
    const ms = Date.parse(c.call.at)
    if (Number.isFinite(ms) && (l.lastMs === null || ms > l.lastMs)) l.lastMs = ms
    const st = shownState(c.call.hotline)
    if (st === 'waiting' || st === 'filing') waiting += 1
    const ago = c.stamp ? daysBefore(today, c.stamp.day) : null
    if (ago === null || ago < 0) continue
    if (ago === 0) l.today += 1
    if (ago <= 6) l.week += 1
    if (ago <= 29) for (const m of c.modalities) mix.set(m, (mix.get(m) ?? 0) + 1)
  }
  const screeningKnown = reads.screensRead && reads.screening === 'open'
  const list = MODALITIES.map((m) => ({
    modality: m,
    count: m === 'screening' && !screeningKnown ? null : mix.get(m) ?? 0,
  }))
  return { lines, mix: list, mixTotal: list.reduce((a, b) => a + (b.count ?? 0), 0), waiting }
}
