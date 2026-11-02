// Playground starters — a sensible config + 4-6 sample rows per page type.
// Prefills the PAGE SCHEMA and SAMPLE DATA editors whenever the admin picks a type (until they edit by hand).
import { addDays, format } from 'date-fns'
import type { PageType } from '@/engine/types'

const isoDay = (offset: number) => format(addDays(new Date(), offset), 'yyyy-MM-dd')

export const PAGE_TYPES: { id: PageType; label: string; hint: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', hint: 'Modular widget grid — stats, charts, lists', icon: 'layout-dashboard' },
  { id: 'sheet', label: 'Sheet', hint: 'Searchable, sortable record table', icon: 'table' },
  { id: 'pipeline', label: 'Pipeline', hint: 'Vertical funnel kanban with stages', icon: 'square-kanban' },
  { id: 'documents', label: 'Documents', hint: 'Doc library + immersive reader', icon: 'book-open' },
  { id: 'videos', label: 'Videos', hint: 'Media library with progress', icon: 'play' },
  { id: 'schedule', label: 'Schedule', hint: 'Week/month calendar grid', icon: 'calendar-days' },
  { id: 'board', label: 'Board', hint: 'Horizontal kanban columns', icon: 'columns-3' },
  { id: 'detail', label: 'Detail', hint: 'Profile/record panel (first row)', icon: 'id-card' },
  { id: 'gallery', label: 'Gallery', hint: 'Photo grid with a lightbox', icon: 'images' },
  { id: 'checklist', label: 'Checklist', hint: 'Walk through it and tick it off', icon: 'list-checks' },
  { id: 'timeline', label: 'Timeline', hint: 'Events in time order, by day', icon: 'history' },
]

