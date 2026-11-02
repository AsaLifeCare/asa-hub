// Workout or Ideal Meals for one client: the app's read kept to this client, the app's generate hook, and the roles…
// Generate missing only ever picks from this client's rows.
import { useEffectiveRole } from '@/lib/effectiveUser'
import { useWellbeingGenerate, type WellbeingImageStatus } from '@/pages/features/wellbeing/useWellbeingGenerate'
import type { ClientRow } from '../shared'
import { useClientWellbeing, type TabRead } from './useClientWellbeing'
import { WELLBEING_RESOURCE, mayGenerate, sortMeals } from './uniqueTabs'

type ImageRow = {
  id: string; image?: string; status: string; mealType?: string
  client_key?: string; clientId?: string; clientName?: string
}

export function useClientImages<T extends ImageRow>(
  tab: 'workout' | 'meals',
  client: Pick<ClientRow, 'id' | 'name' | 'client_key'>,
): {
  read: TabRead<T & { status: WellbeingImageStatus }>
  canGenerate: boolean
  generating: boolean
  onGenerate: () => void
} {
  const role = useEffectiveRole()
  const { isGenerating, applyRows, generateMissing } = useWellbeingGenerate(WELLBEING_RESOURCE[tab])
  const read = useClientWellbeing<T>(tab, client)
  const rows = applyRows(read.rows)
  return {
    read: { ...read, rows },
    canGenerate: mayGenerate(role),
    generating: isGenerating,
    onGenerate: () => void generateMissing(tab === 'meals' ? sortMeals(rows) : rows),
  }
}
