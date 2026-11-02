// SAMPLE-ROW GENERATOR — "Generate rows" for the SAMPLE DATA editor.
// Deterministic on purpose: the same config always yields the same rows, so regenerating is boring (a feature…
import { addDays, format } from 'date-fns'
import type { PageType } from '@/engine/types'
import { animalPhoto } from '@/lib/animals'

const isoDay = (offset: number) => format(addDays(new Date(), offset), 'yyyy-MM-dd')
const isoNow = (offset: number) => addDays(new Date(), offset).toISOString()

/* ---------------- fixed pools (deterministic: index, never random) ---------------- */

const PEOPLE = ['Alex Rivera', 'Sam Lee', 'Jo Patel', 'Maya Chen', 'Chris Young', 'Pat Morgan', 'Taylor Brooks', 'Jordan Diaz']
const ROLES = ['Coordinator', 'Specialist', 'Lead', 'Reviewer', 'Manager', 'Analyst', 'Trainer', 'Mentor']
const PROJECTS = ['Alpha project', 'Beta rollout', 'Gamma research', 'Delta launch', 'Epsilon pilot', 'Zeta review', 'Eta migration', 'Theta refresh']
const COMPANIES = ['Acme Co', 'Globex', 'Initech', 'Umbrella', 'Stark Industries', 'Wayne Labs', 'Hooli', 'Massive Dynamic']
const DEALS = ['Acme rollout', 'Globex expansion', 'Initech pilot', 'Umbrella deal', 'Stark contract', 'Wayne licence', 'Hooli renewal', 'Massive rollout']
const WORDS = ['Planning', 'Hiring', 'Budgets', 'Training', 'Logistics', 'Outreach', 'Quality', 'Compliance']
const TASKS = ['Draft launch checklist', 'Wire the data feed', 'Polish empty states', 'Review schema docs', 'Ship v0.1.0', 'Book the venue', 'Confirm headcount', 'Archive old records']
const SOURCES = ['Inbound', 'Referral', 'Event', 'Outbound']
const STATUSES = ['Active', 'Paused', 'Done']
const CITIES = ['Austin, TX', 'Denver, CO', 'Portland, OR', 'Columbus, OH', 'Miami, FL', 'Boise, ID']
const CHECK_ITEMS = ['Fridge temperature logged', 'No expired stock', 'Exits clear', 'Supplies stocked', 'Logbook signed', 'Lights and locks checked', 'First-aid kit complete', 'Floors dry']
const CHECK_GROUPS = ['Opening', 'Closing', 'Weekly']
const EVENTS = ['Record created', 'Document verified', 'Note added', 'Status updated', 'File returned', 'Review completed']
const EVENT_DETAILS = [
  'Added from the intake form',
  'CPR / First Aid, expires in 24 months',
  'Left a voice note for the team',
  'Moved forward after the review call',
  'Photo was too dark to read the date',
  'Signed off by the coordinator',
]
const DOC_TITLES = ['Getting Started Guide', 'Remote Work Policy', 'Hiring Playbook', 'Incident Response Runbook']
const DOC_EXCERPTS = [
  'Everything a new teammate needs in week one.',
  'Where we work, core hours, and how we stay in sync.',
  'Scorecards, interview loops and debriefs.',
  'Severity levels and comms templates for bad days.',
]
const VIDEO_TITLES = ['Welcome: your first week', 'Setting up your profile', 'Reading the activity dashboard', 'Running a great interview loop']
const VIDEO_DESCS = [
  'A friendly tour of the workspace.',
  'Tune the bell, the badge and dark mode.',
  'KPIs, trends and the weekly goal ring.',
  'Scorecards, debriefs and groupthink.',
]
const SCHED_EVENTS = ['Morning shift', 'Team sync', 'Client visit', 'Evening shift', 'Planning meeting', 'Site walkthrough']
const START_TIMES = ['08:30', '10:00', '11:00', '13:00', '14:00', '15:30']
const DURATIONS = [240, 45, 120, 300, 60, 90]
const GALLERY_TITLES = ['Front of the house', 'Team headshot', 'Brand banner', 'Back garden', 'Group photo', 'Event poster']
const GALLERY_GROUPS = ['scene', 'avatar', 'cover']
const IMAGES = [
  '/assets/library/houses/placeholder.jpg',
  '/assets/library/animals/cat.jpg',
  '/assets/app-hero.svg',
  '/assets/docs/cover-01.jpg',
  '/assets/library/animals/dog.jpg',
  '/assets/docs/cover-02.jpg',
]

