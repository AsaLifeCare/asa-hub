// Employee Tracker — the old platform's employee-docs tracker, rebuilt as ONE hub app over the compliance data four…
// The merge began as a READ-TIME UNION over apps that stayed registered and live; later it became the registry…
import type { AppManifest, PageSchema } from '@/engine/types'
import { certificationsPage } from '@/registry/apps-compliance'
import { performancePage } from '@/registry/apps-expansion'
import {
  IST_CONFIG_SHIPPED, IST_STATUS_DONE, IST_STATUS_OWED, cfgBits, cfgPairsOf,
} from '@/lib/istConfigDeclaration'

// A page that ROUTES but is not a sidebar rung — `config.hidden`, the flag the hiring archive and the candidate…
const offTheRail = (...pages: PageSchema[]): PageSchema[] =>
  pages.map((p) => ({ ...p, config: { ...(p.config ?? {}), hidden: true } }))

// ── THE FOUR SCHEMAS THAT HAD TO MOVE, AND THE FIVE THAT DID NOT ────────── The rule is not "always move" — it is…

// THE SHIPPED FLOOR FOR THE IST TABLE, NOT ITS LAW.
const STATUS_TINTS: Record<string, string> = cfgPairsOf(IST_CONFIG_SHIPPED.ist_status_tints)?.map ?? {}

export const istPage: PageSchema = {
  id: 'records',
  type: 'sheet',
  title: 'IST Records',
  icon: 'graduation-cap',
  dataSource: { resource: 'istRecords' },
  config: {
    entity: ['IST record', 'IST records'],
    searchable: true,
    searchPlaceholder: 'Search staff, client or house…',
    columns: [
      // primary: the name owns an unbroken line, and the round avatar sits beside it — a person is never a bare…
      { key: 'staffName', label: 'Employee', kind: 'avatar+text', primary: true, sortable: true, width: 260 },
      { key: 'clientName', label: 'Client', kind: 'text', sortable: true },
      { key: 'house', label: 'House', kind: 'chip', tintBy: {} },
      { key: 'status', label: 'IST', kind: 'chip', tintBy: STATUS_TINTS, sortable: true },
      { key: 'dueDate', label: 'Needed by', kind: 'date', sortable: true, width: 120 },
      // Empty for most rows, and loud when it is not: no DODD certificate on file, or one that has expired.
      { key: 'certNote', label: 'Certification', kind: 'text' },
      { key: 'notifiedAt', label: 'Last notice', kind: 'date', sortable: true, width: 130 },
      { key: 'notifyCount', label: 'Notices', kind: 'number', width: 90 },
    ],
    filters: [{ key: 'status', label: 'IST', options: cfgBits(IST_CONFIG_SHIPPED.ist_statuses) }],
    rowActions: [
      {
        id: 'ist-remind',
        label: 'Send reminder',
        icon: 'send',
        quick: true,
        kind: 'call',
        call: 'istRemind',
        payload: { id: '{row.id}' },
        // Only for people who owe: offering to chase somebody already trained is how a table teaches people to…
        when: { field: 'status', eq: IST_STATUS_OWED },
        perm: 'people.edit',
        confirm:
          'Queue another IST notice for this employee?\n\n' +
          'Smart Comms sends it on the next sweep — with the wording and recipients from the ' +
          'ist_due row, and nothing at all if that situation is switched off. With test mode on ' +
          'it reaches the testers, not the employee.',
        toast: 'Queued for the next Smart Comms sweep.',
      },
      {
        id: 'ist-done',
        label: 'Mark trained',
        icon: 'check',
        kind: 'patch',
        // Only the status.
        patch: { status: IST_STATUS_DONE },
        when: { field: 'status', eq: IST_STATUS_OWED },
        perm: 'people.edit',
        confirm: 'Record that this employee has been trained on this client?',
        toast: 'Recorded.',
      },
    ],
    // THE REBUILD IS NOT A ROW ACTION, and that was a real bug: on an EMPTY table there is no row, therefore no…
    pagination: { pageSize: Number(IST_CONFIG_SHIPPED.ist_page_size) },
  },
}

export const requirementsPage: PageSchema = {
  id: 'requirements',
  type: 'sheet',
  title: 'Requirements',
  icon: 'list-checks',
  dataSource: { resource: 'complianceEngineReqs' },
  config: {
    entity: ['requirement', 'requirements'],
    customFeature: 'engine/EngineRequirementsPage',
  },
}

export const statesPage: PageSchema = {
  id: 'states',
  type: 'sheet',
  title: 'States matrix',
  icon: 'grid-2x2-check',
  dataSource: { resource: 'complianceEngineStates' },
  config: {
    entity: ['state', 'states'],
    customFeature: 'engine/EngineStatesPage',
  },
}

export const eventsPage: PageSchema = {
  id: 'events',
  type: 'sheet',
  title: 'Events trail',
  icon: 'history',
  dataSource: { resource: 'complianceEngineEvents' },
  config: {
    entity: ['event', 'events'],
    customFeature: 'engine/EngineEventsPage',
  },
}

const rosterPage: PageSchema = {
  id: 'roster',
  type: 'sheet',
  // The app is Workforce Compliance now; THIS page is the Employee Tracker — the first rung, and the only one that…
  title: 'Employee Tracker',
  icon: 'id-card',
  // Nominal — the bespoke screen unions several resources itself.
  dataSource: { resource: 'certMatrix' },
  config: {
    entity: ['employee', 'employees'],
    customFeature: 'employeetracker/EmployeeTrackerPage',
  },
}

// STAFF ISSUES LEFT THIS APP.

export const employeeTrackerManifests: AppManifest[] = [
  {
    // THE ID DOES NOT MOVE.
    id: 'employee-tracker',
    name: 'Workforce Compliance',
    tagline: 'Every employee’s paperwork in one place — the tracker, the certifications, the IST, the policies, the engine, the performance board and the HR tracker',
    icon: 'id-card',
    accent: 'mint',
    category: 'Manage',
    version: '2.0.0',
    // Management material, like the apps it reads: the ledger names every employee's document debt.
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    // ORDER IS THE RAIL.
    pages: [certificationsPage, ...offTheRail(rosterPage, requirementsPage, performancePage)],
    // expiry reminders belong to the data this screen surfaces
    notifications: ['reminder'],
  },
]
