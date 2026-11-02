// QuestionnairesPage — the Questionnaires app landing (`/app/questionnaires/take`, static route wired in App.tsx…
// Header + "+ New questionnaire" (admin, QUESTIONNAIRE_PERM via useCan) opening a builder modal (title / audience /…
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { ClipboardList, Clock, Inbox, Lock, Play, Plus } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import { Badge, Dot } from '@/components/shared/Badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCan } from '@/auth/permissions'
import { useLiveQuestionnaires } from '@/pages/features/questionnaire/live'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { draftKey, useQuestionnaireStore } from '@/stores/useQuestionnaireStore'
import type { HeaderLayout, Questionnaire, QuestionnaireAudience } from '@/lib/seed-questionnaire'
import { staggerContainer, staggerItem } from '@/engine/motion'
import { cn } from '@/lib/utils'
import QuestionnaireRunner from './QuestionnaireRunner'
import {
  AUDIENCE_META,
  BTN_GHOST,
  BTN_PRIMARY,
  HEADER_LAYOUTS,
  INPUT_CLS,
  LayoutThumb,
  QUESTIONNAIRE_PERM,
  QuestionnaireTabs,
  useAllQuestionnaires,
  useQuestionnaireEdited,
  useResolvedQuestions,
} from './bits'

/* ---------------- builder modal (stub: questions added after creation) ---------------- */

function NewQuestionnaireModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (q: Questionnaire) => void
}) {
  const createQuestionnaire = useQuestionnaireStore((s) => s.createQuestionnaire)
  const [title, setTitle] = useState('')
  const [audience, setAudience] = useState<QuestionnaireAudience>('new-hire')
  const [minutes, setMinutes] = useState('5')
  const [layout, setLayout] = useState<HeaderLayout>('hero')

  const reset = () => {
    setTitle('')
    setAudience('new-hire')
    setMinutes('5')
    setLayout('hero')
  }

  const submit = () => {
    if (!title.trim()) {
      toast({ type: 'warning', title: 'Title required', body: 'Give the questionnaire a title to continue.' })
      return
    }
    const q: Questionnaire = {
      id: `q-local-${Date.now().toString(36)}`,
      title: title.trim(),
      description: 'A locally created questionnaire. Add scenarios and questions in Edit mode from the runner.',
      audience,
      estimatedMin: Math.max(1, Number.parseInt(minutes, 10) || 5),
      privacyNote: 'Visible to your team only',
      headerLayout: layout,
      questions: [],
    }
    createQuestionnaire(q)
    toast({
      type: 'success',
      title: 'Questionnaire created',
      body: `"${q.title}" is ready — open it and use Edit questions to add scenarios.`,
    })
    reset()
    onOpenChange(false)
    onCreated(q)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>New questionnaire</DialogTitle>
          <DialogDescription>
            Set the basics now — questions can be added after creation, in the runner's Edit mode.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-text-2">Title</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekend Shift Scenario Check"
              className={INPUT_CLS}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-text-2">Audience</label>
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value as QuestionnaireAudience)}
                className={INPUT_CLS}
              >
                <option value="new-hire">New hire</option>
                <option value="all-staff">All staff</option>
                <option value="manager">Managers</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-text-2">Estimated minutes</label>
              <input
                type="number"
                min={1}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-text-2">Header layout</label>
            <div className="space-y-1.5">
              {HEADER_LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLayout(l.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                    layout === l.id ? 'border-primary bg-tint-primary' : 'border-border hover:border-primary/40',
                  )}
                >
                  <LayoutThumb layout={l.id} active={layout === l.id} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-text-1">{l.label}</span>
                    <span className="block truncate text-[12px] text-text-3">{l.description}</span>
                  </span>
                  <span
                    className={cn(
                      'grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                      layout === l.id ? 'border-primary bg-primary' : 'border-border-strong',
                    )}
                  >
                    {layout === l.id && <span className="h-1.5 w-1.5 rounded-full bg-on-primary" />}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-text-3">
              Admins can change this later with Customize header in the runner.
            </p>
          </div>
        </div>

        <DialogFooter>
          <button type="button" className={BTN_GHOST} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className={BTN_PRIMARY} onClick={submit}>
            <Plus size={14} /> Create questionnaire
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------- questionnaire card ---------------- */

