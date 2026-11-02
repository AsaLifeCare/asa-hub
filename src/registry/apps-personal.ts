// The personal apps — Smart Shopper and Meal Tracker.
// Both migrated together, and both the same species as the Task Board: the data belongs to the person signed in and…
import type { AppManifest, PageSchema } from '@/engine/types'
import { useRegistryStore } from '@/stores/useRegistryStore'

/* The routes are static in App.tsx; these schemas name the sidebar entry. */

const shopperPage: PageSchema = {
  id: 'list',
  type: 'sheet',
  title: 'Smart Shopper',
  icon: 'shopping-cart',
  dataSource: { resource: 'shopperItems' },
  config: { entity: ['item', 'items'], customFeature: 'personal/ShopperPage' },
}

const mealPage: PageSchema = {
  id: 'day',
  type: 'sheet',
  title: 'Meal Tracker',
  icon: 'utensils',
  dataSource: { resource: 'mealLog' },
  config: { entity: ['entry', 'entries'], customFeature: 'personal/MealsPage' },
}

const learningPage: PageSchema = {
  id: 'skills',
  type: 'sheet',
  title: 'Learning',
  icon: 'graduation-cap',
  dataSource: { resource: 'learnSkills' },
  config: { entity: ['competency', 'competencies'], customFeature: 'learning/LearningPage' },
}

const travelPage: PageSchema = {
  id: 'trips',
  type: 'sheet',
  title: 'Company Travel',
  icon: 'plane',
  dataSource: { resource: 'travelTrips' },
  config: { entity: ['trip', 'trips'], customFeature: 'travel/TravelPage' },
}

export const personalManifests: AppManifest[] = [
  {
    id: 'shopper',
    name: 'Smart Shopper',
    tagline: 'What you mean to buy, and roughly what it costs',
    icon: 'shopping-cart',
    accent: 'lavender',
    // Wellbeing by default — joining Meals, Learning, Mail and Business Travel.
    category: 'Wellbeing',
    version: '1.0.0',
    audience: ['all'],
    isNew: true,
    enabled: true,
    pages: [shopperPage],
    notifications: ['app'],
  },
  {
    id: 'meals',
    name: 'Meal Tracker',
    tagline: 'What you ate and drank today, against your own goal',
    icon: 'utensils',
    accent: 'mint',
    category: 'Wellbeing',
    version: '1.0.0',
    audience: ['all'],
    isNew: true,
    enabled: true,
    pages: [mealPage],
    notifications: ['app'],
  },
  {
    id: 'learning',
    name: 'Learning',
    tagline: 'What each person can do, and the evidence behind it',
    icon: 'graduation-cap',
    accent: 'lavender',
    category: 'Wellbeing',
    version: '1.0.0',
    // Everyone: the practice record is the reader's own, and a competency ladder that only managers can open is one…
    audience: ['all'],
    isNew: true,
    enabled: true,
    pages: [learningPage],
    notifications: ['app'],
  },
  {
    id: 'travel',
    name: 'Company Travel',
    tagline: 'Where we go, what it costs, and what came of it',
    icon: 'plane',
    accent: 'blue',
    // Wellbeing by default — same default-not- a-cage rule as Mail.
    category: 'Wellbeing',
    version: '1.0.0',
    // NOT per-person: a trip is a company decision with a budget and an approver, and the point of the record is…
    audience: ['admin', 'manager'],
    isNew: true,
    // RETIRED from the shelf, one app fewer to carry — the trips now show inside Finances (Company travel panel).
    enabled: false,
    pages: [travelPage],
    notifications: ['app'],
  },
]

/** Self-registration, same guard as the other satellite manifests. */
queueMicrotask(() => {
  const registered = useRegistryStore.getState().apps
  const missing = personalManifests.filter((m) => !registered.some((a) => a.id === m.id))
  if (missing.length) useRegistryStore.setState({ apps: [...registered, ...missing] })
})
