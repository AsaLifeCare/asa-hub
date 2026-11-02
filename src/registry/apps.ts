// ASA Hub — seeded app registry (§5).
// 6 enabled + 2 available-but-disabled ("Expenses", "Inventory" — Inventory carries isNew).
import type { AppManifest, PageSchema, TintName } from '@/engine/types'
import { expansionManifests } from '@/registry/apps-expansion'
// the black header the Task Board opens with (src/registry/appHeroes.ts)
import { taskBoardHero } from '@/registry/appHeroes'
// Staff Schedule's schema lives in Calendar Builder; this imports the same object
import { shiftsSuiteManifests } from '@/registry/apps-shifts'
import { schedulePage } from '@/registry/apps-calendarbuilder'
import { wellbeingSuiteManifests } from '@/registry/apps-wellbeing'
import { medsSuiteManifests } from '@/registry/apps-meds'
import { questionnaireSuiteManifests } from '@/registry/apps-questionnaire'
import { myAsaManifests } from '@/registry/apps-myasa'
import { myWorkManifests } from '@/registry/apps-mywork'
import { myProfileManifests } from '@/registry/apps-myprofile'
import { myCalendarManifests } from '@/registry/apps-mycalendar'
import { staffProfilesManifests } from '@/registry/apps-staff-profiles'
import { myInboxManifests } from '@/registry/apps-myinbox'
import { locationsManifests } from '@/registry/apps-locations'
import { clientCandidatesManifests } from '@/registry/apps-client-candidates'
import { clientProfilesManifests } from '@/registry/apps-client-profiles'
import { ssaProfilesManifests } from '@/registry/apps-ssa-profiles'
import { familyProfilesManifests } from '@/registry/apps-family-profiles'
import { staffCandidatesManifests } from '@/registry/apps-staff-candidates'
import { emergencyContactsManifests } from '@/registry/apps-emergencycontacts'
import { schedulingManifests } from '@/registry/apps-scheduling'
import { supportDeskManifests } from '@/registry/apps-support-desk'
import { vehicleCalendarManifests } from '@/registry/apps-vehicle-calendar'
import { notificationManifests } from '@/registry/apps-notifications'
import { playgroundManifests } from '@/registry/apps-playground'
import { releaseUsersManifests } from '@/registry/apps-releaseusers'
import { productionActionsManifests } from '@/registry/apps-productionactions'
import { invoicesManifests } from '@/registry/apps-invoices'
import { financesManifests } from '@/registry/apps-finances'
import { administrationManifests } from '@/registry/apps-administration'
import { technologyManifests } from '@/registry/apps-technology'
import { mailManifests } from '@/registry/apps-mail'
import { docsReaderManifests } from '@/registry/apps-docsreader'
import { digestLabManifests } from '@/registry/apps-digestlab'
import { logsManifests } from '@/registry/apps-logs'
import { timeReconManifests } from '@/registry/apps-timerecon'
import { complianceManifests } from '@/registry/apps-compliance'
import { employeeTrackerManifests } from '@/registry/apps-employeetracker'
import { renderSheetManifests } from '@/registry/apps-rendersheet'
import { cortexManifests } from '@/registry/apps-cortex'
import { teamBoardManifests } from '@/registry/apps-teamboard'
import { hotlineManifests } from '@/registry/apps-hotline'
import { credentialsManifests } from '@/registry/apps-credentials'
import { psiLogManifests } from '@/registry/apps-psilog'
import { staffIssuesManifests } from '@/registry/apps-staffissues'
import { talentPipelineManifests } from '@/registry/apps-talentpipeline'
import { booksManifests } from '@/registry/apps-books'
import { emailDesignsManifests } from '@/registry/apps-emaildesigns'
import { docRoomsManifests } from '@/registry/apps-docrooms'
import { widgetsManifests } from '@/registry/apps-widgets'
import { medDelManifests } from '@/registry/apps-meddel'
import { requestsManifests } from '@/registry/apps-requests'
import { remindersManifests } from '@/registry/apps-reminders'
import { marketingManifests } from '@/registry/apps-marketing'
import { calendarBuilderManifests } from '@/registry/apps-calendarbuilder'
import { HOUSE_TINTS } from '@/lib/seed-care'

/* ---------- Overview · home dashboard (home.md) ---------- */

const homePage: PageSchema = {
  id: 'home',
  type: 'dashboard',
  title: 'Overview',
  icon: 'layout-grid',
  dataSource: { resource: 'activity' },
  config: {
    greeting: { name: 'Alex', subtitle: "Here's what's happening across your workspace today." },
    widgets: [
      { kind: 'stat', label: 'Active people', value: 248, delta: 4.2, tint: 'mint', href: '/app/people/directory', spark: [12, 14, 13, 17, 16, 19, 22, 21, 24] },
      { kind: 'stat', label: 'Open roles', value: 12, delta: 8.1, tint: 'lavender', href: '/app/hiring/pipeline', spark: [4, 6, 5, 8, 7, 9, 10, 11, 12] },
      { kind: 'stat', label: 'Docs published', value: 86, delta: -1.4, tint: 'peach', href: '/app/docs/library', spark: [18, 17, 19, 16, 17, 15, 16, 14, 15] },
      { kind: 'stat', label: 'Hours scheduled', value: 312, delta: 12.6, tint: 'blue', href: '/app/schedule/week', spark: [9, 11, 10, 13, 15, 14, 17, 19, 22] },
      {
        kind: 'area', span: 2, title: 'Workspace activity',
        series: [
          { name: 'This week', color: 'mint', points: [24, 32, 28, 41, 38, 52, 47, 58, 54, 66, 61, 72] },
          { name: 'Last week', color: 'blue', points: [18, 22, 26, 24, 31, 29, 36, 34, 41, 39, 46, 44] },
        ],
      },
      {
        kind: 'donut', title: 'People by department', centerLabel: 'people',
        slices: [
          { label: 'Engineering', value: 96, tint: 'mint' },
          { label: 'Design', value: 42, tint: 'lavender' },
          { label: 'Ops', value: 55, tint: 'peach' },
          { label: 'G&A', value: 55, tint: 'blue' },
        ],
      },
      { kind: 'weather', id: 'home-weather', title: 'Weather', city: 'Canton, OH' },
      { kind: 'clock', id: 'home-clock', title: 'Clock' },
      {
        kind: 'events', title: "Today's events",
        events: [
          { time: '09:30', title: 'Design review', tint: 'lavender', attendees: ['p-02', 'p-06', 'p-10'] },
          { time: '11:00', title: 'Candidate debrief', tint: 'mint', attendees: ['p-03', 'p-17'] },
          { time: '14:00', title: 'Sprint planning', tint: 'blue', attendees: ['p-01', 'p-04', 'p-08', 'p-12'] },
          { time: '16:30', title: '1:1 with Priya', tint: 'peach', attendees: ['p-03'] },
        ],
      },
      {
        kind: 'list', title: 'Recent documents', viewAllHref: '/app/docs/library',
        items: [
          { icon: 'file-text', tint: 'mint', title: 'Remote Work Policy', meta: 'Updated 2h ago · Maya', href: '/app/docs/library' },
          { icon: 'git-branch', tint: 'lavender', title: 'Hiring Playbook', meta: 'Updated yesterday · Priya', href: '/app/docs/library' },
          { icon: 'palette', tint: 'peach', title: 'Design System Principles', meta: 'Updated 2d ago · Tom', href: '/app/docs/library' },
          { icon: 'server', tint: 'blue', title: 'Incident Response Runbook', meta: 'Updated 3d ago · Daniel', href: '/app/docs/library' },
        ],
      },
      {
        kind: 'feed', title: 'Activity', // timeline fed from dataSource (activity resource)
      },
      { kind: 'ring', title: 'Weekly goal', percent: 72, tint: 'mint', caption: '18 of 25 interviews done' },
      {
        kind: 'actions', title: 'Quick actions',
        actions: [
          { icon: 'user-plus', label: 'Add person', tint: 'mint', href: '/app/people/directory' },
          { icon: 'briefcase', label: 'Post a job', tint: 'lavender', href: '/app/hiring/pipeline' },
          { icon: 'file-plus', label: 'New document', tint: 'peach', href: '/app/docs/library' },
          { icon: 'calendar-plus', label: 'Schedule event', tint: 'blue', href: '/app/schedule/week' },
        ],
      },
    ],
  },
}

