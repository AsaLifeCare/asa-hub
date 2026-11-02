// Calendar Builder: the building screens (gated, lib/pageGate) and the Shift Board's screens (ungated).
// Every address renders CalendarBuilderPage; these schemas are fallbacks shared with apps-shifts.ts.
import type { AppManifest, PageSchema } from '@/engine/types'

/* ═══════════════════ the screens that build the calendars ═══════════════════ */

const BUILD = 'Build'

// SMART COMMS — the coverage screen, and it sits FIRST, in front of the Calendar Builder screen.
const smartCommsPage: PageSchema = {
  id: 'smartcomms',
  type: 'sheet',
  title: 'Smart Comms',
  icon: 'message-square-text',
  dataSource: { resource: 'coverageSuggestions' },
  gate: 'every-house',
  config: {
    entity: ['coverage suggestion', 'coverage suggestions'],
    customFeature: 'calendarbuilder/CalendarBuilderPage',
    menuGroup: BUILD,
    /* declared here because the snapshot is cut by app; this page is gated */
    reads: [{ resource: 'callOffs' }, { resource: 'calendarRequests' }],
    searchPlaceholder: 'Search shifts…',
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'headline', label: 'Shift', kind: 'text', sortable: true, width: 260 },
      { key: 'house', label: 'House', kind: 'text', sortable: true },
      { key: 'date', label: 'Date', kind: 'date', sortable: true },
      { key: 'text', label: 'Hours', kind: 'text' },
      { key: 'kind', label: 'Kind', kind: 'chip', sortable: true,
        tintBy: { conflict_release: 'amber', open_cell: 'blue',
                  not_a_staffing_question: 'slate' } },
      { key: 'qualified', label: 'Could cover', kind: 'number', sortable: true },
    ],
    filters: [
      { key: 'kind', label: 'Kind',
        options: ['conflict_release', 'open_cell', 'not_a_staffing_question'] },
      { key: 'house', label: 'House', fromData: true, options: [] },
    ],
    pagination: { pageSize: 14 },
  },
}

/** The Builder view of the Calendar Builder screen: routed, never listed; its address lights that one entry. */
const builderPage: PageSchema = {
  id: 'builder',
  type: 'sheet',
  title: 'Builder',
  icon: 'calendar-cog',
  dataSource: { resource: 'calendarGrid' },
  gate: 'house-manager',
  config: {
    hidden: true,
    menuAs: 'house-cal',
    entity: ['roster row', 'roster rows'],
    customFeature: 'calendarbuilder/HouseCalendarsScreen',
    menuGroup: BUILD,
    searchPlaceholder: 'Search staff…',
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'employee', label: 'Staff', kind: 'text', sortable: true, width: 220 },
      { key: 'house', label: 'House', kind: 'text', sortable: true },
      { key: 'designation', label: 'Designation', kind: 'text' },
      { key: 'rowType', label: 'Row', kind: 'chip', sortable: true,
        tintBy: { staff: 'blue', open: 'amber', workshop: 'lavender' } },
    ],
    filters: [
      { key: 'house', label: 'House', fromData: true, options: [] },
      { key: 'rowType', label: 'Row', options: ['staff', 'open', 'workshop'] },
    ],
    pagination: { pageSize: 14 },
  },
}

const conflictsPage: PageSchema = {
  id: 'conflicts',
  type: 'sheet',
  title: 'Conflicts',
  icon: 'triangle-alert',
  dataSource: { resource: 'calendarConflicts' },
  gate: 'every-house',
  config: {
    entity: ['double-booking', 'double-bookings'],
    customFeature: 'calendarbuilder/CalendarBuilderPage',
    menuGroup: BUILD,
    searchPlaceholder: 'Search staff…',
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'staff', label: 'Staff', kind: 'text', sortable: true, width: 220 },
      { key: 'date', label: 'Date', kind: 'text', sortable: true },
      { key: 'houseA', label: 'House A', kind: 'text', sortable: true },
      { key: 'startA', label: 'Start A', kind: 'text' },
      { key: 'endA', label: 'End A', kind: 'text' },
      { key: 'houseB', label: 'House B', kind: 'text', sortable: true },
      { key: 'startB', label: 'Start B', kind: 'text' },
      { key: 'endB', label: 'End B', kind: 'text' },
    ],
    pagination: { pageSize: 14 },
  },
}

