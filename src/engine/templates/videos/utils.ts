/** Shared constants + pure helpers for the `videos` template (moved verbatim from VideosTemplate.tsx). */
import type { CSSProperties } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'
import { personById } from '@/lib/people-lookup'
import { people } from '@/lib/seed'
import type { TintName, Video } from '@/engine/types'
import type { Visibility, VideoExt } from './types'

export const ext = (v: Video) => v as Video & VideoExt
export const visOf = (v: Video): Visibility => ext(v).visibility ?? 'all'
// 'onboarding' (new-hire tutorials) is watchable by everyone, like 'all'
export const VIS_LEVEL: Record<Visibility, number> = { all: 0, onboarding: 0, managers: 1, admins: 2 }
export const VIS_META: Record<Visibility, { label: string; tint: TintName; lock: string }> = {
  all: { label: 'Everyone', tint: 'mint', lock: '' },
  onboarding: { label: 'New hires', tint: 'mint', lock: '' },
  managers: { label: 'Managers + Admins', tint: 'blue', lock: 'Managers and admins only' },
  admins: { label: 'Admins only', tint: 'peach', lock: 'Admins only' },
}

export const THUMBS = [1, 2, 3, 4, 5, 6].map((i) => `/assets/videos/thumb-0${i}.jpg`)

export const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
export const fmtViews = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${v}`)
const hash = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0)
/** instructor: record field when present, deterministic person otherwise (demo) */
export const instructorOf = (v: Video) =>
  personById(ext(v).instructorId ?? '') ?? people[hash(v.id) % people.length]
/** posted-by: uploader metadata (person record or auth user), falls back to instructor */
export function postedByOf(v: Video): { name: string; avatar?: string; role?: string } | undefined {
  const id = ext(v).postedById
  if (!id) return undefined
  const p = personById(id)
  if (p) return { name: p.name, avatar: p.avatar, role: p.role }
  const u = useAuthStore.getState().users.find((x) => x.id === id)
  return u ? { name: u.name, avatar: u.avatar, role: u.title } : undefined
}

/** rails skip rendering while offscreen (content-visibility) */
export const RAIL_CV_STYLE = { contentVisibility: 'auto', containIntrinsicSize: '0 260px' } as CSSProperties