/* ---------- People · directory (sheet + detail) ---------- */

const peoplePage: PageSchema = {
  id: 'directory',
  type: 'sheet',
  title: 'Directory',
  icon: 'users',
  dataSource: { resource: 'people' },
  config: {
    entity: ['person', 'people'],
    searchPlaceholder: 'Search people…',
    focusDrag: { type: 'staff', idKey: 'id', nameKey: 'name', avatarKey: 'avatar', subtitleKey: 'role' },
    // sweep: a CLIENT focus narrows the directory to that person's caregivers (staff who have EVV visits with them)…
    scopeVia: { resource: 'visits', focusField: 'client', linkField: 'staff', matchField: 'name' },
    secondaryActions: [
      // Import removed — it was a demo toast, and a button that pretends to import teaches people to distrust real…
      { id: 'people-merge', label: 'Merge', icon: 'git-merge', action: 'people-merge', perm: 'apps.manage' },
    ],
    // A REAL create — a large modal with every directory field, but only the identity four are required: full name…
    primaryAction: {
      label: 'Add person', icon: 'user-plus',
      form: {
        title: 'Add person',
        description: 'Every directory field — name, e-mail, phone and current status are required.',
        resource: 'people',
        perm: 'people.edit',
        submitLabel: 'Add person',
        wide: true,
        fields: [
          { key: 'name', label: 'Full name', required: true, fullName: true, placeholder: 'First and last name' },
          { key: 'email', label: 'E-mail', required: true, placeholder: 'name@example.com' },
          { key: 'phone', label: 'Phone', required: true, placeholder: '+1 (330) 555-0100' },
          { key: 'status', label: 'Current status', required: true, type: 'select',
            options: ['Active', 'On leave', 'Offboarding', 'Archived'],
            tints: { Active: 'mint', 'On leave': 'amber', Offboarding: 'pink', Archived: 'slate' } },
          { key: 'role', label: 'Role', placeholder: 'DSP, House Manager…' },
          { key: 'department', label: 'Department', type: 'select', options: ['Engineering', 'Design', 'Ops', 'G&A'] },
          { key: 'location', label: 'Location' },
          { key: 'startDate', label: 'Start date', type: 'date' },
          { key: 'tags', label: 'Tags', type: 'tags', placeholder: 'Comma-separated, e.g. Driver, Bilingual' },
          { key: 'avatar', label: 'Photo', type: 'photo' },
        ],
      },
    },
    selectable: true,
    searchable: true,
    rowHeight: 64,
    viewToggle: true,
    densityToggle: true,
    columns: [
      { key: 'name', label: 'Name', kind: 'avatar+text', sortable: true, subKey: 'email', width: 260 },
      { key: 'role', label: 'Role', kind: 'text' },
      { key: 'department', label: 'Department', kind: 'chip', sortable: true, tintBy: { Engineering: 'mint', Design: 'lavender', Ops: 'peach', 'G&A': 'blue' } },
      { key: 'tags', label: 'Tags', kind: 'chips', max: 2, tintBy: { 'Med pass': 'pink', 'Night shift': 'lavender', 'House lead': 'mint', Driver: 'blue', 'New hire': 'amber', Bilingual: 'peach' } },
      { key: 'location', label: 'Location', kind: 'text', icon: 'map-pin' },
      // The REAL sheet vocabulary is capitalized (Active / On leave / Offboarding / Archived); the demo lowercase…
      { key: 'status', label: 'Status', kind: 'chip', dot: true, tintBy: { Active: 'mint', active: 'mint', 'On leave': 'amber', away: 'amber', Offboarding: 'pink', off: 'pink', Archived: 'slate' } },
      { key: 'startDate', label: 'Start date', kind: 'date', sortable: true, format: 'MMM yyyy' },
    ],
    filters: [
      { key: 'department', label: 'Department', options: ['Engineering', 'Design', 'Ops', 'G&A'] },
      { key: 'status', label: 'Status', options: ['Active', 'On leave', 'Offboarding', 'Archived'] },
      { key: 'tags', label: 'Tag', options: ['Med pass', 'Night shift', 'House lead', 'Driver', 'New hire', 'Bilingual'] },
    ],
    rowBookmark: { type: 'person', titleKey: 'name', subtitleKey: 'role', avatarKey: 'avatar', tint: 'blue', href: '/app/people/directory?record=:id' },
    bulkActions: [
      { id: 'email', label: 'Send email', icon: 'mail' },
      { id: 'tag', label: 'Add tag', icon: 'tag' },
      { id: 'archive', label: 'Archive', icon: 'archive', danger: true },
    ],
    rowActions: [
      { id: 'message', label: 'Message', icon: 'mail', quick: true, toast: 'Opening chat…' },
      { id: 'edit', label: 'Quick edit', icon: 'pencil', quick: true },
      { id: 'view', label: 'View profile', icon: 'eye' },
      { id: 'delete', label: 'Delete', icon: 'trash-2' },
    ],
    // Select and delete permanently, on our side of the world: the ADMIN deletes for real — single rows from the ⋯…
    rowDelete: { perm: 'apps.manage' },
    // inline edit (people-crud-media): EditRecordModal spec — opened from the pencil row action and the…
    editForm: {
      title: 'Edit person',
      description: 'Update contact details, org info and profile photo — saved to the directory.',
      resource: 'people',
      perm: 'people.edit',
      submitLabel: 'Save changes',
      fields: [
        { key: 'name', label: 'Full name', required: true },
        { key: 'role', label: 'Role', required: true },
        { key: 'department', label: 'Department', type: 'select', options: ['Engineering', 'Design', 'Ops', 'G&A'] },
        { key: 'email', label: 'Email', required: true, placeholder: 'name@asahub.io' },
        { key: 'phone', label: 'Phone', placeholder: '+1 (555) 014-2233' },
        { key: 'location', label: 'Location' },
        { key: 'status', label: 'Status', type: 'select', options: ['active', 'away', 'off'] },
        { key: 'avatar', label: 'Photo', type: 'photo' },
        { key: 'tags', label: 'Tags', type: 'tags' },
      ],
    },
    pagination: { pageSize: 12 },
    // Cleaned out: the star, the four stat tiles, Manager, Location, the engagement chart and "Recent activity"…
    detailPanel: {
      header: {
        avatar: 'avatar', title: 'name', subtitle: 'role',
        statusChip: { field: 'status', tintBy: { Active: 'mint', active: 'mint', 'On leave': 'amber', away: 'amber', Offboarding: 'pink', off: 'pink', Archived: 'slate' } },
      },
      sections: [
        { kind: 'tags', title: 'Tags', tagsField: 'tags', resource: 'people', perm: 'tags.edit' },
        { kind: 'fields', title: 'Contact', fields: [
          { icon: 'mail', label: 'Email', value: 'email', hrefField: 'email', hrefPrefix: 'mailto:' },
          { icon: 'phone', label: 'Phone', value: 'phone', hrefField: 'phone', hrefPrefix: 'tel:' },
        ] },
      ],
      footer: [
        { label: 'Edit person', variant: 'secondary', icon: 'pencil', edit: true },
      ],
    },
  },
}

