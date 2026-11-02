// Questionnaires app registry (questionnaire-suite wave) — scenario Q&A for hiring, onboarding and training, with…
// The main agent merges `...questionnaireSuiteManifests` into src/registry/apps.ts (same seam as apps-expansion.ts).
import type { AppManifest, PageSchema } from '@/engine/types'

/* ---------- page 1 · Take a questionnaire (landing + runner) ---------- */

const takePage: PageSchema = {
  id: 'take',
  type: 'sheet',
  title: 'Take a questionnaire',
  icon: 'clipboard-list',
  dataSource: { resource: 'questionnaires' },
  config: {
    entity: 'questionnaires',
    // Custom feature screen: QuestionnairesPage mounts the card list and the QuestionnaireRunner (5 header layouts…
    customFeature: 'questionnaire/QuestionnairesPage',
    columns: [
      { key: 'title', label: 'Title', kind: 'text', sortable: true },
      { key: 'audience', label: 'Audience', kind: 'chip', tintBy: { 'new-hire': 'mint', 'all-staff': 'blue', manager: 'lavender' } },
      { key: 'estimatedMin', label: 'Minutes', kind: 'number', sortable: true },
      { key: 'privacyNote', label: 'Privacy', kind: 'text' },
    ],
    emptyAction: { label: 'New questionnaire' },
  },
}

/* ---------- page 2 · Responses (admin table) ---------- */

const responsesPage: PageSchema = {
  id: 'responses',
  type: 'sheet',
  title: 'Responses',
  icon: 'inbox',
  dataSource: { resource: 'questionnaireResponses' },
  config: {
    entity: 'responses',
    // PERM GATE — PageSchema has no permission field, so the gate is documented here and enforced inside…
    perm: 'hiring.edit',
    customFeature: 'questionnaire/ResponsesPage',
    columns: [
      { key: 'respondentName', label: 'Respondent', kind: 'text', sortable: true },
      { key: 'role', label: 'Role', kind: 'chip', tintBy: { candidate: 'amber', staff: 'blue', manager: 'lavender' } },
      { key: 'submittedAt', label: 'Submitted', kind: 'date', sortable: true },
      { key: 'answersSummary', label: 'Answers', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'chip', tintBy: { submitted: 'blue', reviewed: 'mint' } },
    ],
  },
}

export const questionnaireSuiteManifests: AppManifest[] = [
  {
    id: 'questionnaires',
    name: 'Questionnaires',
    tagline: 'Scenario Q&A for hiring and training',
    icon: 'clipboard-list',
    accent: 'lavender',
    category: 'Manage',
    version: '1.0.0',
    isNew: true,
    enabled: true,
    audience: ['all', 'staff'],
    pages: [takePage, responsesPage],
    notifications: ['reminder'],
  },
]
