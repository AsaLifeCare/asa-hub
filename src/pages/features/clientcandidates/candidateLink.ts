// "Open in Client Candidates", wherever Potential Clients shows a referral — the pipeline's rows and drawer, the…
// The gate is the resolver's own; Potential Clients is otherwise untouched.
import type { ConfigAction } from '@/engine/configActions'
import type { PageSchema } from '@/engine/types'
import { isAllowedWith, useBadgeRulesVersion } from '@/lib/appAccess'
import { useEffectiveRole } from '@/lib/effectiveUser'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { CANDIDATES_APP_ID, CANDIDATES_PATH } from './candidateModel'

export const OPEN_IN_CANDIDATES = 'Open in Client Candidates'

/** Whether this session may open Client Candidates. */
export function useCandidatesOpen(): boolean {
  const apps = useRegistryStore((s) => s.apps)
  const effRole = useEffectiveRole()
  useBadgeRulesVersion()
  return isAllowedWith(apps, effRole, CANDIDATES_APP_ID)
}

/** The engine's row action (a navigate, no write) that opens the row's referral in Client Candidates. */
export const OPEN_CANDIDATE_ACTION: ConfigAction = {
  id: 'client-candidates', label: OPEN_IN_CANDIDATES, icon: 'user-round-plus', kind: 'navigate',
  href: `${CANDIDATES_PATH}?candidate={row.id}`,
}

/** A Potential Clients page schema with the action on its rows (and on its drawer's footer, when it has one). */
export function withCandidateLink(schema: PageSchema): PageSchema {
  const config = schema.config as Record<string, unknown>
  const rowActions = Array.isArray(config.rowActions) ? (config.rowActions as unknown[]) : []
  const panel = config.detailPanel && typeof config.detailPanel === 'object' ? (config.detailPanel as Record<string, unknown>) : null
  const footer = panel && Array.isArray(panel.footer) ? (panel.footer as unknown[]) : null
  return {
    ...schema,
    config: {
      ...config,
      rowActions: [...rowActions, OPEN_CANDIDATE_ACTION],
      ...(panel ? { detailPanel: { ...panel, footer: [...(footer ?? []), OPEN_CANDIDATE_ACTION] } } : {}),
    },
  } as PageSchema
}