const hoursPage: PageSchema = {
  id: 'hours',
  type: 'sheet',
  title: 'Hours',
  icon: 'clock',
  dataSource: { resource: 'calendarHours' },
  gate: 'every-house',
  config: {
    entity: ['hours row', 'hours rows'],
    customFeature: 'calendarbuilder/CalendarBuilderPage',
    menuGroup: BUILD,
    searchPlaceholder: 'Search staff…',
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'staff', label: 'Staff', kind: 'text', sortable: true, width: 220 },
      { key: 'totalHours', label: 'Total hours', kind: 'number', sortable: true },
      { key: 'weeks', label: 'Weeks', kind: 'number', sortable: true },
      { key: 'perWeekAvg', label: 'Per-week avg', kind: 'number', sortable: true },
    ],
    pagination: { pageSize: 14 },
  },
}

const staffPage: PageSchema = {
  id: 'staff',
  type: 'sheet',
  title: 'Staff Preferences',
  icon: 'contact',
  dataSource: { resource: 'calendarStaff' },
  gate: 'every-house',
  config: {
    entity: ['preference', 'preferences'],
    customFeature: 'calendarbuilder/CalendarBuilderPage',
    menuGroup: BUILD,
    searchPlaceholder: 'Search staff…',
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'name', label: 'Staff', kind: 'text', sortable: true, width: 220 },
      { key: 'shifts', label: 'Shifts', kind: 'text' },
      { key: 'pickup', label: 'Pick up', kind: 'text' },
      { key: 'weekend', label: 'Weekend', kind: 'text' },
      { key: 'allergy', label: 'Allergy/Fear', kind: 'text' },
      { key: 'note', label: 'Note', kind: 'text' },
    ],
    pagination: { pageSize: 14 },
  },
}

/** The houses: the live workbook joined with the master Houses tab; routed, not listed (the Houses app lists them). */
const housesPage: PageSchema = {
  id: 'houses',
  type: 'sheet',
  title: 'Houses',
  icon: 'house',
  dataSource: { resource: 'calendarHouses' },
  gate: 'every-house',
  config: {
    hidden: true,
    entity: ['house', 'houses'],
    customFeature: 'calendarbuilder/CalendarBuilderPage',
    menuGroup: BUILD,
    searchPlaceholder: 'Search houses…',
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'house', label: 'House', kind: 'text', sortable: true, width: 160 },
      { key: 'hasLiveGrid', label: 'Live grid', kind: 'chip', sortable: true,
        tintBy: { true: 'mint', false: 'slate' } },
      { key: 'staffRows', label: 'Staff rows', kind: 'number', sortable: true },
      { key: 'liveAt', label: 'Grid last moved', kind: 'text' },
    ],
    pagination: { pageSize: 14 },
  },
}

/* ═══════════════════ Requests — the two lists, one screen ═══════════════════ */

/** Requests: the staff's (the relay refuses clients and guardians); it cuts each reader's copy. */
const requestsPage: PageSchema = {
  id: 'requests',
  type: 'sheet',
  title: 'Requests',
  icon: 'inbox',
  dataSource: { resource: 'shiftCards' }, // nominal — the page reads /hub-lanes/shift-requests
  gate: 'no-client',
  config: {
    entity: ['request', 'requests'],
    customFeature: 'shifts/ShiftRequestsPage',
    menuGroup: 'Requests',
  },
}

// Swaps: handing a shift to somebody else, where it belongs — beside Builder, Houses, Staff Schedule and Requests…
const swapsPage: PageSchema = {
  id: 'swaps',
  type: 'sheet',
  title: 'Swaps',
  icon: 'arrow-right-left',
  dataSource: { resource: 'shiftCards' }, // nominal — the page reads /hub-lanes/shift-handoff/swaps
  gate: 'no-client',
  config: {
    entity: ['swap', 'swaps'],
    customFeature: 'shifts/ShiftSwapsPage',
    menuGroup: 'Requests',
  },
}

/* ═══════════════ the calendars as everybody reads them (from the Shift Board) ═══════════════ */

const CALENDARS = 'Calendars'

// Calendar Builder, the one calendar screen: this address is its Live view and `builder` its Builder view.
export const houseCalPage: PageSchema = {
  id: 'house-cal',
  type: 'sheet',
  title: 'Calendar Builder',
  icon: 'calendar-cog',
  dataSource: { resource: 'shiftCards' }, // nominal — the page reads /hub-lanes/housecal
  gate: 'no-client',
  config: { entity: ['calendar', 'calendars'], customFeature: 'calendarbuilder/HouseCalendarsScreen',
            menuGroup: BUILD },
}