const avatar = (i: number) => animalPhoto(i)
const cycle = <T,>(pool: readonly T[], i: number): T => pool[i % pool.length]
const pickSome = <T,>(pool: readonly T[], i: number, n: number): T[] =>
  Array.from({ length: n }, (_, k) => pool[(i + k) % pool.length])

/** Best-guess scalar for an arbitrary key name — the detail/sheet fallback. */
function valueForKey(key: string, i: number): unknown {
  const k = key.toLowerCase()
  if (/avatar|photo/.test(k)) return avatar(i)
  if (/email/.test(k)) return `${PEOPLE[i % PEOPLE.length].split(' ')[0].toLowerCase()}@example.com`
  if (/location|city|address/.test(k)) return cycle(CITIES, i)
  if (/date|^at$|updated|started|due/.test(k)) return isoDay(-(i * 2 + 1))
  if (/phone/.test(k)) return `555-01${String(i).padStart(2, '0')}`
  if (/owner|assignee|person|actor|author|name/.test(k)) return cycle(PEOPLE, i)
  if (/role|title|position/.test(k)) return cycle(ROLES, i)
  if (/score|rating/.test(k)) return Math.round((3.5 + (i % 3) * 0.5) * 10) / 10
  if (/count|num|projects|tasks|months|days|score|value|amount/.test(k)) return ((i * 13) % 90) + 4
  return cycle(WORDS, i)
}

/* ---------------- per-template generators ---------------- */

type Obj = Record<string, unknown>
const asObj = (v: unknown): Obj => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const asArr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const s = (v: unknown, fb: string) => (typeof v === 'string' && v ? v : fb)

function sheetRows(config: Obj): Obj[] {
  const cols = asArr<Obj>(config.columns)
  return Array.from({ length: 6 }, (_, i) => {
    const row: Obj = { id: `row-${i + 1}` }
    for (const c of cols) {
      const key = s(c.key, '')
      if (!key) continue
      switch (c.kind) {
        case 'avatar+text':
          row[key] = cycle(PEOPLE, i)
          row.avatar = avatar(i)
          if (typeof c.subKey === 'string' && c.subKey) row[c.subKey] = cycle(ROLES, i)
          break
        case 'chip':
          row[key] = cycle(Object.keys(asObj(c.tintBy)).length ? Object.keys(asObj(c.tintBy)) : STATUSES, i)
          break
        case 'chips': {
          const pool = Object.keys(asObj(c.tintBy))
          row[key] = pickSome(pool.length ? pool : WORDS, i, 1 + (i % 3))
          break
        }
        case 'date':
          row[key] = isoDay(-(i * 2 + 1))
          break
        case 'number':
          row[key] = ((i * 37) % 90) + 5
          break
        case 'progress':
          row[key] = Math.round(((i * 0.17 + 0.15) % 0.9) * 100) / 100
          break
        case 'image':
          row[key] = cycle(IMAGES, i)
          break
        case 'doc':
          row[key] = `document-${i + 1}.pdf`
          break
        default:
          row[key] = valueForKey(key, i)
      }
    }
    return row
  })
}

function stageIds(config: Obj, fallback: string[]): string[] {
  const ids = asArr<Obj>(config.stages).map((x) => s(x.id, '')).filter(Boolean)
  return ids.length ? ids : fallback
}

