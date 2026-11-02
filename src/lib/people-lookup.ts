/** Resolve person ids (p-NN) → seed person records (avatars, names) for cross-resource UI. */
import { people } from '@/lib/seed'
import { asList } from '@/lib/asList'
import type { Person } from '@/engine/types'

export const personById = (id: string): Person | undefined => people.find((p) => p.id === id)

// Callers pass whatever the row held — a real array in the seeds, one comma-joined cell when the row came from a…
export const peopleByIds = (ids: unknown): { src?: string; name: string }[] =>
  asList(ids).map((id) => {
    const p = personById(id)
    return { src: p?.avatar, name: p?.name ?? id }
  })
