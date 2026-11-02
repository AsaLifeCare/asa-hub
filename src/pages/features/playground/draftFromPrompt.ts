// DRAFT FROM PROMPT — the no-AI lane, for when automatic app creation has no model behind it and still has to work.
// When every model in the rotation refuses (or the backend cannot be reached), "Describe your app" still delivers…
import type { PageType } from '@/engine/types'
import { playgroundSlug } from '@/stores/usePlaygroundStore'
import { generateRows } from './generate'

type Obj = Record<string, unknown>

export type LocalDraft = {
  name: string
  tagline: string
  icon: string
  accent: string
  category: string
  pages: { id: string; type: string; title: string; config: Obj; rows: Obj[] }[]
}

/* ---------------- words → meaning ---------------- */

/** First match wins — order is the priority when a phrase names two things. */
const TYPE_RULES: [RegExp, PageType][] = [
  [/check ?list|inspection|opening|closing|walkthrough/i, 'checklist'],
  [/schedule|shift|calendar|appointment|booking|rota\b/i, 'schedule'],
  [/pipeline|deal|lead|funnel|sales|prospect/i, 'pipeline'],
  [/kanban|board|task|to-?do|ticket|backlog/i, 'board'],
  [/document|policy|policies|playbook|handbook|library|manual|guide/i, 'documents'],
  [/video|training|course|academy|tutorial|lesson/i, 'videos'],
  [/photo|gallery|image|album|picture/i, 'gallery'],
  [/timeline|history|activity|changelog|audit/i, 'timeline'],
  [/director(y|ies)|profile|people|staff|member|client|resident|employee/i, 'detail'],
  [/dashboard|overview|kpi|metric|summary|scorecard/i, 'dashboard'],
]

const typeFor = (phrase: string): PageType => {
  for (const [re, t] of TYPE_RULES) if (re.test(phrase)) return t
  return 'sheet'
}

/** Sheet column packs per domain — kinds follow the sheet vocabulary. */
const SHEET_PACKS: [RegExp, Obj[]][] = [
  [/fleet|vehicle|van|car|truck|mileage/i, [
    { key: 'name', label: 'Vehicle', kind: 'text' },
    { key: 'plate', label: 'Plate', kind: 'text' },
    { key: 'driver', label: 'Driver', kind: 'avatar+text', subKey: 'role' },
    { key: 'mileage', label: 'Mileage', kind: 'number' },
    { key: 'status', label: 'Status', kind: 'chip', tintBy: { Active: 'mint', 'In shop': 'amber', Retired: 'slate' } },
  ]],
  [/maintenance|repair|work ?order|fix/i, [
    { key: 'name', label: 'Item', kind: 'text' },
    { key: 'location', label: 'Location', kind: 'text' },
    { key: 'priority', label: 'Priority', kind: 'chip', tintBy: { High: 'pink', Normal: 'blue', Low: 'slate' } },
    { key: 'due', label: 'Due', kind: 'date' },
    { key: 'status', label: 'Status', kind: 'chip', tintBy: { Open: 'amber', 'In progress': 'blue', Done: 'mint' } },
  ]],
  [/inventory|suppl|stock|pantry|grocery/i, [
    { key: 'name', label: 'Item', kind: 'text' },
    { key: 'category', label: 'Category', kind: 'chip', tintBy: { Food: 'mint', Cleaning: 'blue', Office: 'lavender', Medical: 'pink' } },
    { key: 'onHand', label: 'On hand', kind: 'number' },
    { key: 'reorderAt', label: 'Reorder at', kind: 'number' },
    { key: 'updated', label: 'Updated', kind: 'date' },
  ]],
  [/expense|purchase|invoice|budget|payment|spend/i, [
    { key: 'name', label: 'Expense', kind: 'text' },
    { key: 'vendor', label: 'Vendor', kind: 'text' },
    { key: 'amount', label: 'Amount', kind: 'number' },
    { key: 'date', label: 'Date', kind: 'date' },
    { key: 'status', label: 'Status', kind: 'chip', tintBy: { Pending: 'amber', Approved: 'mint', Rejected: 'pink' } },
  ]],
  [/visitor|guest|sign-?in/i, [
    { key: 'name', label: 'Visitor', kind: 'avatar+text', subKey: 'company' },
    { key: 'host', label: 'Host', kind: 'text' },
    { key: 'date', label: 'Date', kind: 'date' },
    { key: 'purpose', label: 'Purpose', kind: 'text' },
    { key: 'status', label: 'Status', kind: 'chip', tintBy: { Expected: 'blue', 'On site': 'mint', Left: 'slate' } },
  ]],
  [/incident|accident|safety|hazard/i, [
    { key: 'name', label: 'Incident', kind: 'text' },
    { key: 'location', label: 'Location', kind: 'text' },
    { key: 'severity', label: 'Severity', kind: 'chip', tintBy: { High: 'pink', Medium: 'amber', Low: 'blue' } },
    { key: 'date', label: 'Date', kind: 'date' },
    { key: 'status', label: 'Status', kind: 'chip', tintBy: { Open: 'amber', Reviewing: 'blue', Closed: 'mint' } },
  ]],
  [/fridge|freezer|temperature|temp\b/i, [
    { key: 'name', label: 'Unit', kind: 'text' },
    { key: 'location', label: 'Location', kind: 'text' },
    { key: 'reading', label: 'Reading °C', kind: 'number' },
    { key: 'at', label: 'Logged', kind: 'date' },
    { key: 'status', label: 'Status', kind: 'chip', tintBy: { OK: 'mint', Watch: 'amber', Alarm: 'pink' } },
  ]],
]