function pipelineRows(config: Obj): Obj[] {
  const cf = asObj(config.cardFields)
  const tags = asObj(cf.tags)
  const score = asObj(cf.score)
  const stageField = s(config.stageField, 'stage')
  const stages = stageIds(config, ['new', 'qualified', 'proposal', 'won'])
  const tagPool = Object.keys(asObj(tags.tintBy))
  const max = typeof score.max === 'number' ? score.max : 5
  return Array.from({ length: 6 }, (_, i) => {
    const row: Obj = { id: `row-${i + 1}`, [stageField]: cycle(stages, i) }
    row[s(cf.title, 'name')] = cycle(DEALS, i)
    if (cf.subtitle) row[s(cf.subtitle, 'company')] = cycle(COMPANIES, i)
    if (tags.key) row[s(tags.key, 'source')] = cycle(tagPool.length ? tagPool : SOURCES, i)
    for (const m of asArr<string>(cf.meta)) row[m] = m === 'daysInStage' ? i + 1 : cycle(WORDS, i)
    if (score.key) row[s(score.key, 'score')] = (i % max) + 1
    return row
  })
}

function boardRows(config: Obj): Obj[] {
  const stageField = s(config.stageField, 'column')
  const stages = stageIds(config, ['backlog', 'doing', 'review', 'done'])
  const priorities = ['high', 'normal', 'low']
  return Array.from({ length: 5 }, (_, i) => ({
    id: `row-${i + 1}`,
    title: cycle(TASKS, i),
    [stageField]: cycle(stages, i),
    priority: cycle(priorities, i),
    due: isoDay(i + 1),
    assignee: cycle(PEOPLE, i),
    avatar: avatar(i),
  }))
}

function dashboardRows(): Obj[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `row-${i + 1}`,
    name: cycle(PROJECTS, i),
    status: cycle(STATUSES, i),
    owner: cycle(PEOPLE, i),
    updated: isoDay(-(i + 1)),
    score: (i % 5) + 1,
  }))
}

function detailRows(config: Obj): Obj[] {
  const header = asObj(config.header)
  const chip = asObj(header.statusChip)
  const chipPool = Object.keys(asObj(chip.tintBy))
  return Array.from({ length: 5 }, (_, i) => {
    const row: Obj = { id: `row-${i + 1}` }
    row[s(header.title, 'name')] = cycle(PEOPLE, i)
    if (header.subtitle) row[s(header.subtitle, 'role')] = cycle(ROLES, i)
    if (typeof header.avatar === 'string' && header.avatar && header.avatar !== 'initials') row[header.avatar] = avatar(i)
    if (chip.field) row[s(chip.field, 'status')] = cycle(chipPool.length ? chipPool : STATUSES, i)
    for (const st of asArr<Obj>(config.stats)) {
      const key = s(st.value, '')
      if (key) row[key] = valueForKey(key, i)
    }
    for (const sec of asArr<Obj>(config.sections)) {
      if (sec.kind === 'fields') {
        for (const f of asArr<Obj>(sec.fields)) {
          const key = s(f.value, '')
          if (key) row[key] = valueForKey(key, i)
        }
      } else if (sec.kind === 'chips' || sec.kind === 'list') {
        const key = s(sec.itemsField, '')
        if (key) row[key] = pickSome(WORDS, i, 2 + (i % 2))
      } else if (sec.kind === 'timeline') {
        const key = s(sec.entriesField, '')
        if (key) row[key] = pickSome(EVENTS, i, 2).map((t, k) => ({ at: isoDay(-(k + 1)), title: t, detail: cycle(EVENT_DETAILS, i + k) }))
      }
    }
    return row
  })
}

function galleryRows(config: Obj): Obj[] {
  const srcKey = s(config.srcKey, 'src')
  const titleKey = s(config.titleKey, 'title')
  const subtitleKey = s(config.subtitleKey, '')
  const groupBy = s(config.groupBy, '')
  return Array.from({ length: 6 }, (_, i) => {
    const row: Obj = { id: `row-${i + 1}`, [srcKey]: cycle(IMAGES, i), [titleKey]: cycle(GALLERY_TITLES, i) }
    if (subtitleKey) row[subtitleKey] = i % 2 ? cycle(PEOPLE, i) : ''
    if (groupBy) row[groupBy] = cycle(GALLERY_GROUPS, i)
    return row
  })
}