export const STARTER_CONFIGS: Record<PageType, Record<string, unknown>> = {
  dashboard: {
    greeting: { name: 'there', subtitle: 'A first look at your new app.' },
    widgets: [
      { kind: 'stat', label: 'Records', value: '4', delta: '+2', deltaLabel: 'this week', tint: 'mint', spark: [2, 3, 3, 4, 4, 5, 6] },
      { kind: 'ring', title: 'Weekly goal', percent: 68, tint: 'lavender', caption: 'of target' },
      { kind: 'donut', title: 'By status', slices: [
        { label: 'Active', value: 3, tint: 'mint' },
        { label: 'Paused', value: 1, tint: 'amber' },
      ], centerLabel: 'rows' },
      { kind: 'note', title: 'Remember', tint: 'peach', text: 'Feed this page from an automation when you are ready.' },
    ],
  },
  sheet: {
    entity: ['record', 'records'],
    searchable: true,
    selectable: true,
    densityToggle: true,
    columns: [
      { key: 'name', label: 'Name', kind: 'avatar+text', subKey: 'role' },
      { key: 'status', label: 'Status', kind: 'chip', tintBy: { Active: 'mint', Paused: 'amber', Done: 'blue' } },
      { key: 'owner', label: 'Owner', kind: 'text' },
      { key: 'updated', label: 'Updated', kind: 'date' },
      { key: 'score', label: 'Score', kind: 'number' },
    ],
  },
  pipeline: {
    entity: 'deals',
    stageField: 'stage',
    showRail: true,
    showSummary: true,
    stages: [
      { id: 'new', label: 'New', tint: 'blue', description: 'Fresh in — needs triage' },
      { id: 'qualified', label: 'Qualified', tint: 'lavender', description: 'Worth pursuing' },
      { id: 'proposal', label: 'Proposal', tint: 'amber', description: 'Numbers on the table' },
      { id: 'won', label: 'Won', tint: 'mint', description: 'Signed — celebrate', celebrate: true },
    ],
    cardFields: {
      title: 'name',
      subtitle: 'company',
      tags: { key: 'source', tintBy: { Referral: 'mint', Inbound: 'blue', Event: 'peach' } },
      meta: ['daysInStage'],
      score: { key: 'score', max: 5 },
    },
  },
  documents: {
    cardStyle: 'cover',
    collections: [
      { id: 'guides', label: 'Guides', icon: 'book-open', tint: 'mint' },
      { id: 'policies', label: 'Policies', icon: 'shield', tint: 'peach' },
    ],
    reader: { showToc: true, showMeta: true, allowPrint: true },
  },
  videos: {
    featuredId: 'row-1',
    channels: [
      { id: 'onboarding', label: 'Onboarding', tint: 'mint' },
      { id: 'deep-dives', label: 'Deep dives', tint: 'lavender' },
    ],
    player: { showPlaylist: true, showProgress: true, autoplayNext: false },
  },
  schedule: {
    view: 'week',
    allowViews: ['week', 'month'],
    resources: [
      { id: 'r-1', name: 'Alex Rivera', avatar: '/assets/library/animals/cat.jpg', role: 'Coordinator' },
      { id: 'r-2', name: 'Sam Lee', avatar: '/assets/library/animals/dog.jpg', role: 'Specialist' },
      { id: 'r-3', name: 'Jo Patel', avatar: '/assets/library/animals/red-panda.jpg', role: 'Lead' },
    ],
    timeRange: [8, 19],
    slotMinutes: 30,
    eventTypes: {
      shift: { label: 'Shift', tint: 'mint' },
      meeting: { label: 'Meeting', tint: 'peach' },
      visit: { label: 'Visit', tint: 'blue' },
    },
    showMiniMonth: true,
    showNowLine: true,
  },
  board: {
    stageField: 'column',
    stages: [
      { id: 'backlog', label: 'Backlog', tint: 'lavender' },
      { id: 'doing', label: 'Doing', tint: 'amber' },
      { id: 'review', label: 'Review', tint: 'peach' },
      { id: 'done', label: 'Done', tint: 'mint' },
    ],
  },
  detail: {
    header: {
      title: 'name',
      subtitle: 'role',
      avatar: 'avatar',
      // the engine reads `statusChip` (detail/Header.tsx) — `chip` is a dead key
      statusChip: { field: 'status', tintBy: { Active: 'mint', Paused: 'amber' } },
    },
    stats: [
      // StatGrid renders a leading icon unconditionally — stats need `icon`
      { label: 'Projects', value: 'projects', icon: 'briefcase', tint: 'mint' },
      { label: 'Tasks done', value: 'tasksDone', icon: 'clipboard-check', tint: 'blue' },
      { label: 'Score', value: 'score', icon: 'star', tint: 'lavender' },
      { label: 'Tenure (mo)', value: 'tenureMonths', icon: 'clock', tint: 'peach' },
    ],
    sections: [
      { kind: 'fields', title: 'Details', fields: [
        { label: 'Email', value: 'email' },
        { label: 'Location', value: 'location' },
        { label: 'Started', value: 'startDate' },
      ] },
      // chips sections read `itemsField` (a record key holding the array)
      { kind: 'chips', title: 'Skills', itemsField: 'skills' },
    ],
  },
  gallery: {
    srcKey: 'src',
    titleKey: 'title',
    subtitleKey: 'assignedTo',
    groupBy: 'kind',
    aspect: 'photo',
    searchPlaceholder: 'Search images…',
  },
  checklist: {
    groupKey: 'section',
    labelKey: 'item',
    noteKey: 'note',
    requiredKey: 'required',
  },
  timeline: {
    timeKey: 'at',
    titleKey: 'title',
    bodyKey: 'detail',
    actorKey: 'actor',
    kindKey: 'kind',
    kindTints: { created: 'mint', updated: 'blue', issue: 'pink', note: 'lavender' },
  },
}