/* ---------- Hiring · pipeline ---------- */

// Archive — where the hiring lane ends.
const hiringArchivePage: PageSchema = {
  id: 'archive',
  type: 'sheet',
  title: 'Archive',
  icon: 'archive',
  dataSource: { resource: 'candidates' },
  // HIDDEN FROM THE MENU, NOT FROM THE PLATFORM: the Archive arrived and the other rung went with it, and no…
  config: {
    hidden: true,
    entity: ['candidate without a number', 'candidates without a number'],
  },
}

// The SECOND VIEW — the legacy Talent Pipeline wireframe redrawn with our materials: Board · Table · Calendar ·…
const chatPage: PageSchema = {
  id: 'messages',
  type: 'sheet',
  title: 'Chat',
  icon: 'message-square',
  dataSource: { resource: 'activity' },
  config: { entity: ['message', 'messages'], customFeature: 'chat/ChatAppPage' },
}

const suggestionsPage: PageSchema = {
  id: 'box',
  type: 'sheet',
  title: 'Suggestions',
  icon: 'lightbulb',
  dataSource: { resource: 'activity' },
  config: { entity: ['suggestion', 'suggestions'], customFeature: 'suggestions/SuggestionsPage' },
}

// THE COMPANY CALENDAR: the whole company's time on one full-screen month — shifts, hiring, trainings, birthdays…
const companyCalendarPage: PageSchema = {
  id: 'month',
  type: 'sheet',
  title: 'Calendar',
  icon: 'calendar-days',
  dataSource: { resource: 'events' },
  config: { entity: ['event', 'events'], customFeature: 'calendar/CompanyCalendarPage' },
}

// THE MERGE: Pipeline and Flow are ONE page now, and the Flow's nested rail — the square that simulated an SPA…
const hiringFlowPage: PageSchema = {
  id: 'flow',
  type: 'sheet',
  title: 'Flow',
  icon: 'git-merge',
  dataSource: { resource: 'candidates' },
  config: { hidden: true, entity: ['candidate', 'candidates'] },
}

// THE SIMULATOR — the whole hiring process walked one step at a time against a rehearsal card, with what each step…

// THE CANDIDATE'S FULL PROFILE — a PAGE like the Simulator, never a view, and a HIDDEN one: it routes (?id= picks…
const hiringCandidatePage: PageSchema = {
  id: 'candidate',
  type: 'sheet',
  title: 'Candidate',
  icon: 'user-round',
  dataSource: { resource: 'candidates' },
  config: { hidden: true, customFeature: 'hiring/CandidateProfilePage' },
}

