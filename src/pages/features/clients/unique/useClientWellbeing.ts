// One client's rows from a wellbeing app: the app's own read (useWellbeingRows) with NO seed — a failed read keeps…
import { useMemo } from 'react'
import { useWellbeingRows } from '@/pages/features/wellbeing/useWellbeingRows'
import type { ClientRow } from '../shared'
import { WELLBEING_RESOURCE, rowsForClient, type WellbeingTabId } from './uniqueTabs'

type Keyed = { client_key?: string; clientId?: string; clientName?: string }

/** What a tab has read: this client's rows only. */
export type TabRead<T> = { rows: T[]; loading: boolean; error: string }

const NO_SEED: never[] = []

export function useClientWellbeing<T extends Keyed>(
  tab: WellbeingTabId,
  client: Pick<ClientRow, 'id' | 'name' | 'client_key'>,
): TabRead<T> {
  const { rows, loading, error } = useWellbeingRows<T>(WELLBEING_RESOURCE[tab], NO_SEED)
  const mine = useMemo(() => rowsForClient(rows, client), [rows, client])
  return { rows: mine, loading, error }
}