export const cardsPage: PageSchema = {
  id: 'cards',
  type: 'sheet',
  title: 'Shift Cards',
  icon: 'contact',
  dataSource: { resource: 'shiftCards' },
  config: {
    entity: ['shift card', 'shift cards'],
    menuGroup: CALENDARS,
    searchPlaceholder: 'Search staff…',
    scopeBy: ['personName', 'personId'],
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'personName', label: 'Staff', kind: 'avatar+text', sortable: true, subKey: 'personId', width: 240 },
      { key: 'totalShifts', label: 'Total shifts', kind: 'number', sortable: true },
      { key: 'houseCount', label: 'Houses', kind: 'number', sortable: true },
    ],
    pagination: { pageSize: 12 },
  },
}

/** The old House Calendar board, Live's week now: kept only so CalendarBuilderPage can redirect its address. */
export const calendarPage: PageSchema = {
  id: 'calendar',
  type: 'sheet',
  title: 'House Calendar',
  icon: 'calendar-days',
  dataSource: { resource: 'shiftMatrix' },
  config: {
    hidden: true,
    entity: ['roster cell', 'roster cells'],
    menuGroup: CALENDARS,
    searchPlaceholder: 'Search roster…',
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'staffName', label: 'Staff', kind: 'text', sortable: true, width: 220 },
      { key: 'houseId', label: 'House', kind: 'text', sortable: true },
      { key: 'dayIndex', label: 'Day (0=SAT)', kind: 'number', sortable: true },
      { key: 'code', label: 'Code', kind: 'text' },
      {
        key: 'kind', label: 'Kind', kind: 'chip', sortable: true,
        tintBy: { day: 'blue', morning: 'amber', afternoon: 'mint', evening: 'lavender', overnight: 'pink', ro: 'peach', off: 'blue', alias: 'amber' },
      },
    ],
    filters: [
      { key: 'kind', label: 'Kind', options: ['day', 'morning', 'afternoon', 'evening', 'overnight', 'ro', 'off', 'alias'] },
    ],
    pagination: { pageSize: 14 },
  },
}

export const timelinePage: PageSchema = {
  id: 'timeline',
  type: 'sheet',
  title: 'Shift Timeline',
  icon: 'clock',
  dataSource: { resource: 'shiftTimeline' },
  config: {
    entity: ['timeline entry', 'timeline entries'],
    menuGroup: CALENDARS,
    searchPlaceholder: 'Search shifts…',
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'staffName', label: 'Staff', kind: 'text', sortable: true, width: 220 },
      { key: 'clientName', label: 'Client', kind: 'text', sortable: true },
      { key: 'houseCode', label: 'House', kind: 'text' },
      { key: 'date', label: 'Date', kind: 'date', sortable: true },
      { key: 'startHour', label: 'Start (h)', kind: 'number', sortable: true },
      { key: 'endHour', label: 'End (h)', kind: 'number', sortable: true },
      {
        key: 'kind', label: 'Kind', kind: 'chip', sortable: true,
        tintBy: { day: 'blue', morning: 'amber', afternoon: 'mint', evening: 'lavender', overnight: 'pink' },
      },
    ],
    pagination: { pageSize: 14 },
  },
}

