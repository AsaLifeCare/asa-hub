// Image Bank dataset (people-crud-media wave) — a browsable library of the workspace's photos that admins can…
// Registered in src/lib/seed-extra.ts as the `photos` resource.
import type { TintName } from '@/engine/types'
import { withTenant } from '@/lib/tenancy'
// sweep: photos get person linkage (personId) so Person Focus Mode narrows the image bank to the focused staff…
import { clients as careClients } from '@/lib/seed-care'
import { ANIMAL_PHOTOS } from '@/lib/animals'

export type Photo = {
  id: string
  title: string
  kind: 'animal' | 'avatar' | 'scene' | 'cover'
  src: string
  assignedTo: string | null
  personId: string | null // sweep: p-NN (staff) or cl-NN (client) linkage
  tint: TintName
}

const pad = (n: number) => String(n).padStart(2, '0')

const SCENE_TITLES: [string, string][] = [
  ['thumb-01', 'Training scene — med pass walkthrough'],
  ['thumb-02', 'Training scene — house orientation'],
  ['thumb-03', 'Training scene — documentation basics'],
  ['thumb-04', 'Training scene — safety drills'],
  ['thumb-05', 'Training scene — client activities'],
  ['thumb-06', 'Training scene — team huddle'],
]

const COVER_TITLES: [string, string][] = [
  ['cover-01', 'Cover — calm gradient'],
  ['cover-02', 'Cover — warm tones'],
  ['cover-03', 'Cover — cool tones'],
  ['cover-04', 'Cover — editorial'],
]

/** A few photos start pre-assigned so the bank shows realistic usage. */
const PRE_ASSIGNED: Record<string, string> = {
  'ph-a01': 'Maya Chen',
  'ph-a02': 'Tom Becker',
  'ph-a03': 'Priya Nair',
  'ph-a04': 'Daniel Osei',
  'ph-a05': 'Sofia Morales',
}
/** sweep: staff person ids for the pre-assigned headshots (p-NN). */
const PRE_ASSIGNED_STAFF_IDS: Record<string, string> = {
  'ph-a01': 'p-01',
  'ph-a02': 'p-02',
  'ph-a03': 'p-03',
  'ph-a04': 'p-04',
  'ph-a05': 'p-05',
}
// sweep: the next five headshots start assigned to CLIENTS (cl-NN) so a client focus visibly narrows the image bank.
const PRE_ASSIGNED_CLIENTS: Record<string, number> = {
  'ph-a06': 0,
  'ph-a07': 1,
  'ph-a08': 2,
  'ph-a09': 3,
  'ph-a10': 4,
}

const TINTS: TintName[] = ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber']

export const photos: Photo[]  = withTenant([
  ...ANIMAL_PHOTOS.map((animal, i): Photo => {
    const id = `ph-a${pad(i + 1)}`
    const clientIdx = PRE_ASSIGNED_CLIENTS[id]
    return {
      id,
      title: `Animal — ${animal.label}`,
      kind: 'animal',
      src: animal.src,
      assignedTo:
        PRE_ASSIGNED[id] ?? (clientIdx != null ? careClients[clientIdx % careClients.length].name : null),
      personId:
        PRE_ASSIGNED_STAFF_IDS[id] ??
        (clientIdx != null ? careClients[clientIdx % careClients.length].id : null),
      tint: TINTS[i % TINTS.length],
    }
  }),
  ...SCENE_TITLES.map(([file, title], i): Photo => ({
    id: `ph-s${pad(i + 1)}`,
    title,
    kind: 'scene',
    src: `/assets/videos/${file}.jpg`,
    assignedTo: null,
    personId: null,
    tint: TINTS[(i + 2) % TINTS.length],
  })),
  {
    id: 'ph-s07',
    title: 'Scene — app hero artwork',
    kind: 'scene',
    src: '/assets/app-hero.svg',
    assignedTo: null,
    personId: null,
    tint: 'blue',
  },
  {
    id: 'ph-s08',
    title: 'Scene — empty state illustration',
    kind: 'scene',
    src: '/assets/empty-state.svg',
    assignedTo: null,
    personId: null,
    tint: 'lavender',
  },
  ...COVER_TITLES.map(([file, title], i): Photo => ({
    id: `ph-c${pad(i + 1)}`,
    title,
    kind: 'cover',
    src: `/assets/docs/${file}.jpg`,
    assignedTo: null,
    personId: null,
    tint: TINTS[(i + 4) % TINTS.length],
  })),
])
