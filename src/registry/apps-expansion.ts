// ASA Hub — expansion app registry (apps-expansion wave): 22 home-healthcare app manifests rendered by the existing…
// The main agent merges `...expansionManifests` into src/registry/apps.ts.
import type { AppManifest, PageSchema, TintName } from '@/engine/types'
import type { Permission } from '@/auth/types'
// Shifts & Coverage's schema lives in Calendar Builder; this imports the same object
import { coveragePage } from '@/registry/apps-calendarbuilder'
// the black headers these two pages open with (src/registry/appHeroes.ts)
import { diseasesHero, ispHero } from '@/registry/appHeroes'

/* ================= enabled (6) ================= */

/* ---------- 1 · CRM — Referral Pipeline (pipeline / leads) ---------- */

// THE REFERRAL FUNNEL MOVED INTO POTENTIAL CLIENTS: the CRM belongs inside Potential Clients, and the CRM app…


/* ---------- 2 · Diseases Registry (sheet + detail / diseases) ---------- */

// sweep: category tint chips — extended tints (info/danger) ride the same runtime maps (cast per the imagebank…
const DISEASE_CATEGORY_TINTS = {
  Developmental: 'lavender',
  Neurological: 'blue',
  Cardiac: 'pink',
  Respiratory: 'info' as TintName,
  Metabolic: 'green',
  Psychiatric: 'peach',
  Physical: 'amber',
  Sensory: 'mint',
  Risk: 'danger' as TintName,
}
const DISEASE_SEVERITY_TINTS = { mild: 'mint', moderate: 'amber', high: 'pink' } as const

const diseasesPage: PageSchema = {
  id: 'registry',
  type: 'sheet',
  title: 'Diseases Registry',
  icon: 'stethoscope',
  dataSource: { resource: 'diseases' },
  config: {
    entity: ['condition', 'conditions'],
    hero: diseasesHero,
    searchPlaceholder: 'Search conditions or ICD-10…',
    // sweep: client linkage — focus mode filters by linked client ids
    scopeBy: 'clientIds',
    secondaryActions: [{ id: 'export', label: 'Export', icon: 'download', toast: 'Export started' }],
    primaryAction: { label: 'Add condition', icon: 'plus' },
    searchable: true,
    rowHeight: 56,
    // THE PREVALENCE STRIP IS THE HERO NOW.
    columns: [
      { key: 'name', label: 'Condition', kind: 'text', sortable: true, width: 240 },
      { key: 'icdCode', label: 'ICD-10', kind: 'chip', tintBy: {} },
      { key: 'category', label: 'Category', kind: 'chip', sortable: true, tintBy: DISEASE_CATEGORY_TINTS },
      { key: 'clientsAffected', label: 'Clients', kind: 'number', sortable: true },
      { key: 'severity', label: 'Severity', kind: 'chip', dot: true, tintBy: DISEASE_SEVERITY_TINTS },
      { key: 'careFlags', label: 'Care flags', kind: 'chips', max: 2, tintCycle: ['blue', 'mint', 'lavender'] },
    ],
    filters: [
      { key: 'category', label: 'Category', options: Object.keys(DISEASE_CATEGORY_TINTS) },
      { key: 'severity', label: 'Severity', options: ['mild', 'moderate', 'high'] },
    ],
    rowActions: [
      { id: 'view', label: 'View details', icon: 'eye' },
    ],
    pagination: { pageSize: 12 },
    detailPanel: {
      header: {
        title: 'name', subtitle: 'icdCode',
        statusChip: { field: 'severity', tintBy: DISEASE_SEVERITY_TINTS },
        actions: [
          { icon: 'file-text', label: 'Open protocol', iconOnly: true, toast: 'Opening care protocol…' },
          { icon: 'ellipsis', label: 'More actions', iconOnly: true, toast: 'More actions' },
        ],
      },
      stats: [
        { label: 'Clients affected', value: 'clientsAffected', icon: 'users', tint: 'pink' },
        { label: 'Mild', value: 'severityDist.mild', icon: 'circle-check', tint: 'mint' },
        { label: 'Moderate', value: 'severityDist.moderate', icon: 'clock', tint: 'amber' },
        { label: 'High', value: 'severityDist.high', icon: 'triangle-alert', tint: 'pink' },
      ],
      sections: [
        { kind: 'chips', title: 'Care flags', itemsField: 'careFlags', icon: 'flag', tints: ['blue', 'mint', 'lavender', 'peach'] },
        { kind: 'fields', title: 'Diagnosis', fields: [
          { icon: 'stethoscope', label: 'Condition', value: 'name' },
          { icon: 'badge-check', label: 'ICD-10', value: 'icdCode' },
          { icon: 'layers', label: 'Category', value: 'category' },
          { icon: 'notebook-pen', label: 'Notes', value: 'notes' },
        ] },
      ],
      footer: [
        { label: 'Export summary', variant: 'secondary', icon: 'download', toast: 'Export started' },
        { label: 'Open registry entry', variant: 'primary', icon: 'arrow-up-right', toast: 'Opening full entry…' },
      ],
    },
  },
}

// ---------- 3 · Incidents (sheet + detail / incidents) ---------- THE REAL UI/MUI SHEET, TWO VIEWS: the house view…

const incidentsPage: PageSchema = {
  id: 'log',
  type: 'sheet',
  title: 'Incident Log',
  icon: 'siren',
  dataSource: { resource: 'uiIncidents' },
  config: {
    entity: ['incident', 'incidents'],
    searchPlaceholder: 'Search incidents…',
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'incident_date', label: 'Date', kind: 'date', sortable: true, format: 'MMM d, yyyy' },
      { key: 'incident_category', label: 'Category', kind: 'chip', sortable: true,
        tintBy: { 'Medication related error': 'pink', Fall: 'amber', Behavior: 'lavender', Injury: 'peach', MUI: 'blue' } },
      // The person is a ROUND face with their initials, always (a standing law).
      { key: 'client_name', label: 'Client', kind: 'avatar+text', width: 170 },
      { key: 'incident_location', label: 'Location', kind: 'text', icon: 'house' },
      { key: 'your_name', label: 'Reported by', kind: 'text' },
      { key: 'employees_involved', label: 'Employees involved', kind: 'text' },
    ],
    filters: [
      { key: 'incident_category', label: 'Category', options: ['Medication related error', 'Fall', 'Behavior', 'Injury', 'MUI'] },
      { key: 'incident_location', label: 'Location', options: ['Client Home', 'Day Program', 'Community', 'Vehicle'] },
    ],
    // "MUI Watch" — computed live over the REAL rows.
    summaryStrip: {
      title: 'MUI Watch',
      icon: 'siren',
      tint: 'pink',
      items: [
        {
          label: 'MUIs',
          icon: 'triangle-alert',
          tint: 'pink',
          compute: (rows: any[]) => rows.filter((r) => /mui|major unusual/i.test(String(r.incident_category ?? ''))).length,
        },
        {
          label: 'This month',
          icon: 'clock',
          tint: 'amber',
          compute: (rows: any[]) => {
            const now = new Date()
            return rows.filter((r) => {
              const d = new Date(String(r.incident_date ?? ''))
              return !isNaN(d.getTime()) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
            }).length
          },
        },
        {
          label: 'Reports',
          icon: 'clipboard-check',
          tint: 'mint',
          compute: (rows: any[]) => rows.length,
        },
      ],
    },
    pagination: { pageSize: 12 },
    detailPanel: {
      // a report opens in Support Requests' panel pattern (IncidentPanel), not the template's dark header and tiles;
      // the fields below stay the record of what it shows
      ownPanel: 'incident',
      header: { title: 'incident_category', subtitle: 'incident_location' },
      stats: [
        { label: 'Client', value: 'client_name', icon: 'user', tint: 'blue' },
        { label: 'Date', value: 'incident_date', icon: 'clock', tint: 'peach' },
      ],
      sections: [
        { kind: 'fields', title: 'Report', fields: [
          { icon: 'siren', label: 'Category', value: 'incident_category' },
          { icon: 'user', label: 'Client', value: 'client_name' },
          { icon: 'house', label: 'Location', value: 'incident_location' },
          { icon: 'clock', label: 'Incident date', value: 'incident_date' },
          { icon: 'clock', label: 'Incident time', value: 'incident_time' },
          { icon: 'clipboard-check', label: 'Reported on', value: 'incident_reported_date' },
          { icon: 'user', label: 'Reported by', value: 'your_name' },
          { icon: 'users', label: 'Employees involved', value: 'employees_involved' },
        ] },
        { kind: 'fields', title: 'What happened', fields: [
          { icon: 'file-text', label: 'Summary', value: 'summary_of_incident' },
          { icon: 'clipboard-check', label: 'Immediate action', value: 'immediate_action_taken' },
        ] },
      ],
    },
  },
}

// The separate "Sheet" pages died: one tab is enough, reached by pressing a button.

/* ---------- Onboarding — the new hire's six steps as an APP ---------- */

const onboardingAppPage: PageSchema = {
  id: 'steps',
  type: 'sheet',
  title: 'Onboarding',
  icon: 'graduation-cap',
  dataSource: { resource: 'onboarding' },
  config: { entity: ['step', 'steps'], customFeature: 'onboarding/OnboardingHome' },
}

/* ---------- Interviews — the interviewer's desk (custom page) ---------- */

const interviewsPage: PageSchema = {
  id: 'board',
  type: 'sheet',
  title: 'Interviews',
  icon: 'clipboard-check',
  dataSource: { resource: 'candidates' },
  config: { entity: ['interview', 'interviews'], customFeature: 'interviews/InterviewsPage' },
}

