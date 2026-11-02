// GENERATE click asks Apps Script for today's cached illustration.
// New art is produced nightly by the old platform (Cloudflare) — Hub OpenAI on-demand stays off…
import { useCallback, useState } from 'react'
import { gasAction } from '@/features/hiring/shared'
import { invalidate } from '@/lib/apiCache'
import { noteWrite } from '@/lib/snapshotClient'
import { toast } from '@/stores/useToastStore'
import { useApiConfigStore } from '@/stores/useApiConfigStore'

export type WellbeingImageStatus = 'ready' | 'pending' | 'generating'

type RowWithImage = { id: string; image?: string; status: string }

export function useWellbeingGenerate(resource: 'mealIdeals' | 'workoutPlans') {
  const [generating, setGenerating] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Record<string, { image: string; status: 'ready' }>>({})

  const isGenerating = generating.size > 0

  const applyRows = useCallback(
    <T extends RowWithImage>(rows: T[]): (T & { status: WellbeingImageStatus })[] =>
      rows.map((r) => {
        const o = overrides[r.id]
        if (o) return { ...r, image: o.image, status: 'ready' as const }
        if (generating.has(r.id)) return { ...r, image: '', status: 'generating' as const }
        return { ...r, status: (r.status === 'ready' ? 'ready' : 'pending') as WellbeingImageStatus }
      }),
    [overrides, generating],
  )

  const generateOne = useCallback(
    async (id: string) => {
      if (generating.has(id)) return
      if (useApiConfigStore.getState().driver !== 'apps-script') {
        toast({
          type: 'info',
          title: 'Live API required',
          body: 'Switch to the live backend to render AI illustrations.',
        })
        return
      }
      setGenerating((s) => new Set(s).add(id))
      try {
        const data = await gasAction<{ id: string; image: string; status: 'ready'; cached?: boolean }>(
          'wellbeingGenerateImage',
          { row_id: id },
          { timeoutMs: 120000 },
        )
        const image = String(data?.image || '').trim()
        if (!image) throw new Error('Backend returned ready with no image URL')
        setOverrides((o) => ({ ...o, [id]: { image, status: 'ready' } }))
        // Patch the snapshot so a refresh does not resurrect empty cards from the pre-generate slice.
        noteWrite(resource, { id, row: { id, image, status: 'ready' } })
        invalidate(resource)
        toast({
          type: 'success',
          title: data.cached ? "Today's illustration loaded" : 'Illustration rendered',
          body: data.cached
            ? 'Already generated today — no new API call.'
            : 'Saved for today; reopening this card will not spend tokens again.',
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Generation failed'
        toast({ type: 'danger', title: 'Could not render illustration', body: msg })
      } finally {
        setGenerating((s) => {
          const n = new Set(s)
          n.delete(id)
          return n
        })
      }
    },
    [generating, resource],
  )

  const generateMissing = useCallback(
    async (visible: RowWithImage[]) => {
      const next = visible.find(
        (r) => r.status === 'pending' && !generating.has(r.id) && !overrides[r.id],
      )
      if (!next) {
        toast({
          type: 'info',
          title: 'Nothing to render',
          body: 'Every visible card already has today\'s illustration or is being rendered.',
        })
        return
      }
      await generateOne(next.id)
    },
    [generateOne, generating, overrides],
  )

  return { isGenerating, applyRows, generateOne, generateMissing }
}
