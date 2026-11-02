// Potential Clients registry (v9 apiconn wave): the mounted example app for the platform's API connection.
// One sheet page ("Pipeline") showcasing the sheet engine — tinted chip columns, dot priority chip, sortable number…
import type { AppManifest, PageSchema, TintName } from '@/engine/types'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { boardStage, isRoundClock, leadDaysLeft, leadRating } from '@/lib/referralAnalysis'
import { INTAKE_STAGES } from '@/lib/intakeStages'

/* ---------- tints ---------- */

const STAGE_TINTS: Record<string, TintName> = {
  New: 'blue',
  Contacted: 'amber',
  Assessment: 'lavender',
  'ISP drafting': 'peach',
  Converted: 'mint',
  'On hold': 'pink',
  // the vocabulary the tab actually holds (lowercase, like the scraper writes)
  new: 'blue',
  read: 'lavender',
  // the intake stages Client Candidates writes on the same rows
  ...Object.fromEntries(INTAKE_STAGES.map((s) => [s.label, s.tint])),
}

// The care rating, coloured by what it means for the call list: 8+ is worth a call today, 5–7 is worth reading…
const RATING_TINTS: Record<string, TintName> = {
  '10': 'mint', '9': 'mint', '8': 'mint',
  '7': 'amber', '6': 'amber', '5': 'amber',
  '4': 'peach', '3': 'peach', '2': 'blue', '1': 'blue',
}

/* ---------- Pipeline (sheet — also rendered by the bespoke screen) ---------- */