// The candidate's FULL profile behind the interviewer's desk — the same page the hiring app carries, HIDDEN: it…
const interviewsCandidatePage: PageSchema = {
  id: 'candidate',
  type: 'sheet',
  title: 'Candidate',
  icon: 'user-round',
  dataSource: { resource: 'candidates' },
  config: { hidden: true, customFeature: 'hiring/CandidateProfilePage' },
}

/* ---------- 4 · MAR — Med Administration (sheet / marEntries) ---------- */

const marPage: PageSchema = {
  id: 'mar',
  type: 'sheet',
  title: 'Medication Administration',
  icon: 'pill',
  dataSource: { resource: 'marEntries' },
  config: {
    entity: ['MAR entry', 'MAR entries'],
    searchPlaceholder: 'Search medications or clients…',
    scopeBy: 'client',
    secondaryActions: [{ id: 'export', label: 'Export MAR', icon: 'download', toast: 'Export started' }],
    primaryAction: { label: 'Record administration', icon: 'plus' },
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'medication', label: 'Medication', kind: 'text', sortable: true, width: 220 },
      // The person is a ROUND face with their initials, always (a standing law).
      { key: 'client', label: 'Client', kind: 'avatar+text', width: 160 },
      // Times and statuses are the eMAR pass log's OWN vocabulary — measured, not invented: Pass · Cancel ·…
      { key: 'schedule', label: 'Schedule', kind: 'chip', tintBy: { '8:00 AM': 'mint', '2:00 PM': 'amber', '4:00 PM': 'amber', '5:00 PM': 'amber', '8:00 PM': 'lavender' } },
      { key: 'administeredBy', label: 'Administered by', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'chip', dot: true, tintBy: { Pass: 'mint', Cancel: 'amber', Discontinued: 'pink' } },
      { key: 'date', label: 'Date', kind: 'date', sortable: true, format: 'MMM d, yyyy' },
    ],
    filters: [
      { key: 'schedule', label: 'Schedule', options: ['8:00 AM', '2:00 PM', '4:00 PM', '5:00 PM', '8:00 PM'] },
      { key: 'status', label: 'Status', options: ['Pass', 'Cancel', 'Discontinued'] },
    ],
    rowActions: [{ id: 'view', label: 'View entry', icon: 'eye' }],
    pagination: { pageSize: 14 },
  },
}


/* ---------- 6 · Leadership Dashboard (dashboard) ---------- */

const leadershipPage: PageSchema = {
  id: 'overview',
  type: 'dashboard',
  title: 'Leadership Overview',
  icon: 'gauge',
  dataSource: { resource: 'activity' },
  config: {
    greeting: { name: 'Leadership', subtitle: "Census, compliance and coverage across all four houses." },
    widgets: [
      { kind: 'stat', label: 'Census (clients served)', value: 96, delta: 2.1, tint: 'mint', href: '/app/diseases/registry', spark: [88, 90, 89, 91, 93, 92, 94, 95, 96] },
      { kind: 'stat', label: 'Open incidents', value: 7, delta: -12.5, tint: 'amber', href: '/app/incidents/log', spark: [11, 10, 12, 9, 10, 8, 9, 8, 7] },
      { kind: 'stat', label: 'Compliance score', value: 94, delta: 1.8, deltaLabel: 'vs last quarter', tint: 'lavender', spark: [88, 89, 91, 90, 92, 93, 92, 94, 94] },
      { kind: 'stat', label: 'Shifts open', value: 5, delta: -28.6, tint: 'blue', href: '/app/shifts/coverage', spark: [9, 8, 10, 7, 8, 6, 7, 6, 5] },
      {
        kind: 'area', span: 2, title: 'Admissions — last 12 weeks',
        series: [
          { name: 'Admissions', color: 'mint', points: [2, 3, 1, 4, 3, 5, 4, 6, 5, 7, 6, 8] },
          { name: 'Discharges', color: 'pink', points: [1, 2, 1, 2, 1, 3, 2, 2, 3, 2, 3, 2] },
        ],
      },
      {
        kind: 'donut', title: 'Clients by house', centerLabel: 'clients',
        slices: [
          { label: 'Maple House', value: 28, tint: 'mint' },
          { label: 'Cedar House', value: 24, tint: 'lavender' },
          { label: 'Birch House', value: 22, tint: 'peach' },
          { label: 'Willow House', value: 22, tint: 'blue' },
        ],
      },
      {
        kind: 'list', title: 'Latest incidents', viewAllHref: '/app/incidents/log',
        items: [
          { icon: 'siren', tint: 'amber', title: 'Fall · Maple House', meta: 'J.M. · in review', href: '/app/incidents/log' },
          { icon: 'siren', tint: 'pink', title: 'Medication error · Cedar House', meta: 'L.B. · open', href: '/app/incidents/log' },
          { icon: 'siren', tint: 'lavender', title: 'Behavior · Birch House', meta: 'D.P. · closed', href: '/app/incidents/log' },
          { icon: 'siren', tint: 'blue', title: 'MUI report · Willow House', meta: 'R.S. · open', href: '/app/incidents/log' },
        ],
      },
      { kind: 'ring', title: 'Audit pass rate', percent: 94, tint: 'mint', caption: '17 of 18 audits passed YTD' },
      {
        kind: 'actions', title: 'Quick actions',
        actions: [
          { icon: 'siren', label: 'Report incident', tint: 'amber', href: '/app/incidents/log' },
          { icon: 'clock', label: 'Cover a shift', tint: 'blue', href: '/app/shifts/coverage' },
          { icon: 'handshake', label: 'Add referral', tint: 'mint', href: '/app/crm/pipeline' },
          { icon: 'clipboard-check', label: 'Schedule audit', tint: 'lavender', href: '/app/audits/log' },
        ],
      },
    ],
  },
}

/* ================= available (16, enabled: false) ================= */

/* ---------- 7 · Owners / Executive (dashboard) ---------- */

const ownersPage: PageSchema = {
  id: 'executive',
  type: 'dashboard',
  title: 'Executive Overview',
  icon: 'crown',
  dataSource: { resource: 'activity' },
  config: {
    greeting: { name: 'Owners', subtitle: 'Revenue, payer mix and growth across the organization.' },
    widgets: [
      { kind: 'stat', label: 'Monthly revenue ($)', value: 1240000, delta: 6.4, tint: 'mint', spark: [980, 1020, 1060, 1040, 1110, 1150, 1130, 1190, 1240] },
      { kind: 'stat', label: 'Units billed', value: 18420, delta: 3.2, tint: 'blue', spark: [140, 152, 148, 160, 158, 168, 172, 178, 184] },
      { kind: 'stat', label: 'Occupancy (beds)', value: 96, delta: 2.1, tint: 'lavender', spark: [88, 90, 89, 91, 93, 92, 94, 95, 96] },
      { kind: 'stat', label: 'AR days', value: 31, delta: -8.8, deltaLabel: 'vs last month', tint: 'peach', spark: [42, 40, 39, 38, 36, 35, 34, 32, 31] },
      {
        kind: 'area', span: 2, title: 'Monthly revenue — 12 months ($k)',
        series: [
          { name: 'This year', color: 'mint', points: [980, 1020, 1060, 1040, 1110, 1150, 1130, 1190, 1240, 1210, 1260, 1300] },
          { name: 'Last year', color: 'blue', points: [860, 890, 910, 940, 920, 970, 990, 1010, 1030, 1050, 1080, 1100] },
        ],
      },
      {
        kind: 'donut', title: 'Payer mix', centerLabel: 'claims',
        slices: [
          { label: 'Medicaid Waiver', value: 68, tint: 'mint' },
          { label: 'County', value: 19, tint: 'blue' },
          { label: 'Private', value: 13, tint: 'lavender' },
        ],
      },
      {
        kind: 'list', title: 'Top payer activity', viewAllHref: '/app/billing/claims',
        items: [
          { icon: 'landmark', tint: 'mint', title: 'Ohio Medicaid — batch paid', meta: '$412k · today', href: '/app/billing/claims' },
          { icon: 'landmark', tint: 'blue', title: 'Franklin County DD — remit', meta: '$86k · yesterday', href: '/app/billing/claims' },
          { icon: 'landmark', tint: 'lavender', title: 'Private pay — invoices sent', meta: '$34k · 2d ago', href: '/app/billing/claims' },
          { icon: 'landmark', tint: 'pink', title: '2 claims denied — review', meta: '$9.4k · 3d ago', href: '/app/billing/claims' },
        ],
      },
      { kind: 'ring', title: 'Collection rate', percent: 97, tint: 'mint', caption: '97% of billed $ collected' },
      {
        kind: 'actions', title: 'Quick actions',
        actions: [
          { icon: 'landmark', label: 'Open billing', tint: 'blue', href: '/app/billing/claims' },
          { icon: 'wallet', label: 'Payroll summary', tint: 'mint', href: '/app/payroll/hours' },
          { icon: 'gauge', label: 'Leadership view', tint: 'lavender', href: '/app/leadership/overview' },
          { icon: 'handshake', label: 'Referral pipeline', tint: 'peach', href: '/app/crm/pipeline' },
        ],
      },
    ],
  },
}

/* ---------- 8 · Quality Indicators (dashboard) ---------- */

