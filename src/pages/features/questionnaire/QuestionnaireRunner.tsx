// QuestionnaireRunner — the answering experience, mounted by QuestionnairesPage when Start/Continue is clicked…
// HEADER — 5 selectable layouts (hero / split / banner / minimal / cards), the app's signature "many header…
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Clock,
  GripVertical,
  Inbox,
  LayoutGrid,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import ProgressBar from '@/components/shared/ProgressBar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { useCan } from '@/auth/permissions'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { useQuestionnaireStore } from '@/stores/useQuestionnaireStore'
import { submitQuestionnaire } from './live'
import type {
  HeaderLayout,
  QuestionKind,
  QuestionOption,
  Questionnaire,
  QuestionnaireQuestion,
  ResponseAnswer,
  ResponseRole,
} from '@/lib/seed-questionnaire'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import {
  BTN_GHOST,
  BTN_PRIMARY,
  HEADER_LAYOUTS,
  INPUT_CLS,
  InfoChips,
  LayoutThumb,
  QUESTIONNAIRE_PERM,
  TEXTAREA_CLS,
  useResolvedLayout,
  useResolvedQuestions,
} from './bits'

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'] as const
const MIN_OPTIONS = 2
const MAX_OPTIONS = OPTION_KEYS.length

/* ================= header layouts ================= */

function Overline({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary', className)}>
      {children}
    </div>
  )
}

function MetaStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-tint-primary text-tint-fg-primary">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{label}</span>
        <span className="block truncate text-[13px] font-semibold text-text-1">{value}</span>
      </span>
    </div>
  )
}

function RunnerHeader({
  q,
  layout,
  questionCount,
  answered,
}: {
  q: Questionnaire
  layout: HeaderLayout
  questionCount: number
  answered: number
}) {
  switch (layout) {
    case 'hero':
      return (
        <div className="mx-auto max-w-[680px] pt-2 text-center">
          <Overline>Questionnaire</Overline>
          <h1 className="mt-2 font-display text-[30px] font-bold leading-[38px] tracking-[-0.015em] text-text-1">
            {q.title}
          </h1>
          <p className="mx-auto mt-3 max-w-[620px] text-[14px] leading-6 text-text-2">{q.description}</p>
          <InfoChips q={q} className="mt-4 justify-center" />
        </div>
      )
    case 'split':
      return (
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-[1fr_300px]">
          <div>
            <Overline>Questionnaire</Overline>
            <h1 className="mt-1.5 font-display text-[24px] font-bold leading-[32px] tracking-[-0.015em] text-text-1">
              {q.title}
            </h1>
            <p className="mt-2 text-[13.5px] leading-6 text-text-2">{q.description}</p>
            <InfoChips q={q} className="mt-3" />
          </div>
          <Card className="space-y-3.5 p-4">
            <MetaStat icon={<Clock size={15} />} label="Time" value={`About ${q.estimatedMin} minutes`} />
            <MetaStat icon={<Lock size={15} />} label="Privacy" value={q.privacyNote} />
            <div className="border-t border-border pt-3">
              <div className="mb-1.5 flex items-center justify-between text-[12px]">
                <span className="font-semibold text-text-2">Progress</span>
                <span className="text-text-3">
                  {answered}/{questionCount} answered
                </span>
              </div>
              <ProgressBar value={questionCount ? answered / questionCount : 0} tint="mint" />
            </div>
          </Card>
        </div>
      )
    case 'banner':
      return (
        <div className="rounded-lg bg-tint-primary px-6 py-5">
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-primary text-on-primary">
              <ClipboardList size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[22px] font-bold leading-[30px] tracking-[-0.015em] text-text-1">
                {q.title}
              </h1>
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-text-2">{q.description}</p>
            </div>
            <InfoChips q={q} className="shrink-0 [&>span]:bg-surface" />
          </div>
        </div>
      )
    case 'minimal':
      return (
        <div>
          <Overline>Questionnaire</Overline>
          <h1 className="mt-1 font-display text-[22px] font-bold leading-[30px] tracking-[-0.015em] text-text-1">
            {q.title}
          </h1>
        </div>
      )
    case 'cards':
      return (
        <div className="space-y-5">
          <div>
            <Overline>Questionnaire</Overline>
            <h1 className="mt-1.5 font-display text-[24px] font-bold leading-[32px] tracking-[-0.015em] text-text-1">
              {q.title}
            </h1>
            <p className="mt-2 max-w-[720px] text-[13.5px] leading-6 text-text-2">{q.description}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <MetaStat icon={<ClipboardList size={15} />} label="Questions" value={`${questionCount} scenario${questionCount === 1 ? '' : 's'}`} />
            </Card>
            <Card className="p-4">
              <MetaStat icon={<Clock size={15} />} label="Time" value={`About ${q.estimatedMin} minutes`} />
            </Card>
            <Card className="p-4">
              <MetaStat icon={<Lock size={15} />} label="Privacy" value={q.privacyNote} />
            </Card>
          </div>
        </div>
      )
  }
}