function QuestionnaireCard({
  q,
  responsesCount,
  onStart,
}: {
  q: Questionnaire
  responsesCount: number
  onStart: () => void
}) {
  const canManage = useCan(QUESTIONNAIRE_PERM)
  const user = useAuthStore((s) => s.user)
  const questions = useResolvedQuestions(q)
  const edited = useQuestionnaireEdited(q)
  const localResponses = useQuestionnaireStore((s) => s.localResponses)
  const drafts = useQuestionnaireStore((s) => s.drafts)
  const navigate = useNavigate()

  const submitted = !!user && localResponses.some((r) => r.questionnaireId === q.id && r.respondentName === user.name)
  const draftCount = user ? drafts[draftKey(user.id, q.id)] ?? 0 : 0
  const status: 'not-started' | 'in-progress' | 'submitted' = submitted
    ? 'submitted'
    : draftCount > 0
      ? 'in-progress'
      : 'not-started'

  const audience = AUDIENCE_META[q.audience]
  const totalResponses = responsesCount + localResponses.filter((r) => r.questionnaireId === q.id).length

  return (
    <motion.div variants={staggerItem}>
      <Card hover className="flex h-full flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-tint-lavender text-tint-fg-lavender">
            <ClipboardList size={18} />
          </span>
          <span className="flex items-center gap-1.5">
            {canManage && edited && (
              <span
                title="The question list was edited on this device — differs from the seed."
                className="inline-flex items-center rounded-full bg-tint-info px-2 py-0.5 text-[11px] font-semibold leading-4 text-tint-fg-info"
              >
                Edited
              </span>
            )}
            <Badge label={audience.label} tint={audience.tint} />
          </span>
        </div>

        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-bold leading-5 text-text-1">{q.title}</h3>
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-text-2">{q.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-3">
          <span className="inline-flex items-center gap-1">
            <ClipboardList size={12} /> {questions.length} question{questions.length === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock size={12} /> ~{q.estimatedMin} min
          </span>
          <span className="inline-flex items-center gap-1">
            <Lock size={12} /> {q.privacyNote}
          </span>
          <span className="inline-flex items-center gap-1">
            <Inbox size={12} /> {totalResponses} response{totalResponses === 1 ? '' : 's'}
          </span>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-text-2">
            <Dot green={status === 'submitted'} className={status === 'in-progress' ? 'bg-warning' : undefined} />
            {status === 'submitted'
              ? 'Submitted'
              : status === 'in-progress'
                ? `In progress · ${draftCount}/${questions.length} answered`
                : 'Not started'}
          </span>
          <div className="flex items-center gap-2">
            {canManage && totalResponses > 0 && (
              <button
                type="button"
                className={cn(BTN_GHOST, 'h-8 px-3 text-[12px]')}
                onClick={() => navigate('/app/questionnaires/responses')}
              >
                View responses ({totalResponses})
              </button>
            )}
            <button type="button" className={cn(BTN_PRIMARY, 'h-8 px-3.5 text-[12px]')} onClick={onStart}>
              <Play size={12} /> {status === 'in-progress' ? 'Continue' : status === 'submitted' ? 'Retake' : 'Start'}
            </button>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}

/* ---------------- page ---------------- */

export default function QuestionnairesPage() {
  const canManage = useCan(QUESTIONNAIRE_PERM)
  const questionnaires = useAllQuestionnaires()
  const { responses: liveResponses } = useLiveQuestionnaires()
  const [builderOpen, setBuilderOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  const responseCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    // THE SHEET, not the bundle — the count under each card has to be the number of people who really answered.
    for (const r of liveResponses) counts[r.questionnaire_id] = (counts[r.questionnaire_id] ?? 0) + 1
    return counts
  }, [])

  const active = activeId ? questionnaires.find((q) => q.id === activeId) : undefined

  if (active) {
    return <QuestionnaireRunner questionnaire={active} onClose={() => setActiveId(null)} />
  }


  return (
    <div className="w-full">
      <QuestionnaireTabs active="take" />
      {/* THE PAGE, NOT A GREETING. "Welcome to the team"
          is an onboarding sentence, and this screen is used by staff every
          quarter — a title that only fits the first day stops meaning anything
          on the tenth visit. */}
      <PageHeader
        title="Take a questionnaire"
        subtitle="Questionnaires for hiring, onboarding and training — read each one and respond honestly."
        actions={
          canManage ? (
            <button type="button" className={BTN_PRIMARY} onClick={() => setBuilderOpen(true)}>
              <Plus size={15} /> New questionnaire
            </button>
          ) : undefined
        }
      />

      {questionnaires.length === 0 ? (
        <Card>
          <EmptyState
            title="No questionnaires yet"
            body="When an admin creates a questionnaire, it will appear here."
          />
        </Card>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
        >
          {questionnaires.map((q) => (
            <QuestionnaireCard
              key={q.id}
              q={q}
              responsesCount={responseCounts[q.id] ?? 0}
              onStart={() => setActiveId(q.id)}
            />
          ))}
        </motion.div>
      )}

      <NewQuestionnaireModal
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        onCreated={(q) => setActiveId(q.id)}
      />
    </div>
  )
}