const qualityPage: PageSchema = {
  id: 'indicators',
  type: 'dashboard',
  title: 'Quality Indicators',
  icon: 'target',
  dataSource: { resource: 'activity' },
  config: {
    greeting: { name: 'Quality', subtitle: 'KPIs tracked against DODD benchmarks and internal targets.' },
    widgets: [
      { kind: 'stat', label: 'Falls per 1,000 hrs', value: 2, delta: -18.4, deltaLabel: 'vs last quarter', tint: 'amber', spark: [4, 3, 4, 3, 3, 2, 3, 2, 2] },
      { kind: 'stat', label: 'Med errors (30d)', value: 3, delta: -25.0, tint: 'pink', spark: [6, 5, 6, 5, 4, 5, 4, 3, 3] },
      { kind: 'stat', label: 'Hospitalizations (YTD)', value: 5, delta: 0.0, deltaLabel: 'vs last year', tint: 'blue', spark: [2, 2, 3, 3, 4, 4, 4, 5, 5] },
      { kind: 'stat', label: 'Training compliance', value: 96, delta: 2.4, deltaLabel: '% staff current', tint: 'mint', spark: [90, 91, 92, 93, 93, 94, 95, 95, 96] },
      {
        kind: 'area', span: 2, title: 'Incidents by month — trend',
        series: [
          { name: 'Reported', color: 'amber', points: [9, 8, 10, 7, 8, 6, 7, 6, 5, 6, 4, 5] },
          { name: 'MUI-level', color: 'pink', points: [2, 1, 2, 1, 1, 1, 0, 1, 1, 0, 1, 0] },
        ],
      },
      {
        kind: 'donut', title: 'Audit findings by area', centerLabel: 'findings',
        slices: [
          { label: 'Medication', value: 9, tint: 'pink' },
          { label: 'Documentation', value: 7, tint: 'lavender' },
          { label: 'House safety', value: 5, tint: 'amber' },
          { label: 'Finance', value: 3, tint: 'blue' },
        ],
      },
      {
        kind: 'list', title: 'Recent audits', viewAllHref: '/app/audits/log',
        items: [
          { icon: 'clipboard-check', tint: 'mint', title: 'Quarterly med-room review', meta: 'Score 96 · passed', href: '/app/audits/log' },
          { icon: 'clipboard-check', tint: 'amber', title: 'Fire drill & egress check', meta: 'Score 88 · follow-up', href: '/app/audits/log' },
          { icon: 'clipboard-check', tint: 'blue', title: 'Billing trail spot check', meta: 'Score 92 · passed', href: '/app/audits/log' },
        ],
      },
      { kind: 'ring', title: 'KPI targets met', percent: 82, tint: 'mint', caption: '9 of 11 indicators on target' },
    ],
  },
}

/* ---------- 9 · Visits & EVV (sheet / visits) ---------- */

const visitsPage: PageSchema = {
  id: 'evv',
  type: 'sheet',
  title: 'Visits & EVV',
  icon: 'map-pin-check',
  dataSource: { resource: 'visits' },
  config: {
    entity: ['visit', 'visits'],
    searchPlaceholder: 'Search visits…',
    // sweep: focus scoping — client initials or staff name both narrow the log
    scopeBy: ['client', 'staff'],
    secondaryActions: [{ id: 'export', label: 'Export EVV', icon: 'download', toast: 'Export started' }],
    primaryAction: { label: 'Log visit', icon: 'plus' },
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'staff', label: 'Staff', kind: 'text', sortable: true, width: 180 },
      { key: 'client', label: 'Client', kind: 'text', width: 110 },
      { key: 'service', label: 'Service', kind: 'chip', tintBy: { PC: 'mint', HPC: 'blue', Respite: 'lavender' } },
      { key: 'clockIn', label: 'Clock in', kind: 'date', sortable: true, format: 'MMM d, h:mm a' },
      { key: 'clockOut', label: 'Clock out', kind: 'date', format: 'h:mm a' },
      { key: 'verified', label: 'Verified', kind: 'chip', tintBy: { true: 'mint', false: 'pink' } },
    ],
    filters: [
      { key: 'service', label: 'Service', options: ['PC', 'HPC', 'Respite'] },
      { key: 'verified', label: 'Verified', options: ['true', 'false'] },
    ],
    pagination: { pageSize: 12 },
  },
}

/* ---------- 10 · Audits & Compliance (sheet / audits) ---------- */

const auditsPage: PageSchema = {
  id: 'log',
  type: 'sheet',
  title: 'Audits & Compliance',
  icon: 'clipboard-check',
  dataSource: { resource: 'audits' },
  config: {
    entity: ['audit', 'audits'],
    searchPlaceholder: 'Search audits…',
    secondaryActions: [{ id: 'export', label: 'Export', icon: 'download', toast: 'Export started' }],
    primaryAction: { label: 'Schedule audit', icon: 'plus' },
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'title', label: 'Audit', kind: 'text', sortable: true, width: 260 },
      { key: 'area', label: 'Area', kind: 'chip', tintBy: { Medication: 'pink', Finance: 'blue', 'House safety': 'amber', Documentation: 'lavender' } },
      { key: 'auditor', label: 'Auditor', kind: 'text' },
      { key: 'date', label: 'Date', kind: 'date', sortable: true, format: 'MMM d, yyyy' },
      { key: 'score', label: 'Score', kind: 'progress', sortable: true },
      { key: 'findings', label: 'Findings', kind: 'number' },
      { key: 'status', label: 'Status', kind: 'chip', dot: true, tintBy: { passed: 'mint', 'follow-up': 'amber', scheduled: 'blue' } },
    ],
    filters: [
      { key: 'area', label: 'Area', options: ['Medication', 'Finance', 'House safety', 'Documentation'] },
      { key: 'status', label: 'Status', options: ['passed', 'follow-up', 'scheduled'] },
    ],
    pagination: { pageSize: 10 },
  },
}

/* ---------- 11 · Payroll & Hours (sheet / people) ---------- */

const payrollPage: PageSchema = {
  id: 'hours',
  type: 'sheet',
  title: 'Payroll & Hours',
  icon: 'wallet',
  dataSource: { resource: 'people' },
  config: {
    entity: ['employee', 'employees'],
    searchPlaceholder: 'Search employees…',
    // sweep: distinct manual-order key — this sheet shares `people` with the directory
    orderKey: 'payroll-hours',
    secondaryActions: [{ id: 'export', label: 'Export to payroll', icon: 'download', toast: 'Export started' }],
    primaryAction: { label: 'Run payroll', icon: 'wallet' },
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'name', label: 'Employee', kind: 'avatar+text', sortable: true, subKey: 'email', width: 240 },
      { key: 'role', label: 'Role', kind: 'text' },
      { key: 'department', label: 'Team', kind: 'chip', tintBy: { Engineering: 'mint', Design: 'lavender', Ops: 'peach', 'G&A': 'blue' } },
      { key: 'location', label: 'Site', kind: 'text', icon: 'map-pin' },
      { key: 'status', label: 'Status', kind: 'chip', dot: true, tintBy: { active: 'mint', away: 'amber', off: 'pink' } },
      { key: 'startDate', label: 'Hired', kind: 'date', sortable: true, format: 'MMM yyyy' },
    ],
    filters: [
      { key: 'department', label: 'Team', options: ['Engineering', 'Design', 'Ops', 'G&A'] },
      { key: 'status', label: 'Status', options: ['active', 'away', 'off'] },
    ],
    pagination: { pageSize: 12 },
  },
}

/* ---------- 12 · Billing & Payers (sheet / billingClaims) ---------- */

const billingPage: PageSchema = {
  id: 'claims',
  type: 'sheet',
  title: 'Billing & Payers',
  icon: 'landmark',
  dataSource: { resource: 'billingClaims' },
  config: {
    entity: ['claim', 'claims'],
    searchPlaceholder: 'Search claims…',
    secondaryActions: [{ id: 'export', label: 'Export 835', icon: 'download', toast: 'Export started' }],
    primaryAction: { label: 'Submit batch', icon: 'landmark' },
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'client', label: 'Client', kind: 'text', width: 110 },
      { key: 'payer', label: 'Payer', kind: 'chip', tintBy: { 'Medicaid Waiver': 'mint', Private: 'lavender', County: 'blue' } },
      { key: 'spanStart', label: 'Span start', kind: 'date', sortable: true, format: 'MMM d' },
      { key: 'spanEnd', label: 'Span end', kind: 'date', format: 'MMM d' },
      { key: 'units', label: 'Units', kind: 'number', sortable: true },
      { key: 'amount', label: 'Amount ($)', kind: 'number', sortable: true },
      { key: 'status', label: 'Status', kind: 'chip', dot: true, tintBy: { submitted: 'blue', paid: 'mint', denied: 'pink' } },
    ],
    filters: [
      { key: 'payer', label: 'Payer', options: ['Medicaid Waiver', 'Private', 'County'] },
      { key: 'status', label: 'Status', options: ['submitted', 'paid', 'denied'] },
    ],
    pagination: { pageSize: 12 },
  },
}

/* ---------- 13 · Training Tracker (sheet / people) ---------- */

