// CURATED BUNDLE — Staff Training.
// Short training videos by channel (progress tracked) plus a photo gallery of visual how-tos for everyday care…
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoNow } from './shared'

export const staffTraining: CuratedBundle = {
  id: 'staff-training',
  blurb: 'Onboarding, medication and safety videos, plus photo guides you can skim.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'Staff Training',
      tagline: 'Short videos and photo guides for everyday care tasks.',
      icon: 'graduation-cap',
      accent: 'mint',
      category: 'Library',
      audience: ['admin', 'manager', 'staff'],
      pages: [
        {
          id: 'videos',
          type: 'videos',
          title: 'Videos',
          resource: '',
          config: {
            featuredId: 'vid-1',
            channels: [
              { id: 'onboarding', label: 'Onboarding', tint: 'mint' },
              { id: 'medication', label: 'Medication', tint: 'pink' },
              { id: 'safety', label: 'Safety', tint: 'amber' },
            ],
            player: { showPlaylist: true, showProgress: true, autoplayNext: false },
          },
          rows: [
            { id: 'vid-1', title: 'Welcome: your first week', channel: 'onboarding', thumb: '/assets/videos/thumb-01.jpg', durationSec: 482, views: 312, watched: 1, publishedAt: isoNow(-10), description: 'The houses, the team, and how a shift flows.' },
            { id: 'vid-2', title: 'The handover that takes five minutes', channel: 'onboarding', thumb: '/assets/videos/thumb-02.jpg', durationSec: 305, views: 240, watched: 0.6, publishedAt: isoNow(-8), description: 'What the next shift always needs to hear.' },
            { id: 'vid-3', title: 'Safe medication rounds', channel: 'medication', thumb: '/assets/videos/thumb-03.jpg', durationSec: 654, views: 198, watched: 0.25, publishedAt: isoNow(-6), description: 'The two-person check, step by step.' },
            { id: 'vid-4', title: 'Recording a refused dose', channel: 'medication', thumb: '/assets/videos/thumb-04.jpg', durationSec: 390, views: 154, watched: 0, publishedAt: isoNow(-4), description: 'Refusals are data, not confrontations.' },
            { id: 'vid-5', title: 'Fire drill walkthrough', channel: 'safety', thumb: '/assets/videos/thumb-05.jpg', durationSec: 520, views: 210, watched: 0.75, publishedAt: isoNow(-2), description: 'Alarm to assembly point in Maple House.' },
            { id: 'vid-6', title: 'Hand hygiene refresh', channel: 'safety', thumb: '/assets/videos/thumb-06.jpg', durationSec: 275, views: 176, watched: 0, publishedAt: isoNow(-1), description: 'The five moments, on a real shift.' },
          ],
        },
        {
          id: 'photo-guides',
          type: 'gallery',
          title: 'Photo guides',
          resource: '',
          config: {
            srcKey: 'src',
            titleKey: 'title',
            subtitleKey: 'caption',
            groupBy: 'topic',
            aspect: 'photo',
            searchPlaceholder: 'Search guides…',
          },
          rows: [
            { id: 'img-1', title: 'Medication room layout', caption: 'Where each step of the round happens', topic: 'medication', src: '/assets/library/houses/placeholder.jpg' },
            { id: 'img-2', title: 'PPE station by the door', caption: 'Gloves, aprons and gel in reach', topic: 'safety', src: '/assets/library/animals/cat.jpg' },
            { id: 'img-3', title: 'Kitchen hygiene board', caption: 'Fridge log and allergen list', topic: 'kitchen', src: '/assets/app-hero.svg' },
            { id: 'img-4', title: 'Fridge temperature log', caption: 'Twice daily, initials and time', topic: 'kitchen', src: '/assets/docs/cover-01.jpg' },
            { id: 'img-5', title: 'Evacuation chair spot', caption: 'Top of the main stairs, Maple House', topic: 'safety', src: '/assets/library/animals/dog.jpg' },
            { id: 'img-6', title: 'MAR chart filing', caption: 'Current month up front', topic: 'medication', src: '/assets/docs/cover-02.jpg' },
          ],
        },
      ],
    },
  },
}