/** Fresh starter rows per type (schedule dates are relative to today). */
export function starterRows(type: PageType): Record<string, unknown>[] {
  switch (type) {
    case 'dashboard':
      return [
        { id: 'row-1', name: 'Alpha project', status: 'Active', owner: 'Alex Rivera', updated: isoDay(-1), score: 4 },
        { id: 'row-2', name: 'Beta rollout', status: 'Active', owner: 'Sam Lee', updated: isoDay(-2), score: 5 },
        { id: 'row-3', name: 'Gamma research', status: 'Paused', owner: 'Jo Patel', updated: isoDay(-4), score: 3 },
        { id: 'row-4', name: 'Delta launch', status: 'Active', owner: 'Alex Rivera', updated: isoDay(0), score: 4 },
      ]
    case 'sheet':
      return [
        { id: 'row-1', name: 'Alpha project', role: 'Rollout', status: 'Active', owner: 'Alex Rivera', updated: isoDay(-1), score: 4, avatar: '/assets/library/animals/cat.jpg' },
        { id: 'row-2', name: 'Beta rollout', role: 'Enablement', status: 'Done', owner: 'Sam Lee', updated: isoDay(-2), score: 5, avatar: '/assets/library/animals/dog.jpg' },
        { id: 'row-3', name: 'Gamma research', role: 'Discovery', status: 'Paused', owner: 'Jo Patel', updated: isoDay(-4), score: 3, avatar: '/assets/library/animals/red-panda.jpg' },
        { id: 'row-4', name: 'Delta launch', role: 'GA', status: 'Active', owner: 'Alex Rivera', updated: isoDay(-6), score: 4, avatar: '/assets/library/animals/fox.jpg' },
        { id: 'row-5', name: 'Epsilon pilot', role: 'Pilot', status: 'Active', owner: 'Sam Lee', updated: isoDay(0), score: 2, avatar: '/assets/library/animals/barn-owl.jpg' },
      ]
    case 'pipeline':
      return [
        { id: 'row-1', name: 'Acme rollout', company: 'Acme Co', stage: 'new', source: 'Inbound', daysInStage: 2, score: 3 },
        { id: 'row-2', name: 'Globex expansion', company: 'Globex', stage: 'qualified', source: 'Referral', daysInStage: 5, score: 4 },
        { id: 'row-3', name: 'Initech pilot', company: 'Initech', stage: 'qualified', source: 'Event', daysInStage: 9, score: 2 },
        { id: 'row-4', name: 'Umbrella deal', company: 'Umbrella', stage: 'proposal', source: 'Inbound', daysInStage: 3, score: 5 },
        { id: 'row-5', name: 'Stark contract', company: 'Stark Industries', stage: 'won', source: 'Referral', daysInStage: 1, score: 5 },
      ]
    case 'documents':
      return [
        { id: 'row-1', title: 'Getting Started Guide', excerpt: 'Everything a new teammate needs in week one.', collection: 'guides', cover: '/assets/docs/cover-01.jpg', authorIds: [], updatedAt: new Date().toISOString(), readMinutes: 6, body: [
          { kind: 'h2', text: 'Welcome', id: 'welcome' },
          { kind: 'p', text: 'This guide walks you through the workspace, one calm step at a time.' },
          { kind: 'callout', tint: 'mint', text: 'Tip: publish this app from the playground when it feels right.' },
        ] },
        { id: 'row-2', title: 'Remote Work Policy', excerpt: 'Where we work, core hours, and how we stay in sync.', collection: 'policies', cover: '/assets/docs/cover-02.jpg', authorIds: [], updatedAt: new Date().toISOString(), readMinutes: 4, body: [
          { kind: 'h2', text: 'Core hours', id: 'core-hours' },
          { kind: 'p', text: 'We overlap between 10:00 and 15:00 in your local timezone.' },
        ] },
        { id: 'row-3', title: 'Hiring Playbook', excerpt: 'Scorecards, interview loops and debriefs.', collection: 'guides', cover: '/assets/docs/cover-03.jpg', authorIds: [], updatedAt: new Date().toISOString(), readMinutes: 9, body: [
          { kind: 'h2', text: 'The loop', id: 'the-loop' },
          { kind: 'p', text: 'Every loop ends with a written debrief within 24 hours.' },
        ] },
        { id: 'row-4', title: 'Incident Response Runbook', excerpt: 'Severity levels and comms templates for bad days.', collection: 'policies', cover: '/assets/docs/cover-04.jpg', authorIds: [], updatedAt: new Date().toISOString(), readMinutes: 7, body: [
          { kind: 'h2', text: 'Severities', id: 'severities' },
          { kind: 'p', text: 'SEV1 pages the on-call; SEV3 opens a ticket.' },
        ] },
      ]
    case 'videos':
      return [
        { id: 'row-1', title: 'Welcome: your first week', channel: 'onboarding', thumb: '/assets/videos/thumb-01.jpg', durationSec: 482, views: 1240, watched: 1, publishedAt: new Date().toISOString(), description: 'A friendly tour of the workspace.' },
        { id: 'row-2', title: 'Setting up your profile', channel: 'onboarding', thumb: '/assets/videos/thumb-02.jpg', durationSec: 305, views: 860, watched: 0.6, publishedAt: new Date().toISOString(), description: 'Tune the bell, the badge and dark mode.' },
        { id: 'row-3', title: 'Reading the activity dashboard', channel: 'deep-dives', thumb: '/assets/videos/thumb-03.jpg', durationSec: 654, views: 540, watched: 0.25, publishedAt: new Date().toISOString(), description: 'KPIs, trends and the weekly goal ring.' },
        { id: 'row-4', title: 'Running a great interview loop', channel: 'deep-dives', thumb: '/assets/videos/thumb-04.jpg', durationSec: 743, views: 410, watched: 0, publishedAt: new Date().toISOString(), description: 'Scorecards, debriefs and groupthink.' },
      ]
    case 'schedule':
      return [
        { id: 'row-1', title: 'Morning shift', personId: 'r-1', date: isoDay(0), start: '08:30', durationMin: 240, type: 'shift', attendees: [] },
        { id: 'row-2', title: 'Team sync', personId: 'r-2', date: isoDay(0), start: '11:00', durationMin: 45, type: 'meeting', attendees: ['r-1'] },
        { id: 'row-3', title: 'Client visit', personId: 'r-3', date: isoDay(1), start: '13:00', durationMin: 120, type: 'visit', attendees: [] },
        { id: 'row-4', title: 'Evening shift', personId: 'r-2', date: isoDay(2), start: '14:00', durationMin: 300, type: 'shift', attendees: [] },
        { id: 'row-5', title: 'Planning meeting', personId: 'r-1', date: isoDay(3), start: '10:00', durationMin: 60, type: 'meeting', attendees: ['r-2', 'r-3'] },
      ]
    case 'board':
      return [
        { id: 'row-1', title: 'Draft launch checklist', column: 'backlog', priority: 'high', due: isoDay(4), assignee: 'Alex Rivera', avatar: '/assets/library/animals/cat.jpg' },
        { id: 'row-2', title: 'Wire the automation feed', column: 'doing', priority: 'high', due: isoDay(2), assignee: 'Sam Lee', avatar: '/assets/library/animals/dog.jpg' },
        { id: 'row-3', title: 'Polish empty states', column: 'doing', priority: 'normal', due: isoDay(5), assignee: 'Jo Patel', avatar: '/assets/library/animals/red-panda.jpg' },
        { id: 'row-4', title: 'Review schema docs', column: 'review', priority: 'normal', due: isoDay(1), assignee: 'Alex Rivera', avatar: '/assets/library/animals/cat.jpg' },
        { id: 'row-5', title: 'Ship v0.1.0', column: 'done', priority: 'low', due: isoDay(-1), assignee: 'Sam Lee', avatar: '/assets/library/animals/dog.jpg' },
      ]
    case 'detail':
      return [
        { id: 'row-1', name: 'Alex Rivera', role: 'Program Coordinator', status: 'Active', avatar: '/assets/library/animals/cat.jpg', email: 'alex@example.com', location: 'Austin, TX', startDate: isoDay(-400), projects: 6, tasksDone: 128, score: 4.6, tenureMonths: 14, skills: ['Planning', 'Hiring', 'Budgets'] },
        { id: 'row-2', name: 'Sam Lee', role: 'Field Specialist', status: 'Active', avatar: '/assets/library/animals/dog.jpg', email: 'sam@example.com', location: 'Denver, CO', startDate: isoDay(-200), projects: 4, tasksDone: 86, score: 4.2, tenureMonths: 7, skills: ['Training', 'Logistics'] },
      ]
    case 'gallery':
      return [
        { id: 'img-1', title: 'Front of the house', src: '/assets/library/houses/placeholder.jpg', kind: 'scene', assignedTo: '' },
        { id: 'img-2', title: 'Team headshot', src: '/assets/library/animals/cat.jpg', kind: 'avatar', assignedTo: 'Alex Rivera' },
        { id: 'img-3', title: 'Brand banner', src: '/assets/app-hero.svg', kind: 'cover', assignedTo: '' },
      ]
    case 'checklist':
      return [
        { id: 'chk-1', section: 'Kitchen', item: 'Fridge temperature logged', required: 'yes', note: 'Log sheet on the door' },
        { id: 'chk-2', section: 'Kitchen', item: 'No expired food', required: 'yes', note: '' },
        { id: 'chk-3', section: 'Bathroom', item: 'Grab bars secure', required: 'yes', note: '' },
        { id: 'chk-4', section: 'Bathroom', item: 'Supplies stocked', required: 'no', note: '' },
        { id: 'chk-5', section: 'Common areas', item: 'Exits clear', required: 'yes', note: 'Both doors' },
      ]
    case 'timeline':
      return [
        { id: 'ev-1', at: isoDay(0), title: 'Certificate verified', detail: 'CPR / First Aid, expires in 24 months', actor: 'Alex Rivera', kind: 'updated' },
        { id: 'ev-2', at: isoDay(-1), title: 'Document returned', detail: 'Photo was too dark to read the date', actor: 'Sam Lee', kind: 'issue' },
        { id: 'ev-3', at: isoDay(-3), title: 'Record created', detail: 'Added from the hiring pipeline', actor: 'System', kind: 'created' },
      ]
  }
}

export const pretty = (v: unknown) => JSON.stringify(v, null, 2)