const trainingPage: PageSchema = {
  id: 'tracker',
  type: 'sheet',
  title: 'Training Tracker',
  icon: 'graduation-cap',
  dataSource: { resource: 'people' },
  config: {
    entity: ['staff member', 'staff'],
    searchPlaceholder: 'Search staff…',
    // sweep: distinct manual-order key — this sheet shares `people` with the directory
    orderKey: 'training-tracker',
    secondaryActions: [{ id: 'export', label: 'Export matrix', icon: 'download', toast: 'Export started' }],
    primaryAction: { label: 'Assign course', icon: 'graduation-cap' },
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'name', label: 'Staff', kind: 'avatar+text', sortable: true, subKey: 'email', width: 240 },
      { key: 'role', label: 'Role', kind: 'text' },
      { key: 'department', label: 'Team', kind: 'chip', tintBy: { Engineering: 'mint', Design: 'lavender', Ops: 'peach', 'G&A': 'blue' } },
      { key: 'location', label: 'Site', kind: 'text', icon: 'map-pin' },
      { key: 'status', label: 'Certs current', kind: 'chip', dot: true, tintBy: { active: 'mint', away: 'amber', off: 'pink' } },
      { key: 'startDate', label: 'Last renewal', kind: 'date', sortable: true, format: 'MMM yyyy' },
    ],
    filters: [
      { key: 'department', label: 'Team', options: ['Engineering', 'Design', 'Ops', 'G&A'] },
      { key: 'status', label: 'Certs current', options: ['active', 'away', 'off'] },
    ],
    pagination: { pageSize: 12 },
  },
}

/* ---------- Users (custom feature page) ---------- */

// Mounted by a static route in App.tsx (/app/users/accounts).
const usersAccountsPage: PageSchema = {
  id: 'accounts',
  type: 'sheet',
  title: 'Users',
  icon: 'users',
  dataSource: { resource: 'people' }, // nominal — the page is a custom feature, no sheet reads
  config: { entity: ['user', 'users'], customFeature: 'users/UsersPage', columns: [] },
}

/* ---------- ISP Library (sheet over the real service plans) ---------- */

// ISPs — the real Individual Service Plans, imported from asa_isp_chat (tools/import_isps.py), which is…
const ispPage: PageSchema = {
  id: 'library',
  type: 'documents',
  title: 'ISP Library',
  icon: 'clipboard-plus',
  dataSource: { resource: 'isps' },
  config: {
    entity: ['service plan', 'service plans'],
    hero: ispHero,
    searchPlaceholder: 'Search by client, diagnosis, allergy…',
    export: true,
    // The rail stands on the LEFT here, and the plan can be filed as a PDF a house manager carries into a house…
    reader: { showToc: true, showMeta: true, allowPrint: true, tocSide: 'left', pdfAction: 'ispPlanPdf' },
    // The rail lists PEOPLE, not date spans — people's names instead of dates, and the year still shows on each…
    collectionStyle: { icon: 'user', sort: 'asc' },
    docMap: {
      title: 'client_name',
      subtitle: 'isp_year',
      updatedAt: 'updated_at',
      collection: { field: 'client_name', prefix: 'c' },
      sections: [
        { heading: 'Allergies', field: 'allergies', callout: 'pink', keepEmpty: true },
        { heading: 'Safety & risks', field: 'safety_risks', callout: 'peach' },
        { heading: 'Supervision level', field: 'supervision_level', callout: 'amber', keepEmpty: true },
        { heading: 'Medications', field: 'medications' },
        { heading: 'Diet & nutrition', field: 'diet_nutrition' },
        { heading: 'Behaviours', field: 'behaviors' },
        { heading: 'Mobility', field: 'mobility' },
        { heading: 'Personal care', field: 'personal_care' },
        { heading: 'Communication', field: 'communication' },
        { heading: 'Diagnoses', field: 'diagnoses' },
        { heading: 'Medical summary', field: 'medical_summary' },
        { heading: 'Goals & outcomes', field: 'goals_outcomes' },
        { heading: 'Important TO them', field: 'important_to' },
        { heading: 'Important FOR them', field: 'important_for' },
        { heading: 'Contacts', field: 'contacts' },
        { heading: 'Source document', field: 'source_file' },
      ],
    },
  },
}

/* ---------- Staff Performance (custom feature page) ---------- */

// Custom feature screen: PerformanceBoard renders the metric grid, the metric editor and the entry modal.
export const performancePage: PageSchema = {
  id: 'board',
  type: 'sheet',
  title: 'Staff Performance',
  icon: 'trending-up',
  dataSource: { resource: 'people' },
  config: {
    entity: 'staff',
    customFeature: 'performance/PerformanceBoard',
    columns: [
      { key: 'name', label: 'Name', kind: 'text', sortable: true },
      { key: 'role', label: 'Role', kind: 'chip' },
    ],
  },
}

/* ---------- 14 · Onboarding Tracker (pipeline / onboarding) ---------- */

// `onboardingPage` — the Tracker's board — left with its manifest; see the note where the manifest stood.

/* ---------- 15 · Care Plans / ISP (documents / careDocs#isp) ---------- */

const carePlansPage: PageSchema = {
  id: 'plans',
  type: 'documents',
  title: 'Care Plans / ISP',
  icon: 'heart-handshake',
  dataSource: { resource: 'careDocs', params: { filters: { collection: 'isp' } } },
  config: {
    cardStyle: 'cover',
    collections: [{ id: 'isp', label: 'Individual Service Plans', icon: 'heart-handshake', tint: 'pink' }],
    reader: { showToc: true, showMeta: true, allowPrint: true },
    // sweep: client focus narrows the library to that person's plans
    scopeBy: 'client',
  },
}

/* ---------- 16 · Behavior Support (custom / behaviorBoard) ---------- */

// THE APP CHANGED WHAT IT IS ABOUT: Behavior Support now finds which apps a person actually uses, tracing usage…
const behaviorPage: PageSchema = {
  id: 'reading',
  type: 'sheet',
  title: 'Behavior Support',
  icon: 'brain',
  // the board is a DERIVED slice the relay writes; the screen is bespoke and mounted through CUSTOM_PAGES, so this…
  dataSource: { resource: 'behaviorBoard' },
  config: {
    entity: ['reading', 'readings'],
    customFeature: 'behavior/BehaviorSupportPage',
    searchPlaceholder: 'Find a person…',
  },
}

// USER SUPPORT — the same wellbeing reading, with the HR record merged onto every person's card; the result of that…
const userSupportPage: PageSchema = {
  id: 'people',
  type: 'sheet',
  title: 'User Support',
  icon: 'user-check',
  dataSource: { resource: 'behaviorBoard' },
  config: {
    entity: ['person', 'people'],
    customFeature: 'usersupport/UserSupportPage',
    // THE DIRECTORY RIDES ALONG: 100% of the People app's user features are carried into User Support.
    prefetch: [{ resource: 'people' }],
    searchPlaceholder: 'Find a person…',
  },
}

/* ---------- 17 · Family Portal (custom home + documents / careDocs#family) ---------- */

// THE PORTAL COMES HOME (kill list 9).
const familyHomePage: PageSchema = {
  id: 'home',
  type: 'sheet',
  title: 'Home',
  icon: 'house-heart',
  dataSource: { resource: 'clients' },
  config: { entity: ['client', 'clients'], customFeature: 'family/FamilyHomePage' },
}

const familyPage: PageSchema = {
  id: 'updates',
  type: 'documents',
  title: 'Updates',
  icon: 'users',
  dataSource: { resource: 'careDocs', params: { filters: { collection: 'family' } } },
  config: {
    cardStyle: 'minimal',
    collections: [{ id: 'family', label: 'Family updates', icon: 'users', tint: 'blue' }],
    reader: { showToc: true, showMeta: true, allowPrint: true },
    // sweep: client focus narrows the feed to updates for that family
    scopeBy: 'client',
  },
}

/* ---------- 18 · Transportation (sheet / routes) ---------- */

const transportationPage: PageSchema = {
  id: 'routes',
  type: 'sheet',
  title: 'Transportation Users',
  icon: 'van',
  dataSource: { resource: 'routes' },
  config: {
    // BESPOKE: everything it needs is already in hand, so the page merges the info the platform already holds: the…
    customFeature: 'transportation/TransportationPage',
    // Fleet & Mileage the APP retired — Transportation shows all of it — but its two resources live on, read by…
    prefetch: [{ resource: 'fleetVehicles' }, { resource: 'mileageLogs' }],
    entity: ['route', 'routes'],
    searchPlaceholder: 'Search routes or drivers…',
    secondaryActions: [{ id: 'export', label: 'Export', icon: 'download', toast: 'Export started' }],
    // ops-flows: working "Add route" modal (driver/vehicle/date/time/origin/ destination/dynamic stops) — gated…
    primaryAction: { label: 'Add route', icon: 'route', action: 'route-add', perm: 'apps.manage' },
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'route', label: 'Route', kind: 'text', sortable: true, width: 200 },
      { key: 'driver', label: 'Driver', kind: 'text' },
      { key: 'vehicle', label: 'Vehicle', kind: 'text', icon: 'van' },
      { key: 'destination', label: 'Destination', kind: 'text', icon: 'map-pin', width: 260 },
      { key: 'clients', label: 'Clients', kind: 'number', sortable: true },
      { key: 'pickupTime', label: 'Pickup', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'chip', dot: true, tintBy: { 'on-time': 'mint', delayed: 'amber', completed: 'blue' } },
    ],
    filters: [
      { key: 'status', label: 'Status', options: ['on-time', 'delayed', 'completed'] },
    ],
    rowActions: [
      { id: 'maps', label: 'Open in Google Maps', icon: 'square-arrow-out-up-right', action: 'maps-open', quick: true },
      { id: 'view', label: 'View route', icon: 'eye' },
    ],
    pagination: { pageSize: 10 },
    detailPanel: {
      header: {
        title: 'route', subtitle: 'driver',
        statusChip: { field: 'status', tintBy: { 'on-time': 'mint', delayed: 'amber', completed: 'blue' } },
        actions: [
          { icon: 'square-arrow-out-up-right', label: 'Open in Google Maps', iconOnly: true, toast: 'Use the footer button for full directions' },
          { icon: 'ellipsis', label: 'More actions', iconOnly: true, toast: 'More actions' },
        ],
      },
      stats: [
        { label: 'Clients', value: 'clients', icon: 'users', tint: 'blue' },
        { label: 'Pickup', value: 'pickupTime', icon: 'clock', tint: 'peach' },
        { label: 'Vehicle', value: 'vehicle', icon: 'van', tint: 'lavender' },
        { label: 'Date', value: 'date', icon: 'calendar', tint: 'mint' },
      ],
      sections: [
        { kind: 'map', title: 'Map preview', addressField: 'destination' },
        { kind: 'fields', title: 'Route details', fields: [
          { icon: 'map-pin', label: 'Origin', value: 'origin' },
          { icon: 'flag', label: 'Destination', value: 'destination' },
          { icon: 'user', label: 'Driver', value: 'driver' },
          { icon: 'van', label: 'Vehicle', value: 'vehicle' },
          { icon: 'calendar', label: 'Date', value: 'date' },
          { icon: 'clock', label: 'Pickup', value: 'pickupTime' },
        ] },
        { kind: 'list', title: 'Stops', itemsField: 'stops' },
      ],
      footer: [
        { label: 'Open in Google Maps', variant: 'primary', icon: 'square-arrow-out-up-right', action: 'maps-open' },
      ],
    },
  },
}

