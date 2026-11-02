// Compliance — the ~28-item scorecard the legacy Employee Management Portal was still being opened for, PLUS the…
// Three screens now live under the one tile: - overview — the custom scorecard / documents matrix / review queue…
import type { AppManifest, PageSchema } from '@/engine/types'
import { IST_CONFIG_SHIPPED, cfgPairsOf } from '@/lib/istConfigDeclaration'

export const overviewPage: PageSchema = {
  id: 'overview',
  type: 'sheet',
  title: 'Compliance',
  icon: 'shield-check',
  // No `compliance` resource in the generic resolver on purpose: the screen calls the declared actions directly.
  dataSource: { resource: 'compliance' },
  config: {
    entity: ['item', 'items'],
    customFeature: 'compliance/CompliancePage',
  },
}

// the declared ist_cert_status_tints; an edited cell overlays it at render time (certMatrixConfig)
const CERT_STATUS_TINTS: Record<string, string> = cfgPairsOf(IST_CONFIG_SHIPPED.ist_cert_status_tints)?.map ?? {}

// THE MATRIX'S COURSE COLUMNS ARE A SHIPPED FLOOR TOO.

/* ---------- Certifications · overview (dashboard) — absorbed ---------- */

// THE APP'S DASHBOARD — the Certifications Dashboard renamed to plain Dashboard, and built out of the information…
export const certificationsPage: PageSchema = {
  id: 'certifications',
  type: 'dashboard',
  title: 'Dashboard',
  icon: 'layout-dashboard',
  dataSource: { resource: 'staffCerts' },
  config: {
    widgets: [
      // Fed by the DERIVED staffCerts records (Certs.gs): the estate tracker's exceptions + the MAIS history.
      { id: 'stat-expiring', kind: 'stat', label: 'Expiring soon', description: 'Certification records inside the expiring window (Settings → IST, ist_cert_expiring_days).', tint: 'amber', href: '/app/employee-tracker/roster', from: { where: [{ field: 'status', eq: 'expiring' }] } },
      { id: 'stat-expired', kind: 'stat', label: 'Expired certs', description: 'Certification records already past their date.', tint: 'pink', href: '/app/employee-tracker/roster', from: { where: [{ field: 'status', eq: 'expired' }] } },
      { id: 'stat-mais', kind: 'stat', label: 'MAIS certified', description: 'People holding a valid MAIS certification.', tint: 'mint', href: '/app/employee-tracker/roster', from: { where: [{ field: 'certId', eq: 'cert-mais' }, { field: 'status', eq: 'valid' }] } },
      { id: 'stat-med-flagged', kind: 'stat', label: 'Med Delivery flagged', description: 'Med Delivery certifications expiring or expired.', tint: 'blue', href: '/app/employee-tracker/roster', from: { where: [{ field: 'certId', in: ['cert-med1', 'cert-med2', 'cert-med3'] }, { field: 'status', in: ['expiring', 'expired'] }] } },
      {
        id: 'donut-records', kind: 'donut', span: 2, title: 'Compliance — all records', centerLabel: 'records',
        description: 'Every certification record sliced by status.',
        from: {
          groupBy: 'status',
          order: ['valid', 'expiring', 'expired', 'missing'],
          labels: { valid: 'Valid', expiring: 'Expiring soon', expired: 'Expired', missing: 'Missing' },
          tintBy: { valid: 'mint', expiring: 'amber', expired: 'pink', missing: 'lavender' },
        },
      },
      {
        id: 'list-upcoming', kind: 'list', title: 'Upcoming expirations', viewAllHref: '/app/employee-tracker/roster',
        description: 'The next certifications to expire, closest first.',
        from: {
          where: [{ field: 'status', in: ['expiring', 'expired'] }],
          sortBy: 'expiresAt', limit: 8,
          titleField: 'personName', metaFields: ['certName', 'expiresAt'], avatarField: 'avatar',
          tintField: 'status', tintBy: { expiring: 'amber', expired: 'pink' },
          href: '/app/employee-tracker/roster',
        },
      },
      {
        id: 'actions-quick', kind: 'actions', title: 'Quick actions',
        description: 'Shortcuts to the matrix and the directories.',
        actions: [
          { icon: 'table', label: 'Open compliance matrix', tint: 'amber', href: '/app/employee-tracker/roster' },
          { icon: 'users', label: 'People directory', tint: 'blue', href: '/app/people/directory' },
          { icon: 'heart-pulse', label: 'Client directory', tint: 'pink', href: '/app/clients/directory' },
        ],
      },
    ],
    // THE SUGGESTION CATALOG + READY-MADE BOARDS: the same add/remove-with-descriptions and one-press boards the…
    catalog: [
      {
        id: 'cat-stat-valid', kind: 'stat', label: 'Valid certifications',
        description: 'Certification records currently in good standing.',
        tint: 'mint', href: '/app/employee-tracker/roster',
        from: { where: [{ field: 'status', eq: 'valid' }] },
      },
      {
        id: 'cat-stat-records', kind: 'stat', label: 'Records on file',
        description: 'Every certification record the platform holds.',
        tint: 'lavender', href: '/app/employee-tracker/roster',
        from: { where: [] },
      },
      {
        id: 'cat-list-expired', kind: 'list', title: 'Expired — oldest first',
        description: 'Certifications already past their date, most overdue first.',
        viewAllHref: '/app/employee-tracker/roster',
        from: {
          where: [{ field: 'status', eq: 'expired' }],
          sortBy: 'expiresAt', limit: 8,
          titleField: 'personName', metaFields: ['certName', 'expiresAt'], avatarField: 'avatar',
          tintField: 'status', tintBy: { expired: 'pink' },
          href: '/app/employee-tracker/roster',
        },
      },
      {
        id: 'cat-donut-med', kind: 'donut', title: 'Med Delivery — status mix',
        description: 'The three Med Delivery certifications sliced by status.',
        centerLabel: 'records',
        from: {
          where: [{ field: 'certId', in: ['cert-med1', 'cert-med2', 'cert-med3'] }],
          groupBy: 'status',
          order: ['valid', 'expiring', 'expired'],
          labels: { valid: 'Valid', expiring: 'Expiring soon', expired: 'Expired' },
          tintBy: { valid: 'mint', expiring: 'amber', expired: 'pink' },
        },
      },
    ],
    presets: [
      { id: 'everything', title: 'Everything', blurb: 'All the certification widgets at once',
        on: ['stat-expiring', 'stat-expired', 'stat-mais', 'stat-med-flagged', 'donut-records', 'list-upcoming', 'actions-quick', 'cat-stat-valid', 'cat-stat-records', 'cat-list-expired', 'cat-donut-med'] },
      { id: 'watchlist', title: 'The watchlist', blurb: 'What is expiring, what already expired',
        on: ['stat-expiring', 'stat-expired', 'list-upcoming', 'cat-list-expired', 'donut-records'] },
      { id: 'minimal', title: 'Just the numbers', blurb: 'The four headline stats, nothing else',
        on: ['stat-expiring', 'stat-expired', 'stat-mais', 'stat-med-flagged'] },
    ],
  },
}