const hiringPage: PageSchema = {
  id: 'pipeline',
  type: 'pipeline',
  title: 'Kanban',
  icon: 'git-branch',
  dataSource: { resource: 'candidates' },
  config: {
    entity: 'active candidates',
    stageField: 'stage',
    allowDrag: true,
    // The scroll-spy funnel rail is OFF — it was removed and everything pulled to the left.
    showRail: false,
    showSummary: true,
    stageEmptyText: 'No candidates here yet — drag one in',
    secondaryActions: [{ id: 'export', label: 'Export', icon: 'download', toast: 'Export started' }],
    headerFilter: {
      key: 'role',
      label: 'All roles',
      options: [
        'Direct Support Professional', 'House Manager', 'Nurse', 'Coordinator',
      ],
    },
    primaryAction: { label: 'Add candidate', icon: 'user-plus' },
    stages: [
      // THE OPENING HALF IS GONE FROM EVERY ONE OF THESE, crossed out at the start of each line: it named the stage…
      { id: 'new', label: 'New', tint: 'blue', description: 'Resume & CJIS collected, decision moves them on' },
      { id: 'phone-screen', label: 'Phone Screen', tint: 'lavender', description: 'Transcript & AI report auto-generated' },
      { id: 'interview', label: 'Interview', tint: 'amber', description: 'Scorecard & references' },
      { id: 'onboarding', label: 'Onboarding', tint: 'peach', description: '7 required uploads' },
      { id: 'hired', label: 'Hired', tint: 'mint', description: 'The graduation runs here — account, password, Employee Database', celebrate: true },
      // `becoming-staff` MERGED INTO HIRED: one stay, not two — the graduation checklist shows on the Hired card.
      { id: 'ready', label: 'Ready to start', tint: 'blue', description: 'A manager begins their activities' },
      // Step 8 — where they came from, written down — used to be a SEVENTH column here ('Minimal Internal…
    ],
    cardFields: {
      title: 'name',
      subtitle: 'role',
      avatar: 'avatar',
      tags: { key: 'source', tintBy: { Referral: 'mint', Indeed: 'blue', 'Careers page': 'lavender', 'Job fair': 'peach', Agency: 'pink', SMS: 'mint', Direct: 'blue' } },
      meta: ['daysInStage'],
      score: { key: 'score', max: 5 },
      checklist: { key: 'checklist' },
      // Live records carry the real assignee (entity_candidates.assigned_to); no fake fallback owner — the chip…
      owner: { nameKey: 'owner', avatarKey: 'ownerAvatar' },
    },
    // Items appended to a candidate's document checklist when they ENTER a stage (menu "Move to next stage" and…
    checklistPlan: {
      new: [],
      'phone-screen': [
        { id: 'transcript', label: 'Transcript', status: 'auto', owner: 'Auto' },
        { id: 'ai-report', label: 'AI report', status: 'auto', owner: 'Auto' },
        { id: 'screen-details', label: 'Screen details', status: 'done', owner: 'Recruiter' },
        { id: 'advance-decision', label: 'Advance decision', status: 'pending', owner: 'Recruiter' },
      ],
      interview: [
        { id: 'scorecard', label: 'Interview scorecard', status: 'pending', owner: 'Recruiter' },
        { id: 'references', label: 'References checked', status: 'pending', owner: 'HR' },
      ],
      onboarding: [
        { id: 'dropbox-link', label: 'Dropbox link', status: 'missing', owner: 'Candidate', upload: true },
        { id: 'dodd-cert', label: '8-Hr DODD Training Certificate', status: 'missing', owner: 'Candidate', upload: true },
        { id: 'cpr-cert', label: 'CPR / First Aid Certificate', status: 'missing', owner: 'Candidate', upload: true },
        { id: 'med-cert', label: 'Med Delivery Certificate', status: 'missing', owner: 'Candidate', upload: true },
        { id: 'drivers-license', label: "Driver's License / ID", status: 'missing', owner: 'Candidate', upload: true },
        { id: 'diploma', label: 'HS Diploma / GED', status: 'missing', owner: 'Candidate', upload: true },
        { id: 'ss-card', label: 'SS Card / Birth Certificate', status: 'missing', owner: 'Candidate', upload: true },
      ],
      // Nothing to grow on either: the graduation rows are derived server-side (Talent.gs) on Hired, and Ready to…
      hired: [],
      ready: [],
    },
    // Checklist items auto-marked done whenever a candidate advances a stage.
    advanceCompletes: ['resume-decision', 'advance-decision'],
    detailPanel: {
      header: {
        avatar: 'avatar', title: 'name', subtitle: 'role',
        statusChip: { field: 'stage', tintBy: { new: 'blue', 'phone-screen': 'lavender', interview: 'amber', onboarding: 'peach', hired: 'mint', ready: 'blue' } },
      },
      stats: [
        { label: 'Rating', value: 'score', icon: 'star', tint: 'lavender' },
        { label: 'Days in stage', value: 'daysInStage', icon: 'clock', tint: 'peach' },
        { label: 'Source', value: 'source', icon: 'link', tint: 'blue' },
        { label: 'Applied', value: 'appliedAt', icon: 'calendar', tint: 'mint' },
      ],
      sections: [
        { kind: 'fields', title: 'Details', fields: [
          { icon: 'mail', label: 'Email', value: 'email', hrefField: 'email', hrefPrefix: 'mailto:' },
          { icon: 'phone', label: 'Phone', value: 'phone', hrefField: 'phone', hrefPrefix: 'tel:' },
          { icon: 'briefcase', label: 'Role', value: 'role' },
          { icon: 'link', label: 'Source', value: 'source' },
          { icon: 'calendar', label: 'Applied', value: 'appliedAt' },
          { icon: 'file-text', label: 'Resume', value: 'resumeFileLabel', hrefField: 'resumeLink' },
        ] },
        // Real per-candidate evidence trail emitted by the live talent adapter (applied via → resume analysis/SMS…
        { kind: 'timeline', title: 'History & evidence', entriesField: 'summaryTimeline' },
        // Rendered by PipelineTemplate as an interactive block below DetailTemplate content (DetailTemplate ignores…
        { kind: 'checklist', title: 'Document checklist', key: 'checklist' },
      ],
      // Footer decoys removed: the real Reject / gated Move-to-next-stage arrive with the write lane (governed…
    },
  },
}

/* ---------- Academy · videos ---------- */

const videosPage: PageSchema = {
  id: 'videos',
  type: 'videos',
  title: 'Academy',
  icon: 'play-circle',
  dataSource: { resource: 'videos' },
  config: {
    featuredId: 'v-01',
    channels: [
      { id: 'onboarding', label: 'Onboarding', tint: 'mint' },
      { id: 'product', label: 'Product', tint: 'lavender' },
      { id: 'hiring', label: 'Hiring', tint: 'blue' },
      { id: 'security', label: 'Security', tint: 'peach' },
      { id: 'design', label: 'Design', tint: 'pink' },
    ],
    player: { showPlaylist: true, showProgress: true, autoplayNext: false },
  },
}

/* ---------- Schedule · week ---------- */


/* ---------- Clients · care directory (sheet + rich detail) ---------- */