/* ---------- 19 · Meals & Nutrition (sheet / mealPlans) ---------- */

const mealsPage: PageSchema = {
  id: 'plans',
  type: 'sheet',
  title: 'Meals & Nutrition',
  icon: 'utensils',
  dataSource: { resource: 'mealPlans' },
  config: {
    entity: ['meal plan', 'meal plans'],
    searchPlaceholder: 'Search meal plans…',
    secondaryActions: [{ id: 'export', label: 'Export', icon: 'download', toast: 'Export started' }],
    primaryAction: { label: 'Add plan', icon: 'utensils' },
    searchable: true,
    rowHeight: 56,
    columns: [
      { key: 'house', label: 'House', kind: 'chip', tintBy: { 'Maple House': 'mint', 'Cedar House': 'lavender', 'Birch House': 'peach', 'Willow House': 'blue' } },
      { key: 'plan', label: 'Plan', kind: 'chip', sortable: true, tintBy: { Regular: 'mint', Diabetic: 'blue', Pureed: 'amber', 'Texture-modified': 'lavender' } },
      { key: 'allergies', label: 'Allergies', kind: 'text', icon: 'siren' },
      { key: 'updatedBy', label: 'Updated by', kind: 'text' },
      { key: 'updatedAt', label: 'Updated', kind: 'date', sortable: true, format: 'MMM d, yyyy' },
    ],
    filters: [
      { key: 'house', label: 'House', options: ['Maple House', 'Cedar House', 'Birch House', 'Willow House'] },
      { key: 'plan', label: 'Plan', options: ['Regular', 'Diabetic', 'Pureed', 'Texture-modified'] },
    ],
    pagination: { pageSize: 10 },
  },
}

/* ---------- 20 · House Work Orders (pipeline / workOrders) ---------- */

const workOrdersPage: PageSchema = {
  id: 'board',
  type: 'pipeline',
  title: 'House Work Orders',
  icon: 'wrench',
  dataSource: { resource: 'workOrders' },
  config: {
    entity: 'open work orders',
    stageField: 'status',
    allowDrag: true,
    showRail: true,
    showSummary: true,
    summary: { footer: 'Avg. time to done: 9 days' },
    stageEmptyText: 'Nothing here — drag a work order in',
    primaryAction: { label: 'Report issue', icon: 'wrench' },
    stages: [
      { id: 'reported', label: 'Reported', tint: 'pink', description: 'New issues from house staff' },
      { id: 'scheduled', label: 'Scheduled', tint: 'amber', description: 'Vendor booked or in-house visit set' },
      { id: 'in-progress', label: 'In progress', tint: 'blue', description: 'Work underway' },
      { id: 'done', label: 'Done', tint: 'mint', description: 'Fixed and verified', celebrate: true },
    ],
    cardFields: {
      title: 'issue',
      subtitle: 'house',
      tags: { key: 'priority', tintBy: { low: 'mint', medium: 'amber', high: 'pink' } },
      meta: ['daysInStage'],
    },
  },
}


// The documents themselves, alongside the signatures.
export const policyDocsPage: PageSchema = {
  id: 'documents',
  type: 'documents',
  title: 'Policies',
  icon: 'shield',
  dataSource: { resource: 'policies' },
  config: {},
}

// Its own page and its own resource because it carries the management team's personal mobile numbers…
const contactListPage: PageSchema = {
  id: 'contacts',
  type: 'documents',
  title: 'Contact list',
  icon: 'phone',
  dataSource: { resource: 'contactLists' },
  config: {},
}

/* ---------- 21 · Policy Acknowledgments (sheet / policyAcks) ---------- */

/* ---------- 22 · Equipment & Assets (sheet / equipment) ---------- */

// sweep: equipment status colors — borrowed=GREEN (--status-green tokens), available/idle=--info blue…
const EQUIPMENT_STATUS_STYLES = {
  borrowed: { bg: 'var(--status-green-soft)', fg: 'var(--status-green)' },
  available: { bg: 'var(--tint-info)', fg: 'var(--tint-info-fg)' },
  repair: { bg: 'var(--tint-danger)', fg: 'var(--tint-danger-fg)' },
} as const

const equipmentPage: PageSchema = {
  id: 'assets',
  type: 'sheet',
  title: 'Equipment & Assets',
  icon: 'monitor',
  dataSource: { resource: 'equipment' },
  config: {
    entity: ['asset', 'assets'],
    searchPlaceholder: 'Search equipment…',
    secondaryActions: [{ id: 'export', label: 'Export', icon: 'download', toast: 'Export started' }],
    primaryAction: { label: 'Add asset', icon: 'package' },
    searchable: true,
    rowHeight: 56,
    // sweep: status summary strip — X borrowed / Y available / Z in repair
    summaryStrip: {
      title: 'Fleet status',
      icon: 'monitor',
      tint: 'blue',
      items: [
        {
          label: 'Borrowed',
          icon: 'user-check',
          tint: 'mint',
          compute: (rows: any[]) => rows.filter((r) => r.status === 'borrowed').length,
        },
        {
          label: 'Available',
          icon: 'package',
          tint: 'blue',
          compute: (rows: any[]) => rows.filter((r) => r.status === 'available').length,
        },
        {
          label: 'In repair',
          icon: 'wrench',
          tint: 'pink',
          compute: (rows: any[]) => rows.filter((r) => r.status === 'repair').length,
        },
      ],
    },
    columns: [
      { key: 'item', label: 'Item', kind: 'text', sortable: true, width: 220 },
      { key: 'serial', label: 'Serial', kind: 'text' },
      { key: 'house', label: 'House', kind: 'chip', tintBy: { 'Maple House': 'mint', 'Cedar House': 'lavender', 'Birch House': 'peach', 'Willow House': 'blue' } },
      // sweep: highly visual status — colored dot chip + tinted cell + left border
      { key: 'status', label: 'Status', kind: 'chip', sortable: true, dot: true, tintCell: true, styleBy: EQUIPMENT_STATUS_STYLES },
      { key: 'borrowedBy', label: 'Borrowed by', kind: 'text', icon: 'user-check' },
      { key: 'condition', label: 'Condition', kind: 'chip', dot: true, tintBy: { new: 'mint', good: 'blue', fair: 'amber', repair: 'pink' } },
    ],
    filters: [
      { key: 'status', label: 'Status', options: ['borrowed', 'available', 'repair'] },
      { key: 'house', label: 'House', options: ['Maple House', 'Cedar House', 'Birch House', 'Willow House'] },
      { key: 'condition', label: 'Condition', options: ['new', 'good', 'fair', 'repair'] },
    ],
    pagination: { pageSize: 12 },
  },
}

/* ================= context-mode: Directors (biographies) ================= */

/* ---------- 23 · Directors — dedicated director biography section ---------- */