const GENERIC_PACK: Obj[] = [
  { key: 'name', label: 'Name', kind: 'avatar+text', subKey: 'detail' },
  { key: 'category', label: 'Category', kind: 'chip', tintBy: { General: 'blue', Priority: 'amber', Archived: 'slate' } },
  { key: 'owner', label: 'Owner', kind: 'text' },
  { key: 'due', label: 'Due', kind: 'date' },
  { key: 'status', label: 'Status', kind: 'chip', tintBy: { Active: 'mint', Paused: 'amber', Done: 'blue' } },
]

const sheetColumns = (phrase: string): Obj[] => {
  for (const [re, pack] of SHEET_PACKS) if (re.test(phrase)) return pack
  return GENERIC_PACK
}

/* ---------------- identity ---------------- */

const ICON_RULES: [RegExp, string][] = [
  [/fleet|vehicle|truck|van|car|mileage/i, 'truck'],
  [/maintenance|repair|fix/i, 'wrench'],
  [/clean|check ?list|inspection/i, 'clipboard-check'],
  [/incident|safety|alert/i, 'megaphone'],
  [/training|academy|course|lesson/i, 'graduation-cap'],
  [/expense|budget|money|invoice|purchase/i, 'wallet'],
  [/people|staff|team|visitor|client|member/i, 'users'],
  [/schedule|shift|calendar|appointment/i, 'calendar'],
  [/document|policy|library|handbook/i, 'book-open'],
  [/photo|gallery|image/i, 'image'],
  [/video/i, 'video'],
  [/board|kanban|task/i, 'square-kanban'],
  [/pipeline|sales|deal/i, 'columns-3'],
  [/inventory|suppl|stock|package/i, 'package'],
  [/health|med|care/i, 'heart-pulse'],
  [/map|site|property|house/i, 'map-pin'],
]

const CATEGORIES: [RegExp, string][] = [
  [/fleet|vehicle|maintenance|clean|fridge|inventory|suppl|safety|incident|visitor|key/i, 'Operations'],
  [/expense|invoice|budget|purchase|payment/i, 'Finance'],
  [/staff|people|training|hiring|team|member/i, 'People'],
  [/sales|deal|lead|pipeline|client/i, 'Sales'],
]

const TINTS = ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber']

