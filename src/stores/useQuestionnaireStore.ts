// Questionnaire store (zustand, persisted to localStorage["asa-questionnaire"]).
// Local layer on top of the seeded datasets (src/lib/seed-questionnaire.ts): - created — questionnaires built in…
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  HeaderLayout,
  Questionnaire,
  QuestionnaireQuestion,
  QuestionnaireResponse,
} from '@/lib/seed-questionnaire'
import { QUESTIONNAIRE_SEED_VERSION, RESEEDED_QUESTIONNAIRE_IDS } from '@/lib/seed-questionnaire'

type QuestionnaireState = {
  created: Questionnaire[]
  questionSets: Record<string, QuestionnaireQuestion[]>
  /** Which seed the stored edits were made against — see the migration below. */
  seedVersion?: number
  layouts: Record<string, HeaderLayout>
  drafts: Record<string, number>
  localResponses: QuestionnaireResponse[]

  createQuestionnaire: (q: Questionnaire) => void
  setLayout: (questionnaireId: string, layout: HeaderLayout) => void
  setQuestions: (questionnaireId: string, questions: QuestionnaireQuestion[]) => void
  /** Removes the admin override so the seeded question list is used again. */
  resetQuestions: (questionnaireId: string) => void
  setDraft: (userId: string, questionnaireId: string, answered: number) => void
  clearDraft: (userId: string, questionnaireId: string) => void
  addResponse: (r: QuestionnaireResponse) => void
  /** A response kept on this device that the server has now kept: it leaves the device. */
  removeResponse: (id: string) => void
}

export const draftKey = (userId: string, questionnaireId: string) => `${userId}:${questionnaireId}`

export const useQuestionnaireStore = create<QuestionnaireState>()(
  persist(
    (set) => ({
      created: [],
      questionSets: {},
      seedVersion: QUESTIONNAIRE_SEED_VERSION,
      layouts: {},
      drafts: {},
      localResponses: [],

      createQuestionnaire: (q) => set((s) => ({ created: [...s.created, q] })),

      setLayout: (questionnaireId, layout) =>
        set((s) => ({ layouts: { ...s.layouts, [questionnaireId]: layout } })),

      setQuestions: (questionnaireId, questions) =>
        set((s) => ({ questionSets: { ...s.questionSets, [questionnaireId]: questions } })),

      resetQuestions: (questionnaireId) =>
        set((s) => {
          const questionSets = { ...s.questionSets }
          delete questionSets[questionnaireId]
          return { questionSets }
        }),

      setDraft: (userId, questionnaireId, answered) =>
        set((s) => ({ drafts: { ...s.drafts, [draftKey(userId, questionnaireId)]: answered } })),

      clearDraft: (userId, questionnaireId) =>
        set((s) => {
          const drafts = { ...s.drafts }
          delete drafts[draftKey(userId, questionnaireId)]
          return { drafts }
        }),

      addResponse: (r) => set((s) => ({ localResponses: [r, ...s.localResponses] })),

      removeResponse: (id) => set((s) => ({ localResponses: s.localResponses.filter((r) => r.id !== id) })),
    }),
    {
      name: 'asa-questionnaire',
      // A stored edit belongs to the seed it was made against.
      version: QUESTIONNAIRE_SEED_VERSION,
      migrate: (persisted: unknown) => {
        const state = (persisted ?? {}) as { questionSets?: Record<string, QuestionnaireQuestion[]> }
        const kept = { ...(state.questionSets ?? {}) }
        for (const id of RESEEDED_QUESTIONNAIRE_IDS) delete kept[id]
        return { ...state, questionSets: kept, seedVersion: QUESTIONNAIRE_SEED_VERSION }
      },
    },
  ),
)