const directorsPage: PageSchema = {
  id: 'directory',
  type: 'sheet',
  title: 'Directors',
  icon: 'id-card',
  dataSource: { resource: 'directors' },
  config: {
    entity: ['director', 'directors'],
    searchPlaceholder: 'Search directors…',
    focusDrag: { type: 'director', idKey: 'id', nameKey: 'name', avatarKey: 'photo', subtitleKey: 'title' },
    scopeBy: 'name',
    searchable: true,
    rowHeight: 64,
    viewToggle: true,
    // live editing (Directory spreadsheet): add / edit / delete, people.edit
    primaryAction: {
      label: 'Add director',
      icon: 'user-plus',
      form: {
        title: 'Add director',
        description: 'Creates a new row in the Directory spreadsheet. Biography and career can be filled in afterwards via Edit.',
        resource: 'directors',
        perm: 'people.edit',
        fields: [
          { key: 'name', label: 'Full name', required: true },
          { key: 'title', label: 'Job title', required: true },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'office', label: 'Office' },
          { key: 'tenure', label: 'Tenure label', placeholder: 'e.g. Since 2021 · 4 yrs' },
          { key: 'focusAreas', label: 'Focus areas', placeholder: 'Comma-separated, e.g. House operations, Safety audits' },
          { key: 'housesOverseen', label: 'Houses overseen', type: 'number' },
          { key: 'directReports', label: 'Direct reports', type: 'number' },
        ],
      },
    },
    editForm: {
      title: 'Edit director',
      resource: 'directors',
      perm: 'people.edit',
      fields: [
        { key: 'name', label: 'Full name', required: true },
        { key: 'title', label: 'Job title', required: true },
        { key: 'avatar', label: 'Photo / avatar', type: 'photo' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'office', label: 'Office' },
        { key: 'tenure', label: 'Tenure label', placeholder: 'e.g. Since 2016 · 9 yrs' },
        { key: 'tenureYears', label: 'Tenure (years)', type: 'number' },
        { key: 'focusAreas', label: 'Focus areas', type: 'tags', placeholder: 'Comma-separated' },
        { key: 'housesOverseen', label: 'Houses overseen', type: 'number' },
        { key: 'directReports', label: 'Direct reports', type: 'number' },
        { key: 'bio', label: 'Biography (3 paragraphs)', type: 'paragraphs' },
      ],
    },
    rowDelete: { perm: 'people.edit' },
    columns: [
      { key: 'name', label: 'Director', kind: 'avatar+text', sortable: true, subKey: 'email', width: 260 },
      { key: 'title', label: 'Title', kind: 'text', icon: 'briefcase' },
      { key: 'focusAreas', label: 'Focus areas', kind: 'chips', max: 2, tintCycle: ['lavender', 'blue', 'pink'] },
      { key: 'tenure', label: 'Tenure', kind: 'text', icon: 'clock' },
      { key: 'housesOverseen', label: 'Houses', kind: 'number', sortable: true },
      { key: 'status', label: 'Status', kind: 'chip', dot: true, tintBy: { active: 'mint' } },
    ],
    filters: [
      { key: 'focusAreas', label: 'Focus area', options: ['Organizational strategy', 'House operations', 'Behavior support', 'Safety audits', 'ISP quality'] },
    ],
    rowActions: [
      { id: 'view', label: 'View biography', icon: 'eye' },
      { id: 'edit', label: 'Edit director', icon: 'pencil' },
      { id: 'delete', label: 'Remove director', icon: 'trash-2' },
    ],
    pagination: { pageSize: 10 },
    detailPanel: {
      header: {
        avatar: 'photo', title: 'name', subtitle: 'title',
        statusChip: { field: 'status', tintBy: { active: 'mint' }, labelBy: { active: 'active director' } },
        bookmark: { type: 'person', tint: 'lavender', href: '/app/directors/directory?record=:id' },
      },
      stats: [
        { label: 'Tenure (yrs)', value: 'tenureYears', icon: 'clock', tint: 'lavender' },
        { label: 'Direct reports', value: 'directReports', icon: 'users', tint: 'blue' },
        { label: 'Houses overseen', value: 'housesOverseen', icon: 'house', tint: 'mint' },
        { label: 'Focus areas', value: 4, icon: 'target', tint: 'pink' },
      ],
      sections: [
        { kind: 'chips', title: 'Focus areas', itemsField: 'focusAreas', icon: 'target', tints: ['lavender', 'blue', 'pink', 'peach'] },
        { kind: 'fields', title: 'Contact', fields: [
          { icon: 'mail', label: 'Email', value: 'email', hrefField: 'email', hrefPrefix: 'mailto:' },
          { icon: 'phone', label: 'Phone', value: 'phone', hrefField: 'phone', hrefPrefix: 'tel:' },
          { icon: 'map-pin', label: 'Office', value: 'office' },
          { icon: 'clock', label: 'Tenure', value: 'tenure' },
        ] },
        { kind: 'timeline', title: 'Biography', entriesField: 'bioEntries' },
        { kind: 'timeline', title: 'Career timeline', entriesField: 'career' },
      ],
      footer: [
        { label: 'Edit director', variant: 'primary', icon: 'pencil', edit: true },
      ],
    },
  },
}

// The division's task lists (the Division Task List book, one tab a person), kept in Postgres (app/sheet_resources.py
// dt* houses): a page a person, behind App Control's directors.tasks control — the master's alone until released.
const TASK_STATUS = ['Not started', 'In progress', 'Blocked', 'Reoccurring', 'Completed']
const TASK_TINTS: Record<string, TintName> = {
  'Not started': 'amber', 'In progress': 'blue', Blocked: 'pink', Reoccurring: 'lavender', Reoccuring: 'lavender',
  Completed: 'mint', completed: 'mint',
}

function taskListPage(id: string, person: string, resource: string, due = 'Due date'): PageSchema {
  return {
    id, type: 'sheet', title: `${person}'s tasks`, icon: 'list-checks', feature: 'directors.tasks',
    dataSource: { resource: resource as PageSchema['dataSource']['resource'] },
    config: {
      entity: ['task', 'tasks'],
      searchable: true,
      searchPlaceholder: `Search ${person}'s tasks…`,
      primaryAction: {
        label: 'Add task', icon: 'plus',
        form: {
          title: `Add a task for ${person}`, resource, perm: 'people.edit',
          presets: { Status: 'Not started' },
          fields: [
            { key: 'Task', label: 'Task', required: true },
            { key: 'Status', label: 'Status', type: 'select', options: TASK_STATUS },
            { key: due, label: 'Due date', placeholder: 'MM/DD/YYYY' },
            { key: 'Notes', label: 'Notes', type: 'textarea' },
          ],
        },
      },
      editForm: {
        title: 'Edit task', resource, perm: 'people.edit',
        fields: [
          { key: 'Task', label: 'Task', required: true },
          { key: 'Status', label: 'Status', type: 'select', options: TASK_STATUS },
          { key: due, label: 'Due date', placeholder: 'MM/DD/YYYY' },
          { key: 'Notes', label: 'Notes', type: 'textarea' },
        ],
      },
      rowDelete: { perm: 'people.edit' },
      columns: [
        { key: 'Task', label: 'Task', kind: 'text', sortable: true, width: 420 },
        { key: 'Status', label: 'Status', kind: 'chip', dot: true, sortable: true, tintBy: TASK_TINTS },
        { key: due, label: 'Due', kind: 'text', sortable: true },
        { key: 'Notes', label: 'Notes', kind: 'text' },
      ],
      filters: [{ key: 'Status', label: 'Status', options: TASK_STATUS }],
      rowActions: [
        { id: 'edit', label: 'Edit task', icon: 'pencil' },
        { id: 'delete', label: 'Remove task', icon: 'trash-2' },
      ],
      pagination: { pageSize: 25 },
    },
  }
}

// a one-column tab (its first line is its header): each line a row, added, edited and removed as text
function noteListPage(id: string, title: string, icon: string, resource: string, column: string): PageSchema {
  const fields = [{ key: column, label: 'Text', type: 'textarea', required: true }]
  return {
    id, type: 'sheet', title, icon, feature: 'directors.tasks',
    dataSource: { resource: resource as PageSchema['dataSource']['resource'] },
    config: {
      entity: ['line', 'lines'],
      searchable: true,
      primaryAction: { label: 'Add line', icon: 'plus',
                       form: { title: `Add to ${title}`, resource, perm: 'people.edit', fields } },
      editForm: { title: 'Edit line', resource, perm: 'people.edit', fields },
      rowDelete: { perm: 'people.edit' },
      columns: [{ key: column, label: column.split('\n')[0].slice(0, 60), kind: 'text' }],
      rowActions: [
        { id: 'edit', label: 'Edit line', icon: 'pencil' },
        { id: 'delete', label: 'Remove line', icon: 'trash-2' },
      ],
      pagination: { pageSize: 50 },
    },
  }
}

// The In-Person Screening Notes form kept in Postgres (app/sheet_resources.py screeningNotes): the interviewers'
// scorecards, behind App Control's interviews.screening-notes control — the master's alone until released.
const WATER = 'Glass of water Test\nOffer a glass of water to the candidate, and analyze the following:'
const OTHER = "Other Notes \nIncluding : Certifications, Overall notes, Situations observed, Anything you may think it's " +
  'important to mention'
