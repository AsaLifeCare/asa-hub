/** The small pieces every Scheduling panel draws: the two-press button, the step bar, the field and note styles. */
import type { ReactNode } from 'react'
import { AlertTriangle, Check, Clock, GraduationCap, Loader2, Minus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { cellTint } from '@/pages/features/shifts/shiftUi'
import { nextPress } from '@/pages/features/timeoff/timeOffModel'
import { TRAINING_PICK_LINE, type Step, type StepState } from './schedulingModel'

export { nextPress }

export const FIELD = 'mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-[12.5px] font-normal normal-case tracking-normal text-text-1 outline-none placeholder:text-text-3 focus:border-primary disabled:opacity-60'
export const AREA = 'mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] font-normal normal-case tracking-normal text-text-1 outline-none placeholder:text-text-3 focus:border-primary'
export const LABEL = 'block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3'
export const PRIMARY_BTN = 'flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
export const OUTLINE_BTN = 'flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50'
export const DANGER_BTN = 'flex h-9 items-center justify-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-surface px-2.5 text-[12.5px] font-semibold text-danger hover:bg-tint-danger disabled:cursor-not-allowed disabled:opacity-50'
/** Scheduling's R/O: a stronger grey than the house grids', its words black and bold. */
export const RO_STRONG = 'bg-[color-mix(in_srgb,var(--text-1)_24%,var(--surface))] font-bold text-text-1'

/** A Scheduling cell's fill and ink by kind: the house grids' own, R/O drawn stronger. */
export function schedTint(kind: string | null | undefined): string {
  return kind === 'ro' ? RO_STRONG : cellTint(kind)
}
/** The top bar's buttons: the profile apps' header height. */
export const BAR_BTN = 'inline-flex h-11 items-center gap-1.5 rounded-[12px] border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 hover:bg-surface-2'

// The inline two-press: the first press arms and says what the second does; "Not yet" disarms.
export function TwoPress({ id, armed, onArm, busy = false, disabled = false, label, armedLabel, icon, tone = 'primary', className,
  title }: {
  id: string
  armed: string
  onArm: (armed: string, act: boolean) => void
  busy?: boolean
  disabled?: boolean
  label: string
  armedLabel: string
  icon?: ReactNode
  tone?: 'primary' | 'outline' | 'danger'
  className?: string
  /** the button's name when its label is an icon alone */
  title?: string
}) {
  const on = armed === id
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-2', className)}>
      <button type="button" disabled={disabled || busy} data-press={id} data-armed={on ? '' : undefined}
        title={title} aria-label={!on && !label ? title : undefined}
        onClick={() => { const p = nextPress(armed, id); onArm(p.armed, p.act) }}
        className={cn(on ? cn(PRIMARY_BTN, 'bg-danger text-white') : tone === 'danger' ? DANGER_BTN : tone === 'outline' ? OUTLINE_BTN : PRIMARY_BTN)}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : icon}
        {on ? `${armedLabel} — press again` : label}
      </button>
      {on && !busy && (
        <button type="button" onClick={() => onArm('', false)} className="text-[12px] text-text-3 hover:text-text-1">Not yet</button>
      )}
    </span>
  )
}

const STEP_TONE: Record<StepState, string> = {
  done: 'bg-tint-mint text-tint-fg-mint',
  waiting: 'bg-tint-amber text-tint-fg-amber',
  refused: 'bg-tint-danger text-tint-fg-danger',
  na: 'bg-tint-slate text-tint-fg-slate',
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <Check size={11} />
  if (state === 'waiting') return <Clock size={11} />
  if (state === 'refused') return <X size={11} />
  return <Minus size={11} />
}

export function StepBar({ steps }: { steps: Step[] }) {
  if (!steps.length) return null
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Progress" data-steps="">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1" title={s.note}>
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', STEP_TONE[s.state])}>
            <StepIcon state={s.state} /> {s.label}
          </span>
          {i < steps.length - 1 && <span className="h-px w-2 bg-border" />}
        </li>
      ))}
    </ol>
  )
}

/** A refusal or a "not possible", said where the press was. */
export function Refusal({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="mt-2 flex items-start gap-1.5 text-[12px] leading-5 text-danger">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>{children}</span>
    </p>
  )
}

// Staff Preferences speak against the placement: the server's reason, and the press that sends the same write again…
export function PrefsOverride({ reason, label, busy, onGo, onDrop }: {
  reason: string
  label: string
  busy: boolean
  onGo: () => void
  onDrop: () => void
}) {
  if (!reason) return null
  return (
    <div role="alert" className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-tint-warning px-2 py-1.5 text-[12px] leading-5 text-text-1"
      data-prefs-override="">
      <p className="flex items-start gap-1.5">
        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" /> <span>{reason}</span>
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={onGo} className={PRIMARY_BTN} data-act="override">
          {busy && <Loader2 size={13} className="animate-spin" />} {label}
        </button>
        <button type="button" disabled={busy} onClick={onDrop} className="text-[12px] text-text-3 hover:text-text-1">Not now</button>
      </div>
    </div>
  )
}

export function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[11.5px] leading-4 text-text-3', className)}>{children}</p>
}

/** Under a picker: the person picked has no IST at the house, so the placement becomes a training. */
export function TrainingPickNote({ className }: { className?: string }) {
  return (
    <p className={cn('mt-2 flex items-start gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-tint-warning px-2 py-1.5 text-[12px] leading-5 text-text-1', className)}
      data-training-note="">
      <GraduationCap size={13} className="mt-0.5 shrink-0" /> <span>{TRAINING_PICK_LINE}</span>
    </p>
  )
}
