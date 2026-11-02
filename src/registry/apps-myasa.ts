// "My asa." — the signed-in user's personal space (profile, week, courses, certifications, bookmarks).
// Custom page: mounted via CUSTOM_PAGES in src/pages/AppRoutePage.tsx ('myasa/home'), so the page schema here is a…
import type { AppManifest } from '@/engine/types'

export const myAsaManifests: AppManifest[] = [
  {
    id: 'myasa',
    name: 'My asa.',
    tagline: 'Your personal home — profile, week, courses, certifications and bookmarks.',
    icon: 'sparkles',
    accent: 'mint',
    category: 'Core',
    version: '1.0.0',
    isNew: true,
    enabled: true,
    // 'onboarding' joined 2026-08-25 (chapter 21): the new hire's login sees their profile, My asa and the…
    audience: ['all', 'staff', 'client', 'onboarding'],
    pages: [
      {
        id: 'home',
        type: 'dashboard',
        title: 'My asa.',
        icon: 'sparkles',
        dataSource: { resource: 'activity' },
        config: {},
      },
    ],
  },
]