const SCORE = ['1', '2', '3', '4', '5']
const SCREENING_FIELDS = [
  { key: 'Candidate Name', label: 'Candidate', required: true },
  { key: "Interviewer's Name", label: 'Interviewer', required: true },
  { key: 'Timestamp', label: 'When', placeholder: 'MM/DD/YYYY HH:MM:SS' },
  { key: 'Show or No-show', label: 'Show or no-show', type: 'select', options: ['Show', 'No-show'] },
  { key: 'Appearance', label: 'Appearance', type: 'select', options: SCORE },
  { key: 'Timeliness', label: 'Timeliness', type: 'select', options: SCORE },
  { key: 'Attitude', label: 'Attitude', type: 'select', options: SCORE },
  { key: 'Communication', label: 'Communication', type: 'select', options: SCORE },
  { key: 'Courtesy Test', label: 'Courtesy test' },
  { key: 'The Listening Test', label: 'Listening test' },
  { key: 'Curiosity / Interest', label: 'Curiosity / interest' },
  { key: WATER, label: 'Glass of water test' },
  { key: 'Overall Candidate Score', label: 'Overall score' },
  { key: 'Observations / Potential Concerns', label: 'Observations / concerns', type: 'textarea' },
  { key: OTHER, label: 'Other notes', type: 'textarea' },
  { key: 'Processed', label: 'Processed' },
]
const screeningNotesPage: PageSchema = {
  id: 'screening-notes', type: 'sheet', title: 'In-person screening notes', icon: 'notebook-pen',
  feature: 'interviews.screening-notes',
  dataSource: { resource: 'screeningNotes' as PageSchema['dataSource']['resource'] },
  config: {
    entity: ['scorecard', 'scorecards'],
    searchable: true,
    searchPlaceholder: 'Search candidates…',
    primaryAction: { label: 'New scorecard', icon: 'plus', form: {
      title: 'New screening scorecard', resource: 'screeningNotes', perm: 'people.edit', wide: true,
      fields: SCREENING_FIELDS } },
    editForm: { title: 'Edit scorecard', resource: 'screeningNotes', perm: 'people.edit', fields: SCREENING_FIELDS },
    rowDelete: { perm: 'people.edit' },
    columns: [
      { key: 'Timestamp', label: 'When', kind: 'text', sortable: true },
      { key: 'Candidate Name', label: 'Candidate', kind: 'text', sortable: true, width: 200 },
      { key: "Interviewer's Name", label: 'Interviewer', kind: 'text', sortable: true },
      { key: 'Show or No-show', label: 'Showed', kind: 'chip' },
      { key: 'Overall Candidate Score', label: 'Score', kind: 'text', sortable: true },
      { key: 'Observations / Potential Concerns', label: 'Observations', kind: 'text', width: 320 },
      { key: 'Processed', label: 'Processed', kind: 'chip', tintBy: { SYNCED: 'mint', UNMATCHED: 'amber' } },
    ],
    rowActions: [
      { id: 'edit', label: 'Edit scorecard', icon: 'pencil' },
      { id: 'delete', label: 'Remove scorecard', icon: 'trash-2' },
    ],
    pagination: { pageSize: 25 },
  },
}

const divisionTaskPages: PageSchema[] = [
  taskListPage('tasks-britt', 'Britt', 'dtBritt'),
  taskListPage('tasks-cassy', 'Cassy', 'dtCassy'),
  taskListPage('tasks-nat', 'Nat', 'dtNat', 'Due Date'),
  taskListPage('tasks-regina', 'Regina', 'dtRegina'),
  taskListPage('tasks-tammy', 'Tammy', 'dtTammy'),
  taskListPage('tasks-tieara', 'Tieara', 'dtTieara'),
  noteListPage('doc-review', 'Monthly doc review', 'file-check', 'dtMonthlyDocReview', 'March 2026'),
  noteListPage('division-notes', 'Division notes', 'notebook-pen', 'dtNotes',
               'JH- Tracking- No comments. everything done'),
]

/* ---------- 24 · Projects (sheet + detail / projects) — ops-flows ---------- */