export const potentialClientsPipelinePage: PageSchema = {
  id: 'pipeline',
  type: 'sheet',
  title: 'Pipeline',
  icon: 'user-plus',
  dataSource: { resource: 'potentialClients' },
  config: {
    entity: ['referral', 'referrals'],
    searchPlaceholder: 'Search names, diagnoses or ZIPs…',
    searchable: true,
    exportName: 'potential-clients-pipeline',
    secondaryActions: [{ id: 'export', label: 'Export', icon: 'download' }],
    // A REAL create, not a button that only emits a warning: a modal with every lead field a hand can fill; the…
    primaryAction: {
      label: 'Add potential client', icon: 'plus',
      form: {
        title: 'Add potential client',
        description: 'A referral entered by hand — name with phone AND e-mail, or name with the referral number.',
        resource: 'potentialClients',
        perm: 'people.edit',
        submitLabel: 'Add referral',
        wide: true,
        presets: { stage: 'new', source: 'manual' },
        // the either/or that makes a row worth keeping: a reachable person, or a referral number that can be chased…
        requiredGroups: [
          { label: 'name + phone + e-mail', fields: ['client_name', 'phone', 'email'] },
          { label: 'name + referral number', fields: ['client_name', 'referral_id'] },
        ],
        fields: [
          { key: 'client_name', label: 'Client name', required: true, placeholder: 'First and last name' },
          { key: 'client_age', label: 'Age', type: 'number' },
          { key: 'client_gender', label: 'Sex' },
          { key: 'phone', label: 'Phone', placeholder: '+1 (330) 555-0100' },
          { key: 'email', label: 'E-mail' },
          { key: 'postal_code', label: 'ZIP' },
          { key: 'diagnosis', label: 'Diagnosis', type: 'textarea' },
          { key: 'frequency', label: 'Frequency', placeholder: '24/7, weekly, 20 hours/week…' },
          { key: 'description', label: 'Service needed', type: 'textarea' },
          { key: 'funding_source', label: 'Funding source' },
          { key: 'expiration_date', label: 'Referral expires', type: 'date' },
          { key: 'referral_id', label: 'Referral number' },
          { key: 'owner', label: 'Owner' },
          { key: 'next_step', label: 'Next step' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
    },
    // New potential clients arrive every day, and the question that matters is "who did we already text?" — leads…
    rowTint: { key: 'sms_sent' },
    // Once the alert SMS went out, the first person who opens the lead moves it new → read — automatically, any…
    markReadOnOpen: { field: 'stage', from: 'new', to: 'read', when: 'sms_sent', action: 'leadOpened' },
    // The referrals that actually live in this tab (imported + scraped), not the demo seed this page was first…
    columns: [
      // A ROUND AVATAR BEFORE A PERSON'S NAME — the table standard here, and it is a person: `avatar+text` falls…
      { key: 'client_name', label: 'Prospect', kind: 'avatar+text', sortable: true, primary: true, minWidth: 200 },
      { key: 'ai_rating', label: 'Rating', kind: 'chip', dot: true, sortable: true, width: 90, tintBy: RATING_TINTS },
      { key: 'diagnosis', label: 'Diagnosis', kind: 'text', wrap: 2, maxWidth: 240 },
      { key: 'frequency', label: 'Frequency', kind: 'text', wrap: 2, maxWidth: 180 },
      { key: 'description', label: 'Service needed', kind: 'text', wrap: 2, maxWidth: 320 },
      { key: 'postal_code', label: 'ZIP', kind: 'text', sortable: true, width: 90 },
      { key: 'expiration_date', label: 'Expires', kind: 'date', sortable: true, expiry: true, width: 150 },
      { key: 'stage', label: 'Stage', kind: 'chip', tintBy: STAGE_TINTS, width: 130 },
    ],
    filters: [
      // the values the imported rows actually carry (the filter compares exactly); the demo-seed vocabulary in…
      { key: 'stage', label: 'Stage', options: ['new', 'read', ...INTAKE_STAGES.map((s) => s.label)] },
    ],
    // only what the black header above does not already state
    summaryStrip: {
      title: 'Pipeline',
      icon: 'user-plus',
      tint: 'blue',
      items: [
        {
          // still winnable: the ones whose window has not closed
          label: 'Still open', icon: 'clock', tint: 'mint',
          compute: (rows: any[]) =>
            rows.filter((r) => {
              const d = leadDaysLeft(r)
              return d !== null && d >= 0
            }).length,
        },
      ],
    },
    rowActions: [{ id: 'view', label: 'View prospect', icon: 'eye' }],
    pagination: { pageSize: 10 },
    detailPanel: {
      header: {
        title: 'client_name',
        subtitle: 'diagnosis',
        statusChip: { field: 'stage', tintBy: STAGE_TINTS },
      },
      stats: [
        { label: 'Rating', value: 'ai_rating', icon: 'star', tint: 'mint' },
        { label: 'Expires', value: 'expiration_date', icon: 'clock', tint: 'amber' },
        { label: 'ZIP', value: 'postal_code', icon: 'map-pin', tint: 'blue' },
        { label: 'Age', value: 'client_age', icon: 'user', tint: 'lavender' },
      ],
      sections: [
        {
          kind: 'fields',
          title: 'Why this rating',
          fields: [
            { icon: 'sparkles', label: 'Assessment', value: 'ai_notes', multiline: true,
              fallback: 'Not rated yet — run Rate on the Lead Scraper screen.' },
          ],
        },
        {
          kind: 'fields',
          title: 'Care needed',
          fields: [
            { icon: 'stethoscope', label: 'Diagnosis', value: 'diagnosis', multiline: true },
            { icon: 'repeat', label: 'Frequency', value: 'frequency', multiline: true },
            { icon: 'heart-pulse', label: 'Service', value: 'description', multiline: true },
          ],
        },
        {
          kind: 'fields',
          title: 'Reaching them',
          fields: [
            { icon: 'phone', label: 'Phone', value: 'phone', fallback: 'Not given' },
            { icon: 'mail', label: 'E-mail', value: 'email', fallback: 'Not given' },
            { icon: 'map-pin', label: 'ZIP', value: 'postal_code' },
            { icon: 'banknote', label: 'Funding source', value: 'funding_source' },
            { icon: 'hash', label: 'Referral', value: 'referral_id' },
            { icon: 'megaphone', label: 'Alert sent', value: 'sms_sent', fallback: 'No' },
            { icon: 'notebook-pen', label: 'Notes', value: 'notes', multiline: true, fallback: '—' },
          ],
        },
      ],
      // The drawer's footer used to carry a "Lead Scraper" button pointing at /app/potential-clients/scraper.
      footer: [
        { label: 'Share', icon: 'share-2', share: true },
      ],
    },
  },
}

/* ---------- Unique (custom feature — one referral read like a profile) ---------- */

// The second view: a referral opened the way a client's Unique profile opens.
export const potentialClientUniquePage: PageSchema = {
  id: 'unique',
  type: 'sheet',
  title: 'Unique',
  icon: 'user',
  dataSource: { resource: 'potentialClients' },
  config: {
    entity: ['referral', 'referrals'],
    customFeature: 'potclients/PotentialClientUniquePage',
    searchable: true,
    columns: [
      { key: 'client_name', label: 'Prospect', kind: 'avatar+text', sortable: true, primary: true },
      { key: 'ai_rating', label: 'Rating', kind: 'chip', dot: true, tintBy: RATING_TINTS },
      { key: 'stage', label: 'Stage', kind: 'chip', tintBy: STAGE_TINTS },
    ],
  },
}

// The Lead Scraper page was removed.


/* ---------- the referral funnel (was the CRM app, killed) ---------- */

export const potentialClientsFunnelPage: PageSchema = {
  id: 'funnel',
  type: 'pipeline',
  title: 'Funnel',
  icon: 'git-branch',
  dataSource: { resource: 'potentialClients' },
  config: {
    entity: 'referrals',
    stageField: 'stage',
    // ONLY THE ONES WORTH A CALL ENTER — the ones rated above 8 land in New.
    stageFrom: boardStage,
    allowDrag: true,
    showRail: true,
    showSummary: true,
    stageEmptyText: 'Nothing here yet — drag a referral in',
    secondaryActions: [{ id: 'export', label: 'Export', icon: 'download' }],
    stages: [
      { id: 'new', label: 'New', tint: 'blue', description: 'Scored above 8 — worth the call' },
      { id: 'contacted', label: 'Contacted', tint: 'lavender', description: 'First call with family or SSA done' },
      { id: 'assessment', label: 'Assessment', tint: 'peach', description: 'Needs assessment & house fit' },
      { id: 'intake', label: 'Intake', tint: 'amber', description: 'Paperwork, funding and DODD waiver checks' },
      { id: 'converted', label: 'Converted', tint: 'mint', description: 'Admitted — welcome home', celebrate: true },
      { id: 'lost', label: 'Lost', tint: 'pink', description: 'Chose another provider or deferred' },
    ],
    cardFields: {
      title: 'client_name',
      subtitle: 'diagnosis',
      tags: { key: 'funding_source' },
      meta: ['ai_rating', 'postal_code'],
    },
    // Only what the black header above does not already state, counted from the rows on screen — a filter narrows…
    summaryStrip: {
      title: 'Worth deciding on',
      icon: 'target',
      tint: 'blue',
      items: [
        {
          label: 'Median score', icon: 'chart-no-axes-column', tint: 'lavender',
          compute: (rows: any[]) => {
            const v = rows.map(leadRating).filter((n): n is number => n !== null).sort((a, b) => a - b)
            if (!v.length) return '—'
            const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2
            return String(Math.round(m * 10) / 10)
          },
        },
        {
          label: 'Already contacted', icon: 'message-square', tint: 'blue',
          compute: (rows: any[]) => rows.filter((r) => String(r?.sms_sent ?? '').trim().toLowerCase() === 'true').length,
        },
        {
          label: 'Needs 24/7', icon: 'moon', tint: 'pink',
          compute: (rows: any[]) => rows.filter(isRoundClock).length,
        },
      ],
    },
  },
}

export const potentialClientsComparePage: PageSchema = {
  id: 'compare',
  type: 'sheet',
  title: 'Compare',
  icon: 'target',
  dataSource: { resource: 'potentialClients' },
  // Bespoke screen — mounted through CUSTOM_PAGES so it inherits the audience guard and the badge layer like every…
  config: { entity: ['referral', 'referrals'] },
}

/* ---------- manifest ---------- */

export const potClientsManifests: AppManifest[] = [
  {
    id: 'potential-clients',
    name: 'Potential Clients',
    tagline: 'Referrals & prospects pipeline',
    icon: 'user-plus',
    accent: 'blue',
    category: 'Manage',
    version: '1.0.0',
    audience: ['all', 'staff'],
    isNew: true,
    enabled: true,
    // ONE SCREEN.
    pages: [potentialClientUniquePage, potentialClientsPipelinePage, potentialClientsComparePage, potentialClientsFunnelPage],
    notifications: ['app'],
  },
]

// Self-registration: registry/apps.ts is off-limits this wave, so importing this module appends the manifest to the…
queueMicrotask(() => {
  const registered = useRegistryStore.getState().apps
  const missing = potClientsManifests.filter((m) => !registered.some((a) => a.id === m.id))
  if (missing.length) useRegistryStore.setState({ apps: [...registered, ...missing] })
})
