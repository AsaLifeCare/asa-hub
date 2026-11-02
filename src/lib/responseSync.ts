// A questionnaire response kept on this device — its send to the server failed — is sent again through
// questionnaireSubmit, the Python door that scores it and keeps it in the Hub's database; once it lands it leaves the
// device. Nothing here reaches Apps Script.
import type { QuestionnaireResponse } from '@/lib/seed-questionnaire'
import { submitQuestionnaire } from '@/pages/features/questionnaire/live'
import { useQuestionnaireStore } from '@/stores/useQuestionnaireStore'

export type SyncResult = {
  ok: number
  failed: number
  failures: { id: string; message: string }[]
}

/** The answers questionnaireSubmit reads, by question id: a choice's key, else the written text. */
export function answersOf(response: QuestionnaireResponse): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of response.answers ?? []) {
    const v = String(a.choiceKey ?? a.text ?? '').trim()
    if (v) out[a.questionId] = v
  }
  return out
}

/** Every response kept on this device, sent again one by one; each that lands leaves the device. */
export async function sendKeptResponses(): Promise<SyncResult> {
  const result: SyncResult = { ok: 0, failed: 0, failures: [] }
  for (const r of [...useQuestionnaireStore.getState().localResponses]) {
    try {
      // a write: never re-sent on a garbled answer, or one response would be kept twice
      await submitQuestionnaire(r.questionnaireId, answersOf(r))
      useQuestionnaireStore.getState().removeResponse(r.id)
      result.ok++
    } catch (e) {
      result.failed++
      result.failures.push({ id: r.id, message: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}