/* ================= admin: customize-header popover ================= */

function CustomizeHeaderButton({ q, layout }: { q: Questionnaire; layout: HeaderLayout }) {
  const setLayout = useQuestionnaireStore((s) => s.setLayout)
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={BTN_GHOST}>
          <LayoutGrid size={14} /> Customize header
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-3">
        <div className="mb-2 px-1">
          <div className="text-[13px] font-semibold text-text-1">Header layout</div>
          <div className="text-[12px] text-text-3">Applies to this questionnaire for everyone.</div>
        </div>
        <div className="space-y-1">
          {HEADER_LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setLayout(q.id, l.id)
                setOpen(false)
                toast({ type: 'success', title: `Header set to ${l.label}`, body: 'Saved for this questionnaire.' })
              }}
              className={cn(
                'flex w-full items-center gap-3 rounded-md border px-2.5 py-2 text-left transition-colors',
                layout === l.id ? 'border-primary bg-tint-primary' : 'border-transparent hover:border-border hover:bg-surface-2',
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
                  layout === l.id ? 'border-primary bg-primary' : 'border-border-strong bg-surface',
                )}
              >
                {layout === l.id && <span className="h-1.5 w-1.5 rounded-full bg-on-primary" />}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* ================= admin: question edit / add modal ================= */

