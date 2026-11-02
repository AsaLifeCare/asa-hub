// The questionnaires, through the protocol.
// The screens used to import `seed-questionnaire.ts` directly, which meant the questions on the page were a file in…
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { gasAction } from '@/features/hiring/shared'
import type {
  HeaderLayout,
  Questionnaire,
  QuestionnaireAudience,
  QuestionnaireQuestion,
  QuestionOption,
  QuestionKind,
} from '@/lib/seed-questionnaire'

/** One question as the sheet holds it — a row, not a card. */
type SheetQuestion = {
  id: string
  number: number
  kind: string
  scenario: string
  prompt: string
  options?: QuestionOption[]
  placeholder: string
  scaleLow: string
  scaleHigh: string
  metric: string
  weight: number
  yes_is: string
  unit: string
  purpose: string
}
type SheetQuestionnaire = {
  id: string
  title: string
  audience: string
  description: string
  estimatedMin: number
  privacyNote: string
  headerLayout: string
  source_sheet: string
  questions: SheetQuestion[]
}
// A row of `questionnaireResponses` AS THE RESOURCE RETURNS IT — column names, not renamed ones.
export type LiveResponse = {
  response_id: string
  questionnaire_id: string
  questionnaire_title: string
  respondent: string
  respondent_email: string
  role: string
  submitted_at: string
  answered: number
  total: number
  score: number | null
  status: string
  // The raw cell — the resource returns column names, and this one is a JSON string.
  answers_json: string
}
/** One row of the `questionnaires` tab, as the resource returns it. */
type Row = {
  questionnaire_id?: string; questionnaire_title?: string; audience?: string
  description?: string; estimated_min?: string | number
  privacy_note?: string; header_layout?: string
  q_number?: string | number; question_id?: string; kind?: string
  scenario?: string; prompt?: string; options?: string; placeholder?: string
  scale_low?: string; scale_high?: string
  metric?: string; weight?: string | number; yes_is?: string; unit?: string
  purpose?: string; source_sheet?: string
}

// "A: text | B: text" → the lettered options the runner draws.
function parseOptions(raw: string): QuestionOption[] | undefined {
  const out: QuestionOption[] = []
  for (const part of String(raw ?? '').split('|')) {
    const m = part.trim().match(/^([A-F])\s*[:.\-]\s*(.+)$/)
    if (m) out.push({ key: m[1] as QuestionOption['key'], text: m[2].trim() })
  }
  return out.length ? out : undefined
}

const KINDS: QuestionKind[] = ['choice', 'text', 'scale', 'number', 'yesno', 'date']

// Sheet row → the card the runner draws.
function toQuestionnaire(q: SheetQuestionnaire): Questionnaire {
  const questions: QuestionnaireQuestion[] = q.questions.map((r) => ({
    id: r.id,
    kind: (KINDS.includes(r.kind as QuestionKind) ? r.kind : 'text') as QuestionKind,
    scenario: r.scenario,
    prompt: r.prompt,
    options: r.options,
    unit: r.unit || undefined,
    placeholder: r.placeholder || undefined,
    scaleLabels: r.scaleLow || r.scaleHigh ? [r.scaleLow, r.scaleHigh] : undefined,
    scoring:
      r.metric && r.metric !== 'Diagnostic Only'
        ? {
            metric: r.metric,
            weight: r.weight,
            yesIs: r.yes_is === 'no' ? 'no' : r.yes_is === 'yes' ? 'yes' : undefined,
            purpose: r.purpose,
          }
        : undefined,
    required: true,
  }))
  return {
    id: q.id,
    title: q.title,
    description: q.description,
    audience: (['new-hire', 'all-staff', 'manager'].includes(q.audience)
      ? q.audience
      : 'all-staff') as QuestionnaireAudience,
    estimatedMin: q.estimatedMin || Math.max(3, Math.round(questions.length * 0.8)),
    privacyNote: q.privacyNote || 'Visible to your team only',
    headerLayout: (q.headerLayout || 'minimal') as HeaderLayout,
    questions,
  }
}

/** Rows → questionnaires, grouped and ordered the way the sheet is. */
function group(rows: Row[]): SheetQuestionnaire[] {
  const by = new Map<string, SheetQuestionnaire>()
  for (const r of rows) {
    const id = String(r.questionnaire_id ?? '').trim()
    const prompt = String(r.prompt ?? '').trim()
    if (!id || !prompt) continue
    if (!by.has(id)) {
      by.set(id, {
        id,
        title: String(r.questionnaire_title ?? '').trim() || id,
        audience: String(r.audience ?? 'all-staff').trim(),
        description: String(r.description ?? ''),
        estimatedMin: parseInt(String(r.estimated_min ?? ''), 10) || 0,
        privacyNote: String(r.privacy_note ?? ''),
        headerLayout: String(r.header_layout ?? ''),
        source_sheet: String(r.source_sheet ?? ''),
        questions: [],
      })
    }
    const q = by.get(id)!
    const weight = parseFloat(String(r.weight ?? '').replace(',', '.'))
    q.questions.push({
      id: String(r.question_id ?? `${id}-q${q.questions.length + 1}`),
      number: parseInt(String(r.q_number ?? ''), 10) || q.questions.length + 1,
      kind: String(r.kind ?? 'text'),
      scenario: String(r.scenario ?? ''),
      prompt,
      options: parseOptions(String(r.options ?? '')),
      placeholder: String(r.placeholder ?? ''),
      scaleLow: String(r.scale_low ?? ''),
      scaleHigh: String(r.scale_high ?? ''),
      metric: String(r.metric ?? ''),
      weight: Number.isNaN(weight) ? 0 : weight,
      yes_is: String(r.yes_is ?? ''),
      unit: String(r.unit ?? ''),
      purpose: String(r.purpose ?? ''),
    })
  }
  const out = [...by.values()]
  for (const q of out) q.questions.sort((a, b) => a.number - b.number)
  return out
}

export function useLiveQuestionnaires() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [responses, setResponses] = useState<LiveResponse[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.list<Row>('questionnaires')
      setRows(list)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The questionnaires could not be read.')
    } finally {
      setLoading(false)
    }
    // The responses are their own tab and their own read; a failure there must not cost the questions.
    try {
      setResponses(await api.list<LiveResponse>('questionnaireResponses'))
    } catch { /* the page shows none rather than inventing some */ }
  }, [])

  useEffect(() => { void load() }, [load])

  return {
    loading,
    error,
    reload: load,
    questionnaires: rows ? group(rows).map(toQuestionnaire) : [],
    responses,
  }
}

/** Send one person's answers through the declared write: Python scores them and keeps them in the Hub's database. */
export async function submitQuestionnaire(
  questionnaireId: string,
  answers: Record<string, string>,
) {
  // a write: never re-sent on a garbled answer, or one response would be kept twice
  return gasAction<{ response_id: string; answered: number; total: number; score: number | null; message: string }>(
    'questionnaireSubmit',
    { questionnaire_id: questionnaireId, answers: JSON.stringify(answers) },
    { retry: false },
  )
}
