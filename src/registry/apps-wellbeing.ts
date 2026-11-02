// Wellbeing suite — app registry (wellbeing-suite wave): 4 client-wellbeing apps (Ideal Meals, Workout, Sleep…
// The main agent merges `...wellbeingSuiteManifests` into src/registry/apps.ts.
import type { AppManifest, PageSchema } from '@/engine/types'

/* ---------- 1 · Ideal Meals (sheet fallback / mealIdeals) ---------- */

const idealMealsPage: PageSchema = {
  id: 'plates',
  type: 'sheet',
  title: 'Ideal Plates',
  icon: 'utensils',
  dataSource: { resource: 'mealIdeals' },
  config: {
    entity: ['ideal meal', 'ideal meals'],
    searchPlaceholder: 'Search client or dish…',
    // client linkage — Person Focus Mode filters by linked client id
    scopeBy: 'clientId',
    searchable: true,
    columns: [
      { key: 'dishName', label: 'Dish' },
      { key: 'clientName', label: 'Client' },
      { key: 'mealType', label: 'Meal' },
      { key: 'dietaryTags', label: 'Dietary tags' },
      { key: 'status', label: 'Status' },
    ],
  },
}

/* ---------- 2 · Workout (sheet fallback / workoutPlans) ---------- */

const workoutPage: PageSchema = {
  id: 'movement',
  type: 'sheet',
  title: 'Ideal Movement',
  icon: 'dumbbell',
  dataSource: { resource: 'workoutPlans' },
  config: {
    entity: ['workout plan', 'workout plans'],
    searchPlaceholder: 'Search client or activity…',
    scopeBy: 'clientId',
    searchable: true,
    columns: [
      { key: 'activity', label: 'Activity' },
      { key: 'clientName', label: 'Client' },
      { key: 'durationMin', label: 'Minutes' },
      { key: 'intensity', label: 'Intensity' },
      { key: 'status', label: 'Status' },
    ],
  },
}

/* ---------- 3 · Sleep (sheet fallback / sleepProfiles) ---------- */

const sleepPage: PageSchema = {
  id: 'rest',
  type: 'sheet',
  title: 'Ideal Rest',
  icon: 'moon',
  dataSource: { resource: 'sleepProfiles' },
  config: {
    entity: ['sleep profile', 'sleep profiles'],
    searchPlaceholder: 'Search client or note…',
    scopeBy: 'clientId',
    searchable: true,
    columns: [
      { key: 'clientName', label: 'Client' },
      { key: 'avgHours', label: 'Avg hours' },
      { key: 'targetHours', label: 'Target' },
      { key: 'quality', label: 'Quality' },
      { key: 'trend', label: 'Trend' },
    ],
  },
}

/* ---------- 4 · Hydration (sheet fallback / hydrationProfiles) ---------- */

const hydrationPage: PageSchema = {
  id: 'intake',
  type: 'sheet',
  title: 'Ideal Intake',
  icon: 'droplets',
  dataSource: { resource: 'hydrationProfiles' },
  config: {
    entity: ['hydration profile', 'hydration profiles'],
    searchPlaceholder: 'Search client or note…',
    scopeBy: 'clientId',
    searchable: true,
    columns: [
      { key: 'clientName', label: 'Client' },
      { key: 'avgOz', label: 'Avg oz' },
      { key: 'targetOz', label: 'Target' },
      { key: 'glasses', label: 'Glasses (of 8)' },
      { key: 'trend', label: 'Trend' },
    ],
  },
}

// FOUR APPS, NOT FOUR PAGES OF `clients`.
export const wellbeingSuiteManifests: AppManifest[] = [
  {
    id: 'ideal-meals',
    name: 'Ideal Meals',
    tagline: 'AI-plated lunches, dinners and breakfasts from each client’s dietary profile.',
    icon: 'utensils',
    accent: 'mint',
    category: 'Care',
    version: '1.0.0',
    isNew: true,
    enabled: true,
    audience: ['all', 'staff'],
    pages: [idealMealsPage],
  },
  {
    id: 'workout',
    name: 'Workout',
    tagline: 'Ideal movement sessions matched to mobility and therapy goals.',
    icon: 'dumbbell',
    accent: 'peach',
    category: 'Care',
    version: '1.0.0',
    isNew: true,
    enabled: true,
    audience: ['all', 'staff'],
    pages: [workoutPage],
  },
  {
    id: 'sleep',
    name: 'Sleep',
    tagline: 'Rest quality, bedtime routines and ISP sleep targets at a glance.',
    icon: 'moon',
    accent: 'lavender',
    category: 'Care',
    version: '1.0.0',
    isNew: true,
    enabled: true,
    audience: ['all', 'staff'],
    pages: [sleepPage],
  },
  {
    id: 'hydration',
    name: 'Hydration',
    tagline: 'Daily fluid intake against each client’s target, with prompt-aware notes.',
    icon: 'droplets',
    accent: 'blue',
    category: 'Care',
    version: '1.0.0',
    isNew: true,
    enabled: true,
    audience: ['all', 'staff'],
    pages: [hydrationPage],
  },
]