function checklistRows(config: Obj): Obj[] {
  return Array.from({ length: 6 }, (_, i) => ({
    id: `row-${i + 1}`,
    [s(config.groupKey, 'section')]: cycle(CHECK_GROUPS, Math.floor(i / 2)),
    [s(config.labelKey, 'item')]: cycle(CHECK_ITEMS, i),
    [s(config.noteKey, 'note')]: i % 3 === 0 ? 'See the log by the door' : '',
    [s(config.requiredKey, 'required')]: i % 4 === 3 ? 'no' : 'yes',
  }))
}

function timelineRows(config: Obj): Obj[] {
  const kindPool = Object.keys(asObj(config.kindTints))
  return Array.from({ length: 6 }, (_, i) => ({
    id: `row-${i + 1}`,
    [s(config.timeKey, 'at')]: isoDay(-i),
    [s(config.titleKey, 'title')]: cycle(EVENTS, i),
    [s(config.bodyKey, 'detail')]: cycle(EVENT_DETAILS, i),
    [s(config.actorKey, 'actor')]: cycle(PEOPLE, i),
    [s(config.kindKey, 'kind')]: cycle(kindPool.length ? kindPool : ['created', 'updated', 'note'], i),
  }))
}

function documentsRows(config: Obj): Obj[] {
  const collections = asArr<Obj>(config.collections).map((c) => s(c.id, '')).filter(Boolean)
  const pool = collections.length ? collections : ['guides']
  return Array.from({ length: 5 }, (_, i) => ({
    id: `row-${i + 1}`,
    title: cycle(DOC_TITLES, i),
    excerpt: cycle(DOC_EXCERPTS, i),
    collection: cycle(pool, i),
    cover: `/assets/docs/cover-0${(i % 4) + 1}.jpg`,
    authorIds: [],
    updatedAt: isoNow(-i),
    readMinutes: 4 + i,
    body: [
      { kind: 'h2', text: 'Overview', id: 'overview' },
      { kind: 'p', text: cycle(DOC_EXCERPTS, i) },
    ],
  }))
}

function videosRows(config: Obj): Obj[] {
  const channels = asArr<Obj>(config.channels).map((c) => s(c.id, '')).filter(Boolean)
  const pool = channels.length ? channels : ['general']
  return Array.from({ length: 5 }, (_, i) => ({
    id: `row-${i + 1}`,
    title: cycle(VIDEO_TITLES, i),
    channel: cycle(pool, i),
    thumb: `/assets/videos/thumb-0${(i % 6) + 1}.jpg`,
    durationSec: 300 + i * 120,
    views: 1200 - i * 250,
    watched: (i % 4) / 4,
    publishedAt: isoNow(-i),
    description: cycle(VIDEO_DESCS, i),
  }))
}

function scheduleRows(config: Obj): Obj[] {
  const resources = asArr<Obj>(config.resources).map((r) => s(r.id, '')).filter(Boolean)
  const resPool = resources.length ? resources : ['r-1']
  const typePool = Object.keys(asObj(config.eventTypes))
  const types = typePool.length ? typePool : ['shift']
  return Array.from({ length: 6 }, (_, i) => ({
    id: `row-${i + 1}`,
    title: cycle(SCHED_EVENTS, i),
    personId: cycle(resPool, i),
    date: isoDay(i % 4),
    start: cycle(START_TIMES, i),
    durationMin: cycle(DURATIONS, i),
    type: cycle(types, i),
    attendees: i % 2 ? [cycle(resPool, i + 1)] : [],
  }))
}

// 4–8 plausible rows for the page type, shaped from the current config.
export function generateRows(type: PageType, config: Obj): Obj[] {
  switch (type) {
    case 'sheet':
      return sheetRows(config)
    case 'pipeline':
      return pipelineRows(config)
    case 'board':
      return boardRows(config)
    case 'dashboard':
      return dashboardRows()
    case 'detail':
      return detailRows(config)
    case 'gallery':
      return galleryRows(config)
    case 'checklist':
      return checklistRows(config)
    case 'timeline':
      return timelineRows(config)
    case 'documents':
      return documentsRows(config)
    case 'videos':
      return videosRows(config)
    case 'schedule':
      return scheduleRows(config)
  }
}