/** Shifts & Coverage; the absorbed `shifts` manifest reads this same object. Routed, not listed. */
export const coveragePage: PageSchema = {
  id: 'coverage',
  type: 'sheet',
  title: 'Shifts & Coverage',
  icon: 'clock',
  dataSource: { resource: 'shifts' },
  config: {
    hidden: true,
    entity: ['shift', 'shifts'],
    menuGroup: CALENDARS,
    searchPlaceholder: 'Search staff or houses…',
    // roster rows drag to the tracker by name
    focusDrag: { type: 'staff', idKey: 'staff', nameKey: 'staff', subtitleKey: 'house' },
    scopeBy: 'staff',
    secondaryActions: [{ id: 'export', label: 'Export', icon: 'download', toast: 'Export started' }],
    // no "Post shift": this board mirrors the scheduling calendar
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'staff', label: 'Staff', kind: 'avatar+text', sortable: true, primary: true, width: 220 },
      // the chip opens the house panel (OpsActionModals)
      { key: 'house', label: 'House', kind: 'chip', cellAction: 'house-panel' },
      { key: 'date', label: 'Date', kind: 'date', sortable: true, format: 'EEE, MMM d' },
      { key: 'start', label: 'Start', kind: 'text' },
      { key: 'end', label: 'End', kind: 'text' },
      {
        key: 'status', label: 'Shift', kind: 'chip', dot: true, sortable: true,
        tintBy: {
          Day: 'blue', Morning: 'amber', Afternoon: 'mint',
          Evening: 'lavender', Overnight: 'pink', 'R/O': 'peach',
        },
      },
    ],
    // Houses come and go in the estate; the choices are read off the rows.
    filters: [
      { key: 'house', label: 'House', fromData: true, options: [] },
      { key: 'status', label: 'Shift', fromData: true, options: [] },
    ],
    rowActions: [{ id: 'view', label: 'View shift', icon: 'eye' }],
    pagination: { pageSize: 14 },
    detailPanel: {
      header: {
        // the roster mirror carries names, not photos
        avatar: 'initials', title: 'staff', subtitle: 'house',
        statusChip: {
          field: 'status',
          tintBy: {
            Day: 'blue', Morning: 'amber', Afternoon: 'mint',
            Evening: 'lavender', Overnight: 'pink', 'R/O': 'peach',
          },
        },
      },
      sections: [
        // housePhoto from shift_slices.py; none renders no section
        { kind: 'image', title: 'House', srcField: 'housePhoto', altField: 'house' },
        { kind: 'fields', title: 'Shift', fields: [
          { icon: 'house', label: 'House', value: 'house' },
          { icon: 'calendar', label: 'Date', value: 'date' },
          { icon: 'clock', label: 'Start', value: 'start' },
          { icon: 'clock', label: 'End', value: 'end' },
          { icon: 'badge-check', label: 'Shift', value: 'status' },
        ] },
      ],
      footer: [
        { label: 'Open profile', icon: 'arrow-up-right', action: 'staff-profile', variant: 'secondary' },
      ],
    },
  },
}

/** Staff Schedule; the absorbed `schedule` manifest reads this same object. */
export const schedulePage: PageSchema = {
  id: 'week',
  type: 'schedule',
  title: 'Staff Schedule',
  icon: 'calendar-days',
  dataSource: { resource: 'events' },
  config: {
    menuGroup: CALENDARS,
    /** first visit only; a reader's own last view wins */
    view: 'month',
    allowViews: ['day', 'week', 'month'],
    // columns come from the rows; appId stays the schedule's so its matrix gates still apply
    resourcesFrom: 'data',
    appId: 'schedule',
    resources: [
      { id: 'p-01', name: 'Maya Chen', avatar: '/assets/library/animals/cat.jpg', role: 'House Manager' },
      { id: 'p-02', name: 'Tom Becker', avatar: '/assets/library/animals/dog.jpg', role: 'Direct Support Pro' },
      { id: 'p-03', name: 'Priya Nair', avatar: '/assets/library/animals/red-panda.jpg', role: 'Caregiver' },
      { id: 'p-04', name: 'Daniel Osei', avatar: '/assets/library/animals/fox.jpg', role: 'Overnight Lead' },
      { id: 'p-05', name: 'Sofia Morales', avatar: '/assets/library/animals/barn-owl.jpg', role: 'Float Nurse (RN)' },
    ],
    // a trimmed range would drop overnight bars
    timeRange: [0, 24],
    slotMinutes: 30,
    eventTypes: {
      shift: { label: 'Shift', tint: 'mint' },
      appointment: { label: 'Appointment', tint: 'blue' },
      meeting: { label: 'Team meeting', tint: 'peach' },
      'one-on-one': { label: '1:1', tint: 'lavender' },
      training: { label: 'Training', tint: 'pink' },
    },
    showMiniMonth: true,
    showNowLine: true,
  },
}

// The Shift Board's pages; apps-shifts.ts lists them so old addresses redirect here.
export const SHIFT_BOARD_PAGES: PageSchema[] = [cardsPage, calendarPage, timelinePage, coveragePage,
                                                schedulePage, houseCalPage, requestsPage]

export const calendarBuilderManifests: AppManifest[] = [
  {
    id: 'calendarbuilder',
    name: 'Calendar Builder',
    tagline: 'The house calendars — built, read, given and asked for',
    icon: 'calendar-cog',
    accent: 'amber',
    category: 'Manage',
    version: '1.1.0',
    /** a menu choice, not the lock; clients read the ungated screens, narrowed to their house */
    audience: ['admin', 'manager', 'staff', 'client'],
    isNew: true,
    enabled: true,
    // the listed pages in their menu order; a reader who may not open the first lands on the first they may a…
    pages: [smartCommsPage, houseCalPage, conflictsPage, hoursPage, staffPage, requestsPage,
            swapsPage, cardsPage, timelinePage, schedulePage,
            builderPage, housesPage, calendarPage, coveragePage],
    notifications: ['app', 'reminder'],
  },
]
