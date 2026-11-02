/** Shared types for the `videos` template (moved verbatim from VideosTemplate.tsx). */
import type { TintName } from '@/engine/types'

export type ChannelCfg = { id: string; label: string; tint: TintName }
export type PlayerCfg = { showPlaylist?: boolean; showProgress?: boolean; autoplayNext?: boolean }

/* ---------------- record extensions (fields ride along from seed/uploads) ---------------- */

export type Visibility = 'all' | 'managers' | 'admins' | 'onboarding'
export type VideoExt = {
  instructorId?: string
  postedById?: string
  postedAt?: string
  visibility?: Visibility
  tags?: string[]
  isNew?: boolean
}
