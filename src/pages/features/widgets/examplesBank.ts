// THE EXAMPLES BANK — a broad bank of examples to use first and build from later.
// Every entry is a SPEC, same law as the bank itself — which resource, which narrowing, which label — never data.
import type { TintName } from '@/engine/types'

export type WidgetExample = {
  label: string
  resource: string
  field?: string
  value?: string
  icon: string
  tint: TintName
  /** how it draws — number (default), donut, bars, progress, table, forecast */
  chart?: 'number' | 'donut' | 'bars' | 'progress' | 'table' | 'forecast'
  /** the shelf the gallery groups it under */
  group: string
}

export const WIDGET_EXAMPLES: WidgetExample[] = [
  // ---- the sky — widgets carrying the temperature and the forecast; the 'weather' pseudo-resource reads the…
  { group: 'Weather', label: 'Temperature right now', resource: 'weather', icon: 'sun', tint: 'amber', chart: 'number' },
  { group: 'Weather', label: 'The week ahead', resource: 'weather', icon: 'cloud-sun', tint: 'blue', chart: 'forecast' },
  { group: 'Weather', label: 'Next days, listed', resource: 'weather', icon: 'cloud', tint: 'lavender', chart: 'table' },
  { group: 'Weather', label: 'The highs this week', resource: 'weather', icon: 'thermometer', tint: 'peach', chart: 'bars' },

  /* ---- the styles — tables, pie drawings, and a great many more ---- */
  { group: 'Styles', label: 'Team by status', resource: 'people', field: 'status', icon: 'chart-pie', tint: 'mint', chart: 'donut' },
  { group: 'Styles', label: 'The wall, column by column', resource: 'teamTasks', field: 'column', icon: 'chart-column', tint: 'blue', chart: 'bars' },
  { group: 'Styles', label: 'Share of staff Active', resource: 'people', field: 'status', value: 'Active', icon: 'gauge', tint: 'mint', chart: 'progress' },
  { group: 'Styles', label: 'Latest call-offs', resource: 'callOffs', field: 'type', icon: 'table', tint: 'amber', chart: 'table' },
  { group: 'Styles', label: 'Cards by priority', resource: 'teamTasks', field: 'priority', icon: 'chart-pie', tint: 'pink', chart: 'donut' },
  { group: 'Styles', label: 'Newest books on the shelf', resource: 'books', field: 'subject', icon: 'table', tint: 'lavender', chart: 'table' },
  { group: 'Styles', label: 'Incidents by category', resource: 'incidents', field: 'category', icon: 'chart-column', tint: 'peach', chart: 'bars' },
  { group: 'Styles', label: 'Newest support requests', resource: 'supportQueue', field: 'urgency', icon: 'table', tint: 'blue', chart: 'table' },
  { group: 'Styles', label: 'Support queue by urgency', resource: 'supportQueue', field: 'urgency', icon: 'chart-pie', tint: 'amber', chart: 'donut' },
  { group: 'Styles', label: 'Support queue by type', resource: 'supportQueue', field: 'type_of_request', icon: 'chart-column', tint: 'blue', chart: 'bars' },
  { group: 'Styles', label: 'Requests still New', resource: 'supportQueue', field: 'status', value: 'New', icon: 'gauge', tint: 'pink', chart: 'progress' },
  { group: 'Styles', label: 'Daily notes by category', resource: 'dailyNotes', field: 'category', icon: 'chart-pie', tint: 'lavender', chart: 'donut' },
  { group: 'Styles', label: 'Newest daily notes', resource: 'dailyNotes', field: 'dsp_name', icon: 'table', tint: 'mint', chart: 'table' },
  { group: 'Styles', label: 'Repairs by status', resource: 'workOrders', field: 'status', icon: 'chart-column', tint: 'peach', chart: 'bars' },
  { group: 'Styles', label: 'Newest incidents filed', resource: 'uiIncidents', field: 'incident_category', icon: 'table', tint: 'pink', chart: 'table' },
  { group: 'Styles', label: 'Visits needing the van', resource: 'drVisits', field: 'wheelchair_van_required', value: 'Yes', icon: 'gauge', tint: 'amber', chart: 'progress' },
  { group: 'Styles', label: 'Newest booked visits', resource: 'drVisits', field: 'dr_name', icon: 'table', tint: 'blue', chart: 'table' },
  { group: 'Styles', label: 'Trips by status', resource: 'travelTrips', field: 'status', icon: 'chart-pie', tint: 'mint', chart: 'donut' },
  { group: 'Styles', label: 'Books by subject', resource: 'books', field: 'subject', icon: 'chart-column', tint: 'lavender', chart: 'bars' },
  { group: 'Styles', label: 'Call-offs by type', resource: 'callOffs', field: 'type', icon: 'chart-pie', tint: 'peach', chart: 'donut' },
  { group: 'Styles', label: 'Newest team cards', resource: 'teamTasks', field: 'column', icon: 'table', tint: 'blue', chart: 'table' },
  { group: 'Styles', label: 'Cards already done', resource: 'teamTasks', field: 'column', value: 'done', icon: 'gauge', tint: 'mint', chart: 'progress' },

  /* ---- Command Deck (the daily glance, counted from Hub resources) ---- */
  { group: 'Command Deck', label: 'Active clients', resource: 'clients', icon: 'heart', tint: 'mint' },
  { group: 'Command Deck', label: 'Active staff', resource: 'people', field: 'status', value: 'Active', icon: 'users', tint: 'blue' },
  { group: 'Command Deck', label: 'Candidates in play', resource: 'candidates', icon: 'user-plus', tint: 'amber' },
  { group: 'Command Deck', label: 'Certifications expired', resource: 'staffCerts', field: 'status', value: 'expired', icon: 'badge-alert', tint: 'pink' },
  { group: 'Command Deck', label: 'Certifications expiring', resource: 'staffCerts', field: 'status', value: 'expiring', icon: 'clock', tint: 'amber' },
  { group: 'Command Deck', label: 'Call-offs on file', resource: 'callOffs', icon: 'phone-off', tint: 'peach' },
  { group: 'Command Deck', label: 'UI/MUI reports', resource: 'uiIncidents', icon: 'triangle-alert', tint: 'pink' },
  { group: 'Command Deck', label: 'Open house repairs', resource: 'workOrders', icon: 'wrench', tint: 'amber' },
  { group: 'Command Deck', label: 'Certifications by status', resource: 'staffCerts', field: 'status', icon: 'chart-pie', tint: 'lavender', chart: 'donut' },
  { group: 'Command Deck', label: 'Incidents by category', resource: 'uiIncidents', field: 'incident_category', icon: 'chart-column', tint: 'pink', chart: 'bars' },
  { group: 'Command Deck', label: 'Open reminders', resource: 'reminders', field: 'status', value: 'open', icon: 'bell', tint: 'blue' },

  /* ---- people & team ---- */
  { group: 'People & team', label: 'Active staff', resource: 'people', field: 'status', value: 'Active', icon: 'users', tint: 'mint' },
  { group: 'People & team', label: 'On leave right now', resource: 'people', field: 'status', value: 'On leave', icon: 'user', tint: 'amber' },
  { group: 'People & team', label: 'Offboarding', resource: 'people', field: 'status', value: 'Offboarding', icon: 'user-check', tint: 'pink' },
  { group: 'People & team', label: 'Whole directory', resource: 'people', icon: 'contact', tint: 'blue' },
  { group: 'People & team', label: 'Platform accounts', resource: 'users', icon: 'shield', tint: 'lavender' },

  /* ---- care ---- */
  { group: 'Care', label: 'Clients on record', resource: 'clients', icon: 'heart', tint: 'pink' },
  { group: 'Care', label: 'Service plans on file', resource: 'isps', icon: 'clipboard-check', tint: 'mint' },
  { group: 'Care', label: 'Incidents on file', resource: 'incidents', icon: 'shield-plus', tint: 'peach' },
  { group: 'Care', label: 'Medications tracked', resource: 'medications', icon: 'pill', tint: 'blue' },
  { group: 'Care', label: 'Med deliveries', resource: 'medDeliveries', icon: 'truck', tint: 'amber' },
  { group: 'Care', label: 'Care documents', resource: 'careDocs', icon: 'folder', tint: 'lavender' },
  { group: 'Care', label: 'Doctor appointments', resource: 'drAppointments', icon: 'stethoscope', tint: 'mint' },
  { group: 'Care', label: 'MAR entries', resource: 'marEntries', icon: 'syringe', tint: 'pink' },

  /* ---- the board ---- */
  { group: 'The board', label: 'Cards in progress', resource: 'teamTasks', field: 'column', value: 'in-progress', icon: 'zap', tint: 'amber' },
  { group: 'The board', label: 'Waiting on review', resource: 'teamTasks', field: 'column', value: 'review', icon: 'clipboard-list', tint: 'peach' },
  { group: 'The board', label: 'Backlog size', resource: 'teamTasks', field: 'column', value: 'backlog', icon: 'archive', tint: 'lavender' },
  { group: 'The board', label: 'Finished cards', resource: 'teamTasks', field: 'column', value: 'done', icon: 'clipboard-check', tint: 'mint' },
  { group: 'The board', label: 'Everything on the wall', resource: 'teamTasks', icon: 'layout-grid', tint: 'blue' },
  { group: 'The board', label: 'Projects running', resource: 'teamProjects', field: 'status', value: 'active', icon: 'target', tint: 'blue' },

  /* ---- hiring ---- */
  { group: 'Hiring', label: 'Candidates in the pipeline', resource: 'candidates', icon: 'user-plus', tint: 'blue' },
  { group: 'Hiring', label: 'Phone screens', resource: 'phoneScreens', icon: 'contact', tint: 'lavender' },
  { group: 'Hiring', label: 'People onboarding', resource: 'onboarding', icon: 'rocket', tint: 'amber' },
  { group: 'Hiring', label: 'Referrals received', resource: 'referrals', icon: 'megaphone', tint: 'peach' },

  /* ---- operations ---- */
  { group: 'Operations', label: 'Shifts on the roster', resource: 'shifts', icon: 'calendar-days', tint: 'blue' },
  { group: 'Operations', label: 'Company events', resource: 'events', icon: 'star', tint: 'lavender' },
  { group: 'Operations', label: 'Policies published', resource: 'policies', icon: 'book-open', tint: 'mint' },
  { group: 'Operations', label: 'Staff certifications', resource: 'staffCerts', icon: 'clipboard-check', tint: 'peach' },
  { group: 'Operations', label: 'Billing claims', resource: 'billingClaims', icon: 'wallet', tint: 'blue' },
  { group: 'Operations', label: 'Books on the shelf', resource: 'books', icon: 'book-open', tint: 'amber' },
  { group: 'Operations', label: 'Widgets in this bank', resource: 'widgets', icon: 'layout-grid', tint: 'lavender' },
]
