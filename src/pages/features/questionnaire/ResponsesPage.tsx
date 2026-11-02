// ResponsesPage — the Questionnaires app's admin table (`/app/questionnaires/responses`, static route wired in…
// Sheet-style table over the seeded questionnaireResponses + locally submitted ones from useQuestionnaireStore…
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
// submission stamps wear Ohio wall-clock for every viewer
import { ohioDateTime, ohioDayYear } from '@/lib/ohio'
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  CloudUpload,
  Inbox,
  Loader2,
  MessageSquareText,
  ShieldAlert,
  Star,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import DragPerson from '@/components/shared/DragPerson'
import { Badge } from '@/components/shared/Badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCan } from '@/auth/permissions'
import { useQuestionnaireStore } from '@/stores/useQuestionnaireStore'
import { useLiveQuestionnaires } from '@/pages/features/questionnaire/live'
import { toast } from '@/stores/useToastStore'
import { sendKeptResponses } from '@/lib/responseSync'
import {
  type QuestionnaireQuestion,
  type QuestionnaireResponse,
  type ResponseAnswer,
  type ResponseRole,
} from '@/lib/seed-questionnaire'
import type { TintName } from '@/engine/types'
import { cn } from '@/lib/utils'
import { BTN_GHOST, QUESTIONNAIRE_PERM, QuestionnaireTabs, useAllQuestionnaires } from './bits'

// `answers_json` → { questionId: answer }.
function parseAnswers(raw: unknown): Record<string, string> {
  try {
    const o = JSON.parse(String(raw ?? '{}'))
    if (!o || typeof o !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(o)) out[k] = String(v ?? '')
    return out
  } catch {
    return {}
  }
}

const ROLE_META: Record<ResponseRole, { label: string; tint: TintName }> = {
  candidate: { label: 'Candidate', tint: 'amber' },
  staff: { label: 'Staff', tint: 'blue' },
  manager: { label: 'Manager', tint: 'lavender' },
}

const STATUS_META: Record<QuestionnaireResponse['status'], { label: string; tint: TintName }> = {
  submitted: { label: 'Submitted', tint: 'blue' },
  reviewed: { label: 'Reviewed', tint: 'mint' },
}

type Ordering = 'newest' | 'name'

const ORDERINGS: { id: Ordering; label: string }[] = [
  { id: 'newest', label: 'Newest' },
  { id: 'name', label: 'Name A→Z' },
]

/* ================= response detail modal ================= */

function NoAnswer() {
  return <span className="text-[13px] text-text-3">— No answer</span>
}

