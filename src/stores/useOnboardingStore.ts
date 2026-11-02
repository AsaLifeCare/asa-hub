// Onboarding progress store (zustand, persisted to localStorage["asa-onboarding"]).
// Tracks the 6-step new-hire checklist (see OnboardingHome) per user id: progress: { [userId]: { completed…
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** The six onboarding steps, in display order (ids are stable). */
export const ONBOARDING_STEP_IDS = [
  'packet',
  'background-check',
  'upload-documents',
  'training',
  'questionnaire',
  'tutorials',
] as const

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number]

export type OnboardingProgress = {
  /** Completed step ids (any order — trainees can jump around). */
  completed: OnboardingStepId[]
  /** All six steps done — trainee access has expired. */
  expired: boolean
}

type OnboardingState = {
  /** Per-user progress, keyed by AuthUser.id. */
  progress: Record<string, OnboardingProgress>
  // Mark a step done for a user.
  markDone: (userId: string, stepId: OnboardingStepId) => boolean
  // Undo one step's tick — the revert half of the optimistic Mark done: the screen advances instantly and a FAILED…
  unmark: (userId: string, stepId: OnboardingStepId) => void
  /** Whether the user's onboarding access has expired. */
  isExpired: (userId: string) => boolean
  /** Completed step ids for a user ([] when never started). */
  completedFor: (userId: string) => OnboardingStepId[]
  // Forget this account's progress entirely.
  resetUser: (userId: string) => void
}

const EMPTY: OnboardingProgress = { completed: [], expired: false }

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      progress: {},

      markDone: (userId, stepId) => {
        const cur = get().progress[userId] ?? EMPTY
        if (cur.expired) return true
        const completed = cur.completed.includes(stepId) ? cur.completed : [...cur.completed, stepId]
        const expired = ONBOARDING_STEP_IDS.every((id) => completed.includes(id))
        set((s) => ({ progress: { ...s.progress, [userId]: { completed, expired } } }))
        return expired
      },

      unmark: (userId, stepId) =>
        set((s) => {
          const cur = s.progress[userId]
          if (!cur || !cur.completed.includes(stepId)) return s
          const completed = cur.completed.filter((id) => id !== stepId)
          return { progress: { ...s.progress, [userId]: { completed, expired: false } } }
        }),

      isExpired: (userId) => get().progress[userId]?.expired ?? false,

      completedFor: (userId) => get().progress[userId]?.completed ?? [],

      resetUser: (userId) =>
        set((s) => {
          if (!s.progress[userId]) return s
          const progress = { ...s.progress }
          delete progress[userId]
          return { progress }
        }),
    }),
    { name: 'asa-onboarding' },
  ),
)