function QuestionModal({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** null → adding a new question */
  initial: QuestionnaireQuestion | null
  onSave: (q: QuestionnaireQuestion) => void
}) {
  const [kind, setKind] = useState<QuestionKind>('choice')
  const [scenario, setScenario] = useState('')
  const [prompt, setPrompt] = useState('')
  const [required, setRequired] = useState(true)
  const [opts, setOpts] = useState<string[]>(['', '', '', ''])

  useEffect(() => {
    if (!open) return
    setKind(initial?.kind ?? 'choice')
    setScenario(initial?.scenario ?? '')
    setPrompt(initial?.prompt ?? '')
    setRequired(initial?.required ?? true)
    setOpts(initial?.options ? initial.options.map((o) => o.text) : ['', '', '', ''])
  }, [open, initial])

  const save = () => {
    if (!scenario.trim() || !prompt.trim()) {
      toast({ type: 'warning', title: 'Scenario and question required', body: 'Fill in both the scenario text and the bold question.' })
      return
    }
    let options: QuestionOption[] | undefined
    if (kind === 'choice') {
      if (opts.length < MIN_OPTIONS) {
        toast({ type: 'warning', title: 'At least two options', body: 'Multiple-choice questions need two or more answers.' })
        return
      }
      if (opts.some((o) => !o.trim())) {
        toast({ type: 'warning', title: 'Fill in every option', body: `Multiple-choice questions need text in all ${opts.length} answers (or remove the empty ones).` })
        return
      }
      options = opts.map((text, i) => ({ key: OPTION_KEYS[i], text: text.trim() }))
    }
    onSave({
      id: initial?.id ?? `qq-${Date.now().toString(36)}`,
      kind,
      scenario: scenario.trim(),
      prompt: prompt.trim(),
      options,
      required,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit question' : 'Add question'}</DialogTitle>
          <DialogDescription>The scenario appears in the tinted quote box; the question is the bold prompt below it.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-text-2">Answer type</label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'choice', label: 'Multiple choice', hint: '2–6 letter options (A–F)' },
                  { id: 'text', label: 'Free text', hint: 'Open answer in their own words' },
                ] as const
              ).map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKind(k.id)}
                  className={cn(
                    'rounded-md border px-3 py-2.5 text-left transition-colors',
                    kind === k.id ? 'border-primary bg-tint-primary' : 'border-border hover:border-primary/40',
                  )}
                >
                  <span className="block text-[13px] font-semibold text-text-1">{k.label}</span>
                  <span className="block text-[12px] text-text-3">{k.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-text-2">Scenario</label>
            <textarea
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              rows={3}
              placeholder="Describe the situation the respondent reacts to…"
              className={TEXTAREA_CLS}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-text-2">Question</label>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. What is your first response?"
              className={INPUT_CLS}
            />
          </div>

          {kind === 'choice' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-[12px] font-semibold text-text-2">Options</label>
                <span className="text-[11px] text-text-3">
                  {opts.length} of {MIN_OPTIONS}–{MAX_OPTIONS}
                </span>
              </div>
              {opts.map((text, i) => (
                <div key={OPTION_KEYS[i]} className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-tint-primary text-[11px] font-bold text-tint-fg-primary">
                    {OPTION_KEYS[i]}
                  </span>
                  <input
                    value={text}
                    onChange={(e) => setOpts((s) => s.map((o, j) => (j === i ? e.target.value : o)))}
                    placeholder={`Option ${OPTION_KEYS[i]}`}
                    className={INPUT_CLS}
                  />
                  {opts.length > MIN_OPTIONS && (
                    <button
                      type="button"
                      onClick={() => setOpts((s) => s.filter((_, j) => j !== i))}
                      aria-label={`Remove option ${OPTION_KEYS[i]}`}
                      title="Remove option"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-text-3 transition-colors hover:border-danger/50 hover:text-danger"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              {opts.length < MAX_OPTIONS && (
                <button
                  type="button"
                  onClick={() => setOpts((s) => [...s, ''])}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong px-3 py-2 text-[12px] font-semibold text-text-2 transition-colors hover:border-primary/50 hover:text-text-1"
                >
                  <Plus size={13} /> Add option ({OPTION_KEYS[opts.length]})
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-text-1">Required</div>
              <div className="text-[12px] text-text-3">Respondents must answer before submitting.</div>
            </div>
            <Switch checked={required} onCheckedChange={setRequired} aria-label="Required" />
          </div>
        </div>

        <DialogFooter>
          <button type="button" className={BTN_GHOST} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className={BTN_PRIMARY} onClick={save}>
            <Check size={14} /> {initial ? 'Save changes' : 'Add question'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ================= scenario card ================= */

function ScenarioCard({
  q,
  index,
  total,
  value,
  onAnswer,
  editMode,
  editActions,
  dragHandle,
  innerRef,
}: {
  q: QuestionnaireQuestion
  index: number
  total: number
  value: string
  onAnswer: (v: string) => void
  editMode: boolean
  editActions?: {
    onEdit: () => void
    onDelete: () => void
  }
  /** Hover-reveal dnd-kit grip (edit mode only) — rendered left of the overline. */
  dragHandle?: React.ReactNode
  innerRef: (el: HTMLDivElement | null) => void
}) {
  const answered = value.trim().length > 0
  return (
    <div ref={innerRef} className={cn('scroll-mt-6', editMode && 'group/qcard')}>
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            {dragHandle}
            <Overline className={answered && !editMode ? 'text-tint-fg-mint' : undefined}>
              Scenario {index + 1} of {total}
            </Overline>
            {!q.required && !editMode && (
              <span className="rounded-full bg-tint-info px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-tint-fg-info">
                Optional
              </span>
            )}
          </div>
          {editMode && editActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="grid h-8 w-8 place-items-center rounded-md border border-border text-text-2 transition-colors hover:border-primary/50 hover:text-text-1"
                  aria-label="Question actions"
                >
                  <MoreHorizontal size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={editActions.onEdit} aria-label="Edit question" title="Edit question">
                  <Pencil size={14} />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-danger" onClick={editActions.onDelete}>
                  <Trash2 size={14} /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* tinted quote box — 3px primary left border, per the reference */}
        <div className="rounded-md border-l-[3px] border-primary bg-tint-primary px-4 py-3">
          <p className="text-[13.5px] leading-6 text-text-1">{q.scenario}</p>
        </div>

        <p className="text-[14px] font-bold text-text-1">{q.prompt}</p>

        <div className={cn(editMode && 'pointer-events-none opacity-60')}>
          {/* THE MEASURED KINDS. These questions feed a named metric with a
              weight (seed-questionnaire.ts, QuestionScoring), so the shape of
              the answer is part of the question — a 1–5 ladder typed into a
              free-text box is not the same answer, and would not score. */}
          {q.kind === 'scale' ? (
            <div>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => {
                  const on = value === String(n)
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => onAnswer(String(n))}
                      className={cn(
                        'h-11 flex-1 rounded-md border text-[15px] font-bold transition-colors',
                        on ? 'border-primary bg-primary text-on-primary'
                           : 'border-border bg-surface text-text-1 hover:border-primary/60',
                      )}
                    >
                      {n}
                    </button>
                  )
                })}
              </div>
              {q.scaleLabels && (
                <div className="mt-1.5 flex justify-between text-[11.5px] text-text-3">
                  <span>1 — {q.scaleLabels[0]}</span>
                  <span>5 — {q.scaleLabels[1]}</span>
                </div>
              )}
            </div>
          ) : q.kind === 'yesno' ? (
            <div className="flex gap-2">
              {['Yes', 'No'].map((label) => {
                const on = value === label
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => onAnswer(label)}
                    className={cn(
                      'h-11 flex-1 rounded-md border text-[14px] font-semibold transition-colors',
                      on ? 'border-primary bg-primary text-on-primary'
                         : 'border-border bg-surface text-text-1 hover:border-primary/60',
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          ) : q.kind === 'number' ? (
            <div className="flex items-center gap-2">
              <input
                type="number" min={0} inputMode="numeric"
                value={value}
                onChange={(e) => onAnswer(e.target.value)}
                className="h-11 w-40 rounded-md border border-border bg-surface px-3 text-[14px] text-text-1 outline-none focus:border-primary"
              />
              {q.unit && <span className="text-[13px] text-text-3">{q.unit}</span>}
            </div>
          ) : q.kind === 'date' ? (
            <input
              type="date"
              value={value}
              onChange={(e) => onAnswer(e.target.value)}
              className="h-11 w-52 rounded-md border border-border bg-surface px-3 text-[14px] text-text-1 outline-none focus:border-primary"
            />
          ) : q.kind === 'choice' ? (
            <div className="space-y-2">
              {(q.options ?? []).map((opt) => {
                const selected = value === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => onAnswer(opt.key)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md border px-3.5 py-3 text-left transition-colors',
                      selected ? 'border-primary bg-tint-primary' : 'border-border bg-surface hover:border-primary/60',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                        selected ? 'bg-primary text-on-primary' : 'bg-tint-primary text-tint-fg-primary',
                      )}
                    >
                      {opt.key}
                    </span>
                    <span className="min-w-0 flex-1 text-[13px] leading-5 text-text-1">{opt.text}</span>
                    {selected && <Check size={16} className="shrink-0 text-primary" />}
                  </button>
                )
              })}
            </div>
          ) : (
            <div>
              <textarea
                value={value}
                onChange={(e) => onAnswer(e.target.value)}
                rows={5}
                placeholder={q.placeholder ?? "Answer in your own words — there are no wrong answers…"}
                className={cn(TEXTAREA_CLS, 'min-h-[130px] resize-y')}
              />
              <div className="mt-1 text-right text-[11px] text-text-3">{value.length} characters</div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

/* ================= admin: drag-to-reorder + reset ================= */

// Sortable wrapper around a scenario card in Edit mode — same interaction language as SheetTemplate's manual rows…
function SortableScenarioCard({
  id,
  children,
}: {
  id: string
  children: (dragHandle: React.ReactNode) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const dragHandle = (
    <button
      {...attributes}
      {...listeners}
      type="button"
      aria-label="Drag to reorder"
      title="Drag to reorder"
      className="grid h-7 w-7 shrink-0 cursor-grab place-items-center rounded-sm text-text-3 opacity-0 transition-opacity duration-150 hover:bg-surface-3 hover:text-text-1 focus:opacity-100 active:cursor-grabbing group-hover/qcard:opacity-100 max-md:opacity-100"
    >
      <GripVertical size={14} />
    </button>
  )
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10 rounded-lg bg-surface shadow-2 ring-1 ring-primary/40')}
    >
      {children(dragHandle)}
    </div>
  )
}

/** Admin "Reset questions" — restores the seeded list, confirmed via a small popover. */
function ResetQuestionsButton({ q }: { q: Questionnaire }) {
  const resetQuestions = useQuestionnaireStore((s) => s.resetQuestions)
  const hasOverride = useQuestionnaireStore((s) => s.questionSets[q.id] !== undefined)
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(BTN_GHOST, 'disabled:cursor-not-allowed disabled:opacity-50')}
          disabled={!hasOverride}
          title={hasOverride ? 'Restore the seeded question list' : 'No edits to reset'}
        >
          <RotateCcw size={14} /> Reset questions
        </button>
      </PopoverTrigger>
      {hasOverride && (
        <PopoverContent align="end" className="w-[300px] p-3">
          <div className="px-1">
            <div className="text-[13px] font-semibold text-text-1">Reset questions?</div>
            <p className="mt-1 text-[12px] leading-5 text-text-3">
              This restores the original seeded list for “{q.title}”. Your edits, added questions and the
              custom order are discarded.
            </p>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className={cn(BTN_GHOST, 'h-8 px-3 text-[12px]')} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={cn(BTN_PRIMARY, 'h-8 px-3 text-[12px]')}
              onClick={() => {
                resetQuestions(q.id)
                setOpen(false)
                toast({ type: 'info', title: 'Questions reset', body: 'The seeded question list is live again.' })
              }}
            >
              <RotateCcw size={13} /> Reset
            </button>
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}

/* ================= runner ================= */

export default function QuestionnaireRunner({
  questionnaire: q,
  onClose,
  onSubmitted,
  onProgress,
}: {
  questionnaire: Questionnaire
  onClose: () => void
  /** Fired when the answers were actually SUBMITTED. */
  onSubmitted?: () => void
  // How much of it is filled in, as it changes.
  onProgress?: (answered: number, total: number) => void
}) {
  const canManage = useCan(QUESTIONNAIRE_PERM)
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  const layout = useResolvedLayout(q)
  const questions = useResolvedQuestions(q)
  const setQuestions = useQuestionnaireStore((s) => s.setQuestions)
  const setDraft = useQuestionnaireStore((s) => s.setDraft)
  const clearDraft = useQuestionnaireStore((s) => s.clearDraft)
  const addResponse = useQuestionnaireStore((s) => s.addResponse)

  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [activeIdx, setActiveIdx] = useState(0)
  const [editMode, setEditMode] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<QuestionnaireQuestion | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  const total = questions.length
  const answered = useMemo(
    () => questions.filter((qq) => (answers[qq.id] ?? '').trim().length > 0).length,
    [questions, answers],
  )
  const lastIdx = Math.max(0, total - 1)

  /* draft tracking → landing card shows "In progress · n/m answered" */
  useEffect(() => {
    if (!user || submitted || editMode) return
    if (answered > 0) setDraft(user.id, q.id, answered)
  }, [answered, user, submitted, editMode, q.id, setDraft])

  // Report the count outward as it moves — see `onProgress` above.
  useEffect(() => { onProgress?.(answered, total) }, [answered, total, onProgress])

  // live reconciliation — answers stay keyed by question id; when the admin edits the live list (delete question…
  useEffect(() => {
    setAnswers((s) => {
      let changed = false
      const next: Record<string, string> = {}
      for (const [id, v] of Object.entries(s)) {
        const qq = questions.find((x) => x.id === id)
        if (!qq) {
          changed = true // question deleted
          continue
        }
        if (qq.kind === 'choice' && v && !(qq.options ?? []).some((o) => o.key === v)) {
          changed = true // selected option was removed
          continue
        }
        if (qq.kind === 'text' && v.length === 1 && (qq.options ?? []).some((o) => o.key === v)) {
          changed = true // question switched choice → text with a letter key stored
          continue
        }
        next[id] = v
      }
      return changed ? next : s
    })
  }, [questions])

  const scrollTo = (idx: number) => {
    const clamped = Math.max(0, Math.min(lastIdx, idx))
    setActiveIdx(clamped)
    cardRefs.current[clamped]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const answer = (id: string, v: string) => setAnswers((s) => ({ ...s, [id]: v }))

  /* ---------- submit ---------- */

  const submit = () => {
    const openRequired = questions.filter((qq) => qq.required && !(answers[qq.id] ?? '').trim())
    if (openRequired.length > 0) {
      const firstOpen = questions.findIndex((qq) => qq.id === openRequired[0].id)
      toast({
        type: 'warning',
        title: `${openRequired.length} required question${openRequired.length === 1 ? '' : 's'} still unanswered`,
        body: 'Answer every required scenario before you can submit.',
      })
      if (firstOpen >= 0) scrollTo(firstOpen)
      return
    }
    const role: ResponseRole =
      user?.role === 'onboarding' ? 'candidate' : user?.role === 'staff' ? 'staff' : 'manager'
    // structured capture — the local answers map becomes a per-question array so the Responses detail modal (and…
    const structuredAnswers: ResponseAnswer[] = questions.flatMap((qq) => {
      const v = (answers[qq.id] ?? '').trim()
      if (!v) return []
      return [qq.kind === 'choice' ? { questionId: qq.id, choiceKey: v as ResponseAnswer['choiceKey'] } : { questionId: qq.id, text: v }]
    })
    const localResponse = {
      id: `qr-local-${Date.now().toString(36)}`,
      questionnaireId: q.id,
      respondentName: user?.name ?? 'You',
      role,
      submittedAt: new Date().toISOString(),
      answersSummary: `${answered}/${total} answered`,
      answers: structuredAnswers,
      score: null,
      status: 'submitted' as const,
    }
    if (user) clearDraft(user.id, q.id)
    setSubmitted(true)
    onSubmitted?.()

    // scored and kept by the server (questionnaireSubmit, in Python); a send that fails is kept on this device and
    // sent again from Responses
    const sent = Object.fromEntries(questions.map((qq) => [qq.id, (answers[qq.id] ?? '').trim()]).filter(([, v]) => v))
    void submitQuestionnaire(q.id, sent).then(
      (got) => toast({ type: 'success', title: 'Responses submitted',
        body: `${got?.message ? `${got.message} ` : ''}Thank you — your answers are visible to your team only.` }),
      (e) => {
        addResponse(localResponse)
        toast({
          type: 'warning',
          title: 'Saved here, not yet on the server',
          body: `Your answers are recorded on this device and can be sent again from Responses — ${
            e instanceof Error && e.message ? e.message : 'the server did not answer'}.`,
        })
      })
  }

  /* ---------- admin edit actions ---------- */

  const persist = (next: QuestionnaireQuestion[]) => setQuestions(q.id, next)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    persist(arrayMove(questions, questions.findIndex((qq) => qq.id === active.id), questions.findIndex((qq) => qq.id === over.id)))
  }

  const remove = (id: string) => {
    persist(questions.filter((qq) => qq.id !== id))
    toast({ type: 'info', title: 'Question deleted', body: 'The scenario was removed from this questionnaire.' })
  }

  const saveQuestion = (qq: QuestionnaireQuestion) => {
    const exists = questions.some((x) => x.id === qq.id)
    persist(exists ? questions.map((x) => (x.id === qq.id ? qq : x)) : [...questions, qq])
    toast({
      type: 'success',
      title: exists ? 'Question updated' : 'Question added',
      body: exists ? 'Your changes are live for this questionnaire.' : 'Appended at the bottom of the deck.',
    })
  }

  /* ---------- confirmation state ---------- */

  if (submitted) {
    return (
      <div className="mx-auto max-w-[560px] pt-10">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
        >
          <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-tint-mint text-tint-fg-mint">
              <CircleCheck size={26} />
            </span>
            <h2 className="font-display text-[20px] font-bold text-text-1">Responses submitted — thank you!</h2>
            <p className="max-w-[380px] text-[13.5px] leading-6 text-text-2">
              Your answers to “{q.title}” are visible to your team only. A coordinator will review them as part of
              your onboarding.
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <button type="button" className={BTN_PRIMARY} onClick={onClose}>
                <ArrowLeft size={14} /> Back to questionnaires
              </button>
              {canManage && (
                <button
                  type="button"
                  className={BTN_GHOST}
                  onClick={() => navigate('/app/questionnaires/responses')}
                >
                  <Inbox size={14} /> View responses
                </button>
              )}
            </div>
          </Card>
        </motion.div>
      </div>
    )
  }

  /* ---------- runner ---------- */

  return (
    <div className="mx-auto max-w-[760px]">
      {/* toolbar: back + admin controls */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_GHOST} onClick={onClose}>
          <ArrowLeft size={14} /> Back
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canManage && (
            <>
            <CustomizeHeaderButton q={q} layout={layout} />
            <ResetQuestionsButton q={q} />
            <button
              type="button"
              onClick={() => setEditMode((v) => !v)}
              className={cn(BTN_GHOST, editMode && 'border-primary bg-tint-primary text-text-1')}
            >
              <Pencil size={14} /> {editMode ? 'Done editing' : 'Edit questions'}
            </button>
            </>
          )}
        </div>
      </div>

      {/* HEADER — 5 layouts */}
      <RunnerHeader q={q} layout={layout} questionCount={total} answered={answered} />

      {/* BODY — info chips (layouts without them inline) + stacked scenario cards */}
      {layout === 'minimal' && <InfoChips q={q} className="mt-4" />}

      <div className="mt-6 space-y-5">
        {total === 0 ? (
          <Card>
            <EmptyState
              title="No questions yet"
              body={
                canManage
                  ? 'This questionnaire was just created. Turn on Edit questions and add the first scenario.'
                  : 'An admin is still building this questionnaire — check back soon.'
              }
              action={
                canManage
                  ? {
                      label: 'Add the first question',
                      onClick: () => {
                        setEditMode(true)
                        setEditing(null)
                        setModalOpen(true)
                      },
                    }
                  : undefined
              }
            />
          </Card>
        ) : editMode && canManage ? (
          /* EDIT MODE — real drag-to-reorder via dnd-kit (persists to the store) */
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={questions.map((qq) => qq.id)} strategy={verticalListSortingStrategy}>
              {questions.map((qq, i) => (
                <SortableScenarioCard key={qq.id} id={qq.id}>
                  {(dragHandle) => (
                    <ScenarioCard
                      q={qq}
                      index={i}
                      total={total}
                      value={answers[qq.id] ?? ''}
                      onAnswer={(v) => answer(qq.id, v)}
                      editMode={editMode}
                      dragHandle={dragHandle}
                      innerRef={(el) => {
                        cardRefs.current[i] = el
                      }}
                      editActions={{
                        onEdit: () => {
                          setEditing(qq)
                          setModalOpen(true)
                        },
                        onDelete: () => remove(qq.id),
                      }}
                    />
                  )}
                </SortableScenarioCard>
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          <AnimatePresence initial={false}>
            {questions.map((qq, i) => (
              <motion.div
                key={qq.id}
                layout
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
              >
                <ScenarioCard
                  q={qq}
                  index={i}
                  total={total}
                  value={answers[qq.id] ?? ''}
                  onAnswer={(v) => answer(qq.id, v)}
                  editMode={editMode}
                  innerRef={(el) => {
                    cardRefs.current[i] = el
                  }}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        {editMode && total > 0 && (
          <button
            type="button"
            onClick={() => {
              setEditing(null)
              setModalOpen(true)
            }}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border-strong px-6 py-5 text-[13px] font-semibold text-text-2 transition-colors hover:border-primary/50 hover:text-text-1"
          >
            <Plus size={15} /> Add question
          </button>
        )}
      </div>

      {/* FOOTER — progress + Previous/Next/Submit */}
      {total > 0 && !editMode && (
        <div className="sticky bottom-0 z-10 mt-6 border-t border-border bg-bg/90 py-3 backdrop-blur">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <span className="text-[12px] font-semibold text-text-2">
              {answered} of {total} answered
            </span>
            <span className="text-[12px] text-text-3">
              Scenario {Math.min(activeIdx + 1, total)} of {total}
            </span>
          </div>
          <ProgressBar value={total ? answered / total : 0} tint="mint" className="mb-3" />
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className={BTN_GHOST}
              disabled={activeIdx === 0}
              onClick={() => scrollTo(activeIdx - 1)}
            >
              <ChevronLeft size={14} /> Previous
            </button>
            {activeIdx >= lastIdx ? (
              <button type="button" className={BTN_PRIMARY} onClick={submit}>
                <Send size={14} /> Submit responses
              </button>
            ) : (
              <button type="button" className={BTN_PRIMARY} onClick={() => scrollTo(activeIdx + 1)}>
                Next <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      <QuestionModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        initial={editing}
        onSave={saveQuestion}
      />
    </div>
  )
}