/** One question block: number + prompt, then the highlighted choice list or the written answer. */
function AnswerBlock({
  index,
  q,
  answer,
}: {
  index: number
  q: QuestionnaireQuestion
  answer: ResponseAnswer | undefined
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-text-3">
          Q{index + 1}
        </span>
        <p className="text-[13.5px] font-bold leading-5 text-text-1">{q.prompt}</p>
      </div>

      {q.kind === 'choice' ? (
        answer?.choiceKey ? (
          <div className="space-y-1.5">
            {(q.options ?? []).map((opt) => {
              const selected = opt.key === answer.choiceKey
              return (
                <div
                  key={opt.key}
                  className={cn(
                    'flex items-center gap-3 rounded-md border px-3 py-2.5',
                    selected ? 'border-primary bg-tint-primary' : 'border-border bg-surface',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                      selected ? 'bg-primary text-on-primary' : 'bg-surface-2 text-text-3',
                    )}
                  >
                    {selected ? <Check size={13} strokeWidth={3} /> : opt.key}
                  </span>
                  <span className={cn('min-w-0 flex-1 text-[13px] leading-5', selected ? 'font-medium text-text-1' : 'text-text-2')}>
                    {opt.text}
                  </span>
                  {selected && (
                    <span className="shrink-0 rounded-full bg-tint-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-tint-fg-primary">
                      Selected
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <NoAnswer />
        )
      ) : q.kind === 'scale' && answer?.text ? (
        // A MEASURED ANSWER READS AS AN ANSWER, not as a loose number.
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={cn(
                'grid h-9 w-9 place-items-center rounded-md border text-[14px] font-bold',
                String(n) === answer.text
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-border bg-surface text-text-3',
              )}
            >
              {n}
            </span>
          ))}
          {q.scaleLabels && (
            <span className="ml-1 text-[12px] text-text-2">
              {answer.text === '5' ? q.scaleLabels[1] : answer.text === '1' ? q.scaleLabels[0] : ''}
            </span>
          )}
        </div>
      ) : (q.kind === 'yesno' || q.kind === 'number' || q.kind === 'date') && answer?.text ? (
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-primary bg-tint-primary px-3 py-1.5 text-[13px] font-semibold text-tint-fg-primary">
            {answer.text}
          </span>
          {q.unit && <span className="text-[12px] text-text-3">{q.unit}</span>}
        </div>
      ) : answer?.text ? (
        /* subtle quote block — left border, muted surface */
        <div className="rounded-md border-l-[3px] border-border-strong bg-surface-2 px-4 py-3">
          <p className="text-[13px] leading-6 text-text-1">{answer.text}</p>
        </div>
      ) : (
        <NoAnswer />
      )}
    </div>
  )
}

function ResponseDetailDialog({
  response,
  questions,
  questionnaireTitle,
  onClose,
}: {
  response: QuestionnaireResponse
  questions: QuestionnaireQuestion[]
  questionnaireTitle: string
  onClose: () => void
}) {
  const role = ROLE_META[response.role]
  const status = STATUS_META[response.status]
  const byQuestion = useMemo(() => new Map((response.answers ?? []).map((a) => [a.questionId, a])), [response.answers])

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>
            <DragPerson name={response.respondentName} subtitle={role.label}>
              {response.respondentName}
            </DragPerson>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Detailed answers for {questionnaireTitle}
          </DialogDescription>
        </DialogHeader>

        {/* meta chips */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={role.label} tint={role.tint} />
          <Badge label={status.label} tint={status.tint} />
          {response.score != null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold leading-4 text-tint-fg-amber">
              <Star size={11} /> {response.score}/5
            </span>
          )}
        </div>
        <div className="-mt-1 text-[12px] text-text-3">
          {questionnaireTitle} · submitted {ohioDateTime(response.submittedAt)} ·{' '}
          {response.answersSummary}
        </div>

        {/* answers, in questionnaire order */}
        <div className="max-h-[54vh] space-y-5 overflow-y-auto border-t border-border pt-4 pr-1">
          {!response.answers ? (
            <div className="flex items-start gap-2.5 rounded-md border border-dashed border-border px-4 py-3.5">
              <MessageSquareText size={15} className="mt-0.5 shrink-0 text-text-3" />
              <p className="text-[13px] leading-5 text-text-2">
                Summary only — detailed answers were not captured for this response.
              </p>
            </div>
          ) : questions.length === 0 ? (
            <p className="text-[13px] text-text-3">The questionnaire this response belongs to is no longer available.</p>
          ) : (
            questions.map((q, i) => (
              <AnswerBlock key={q.id} index={i} q={q} answer={byQuestion.get(q.id)} />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ================= page ================= */

export default function ResponsesPage() {
  const canManage = useCan(QUESTIONNAIRE_PERM)
  const questionnaires = useAllQuestionnaires()
  // Read through the resource, like the questions themselves.
  const { responses: liveRaw, reload } = useLiveQuestionnaires()
  const liveResponses = useMemo(
    () => liveRaw.map((r) => ({
      id: r.response_id,
      questionnaireId: r.questionnaire_id,
      respondentName: r.respondent,
      role: (['candidate', 'staff', 'manager'].includes(r.role) ? r.role : 'staff') as ResponseRole,
      submittedAt: r.submitted_at,
      answersSummary: `${r.answered}/${r.total} answered`,
      // THE ANSWERS THEMSELVES.
      answers: Object.entries(parseAnswers(r.answers_json)).map(([questionId, value]) =>
        /^[A-F]$/.test(value)
          ? { questionId, choiceKey: value as NonNullable<ResponseAnswer['choiceKey']> }
          : { questionId, text: value },
      ),
      score: r.score,
      status: (r.status === 'reviewed' ? 'reviewed' : 'submitted') as 'submitted' | 'reviewed',
    })),
    [liveRaw],
  )
  const localResponses = useQuestionnaireStore((s) => s.localResponses)
  const questionSets = useQuestionnaireStore((s) => s.questionSets)
  const [ordering, setOrdering] = useState<Ordering>('newest')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const titleFor = useMemo(() => {
    const map = new Map(questionnaires.map((q) => [q.id, q.title]))
    return (id: string) => map.get(id) ?? 'Unknown questionnaire'
  }, [questionnaires])

  const rows = useMemo(() => {
    // THE SHEET, not the bundle.
    const all = [...localResponses, ...liveResponses]
    return all.sort((a, b) =>
      ordering === 'newest'
        ? b.submittedAt.localeCompare(a.submittedAt)
        : a.respondentName.localeCompare(b.respondentName),
    )
    // `liveResponses` HAS TO BE HERE.
  }, [localResponses, liveResponses, ordering])

  /* selected response + its questionnaire questions (admin-edited list wins) */
  const detail = detailId ? (rows.find((r) => r.id === detailId) ?? null) : null
  const detailQuestions = useMemo(() => {
    if (!detail) return []
    const q = questionnaires.find((x) => x.id === detail.questionnaireId)
    return q ? (questionSets[q.id] ?? q.questions) : []
  }, [detail, questionnaires, questionSets])

  /* ---------- responses kept on this device ---------- */

  // a response whose send failed was kept here; it is sent again through Python and leaves the device once kept
  const sendKept = async () => {
    if (!localResponses.length || syncing) return
    setSyncing(true)
    const result = await sendKeptResponses()
    setSyncing(false)
    reload()
    if (result.failed === 0) {
      toast({ type: 'success', title: `${result.ok} response${result.ok === 1 ? '' : 's'} sent to the server`,
        body: 'Scored and kept in the Hub’s database.' })
    } else {
      toast({
        type: 'danger',
        title: `${result.failed} response${result.failed === 1 ? '' : 's'} not sent`,
        body: `${result.ok} sent · first error: ${result.failures[0]?.message ?? 'unknown'}`,
      })
    }
  }

  const syncStatus = localResponses.length
    ? `${localResponses.length} kept on this device`
    : 'Every response is on the server'

  if (!canManage) {
    return (
      <div className="mx-auto max-w-[560px] pt-10">
        <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-tint-amber text-tint-fg-amber">
            <ShieldAlert size={22} />
          </span>
          <h2 className="font-display text-[17px] font-bold text-text-1">Responses are admin-only</h2>
          <p className="max-w-[360px] text-[13px] leading-5 text-text-2">
            Reviewing questionnaire responses requires the <span className="font-mono text-[12px]">{QUESTIONNAIRE_PERM}</span>{' '}
            permission. Ask an admin if you need access.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="w-full">
      <QuestionnaireTabs active="responses" />
      <PageHeader
        title="Responses"
        subtitle={`${rows.length} response${rows.length === 1 ? '' : 's'} across ${questionnaires.length} questionnaire${questionnaires.length === 1 ? '' : 's'}.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('text-[12px]', localResponses.length ? 'font-medium text-tint-fg-amber' : 'text-text-3')}>
              {syncStatus}
            </span>
            {localResponses.length > 0 && (
              <button type="button" className={BTN_GHOST} onClick={() => void sendKept()} disabled={syncing}>
                {syncing ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />}
                {syncing ? 'Sending…' : 'Send to the server'}
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={BTN_GHOST}>
                  <ArrowUpDown size={14} /> {ORDERINGS.find((o) => o.id === ordering)?.label}
                  <ChevronDown size={13} className="text-text-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {ORDERINGS.map((o) => (
                  <DropdownMenuItem key={o.id} onClick={() => setOrdering(o.id)}>
                    <Check size={14} className={cn(ordering === o.id ? 'text-primary' : 'opacity-0')} />
                    {o.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="No responses yet" body="When someone submits a questionnaire, their response lands here." />
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  {['Respondent', 'Questionnaire', 'Role', 'Submitted', 'Answers', 'Score', 'Status'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const role = ROLE_META[r.role]
                  const status = STATUS_META[r.status]
                  return (
                    <tr
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`View answers from ${r.respondentName}`}
                      onClick={() => setDetailId(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setDetailId(r.id)
                        }
                      }}
                      className="group cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-surface-2/60 focus-visible:bg-surface-2/60 focus-visible:outline-none"
                    >
                      <td className="px-4 py-3">
                        {/* respondents are candidates/staff/managers — never consumers */}
                        <DragPerson name={r.respondentName} subtitle={role.label}>
                          <span className="text-[13px] font-semibold text-text-1 underline-offset-2 group-hover:underline">
                            {r.respondentName}
                          </span>
                        </DragPerson>
                      </td>
                      <td className="max-w-[240px] px-4 py-3">
                        <span className="block truncate text-[13px] text-text-2">{titleFor(r.questionnaireId)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge label={role.label} tint={role.tint} />
                      </td>
                      <td className="px-4 py-3 text-[13px] text-text-2">
                        {ohioDayYear(r.submittedAt)}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-text-2">{r.answersSummary}</td>
                      <td className="px-4 py-3">
                        {r.score != null ? (
                          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-text-1">
                            <Star size={12} className="text-tint-fg-amber" /> {r.score}/5
                          </span>
                        ) : (
                          <span className="text-[13px] text-text-3">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge label={status.label} tint={status.tint} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[12px] text-text-3">
            <span className="inline-flex items-center gap-1.5">
              <Inbox size={12} /> {rows.length} rows · ordered by {ORDERINGS.find((o) => o.id === ordering)?.label} ·
              click a row to see the answers
            </span>
            <Link to="/app/questionnaires/take" className="font-semibold text-primary hover:underline">
              Take a questionnaire →
            </Link>
          </div>
        </Card>
      )}

      {detail && (
        <ResponseDetailDialog
          response={detail}
          questions={detailQuestions}
          questionnaireTitle={titleFor(detail.questionnaireId)}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  )
}