const titleCase = (s: string): string =>
  s.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
    .map((w) => (w.length > 2 || /^[^a-z]*$/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')

/** "a fleet tracker" → "Fleet Tracker"; articles and filler lead words go. */
const cleanHead = (s: string): string =>
  s.trim().replace(/^(?:i (?:want|need)|please|make|create|build|give me)\s+/i, '')
    .replace(/^(?:an?|the|my|our)\s+/i, '')
    .replace(/[.!?\s]+$/, '')

/* ---------------- the generator ---------------- */

// One sentence → a whole draft.
export function draftFromPrompt(prompt: string): LocalDraft {
  const text = prompt.trim().replace(/\s+/g, ' ')
  // the head names the app; everything after a joining word describes pages
  const [headRaw, ...tailParts] = text.split(/\b(?:with|that|for|featuring|including|to track|to manage)\b/i)
  const head = cleanHead(headRaw || '')
  const name = titleCase(head.split(' ').slice(0, 5).join(' ')) || 'Custom app'

  const featureText = tailParts.join(' ')
  const features = (featureText ? featureText.split(/,|;|\band\b/i) : [])
    .map((f) => cleanHead(f.replace(/^(?:a|an|the|some)\s+/i, ''))
      .replace(/\b(?:pages?|sections?|tabs?|lists?|views?)\b/i, '')
      .trim())
    .filter((f) => f.length > 1)
    .slice(0, 4)
  if (!features.length) features.push(head || 'overview')

  const used = new Set<string>()
  const pages = features.map((feature, i) => {
    const type = typeFor(feature)
    let id = playgroundSlug(feature.toLowerCase().replace(/\s+/g, '-').slice(0, 30) || `page-${i + 1}`)
    while (used.has(id)) id = `${id}-${i + 1}`
    used.add(id)
    const config = configFor(type, feature, name)
    return {
      id,
      type,
      title: titleCase(feature.split(' ').slice(0, 4).join(' ')) || `Page ${i + 1}`,
      config,
      rows: generateRows(type, config),
    }
  })

  const whole = text
  const icon = (ICON_RULES.find(([re]) => re.test(whole)) ?? [null, 'rocket'])[1] as string
  const category = (CATEGORIES.find(([re]) => re.test(whole)) ?? [null, 'Workspace'])[1] as string
  let hash = 0
  for (let i = 0; i < whole.length; i++) hash = (hash * 31 + whole.charCodeAt(i)) >>> 0

  return {
    name,
    tagline: `One calm place for ${(head || 'everything').toLowerCase()}.`,
    icon,
    accent: TINTS[hash % TINTS.length],
    category,
    pages,
  }
}

/* ---------------- per-type minimal configs ---------------- */

// Just enough config for the template to mount and for generateRows to fill believable rows — the same vocabularies…
function configFor(type: PageType, feature: string, appName: string): Obj {
  switch (type) {
    case 'sheet':
      return {
        entity: [feature.toLowerCase().replace(/\s+$/, ''), `${feature.toLowerCase()}s`],
        searchable: true,
        selectable: true,
        columns: sheetColumns(feature),
      }
    case 'pipeline':
      return {
        stageField: 'stage',
        stages: [
          { id: 'new', label: 'New', tint: 'blue' },
          { id: 'qualified', label: 'Qualified', tint: 'lavender' },
          { id: 'proposal', label: 'Proposal', tint: 'amber' },
          { id: 'won', label: 'Won', tint: 'mint' },
        ],
        cardFields: {
          title: 'name',
          subtitle: 'company',
          tags: { key: 'source', tintBy: { Inbound: 'mint', Referral: 'amber', Event: 'lavender', Outbound: 'blue' } },
          meta: ['daysInStage'],
          score: { key: 'score', max: 5 },
        },
      }
    case 'board':
      return {
        stageField: 'column',
        stages: [
          { id: 'backlog', label: 'Backlog', tint: 'slate' },
          { id: 'doing', label: 'Doing', tint: 'blue' },
          { id: 'review', label: 'Review', tint: 'amber' },
          { id: 'done', label: 'Done', tint: 'mint' },
        ],
        cardFields: { title: 'title', tags: { key: 'priority', tintBy: { high: 'pink', normal: 'blue', low: 'slate' } }, meta: ['due'] },
      }
    case 'checklist':
      return { groupKey: 'section', labelKey: 'item', noteKey: 'note', requiredKey: 'required' }
    case 'gallery':
      return { srcKey: 'src', titleKey: 'title', subtitleKey: 'subtitle', groupBy: 'kind', aspect: 'photo' }
    case 'timeline':
      return {
        timeKey: 'at', titleKey: 'title', bodyKey: 'detail', actorKey: 'actor', kindKey: 'kind',
        kindTints: { created: 'mint', updated: 'blue', note: 'amber' },
      }
    case 'documents':
      return {
        collections: [
          { id: 'guides', label: 'Guides', icon: 'book-open', tint: 'blue' },
          { id: 'policies', label: 'Policies', icon: 'clipboard-list', tint: 'lavender' },
        ],
      }
    case 'videos':
      return {
        channels: [
          { id: 'general', label: 'General', tint: 'blue' },
          { id: 'onboarding', label: 'Onboarding', tint: 'mint' },
        ],
      }
    case 'schedule':
      return {
        view: 'week',
        resources: [
          { id: 'r-1', name: 'Alex Rivera', role: 'Coordinator' },
          { id: 'r-2', name: 'Sam Lee', role: 'Specialist' },
          { id: 'r-3', name: 'Jo Patel', role: 'Lead' },
        ],
        eventTypes: {
          shift: { label: 'Shift', tint: 'blue' },
          visit: { label: 'Visit', tint: 'mint' },
          meeting: { label: 'Meeting', tint: 'lavender' },
        },
        timeRange: [8, 19],
        slotMinutes: 30,
      }
    case 'detail':
      return {
        header: {
          title: 'name', subtitle: 'role',
          statusChip: { field: 'status', tintBy: { Active: 'mint', Paused: 'amber', Done: 'blue' } },
        },
        stats: [
          { label: 'Projects', value: 'projects', icon: 'folder', tint: 'blue' },
          { label: 'Score', value: 'score', icon: 'star', tint: 'amber' },
        ],
        sections: [
          { kind: 'fields', title: 'Details', fields: [
            { label: 'Email', value: 'email' },
            { label: 'Location', value: 'location' },
            { label: 'Phone', value: 'phone', icon: 'phone' },
          ] },
        ],
      }
    case 'dashboard':
      return {
        greeting: { name: appName, subtitle: 'The week at a glance' },
        widgets: [
          { kind: 'stat', label: 'Active', value: 24, delta: '+3', tint: 'mint' },
          { kind: 'stat', label: 'Pending', value: 6, tint: 'amber' },
          { kind: 'ring', percent: 0.72, caption: 'Weekly goal' },
          { kind: 'bars', bars: [
            { label: 'Mon', value: 4, tint: 'blue' },
            { label: 'Tue', value: 7, tint: 'blue' },
            { label: 'Wed', value: 5, tint: 'blue' },
            { label: 'Thu', value: 9, tint: 'mint' },
            { label: 'Fri', value: 6, tint: 'mint' },
          ] },
          { kind: 'note', text: 'Drafted locally from your description — reshape anything in the builders.', tint: 'lavender' },
        ],
      }
  }
}