/* ---------- Certifications · compliance matrix — absorbed ---------- */

export const certMatrixPage: PageSchema = {
  id: 'matrix',
  type: 'sheet',
  title: 'Compliance Matrix',
  icon: 'table',
  dataSource: { resource: 'certMatrix' },
  config: {
    entity: ['employee', 'employees'],
    searchPlaceholder: 'Search employees…',
    scopeBy: 'name',
    // sweep: a CLIENT focus flips the matrix to that person's caregivers' compliance rows (linked through EVV…
    scopeVia: { resource: 'visits', focusField: 'client', linkField: 'staff', matchField: 'name' },
    // No "add record" door: the matrix is DERIVED live from the estate's own tracker (Trainings Status + the DODD…
    searchable: true,
    rowHeight: 56,
    densityToggle: true,
    columns: [
      { key: 'name', label: 'Employee', kind: 'avatar+text', sortable: true, subKey: 'role', width: 230 },
      { key: 'dodd', label: 'DODD 8-Hr', kind: 'chip', tintBy: CERT_STATUS_TINTS, dashedBy: ['missing'] },
      { key: 'cpr', label: 'CPR/FA', kind: 'chip', tintBy: CERT_STATUS_TINTS, dashedBy: ['missing'] },
      { key: 'med1', label: 'Med Del 1', kind: 'chip', tintBy: CERT_STATUS_TINTS, dashedBy: ['missing'] },
      { key: 'med2', label: 'Med Del 2', kind: 'chip', tintBy: CERT_STATUS_TINTS, dashedBy: ['missing'] },
      { key: 'med3', label: 'Med Del 3', kind: 'chip', tintBy: CERT_STATUS_TINTS, dashedBy: ['missing'] },
      { key: 'mais', label: 'DODD MAIS', kind: 'chip', tintBy: CERT_STATUS_TINTS, dashedBy: ['missing'] },
      { key: 'attention', label: 'Needs attention', kind: 'text', sortable: true, width: 120 },
    ],
    filters: [
      { key: 'dodd', label: 'Missing: DODD', options: ['missing'] },
      { key: 'med1', label: 'Missing: Med Del 1', options: ['missing'] },
      { key: 'med2', label: 'Missing: Med Del 2', options: ['missing'] },
      { key: 'med3', label: 'Missing: Med Del 3', options: ['missing'] },
      { key: 'mais', label: 'DODD MAIS', options: ['valid', 'expiring', 'expired', 'missing'] },
    ],
    rowActions: [{ id: 'view', label: 'View compliance', icon: 'eye' }],
    pagination: { pageSize: Number(IST_CONFIG_SHIPPED.ist_matrix_page_size) },
    detailPanel: {
      header: {
        title: 'name', subtitle: 'role',
        bookmark: { type: 'person', tint: 'amber', href: '/app/employee-tracker/roster?record=:id' },
      },
      stats: [
        { label: 'Needs attention', value: 'attention', icon: 'circle-alert', tint: 'pink' },
      ],
      sections: [
        { kind: 'fields', title: 'Expirations on record', fields: [
          { icon: 'badge-check', label: 'DODD 8-Hr', value: 'dodd_expires', fallback: '—' },
          { icon: 'heart-pulse', label: 'CPR/FA', value: 'cpr_expires', fallback: '—' },
          { icon: 'pill', label: 'Med Del 1', value: 'med1_expires', fallback: '—' },
          { icon: 'pill', label: 'Med Del 2', value: 'med2_expires', fallback: '—' },
          { icon: 'pill', label: 'Med Del 3', value: 'med3_expires', fallback: '—' },
          { icon: 'shield-check', label: 'DODD MAIS', value: 'mais_expires', fallback: '—' },
        ] },
      ],
      footer: [
        { label: 'People directory', variant: 'secondary', icon: 'arrow-up-right', href: '/app/people/directory' },
      ],
    },
  },
}

export const complianceManifests: AppManifest[] = [
  {
    id: 'compliance',
    name: 'Compliance',
    tagline: 'Every document and certification the estate tracks, and who is short',
    icon: 'shield-check',
    accent: 'blue',
    category: 'Manage',
    version: '1.0.0',
    // A menu, never a lock: Compliance.gs refuses by role before the handler.
    audience: ['admin', 'manager'],
    isNew: true,
    // PUT AWAY, NOT DELETED: an app that leaves is uninstalled, never destroyed.
    enabled: false,
    // ORDER MATTERS (superseding T14c): the Certifications DASHBOARD is the screen the app opens on, then the…
    pages: [certificationsPage, overviewPage, certMatrixPage],
    // carried over from the absorbed Certifications app — expiry reminders
    notifications: ['reminder'],
  },
]