// Projects — the real portfolio, imported from the old platform (tools/import_projects.py).
const projectsPage: PageSchema = {
  id: 'board',
  type: 'sheet',
  title: 'Projects',
  icon: 'folder-kanban',
  dataSource: { resource: 'projects' },
  config: {
    entity: ['project', 'projects'],
    searchPlaceholder: 'Search projects…',
    secondaryActions: [{ id: 'export', label: 'Export', icon: 'download', toast: 'Export started' }],
    primaryAction: {
      label: 'New project',
      icon: 'folder-kanban',
      form: {
        title: 'New project',
        description: 'Add a project to the portfolio.',
        resource: 'projects',
        perm: 'apps.manage',
        submitLabel: 'Create project',
        fields: [
          { key: 'name', label: 'Name', required: true },
          { key: 'category', label: 'Category', placeholder: 'e.g. AI platform, Talent, Operations' },
          { key: 'status', label: 'Status', type: 'select', required: true,
            options: ['live', 'operational', 'in_use', 'experimental', 'framework', 'early', 'archived', 'unassessed'] },
          { key: 'blurb', label: 'What it is' },
        ],
      },
    },
    searchable: true,
    rowHeight: 64,
    // Every field is editable — the whole point of moving the portfolio out of a Python dict is that a status or a…
    editForm: {
      title: 'Edit project',
      description: 'The portfolio record — what it is, where it stands, what it still lacks.',
      resource: 'projects',
      perm: 'apps.manage' as Permission,
      submitLabel: 'Save project',
      fields: [
        { key: 'name', label: 'Name', required: true },
        { key: 'category', label: 'Category', placeholder: 'e.g. AI platform, Talent, Operations' },
        { key: 'status', label: 'Status', type: 'select',
          options: ['live', 'operational', 'in_use', 'experimental', 'framework', 'early', 'archived', 'unassessed'] },
        { key: 'blurb', label: 'What it is', type: 'textarea', placeholder: 'Two or three sentences someone new could act on.' },
        // Written one per line; stored joined with " · ", which is the format the old platform export and the…
        { key: 'strengths', label: 'Strengths (one per line)', type: 'textarea' },
        { key: 'gaps', label: 'Gaps (one per line)', type: 'textarea' },
        { key: 'owner', label: 'Owner' },
        { key: 'platform', label: 'Part of the platform', type: 'select', options: ['yes', ''] },
        { key: 'assessed', label: 'Assessed', type: 'select', options: ['yes', ''] },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    columns: [
      // the name is what people scan for — it never shrinks
      { key: 'name', label: 'Project', kind: 'text', sortable: true, primary: true, minWidth: 200 },
      { key: 'category', label: 'Category', kind: 'text', sortable: true, maxWidth: 200, wrap: 2 },
      // the old platform's own status vocabulary, kept verbatim — renaming a status is how two systems quietly stop…
      { key: 'status', label: 'Status', kind: 'chip', dot: true, sortable: true, width: 130,
        tintBy: { live: 'mint', operational: 'blue', in_use: 'blue', experimental: 'amber',
                  framework: 'lavender', early: 'peach', archived: 'slate' as TintName, unassessed: 'pink' } },
      // three lines, not one: these blurbs are 2–4 sentences by design
      { key: 'blurb', label: 'What it is', kind: 'text', wrap: 3, maxWidth: 520 },
      { key: 'file_count', label: 'Files', kind: 'number', sortable: true, width: 80 },
    ],
    filters: [
      { key: 'status', label: 'Status',
        options: ['live', 'operational', 'in_use', 'experimental', 'framework', 'early', 'archived', 'unassessed'] },
    ],
    rowActions: [
      { id: 'view', label: 'View project', icon: 'eye' },
      { id: 'edit', label: 'Edit project', icon: 'pencil', quick: true },
      { id: 'share', label: 'Share', icon: 'share-2' },
    ],
    rowFeedback: { itemKind: 'project', titleKey: 'name' },
    pagination: { pageSize: 10 },
    detailPanel: {
      header: {
        title: 'name', subtitle: 'category',
        statusChip: { field: 'status',
          tintBy: { live: 'mint', operational: 'blue', in_use: 'blue', experimental: 'amber',
                    framework: 'lavender', early: 'peach', archived: 'slate' as TintName, unassessed: 'pink' } },
      },
      stats: [
        { label: 'Files', value: 'file_count', icon: 'file-text', tint: 'blue' },
        { label: 'Status', value: 'status', icon: 'activity', tint: 'mint' },
        { label: 'Category', value: 'category', icon: 'layers', tint: 'lavender' },
        { label: 'Assessed', value: 'assessed', icon: 'clipboard-check', tint: 'peach' },
      ],
      sections: [
        { kind: 'fields', title: 'What it is', fields: [
          { icon: 'info', label: 'Summary', value: 'blurb', multiline: true,
            fallback: 'No summary written yet — open Edit and describe it.' },
        ] },
        { kind: 'fields', title: 'Where it stands', fields: [
          { icon: 'thumbs-up', label: 'Strengths', value: 'strengths', bullets: true, tint: 'mint',
            fallback: 'No strengths recorded.' },
          { icon: 'triangle-alert', label: 'Gaps', value: 'gaps', bullets: true, tint: 'peach',
            fallback: 'No gaps recorded — which usually means it has not been assessed.' },
        ] },
        { kind: 'fields', title: 'Record', fields: [
          { icon: 'user', label: 'Owner', value: 'owner', fallback: 'Unassigned' },
          { icon: 'folder', label: 'Recent files', value: 'recent_files', multiline: true, fallback: 'None indexed.' },
          { icon: 'hard-drive', label: 'Size', value: 'size_bytes' },
          { icon: 'git-branch', label: 'Origin', value: 'origin' },
          { icon: 'clock', label: 'Imported', value: 'updated_at' },
          { icon: 'sticky-note', label: 'Notes', value: 'notes', multiline: true, fallback: '—' },
        ] },
      ],
      footer: [
        { label: 'Edit', icon: 'pencil', variant: 'primary', edit: true },
        { label: 'Share', icon: 'share-2', share: true },
      ],
    },
  },
}

// The Work items page was REMOVED: a flat table of 463 tasks is the wrong shape for work that is really a board.

/* ================= registry ================= */

export const expansionManifests: AppManifest[] = [
  {
    id: 'diseases', name: 'Diseases Registry', tagline: 'Diagnoses, ICD-10 codes and affected clients',
    icon: 'stethoscope', accent: 'pink', category: 'Care', version: '0.9.0',
    audience: ['client'],
    isNew: true, enabled: true, pages: [diseasesPage], notifications: ['app'],
  },
  {
    id: 'incidents', name: 'Incidents', tagline: 'Incident log, MUI tracking and review trail',
    icon: 'siren', accent: 'amber', category: 'Care', version: '0.9.2',
    audience: ['client'],
    isNew: true, enabled: true, pages: [incidentsPage], notifications: ['app', 'system'],
  },
  {
    id: 'mar', name: 'MAR — Med Administration', tagline: 'Medication administration record by schedule',
    icon: 'pill', accent: 'mint', category: 'Care', version: '0.9.0',
    audience: ['client'],
    isNew: true, enabled: true, pages: [marPage], notifications: ['reminder'],
  },
  {
    // THE ONBOARDING APP: there is a profile dedicated to onboarding with a single view, and that view became an…
    id: 'onboarding', name: 'Onboarding', tagline: 'The new hire’s six steps — packet, tutorials, questionnaire',
    icon: 'graduation-cap', accent: 'mint', category: 'Workspace', version: '1.0.0',
    audience: ['all', 'staff', 'onboarding'],
    isNew: true, enabled: true, pages: [onboardingAppPage], notifications: [],
  },
  {
    // THE INTERVIEWER'S OWN DESK: a narrow app for INTERVIEWER-badge holders — the interview list and the scorecard…
    id: 'interviews', name: 'Interviews', tagline: 'The interviewer’s desk — score and comments per candidate',
    icon: 'clipboard-check', accent: 'lavender', category: 'Workspace', version: '1.0.0',
    audience: ['all', 'staff'],
    isNew: true, enabled: true, pages: [interviewsPage, interviewsCandidatePage, screeningNotesPage], notifications: [],
  },
  {
    id: 'shifts', name: 'Shifts & Coverage', tagline: 'Staffing board and open-shift coverage',
    icon: 'clock', accent: 'blue', category: 'Operations', version: '0.9.1',
    // CLIENT IS IN THE AUDIENCE, and what a client reads here is filtered to the signed-in client alone.
    audience: ['all', 'staff', 'client'],
    /** absorbed into Calendar Builder; kept unlisted because `isAllowedWith` reads this row */
    unlisted: true,
    isNew: true, enabled: true, pages: [coveragePage], notifications: ['reminder'],
  },
  {
    id: 'leadership', name: 'Leadership Dashboard', tagline: 'Census, compliance and coverage at a glance',
    icon: 'gauge', accent: 'lavender', category: 'Intelligence', version: '0.9.0',
    audience: ['director'],
    isNew: true, enabled: true, pages: [leadershipPage], notifications: ['system'],
  },
  {
    id: 'owners', name: 'Owners / Executive', tagline: 'Revenue, payer mix and growth for ownership',
    icon: 'crown', accent: 'peach', category: 'Intelligence', version: '0.9.0',
    audience: ['director'],
    isNew: true, enabled: false, pages: [ownersPage],
  },
  {
    id: 'quality', name: 'Quality Indicators', tagline: 'KPIs and trends against DODD benchmarks',
    icon: 'target', accent: 'green', category: 'Intelligence', version: '0.9.1',
    audience: ['director'],
    isNew: true, enabled: false, pages: [qualityPage],
  },
  {
    id: 'visits', name: 'Visits & EVV', tagline: 'Electronic visit verification for PC, HPC and respite',
    icon: 'map-pin-check', accent: 'mint', category: 'Operations', version: '0.9.0',
    isNew: true, enabled: false, pages: [visitsPage], notifications: ['reminder'],
  },
  {
    id: 'audits', name: 'Audits & Compliance', tagline: 'Internal audits, scores and follow-ups',
    icon: 'clipboard-check', accent: 'amber', category: 'Operations', version: '0.9.0',
    audience: ['director'],
    isNew: true, enabled: false, pages: [auditsPage],
  },
  {
    id: 'payroll', name: 'Payroll & Hours', tagline: 'Employee hours and payroll export prep',
    icon: 'wallet', accent: 'green', category: 'Finance', version: '0.9.0',
    audience: ['staff'],
    isNew: true, enabled: false, pages: [payrollPage],
  },
  {
    id: 'billing', name: 'Billing & Payers', tagline: 'Waiver, county and private-pay claims',
    icon: 'landmark', accent: 'blue', category: 'Finance', version: '0.9.1',
    audience: ['director'],
    isNew: true, enabled: false, pages: [billingPage],
  },
  {
    id: 'users', name: 'Users', tagline: 'Access accounts — staff and clients who can sign in',
    icon: 'users', accent: 'lavender', category: 'Manage', version: '1.0.0',
    audience: ['admin'],
    isNew: true, enabled: true, pages: [usersAccountsPage],
  },
  {
    id: 'isp', name: 'ISP Library', tagline: 'Individual Service Plans, by client',
    icon: 'clipboard-plus', accent: 'mint', category: 'Care', version: '1.0.0',
    audience: ['staff', 'client'],
    isNew: true, enabled: true, pages: [ispPage], notifications: ['app'],
  },
  {
    // REBUILT: the empty app became the DSP analysis, Unique-style, on OUR migrated copy of the old Master Data.
    id: 'performance', name: 'Staff Performance', tagline: "Every DSP's record — attendance, incidents, certs, and the AI's read",
    icon: 'trending-up', accent: 'blue', category: 'Manage', version: '2.0.0',
    audience: ['admin', 'manager'],
    // PUT AWAY, NOT DELETED — the board answers inside Workforce Compliance now, which imports `performancePage`…
    isNew: true, enabled: false, pages: [performancePage], notifications: ['app'],
  },
  {
    id: 'training', name: 'Training Tracker', tagline: 'Certifications and renewal status per staff member',
    icon: 'graduation-cap', accent: 'pink', category: 'Manage', version: '0.9.0',
    audience: ['staff'],
    isNew: true, enabled: false, pages: [trainingPage],
  },
  // THE ONBOARDING TRACKER WAS REMOVED HERE, deleted outright as an app.
  {
    id: 'care-plans', name: 'Care Plans / ISP', tagline: 'Individual Service Plans by house',
    icon: 'heart-handshake', accent: 'pink', category: 'Library', version: '0.9.0',
    audience: ['client'],
    isNew: true, enabled: false, pages: [carePlansPage],
  },
  {
    // EVERYBODY OPENS IT; THE BADGE DECIDES WHOSE: the feature is seen up to the house manager badge, every badge…
    id: 'behavior', name: 'Behavior Support',
    tagline: 'How people actually work here — and whether that rhythm is healthy',
    icon: 'brain', accent: 'lavender', category: 'Platform', version: '1.1.0',
    audience: ['all'],
    isNew: true, enabled: true, pages: [behaviorPage],
  },
  {
    // THE MERGED CARD CONTAINS THE HR RECORD, SO THIS APP IS NOT OPEN TO EVERYBODY — never `['all']`, and never…
    id: 'user-support', name: 'User Support',
    tagline: 'How somebody works here, and what the record holds — on one card',
    icon: 'user-check', accent: 'blue', category: 'Platform', version: '1.0.0',
    audience: ['admin', 'manager', 'staff', 'director', 'form', 'project', 'house'],
    focusAudience: ['all'],
    isNew: true, enabled: true, pages: [userSupportPage],
  },
  {
    id: 'family', name: 'Family Portal', tagline: 'Your family member’s care and the letters from the house',
    icon: 'users', accent: 'blue', category: 'Library', version: '1.0.0',
    audience: ['client'],
    isNew: true, enabled: true, pages: [familyHomePage, familyPage],
  },
  {
    id: 'transportation', name: 'Transportation Users', tagline: 'Routes, drivers, vehicles and pickup times',
    icon: 'van', accent: 'peach', category: 'Operations', version: '0.9.0',
    isNew: true, enabled: true, pages: [transportationPage], notifications: ['app'],
  },
  {
    id: 'meals', name: 'Meals & Nutrition', tagline: 'Diet plans and allergy notes per house',
    icon: 'utensils', accent: 'peach', category: 'Care', version: '0.9.0',
    audience: ['client'],
    isNew: true, enabled: false, pages: [mealsPage],
  },
  {
    id: 'work-orders', name: 'House Work Orders', tagline: 'Maintenance issues from reported to done',
    icon: 'wrench', accent: 'amber', category: 'Operations', version: '0.9.0',
    isNew: true, enabled: false, pages: [workOrdersPage], notifications: ['app'],
  },
  {
    id: 'policy-acks', name: 'Policies', tagline: 'The company policies, and who has signed them',
    icon: 'shield', accent: 'lavender', category: 'Library', version: '1.0.0',
    isNew: true, enabled: true,
    pages: [policyDocsPage, contactListPage],
    notifications: ['reminder'],
  },
  {
    id: 'equipment', name: 'Equipment & Assets', tagline: 'Medical equipment, serials and assignments',
    icon: 'monitor', accent: 'blue', category: 'Operations', version: '0.9.0',
    isNew: true, enabled: false, pages: [equipmentPage],
  },
  {
    // Retired as a standalone app: director ACCOUNTS moved to Settings → System users and this slot became the…
    id: 'directors', name: 'Directors', tagline: 'Executive biographies, focus areas and career timelines',
    icon: 'id-card', accent: 'lavender', category: 'Intelligence', version: '1.0.0',
    audience: ['director'],
    isNew: false, enabled: false, pages: [directorsPage, ...divisionTaskPages],
  },
  {
    // ops-flows: accent 'violet' is an ExtendedTintName (tints.ts) — runtime maps are keyed by extended names; cast…
    id: 'projects', name: 'Projects', tagline: 'Cross-program initiatives with linked documentation',
    icon: 'folder-kanban', accent: 'violet' as unknown as AppManifest['accent'], category: 'Operations', version: '1.0.0',
    audience: ['all'],
    // retired — superseded by Technology (the portfolio lives in the Technology app now, read from…
    isNew: true, enabled: false, pages: [projectsPage], notifications: ['app'],
  },
]