const clientsPage: PageSchema = {
  id: 'directory',
  type: 'sheet',
  title: 'Directory',
  icon: 'heart-pulse',
  dataSource: { resource: 'clients' },
  config: {
    // ONE sidebar rung: only "Clients" under Clients.
    hidden: true,
    entity: ['client', 'clients'],
    searchPlaceholder: 'Search clients…',
    focusDrag: { type: 'client', idKey: 'id', nameKey: 'name', subtitleKey: 'clientNumber' },
    scopeBy: 'name',
    // Export and Add client live on the COMMON toolbar the three views share (ClientsToolbar, mounted at the right…
    searchable: true,
    rowHeight: 64,
    viewToggle: true,
    densityToggle: true,
    // A dense header: the numbers first (engine summaryStrip — config, not a bespoke screen).
    summaryStrip: {
      title: 'Clients',
      icon: 'heart-pulse',
      tint: 'pink',
      items: [
        { label: 'Confirmed clients', icon: 'users', tint: 'pink', compute: (rows: any[]) => rows.length },
        { label: 'Active', icon: 'badge-check', tint: 'mint', compute: (rows: any[]) => rows.filter((r) => String(r.status).toLowerCase() === 'active').length },
        { label: 'With a current ISP', icon: 'file-text', tint: 'blue', compute: (rows: any[]) => rows.filter((r) => String(r.isp_year ?? '').trim()).length },
        { label: '24/7 or constant supervision', icon: 'eye', tint: 'amber', compute: (rows: any[]) => rows.filter((r) => /24|constant/i.test(String(r.supervision_level ?? ''))).length },
      ],
    },
    rowBookmark: { type: 'person', titleKey: 'name', subtitleKey: 'clientNumber', tint: 'pink', href: '/app/clients/directory?record=:id' },
    // ISP-derived rows only carry what the plans carry: no house, SSA or self-admin columns of dashes, which made…
    columns: [
      { key: 'name', label: 'Client', kind: 'avatar+text', sortable: true, primary: true, subKey: 'clientNumber', width: 230 },
      { key: 'guardianName', label: 'Guardian', kind: 'text', width: 190 },
      { key: 'conditions', label: 'Conditions', kind: 'chips', max: 2, chipMax: 26, tintCycle: ['pink', 'lavender', 'blue'] },
      { key: 'supervisionShort', label: 'Supervision', kind: 'text', icon: 'eye', width: 170 },
      { key: 'isp_year', label: 'ISP period', kind: 'text', sortable: true, width: 200 },
      { key: 'status', label: 'Status', kind: 'chip', dot: true, tintBy: { active: 'mint', inactive: 'pink' } },
    ],
    filters: [
      { key: 'status', label: 'Status', options: ['active', 'inactive'] },
    ],
    rowActions: [
      { id: 'edit', label: 'Quick edit', icon: 'pencil', quick: true },
      // The chart is a page, not a modal, so it is linkable: a caregiver can send somebody the chart they are…
      { id: 'view', label: 'View record', icon: 'eye', kind: 'navigate', href: 'page:record?record={row.id}' },
    ],
    // inline edit (people-crud-media): guardian contact + client photo.
    editForm: {
      title: 'Edit client',
      description: 'Update guardian contact details and the client photo — saved to the chart.',
      resource: 'clients',
      perm: 'clients.edit',
      submitLabel: 'Save changes',
      fields: [
        { key: 'name', label: 'Full name', required: true },
        { key: 'houseName', label: 'House', type: 'select', options: Object.keys(HOUSE_TINTS) },
        { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
        { key: 'guardianName', label: 'Guardian', placeholder: 'Name (relationship)' },
        { key: 'guardian.email', label: 'Guardian email', placeholder: 'guardian@example.org' },
        { key: 'guardian.phone', label: 'Guardian phone', placeholder: '+1 (555) …' },
        { key: 'avatar', label: 'Photo', type: 'photo' },
      ],
    },
    pagination: { pageSize: 10 },
    detailPanel: {
      header: {
        // subtitle is the SHORT supervision tag — the full prose ("Auditory supervision.
        avatar: 'avatar', title: 'name', subtitle: 'supervisionShort',
        statusChip: { field: 'status', tintBy: { active: 'mint', inactive: 'pink' } },
        bookmark: { type: 'person', tint: 'pink', href: '/app/clients/directory?record=:id' },
        actions: [
          { icon: 'mail', label: 'Email guardian', iconOnly: true, toast: 'Opening mail composer…' },
          { icon: 'phone', label: 'Call house', iconOnly: true, toast: 'Starting a call…' },
          { icon: 'calendar', label: 'Book appointment', iconOnly: true, toast: 'Opening calendar…' },
        ],
      },
      stats: [
        { label: 'Conditions', value: 'conditionCount', icon: 'stethoscope', tint: 'lavender' },
        { label: 'Medications', value: 'medCount', icon: 'pill', tint: 'blue' },
        { label: 'Upcoming appts', value: 'upcomingAppts', icon: 'calendar-days', tint: 'mint' },
      ],
      sections: [
        { kind: 'chips', title: 'Conditions', itemsField: 'conditions', icon: 'stethoscope', tints: ['pink', 'lavender', 'blue', 'peach'] },
        { kind: 'chips', title: 'Allergies', itemsField: 'allergies', icon: 'triangle-alert', tints: ['amber'], emptyText: 'No known allergies.' },
        { kind: 'chips', title: 'Medications', itemsField: 'medications', icon: 'pill', tints: ['blue', 'mint', 'lavender'] },
        { kind: 'fields', title: 'Care team & plan', fields: [
          { icon: 'eye', label: 'Supervision', value: 'supervision_level', multiline: true },
          { icon: 'file-text', label: 'ISP period', value: 'isp_year' },
          { icon: 'users', label: 'Contacts', value: 'contacts', multiline: true, fallback: 'No contacts on file.' },
          { icon: 'heart', label: 'Important TO them', value: 'important_to', bullets: true },
          { icon: 'shield', label: 'Important FOR them', value: 'important_for', bullets: true },
          { icon: 'target', label: 'Goals', value: 'goals_outcomes', multiline: true },
          { icon: 'users', label: 'Guardian', value: 'guardianName' },
        ] },
        { kind: 'calendar', title: 'Doctor appointments', eventsField: 'appointments', tint: 'pink' },
        { kind: 'timeline', title: 'Recent notes', entriesField: 'notes' },
      ],
      footer: [
        { label: 'Edit client', variant: 'secondary', icon: 'pencil', edit: true },
        { label: 'Log a note', variant: 'primary', icon: 'pen-line', toast: 'Opening note composer…' },
      ],
    },
  },
}

// Client Record — the second view of Clients, and the replica of the screen this company read for years on the…
const clientRecordPage: PageSchema = {
  id: 'record',
  type: 'sheet',
  title: 'Record',
  icon: 'clipboard-list',
  dataSource: { resource: 'clients' },
  config: {
    // a hidden rung, like the Directory: the route, the row actions (page:record) and every ?record= deep link keep…
    hidden: true,
    entity: ['client', 'clients'],
    customFeature: 'clients/ClientRecordPage',
    searchPlaceholder: 'Search clients…',
    searchable: true,
    columns: [
      { key: 'name', label: 'Client', kind: 'avatar+text', sortable: true, primary: true, subKey: 'clientNumber', width: 230 },
      { key: 'supervisionShort', label: 'Supervision', kind: 'text', icon: 'eye', width: 170 },
      { key: 'isp_year', label: 'ISP period', kind: 'text', sortable: true, width: 200 },
    ],
  },
}

// Unique — the third view of Clients: one client, one screen, the three-column arrangement of the prototype drawn…
const clientUniquePage: PageSchema = {
  id: 'unique',
  type: 'sheet',
  title: 'Unique',
  icon: 'user-round',
  dataSource: { resource: 'clients' },
  config: { entity: ['client', 'clients'], customFeature: 'clients/ClientUniquePage' },
}

// ---------- Expenses · overview + reports (ops-apps) ---------- NOTE: both pages are custom feature screens…

const expensesOverviewPage: PageSchema = {
  id: 'overview',
  type: 'dashboard',
  title: 'Overview',
  icon: 'layout-dashboard',
  dataSource: { resource: 'expenseReports' },
  config: {
    widgets: [
      { kind: 'stat', label: 'Pending approval', value: 0, tint: 'amber' },
      { kind: 'stat', label: 'Approved this month', value: 0, tint: 'mint' },
      { kind: 'stat', label: 'Rejected', value: 0, tint: 'pink' },
      { kind: 'stat', label: 'Average report', value: 0, tint: 'blue' },
      { kind: 'area', span: 2, title: 'Monthly spend', series: [{ name: 'Spend', color: 'amber', points: [] }] },
      { kind: 'donut', title: 'Spend by category', slices: [] },
    ],
  },
}

const expensesReportsPage: PageSchema = {
  id: 'reports',
  type: 'sheet',
  title: 'Reports',
  icon: 'receipt',
  dataSource: { resource: 'expenseReports' },
  config: {
    entity: ['report', 'reports'],
    searchable: true,
    searchPlaceholder: 'Search reports…',
    columns: [
      { key: 'title', label: 'Title', kind: 'text', sortable: true },
      { key: 'category', label: 'Category', kind: 'chip', tintBy: { Mileage: 'blue', Supplies: 'peach', Training: 'lavender', 'Client activities': 'mint', Meals: 'amber', Medical: 'pink' } },
      { key: 'amount', label: 'Amount', kind: 'number', sortable: true },
      { key: 'date', label: 'Date', kind: 'date', sortable: true },
      { key: 'status', label: 'Status', kind: 'chip', dot: true, tintBy: { pending: 'amber', approved: 'mint', rejected: 'pink' } },
    ],
    filters: [
      { key: 'status', label: 'Status', options: ['pending', 'approved', 'rejected'] },
      { key: 'category', label: 'Category', options: ['Mileage', 'Supplies', 'Training', 'Client activities', 'Meals', 'Medical'] },
    ],
    pagination: { pageSize: 12 },
  },
}

// ---------- Inventory · supplies + medications (ops-apps) ---------- Same custom-screen note as Expenses: pages…

const inventorySuppliesPage: PageSchema = {
  id: 'supplies',
  type: 'sheet',
  title: 'Supplies',
  icon: 'boxes',
  dataSource: { resource: 'inventoryItems', params: { filters: { kind: 'supplies' } } },
  config: {
    entity: ['item', 'items'],
    searchable: true,
    searchPlaceholder: 'Search supplies…',
    columns: [
      { key: 'name', label: 'Item', kind: 'text', sortable: true },
      { key: 'category', label: 'Category', kind: 'chip', tintBy: { PPE: 'peach', Cleaning: 'blue', 'Personal care': 'lavender', Office: 'amber', 'Medical supplies': 'mint' } },
      { key: 'quantityOnHand', label: 'On hand', kind: 'number', sortable: true },
      { key: 'reorderLevel', label: 'Reorder level', kind: 'number' },
      { key: 'storageLocation', label: 'Location', kind: 'text', icon: 'map-pin' },
      { key: 'lastRestocked', label: 'Last restocked', kind: 'date', sortable: true },
    ],
    filters: [
      { key: 'storageLocation', label: 'Location', options: ['House — Meadowlane', 'House — Orchard Dale', 'House — 49th St', 'Office'] },
    ],
    pagination: { pageSize: 12 },
  },
}

const inventoryMedicationsPage: PageSchema = {
  id: 'medications',
  type: 'sheet',
  title: 'Medications',
  icon: 'pill',
  dataSource: { resource: 'inventoryItems', params: { filters: { kind: 'medications' } } },
  config: {
    entity: ['medication', 'medications'],
    searchable: true,
    searchPlaceholder: 'Search medications…',
    columns: [
      { key: 'name', label: 'Medication', kind: 'text', sortable: true, subKey: 'strength' },
      { key: 'form', label: 'Form', kind: 'chip', tintBy: { tab: 'blue', vial: 'lavender', inhaler: 'mint', cream: 'peach', patch: 'amber', liquid: 'pink' } },
      { key: 'lot', label: 'Lot', kind: 'text' },
      { key: 'expiresAt', label: 'Expires', kind: 'date', sortable: true },
      { key: 'quantityOnHand', label: 'On hand', kind: 'number', sortable: true },
      { key: 'storageLocation', label: 'Storage', kind: 'text', icon: 'map-pin' },
      { key: 'clientAssociation', label: 'Client', kind: 'chip', tintBy: { OTC: 'blue' } },
    ],
    filters: [
      { key: 'storageLocation', label: 'Location', options: ['House — Meadowlane', 'House — Orchard Dale', 'House — 49th St', 'Office'] },
    ],
    pagination: { pageSize: 12 },
  },
}

/* ---------- Task Board · horizontal kanban (ops-apps) ---------- */

const taskBoardPage: PageSchema = {
  id: 'board',
  type: 'board',
  title: 'Task Board',
  icon: 'square-kanban',
  dataSource: { resource: 'tasks' },
  config: {
    stageField: 'column',
    hero: taskBoardHero,
    stages: [
      { id: 'backlog', label: 'Backlog', tint: 'lavender' },
      { id: 'this-week', label: 'This week', tint: 'blue' },
      { id: 'in-progress', label: 'In progress', tint: 'amber' },
      { id: 'review', label: 'Review', tint: 'peach' },
      { id: 'done', label: 'Done', tint: 'mint' },
    ],
  },
}

/* ---------- Task Board Sheet · the same board, a spreadsheet per card ---------- */

// An app exactly like the Task Board, except that expanding a card creates a SPREADSHEET where the other one opens…
const taskBoardSheetPage: PageSchema = {
  id: 'board',
  type: 'board',
  title: 'Task Board Sheet',
  icon: 'table-2',
  dataSource: { resource: 'sheetTasks' },
  config: {
    stageField: 'column',
    // THE SAME FIVE, deliberately: this is the task board with a different body, and a person who has both should…
    stages: [
      { id: 'backlog', label: 'Backlog', tint: 'lavender' },
      { id: 'this-week', label: 'This week', tint: 'blue' },
      { id: 'in-progress', label: 'In progress', tint: 'amber' },
      { id: 'review', label: 'Review', tint: 'peach' },
      { id: 'done', label: 'Done', tint: 'mint' },
    ],
    // what makes it the SHEET board: the detail panel offers the file instead of the notes box…
    sheetPerCard: true,
  },
}

// THE SHEET ITSELF, INSIDE THE PLATFORM: it must open INSIDE the platform, NOT outside it.
const taskBoardSheetGridPage: PageSchema = {
  id: 'sheet',
  type: 'sheet',
  title: 'Spreadsheet',
  icon: 'table-2',
  dataSource: { resource: 'sheetTasks' },
  config: { customFeature: 'taskboardsheet/TaskBoardSheetPage' },
}

/* ---------- Image Bank · photo library for clients & staff (people-crud-media) ---------- */

const imageBankPage: PageSchema = {
  id: 'bank',
  // A photo library answers "which one is this house?" by looking, not by reading a table sorted by title — so it…
  type: 'gallery',
  title: 'Image Bank',
  icon: 'images',
  dataSource: { resource: 'photos' },
  config: {
    entity: ['photo', 'photos'],
    searchPlaceholder: 'Search photos…',
    srcKey: 'src',
    titleKey: 'title',
    subtitleKey: 'assignedTo',
    groupBy: 'kind',
    groupLabels: { animal: 'Animals', avatar: 'People', scene: 'Houses & scenes', cover: 'Brand' },
    aspect: 'photo',
    // sweep: focus scoping on the assigned person (display name or person id)
    scopeBy: ['assignedTo', 'personId'],
    primaryAction: {
      label: 'Add photo',
      icon: 'image-plus',
      form: {
        title: 'Add photo',
        description: 'Add a photo to the bank by URL — assign it to a person afterwards.',
        resource: 'photos',
        perm: 'people.edit',
        submitLabel: 'Add photo',
        fields: [
          { key: 'title', label: 'Title', required: true, placeholder: 'e.g. Headshot — spring intake' },
          { key: 'src', label: 'Image URL', required: true, placeholder: 'https://… or /assets/…' },
          { key: 'kind', label: 'Kind', type: 'select', required: true, options: ['animal', 'avatar', 'scene', 'cover'] },
        ],
      },
    },
    searchable: true,
    rowHeight: 64,
    viewToggle: true,
    columns: [
      { key: 'src', label: 'Photo', kind: 'image', width: 110 },
      { key: 'title', label: 'Title', kind: 'text', sortable: true },
      { key: 'kind', label: 'Kind', kind: 'chip', sortable: true, tintBy: { animal: 'amber', avatar: 'mint', scene: 'blue', cover: 'lavender' } },
      { key: 'assignedTo', label: 'Assigned to', kind: 'text', icon: 'user-check' },
    ],
    filters: [{ key: 'kind', label: 'Kind', options: ['animal', 'avatar', 'scene', 'cover'] }],
    // row action id 'assign' → AssignPhotoModal (writes the target's avatar)
    photoAssign: {
      perm: 'people.edit',
      targets: [
        { resource: 'people', label: 'Staff', subtitleKey: 'role' },
        { resource: 'clients', label: 'Clients', subtitleKey: 'houseName' },
      ],
    },
    editForm: {
      title: 'Edit photo',
      description: 'Rename, re-categorize or re-point this photo.',
      resource: 'photos',
      perm: 'people.edit',
      submitLabel: 'Save changes',
      fields: [
        { key: 'title', label: 'Title', required: true },
        { key: 'src', label: 'Image URL', required: true },
        { key: 'kind', label: 'Kind', type: 'select', options: ['animal', 'avatar', 'scene', 'cover'] },
        { key: 'assignedTo', label: 'Assigned to', placeholder: 'Person or client name (blank = unassigned)' },
      ],
    },
    rowActions: [
      { id: 'assign', label: 'Assign to…', icon: 'user-check', quick: true },
      { id: 'edit', label: 'Edit photo', icon: 'pencil' },
      { id: 'view', label: 'View details', icon: 'eye' },
    ],
    pagination: { pageSize: 12 },
    detailPanel: {
      header: {
        avatar: 'src', title: 'title', subtitle: 'kind',
      },
      sections: [
        { kind: 'fields', title: 'Details', fields: [
          { icon: 'image', label: 'Kind', value: 'kind' },
          { icon: 'user-check', label: 'Assigned', value: 'assignedTo', fallback: 'Not assigned' },
          { icon: 'link', label: 'Source', value: 'src' },
        ] },
      ],
      footer: [
        { label: 'Edit photo', variant: 'primary', icon: 'pencil', edit: true },
      ],
    },
  },
}

/* ---------- Registry ---------- */

export const appManifests: AppManifest[] = [
  {
    id: 'overview', name: 'Overview', tagline: 'Your workspace at a glance',
    icon: 'layout-grid', accent: 'green', category: 'Workspace', version: '2.4.0',
    audience: ['all', 'onboarding', 'staff'],
    enabled: true, pages: [homePage], notifications: ['system'],
  },
  {
    // ABSORBED INTO USERS → GENERAL, the section where every person in People is meant to appear.
    id: 'people', name: 'People', tagline: 'Directory, profiles and org',
    icon: 'users', accent: 'blue', category: 'Workspace', version: '1.8.2',
    audience: ['staff'],
    enabled: false, pages: [peoplePage], notifications: ['app', 'reminder'],
  },

  {
    id: 'hiring', name: 'Hiring Pipeline', tagline: 'From applied to hired, visually',
    icon: 'git-branch', accent: 'lavender', category: 'Manage', version: '1.5.0',
    audience: ['all', 'admin', 'manager'],
    enabled: true, pages: [hiringPage, hiringFlowPage, hiringArchivePage, hiringCandidatePage],
    notifications: ['app', 'mention'],
  },
  // The 'knowledge' app is RETIRED: it and 'docs' were the same library twice — same `documents` resource, same…
  {
    id: 'academy', name: 'Academy', tagline: 'Courses and video training',
    icon: 'graduation-cap', accent: 'pink', category: 'Library', version: '1.0.0',
    audience: ['all', 'onboarding', 'staff'],
    enabled: true, pages: [videosPage], notifications: ['app'],
  },
  {
    id: 'schedule', name: 'Schedule', tagline: 'Team calendars and events',
    icon: 'calendar-days', accent: 'mint', category: 'Workspace', version: '1.3.4',
    audience: ['staff'],
    /** absorbed into Calendar Builder; kept unlisted because `isAllowedWith` reads this row */
    unlisted: true,
    enabled: true, pages: [schedulePage], notifications: ['reminder'],
  },
  {
    id: 'expenses', name: 'Expenses', tagline: 'Reports, receipts and approvals',
    icon: 'receipt', accent: 'amber', category: 'Finance', version: '1.0.0',
    audience: ['all', 'admin', 'manager'],
    enabled: true,
    pages: [expensesOverviewPage, expensesReportsPage],
    notifications: ['app', 'reminder'],
  },
  {
    id: 'inventory', name: 'Inventory', tagline: 'Supplies and medication stock',
    icon: 'package', accent: 'blue', category: 'Operations', version: '1.0.0',
    audience: ['all', 'admin', 'manager'],
    enabled: true,
    pages: [inventorySuppliesPage, inventoryMedicationsPage],
    notifications: ['app', 'reminder'],
  },
  {
    id: 'taskboard', name: 'Task Board', tagline: 'Operational kanban, horizontally',
    icon: 'square-kanban', accent: 'blue', category: 'Operations', version: '1.0.0',
    audience: ['all', 'admin', 'manager'],
    isNew: true, enabled: true,
    pages: [taskBoardPage],
    notifications: ['mention'],
  },
  {
    // IMMEDIATELY BELOW THE TASK BOARD, wherever apps are listed.
    id: 'taskboard-sheet', name: 'Task Board Sheet', tagline: 'A board where every card is a spreadsheet',
    icon: 'table-2', accent: 'mint', category: 'Operations', version: '1.0.0',
    audience: ['all'],
    isNew: true, enabled: true,
    pages: [taskBoardSheetPage, taskBoardSheetGridPage],
    notifications: ['mention'],
  },
  {
    id: 'clients', name: 'Client Care', tagline: 'Care recipients, houses, guardians and doctor dates',
    icon: 'heart-pulse', accent: 'pink', category: 'Care', version: '1.0.0',
    audience: ['client', 'staff'],
    // Unique FIRST: it is the app's one sidebar rung and its default view.
    isNew: true, enabled: true, pages: [clientUniquePage, clientsPage, clientRecordPage], notifications: ['app', 'reminder'],
  },
  {
    id: 'calendar', name: 'Calendar', tagline: "The whole company's time, one screen",
    icon: 'calendar-days', accent: 'blue', category: 'Workspace', version: '1.0.0',
    audience: ['all', 'admin', 'manager'],
    isNew: true, enabled: true, pages: [companyCalendarPage], notifications: ['app'],
  },
  {
    // Everyone on the platform can be written to, so the audience is everyone who HAS a platform: the onboarding…
    id: 'chat', name: 'Chat', tagline: 'The people on the platform, and what they said',
    icon: 'message-square', accent: 'mint', category: 'Workspace', version: '1.0.0',
    audience: ['all', 'admin', 'manager', 'staff'],
    isNew: true, enabled: true, pages: [chatPage], notifications: ['mention'],
  },
  {
    id: 'suggestions', name: 'Suggestions', tagline: 'Say it — it lands with the right person',
    icon: 'lightbulb', accent: 'amber', category: 'Manage', version: '1.0.0',
    audience: ['all', 'staff', 'client'],
    isNew: true, enabled: true, pages: [suggestionsPage], notifications: ['app'],
  },
  // Certifications merged into the Compliance app (apps-compliance.ts).
  {
    id: 'imagebank', name: 'Image Bank', tagline: 'Photos for clients & staff',
    // extended tint (theme.css --tint-info) — cast per AppBuilderModal pattern
    icon: 'images', accent: 'info' as TintName, category: 'Manage', version: '1.0.0',
    audience: ['all', 'admin', 'manager'],
    isNew: true, enabled: true, pages: [imageBankPage], notifications: ['app'],
  },
  ...expansionManifests,
  // v5 feature suites (shift board, wellbeing, meds, questionnaires)
  ...shiftsSuiteManifests,
  ...wellbeingSuiteManifests,
  ...medsSuiteManifests,
  ...questionnaireSuiteManifests,
  // v6 personal space + studio + comms
  ...myAsaManifests,
  // My Work — actions and requests, scoped by the relay (apps-mywork.ts)
  ...myWorkManifests,
  // My Profile — the person's details, requirements and documents, scoped by the relay (apps-myprofile.ts)
  ...myProfileManifests,
  // My Calendar — the person's week of shifts and own time off requests, scoped by the relay (apps-mycalendar.ts)
  ...myCalendarManifests,
  // My Inbox — the person's alerts, scoped by the relay, and their own chat (apps-myinbox.ts)
  ...myInboxManifests,
  // Staff — one staff member at a time, each section read from StaffProfiles.gs (apps-staff-profiles.ts)
  ...staffProfilesManifests,
  // Locations — one house at a time, each section read from Locations.gs (apps-locations.ts)
  ...locationsManifests,
  // Client Candidates — one referral at a time, read from the Potential Clients app's rows (apps-client-candidates.ts)
  ...clientCandidatesManifests,
  // Clients — one client at a time, each section read from ClientProfiles.gs (apps-client-profiles.ts)
  ...clientProfilesManifests,
  // SSA — one SSA at a time, each section read from SsaProfiles.gs (apps-ssa-profiles.ts)
  ...ssaProfilesManifests,
  // Families — one family member at a time, each section read from FamilyProfiles.gs (apps-family-profiles.ts)
  ...familyProfilesManifests,
  // Staff Candidates — one candidate at a time, read from the Hiring app's records (apps-staff-candidates.ts)
  ...staffCandidatesManifests,
  // Emergency Contacts — the compiled-in directory, reads nothing (apps-emergencycontacts.ts)
  ...emergencyContactsManifests,
  // Scheduling — each house's shifts, edited in place by its people (apps-scheduling.ts)
  ...schedulingManifests,
  // Support Requests — every hotline and scheduling request in one list (apps-support-desk.ts)
  ...supportDeskManifests,
  // Transportation — the team's vehicles, requested, approved and booked (apps-vehicle-calendar.ts)
  ...vehicleCalendarManifests,
  // Apps with no interface — see apps-notifications.ts.
  ...notificationManifests,
  ...playgroundManifests,
  // Release Users — the master-only door (apps-releaseusers.ts)
  ...releaseUsersManifests,
  ...productionActionsManifests,
  // Invoices — the old platform invoice catalog on Hub chrome (apps-invoices.ts)
  ...invoicesManifests,
  // Finances — the old platform finance doc-hub on Hub chrome (apps-finances.ts)
  ...financesManifests,
  // Administration — the old platform workspace + the hub's document apps, merged (apps-administration.ts)
  ...administrationManifests,
  // Technology — the old platform Command Center + Tech Library on Hub chrome (apps-technology.ts)
  ...technologyManifests,
  ...mailManifests,
  ...docsReaderManifests,
  ...digestLabManifests,
  ...logsManifests,
  // Time Reconciliation — bespoke screen via CUSTOM_PAGES (apps-timerecon.ts)
  ...timeReconManifests,
  ...complianceManifests,
  // WORKFORCE COMPLIANCE — the read-time union over the compliance apps, and now the app that HOLDS them: ten…
  ...employeeTrackerManifests,
  // The essential HUB_DB tabs as spreadsheets, editable by badge (apps-rendersheet.ts; the whitelist and the gates…
  ...renderSheetManifests,
  ...medDelManifests,
  ...requestsManifests,
  // the old platform Reminders desk, Hub-owned (apps-reminders.ts)
  ...remindersManifests,
  // The company's shared work wall — the personal Task Board's opposite number, and a separate resource for exactly…
  ...teamBoardManifests,
  ...hotlineManifests,
  ...credentialsManifests,
  // a person's own PsiAnywhere sign-in and time clock (apps-psilog.ts, app/psi_log.py)
  ...psiLogManifests,
  // The HR tracker, lifted out of Workforce Compliance where it sat under the roster table with no address of its…
  ...staffIssuesManifests,
  ...talentPipelineManifests,
  {
    // SIMULATOR HIRING: the Simulator view turned into an APP of its own, everything kept, a single view for one…
    id: 'simulator', name: 'Simulator Hiring',
    tagline: 'The hiring walk’s design bench — every step, rehearsed',
    icon: 'flask-conical', accent: 'lavender', category: 'Manage', version: '1.0.0',
    audience: ['all'],
    isNew: true, enabled: true, notifications: [],
    pages: [{
      id: 'simulator',
      type: 'sheet',
      title: 'Simulations',
      icon: 'flask-conical',
      dataSource: { resource: 'candidates' },
      config: { entity: ['rehearsal', 'rehearsals'], customFeature: 'hiring/SimulatorPage' },
    }, {
      // Flow Control moved here from the Flow view — the bench holds Simulations AND the machine's rhythm.
      id: 'flow-control',
      type: 'sheet',
      title: 'Flow Control',
      icon: 'sliders-horizontal',
      dataSource: { resource: 'candidates' },
      config: { entity: ['situation', 'situations'], customFeature: 'hiring/FlowControlPage' },
    }],
  },
  // Wellbeing's small library — free, licensed, and about this work (apps-books.ts; the catalogue and the Drive…
  ...booksManifests,
  // the platform's letters, rendered and testable (apps-emaildesigns.ts)
  ...emailDesignsManifests,
  ...docRoomsManifests,
  // the widget bank — indicator specs anyone can take (apps-widgets.ts)
  ...widgetsManifests,
  // the Neural Cortex's own house — chat full-screen + the connectome (apps-cortex.ts; the doors are the relay's…
  ...cortexManifests,
  // the competitor sheet + public filings (apps-marketing.ts)
  ...marketingManifests,
  // Calendar Builder, with the Shift Board's screens (apps-calendarbuilder.ts)
  ...calendarBuilderManifests,
]
