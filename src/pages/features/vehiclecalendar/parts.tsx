/** The small pieces every Transportation panel and page draws: fields, the two-press, pills, steps and people. */
import type { ReactNode } from 'react'
import { AlertTriangle, Check, Clock, Loader2, Minus, X } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import { cn } from '@/lib/utils'
import { nextPress } from '@/pages/features/timeoff/timeOffModel'
import {
  HOURS, MINUTES, TINT, TONE_PILL, type Step, type StepState, type Tone, type VehicleTint, type WallParts,
} from './vehicleCalendarModel'
import { TINT_VAR } from '@/lib/tints'

export { nextPress }

export const FIELD = 'mt-1 h-10 w-full rounded-[10px] border border-border bg-surface px-2.5 text-[13px] font-normal normal-case tracking-normal text-text-1 outline-none placeholder:text-text-3 focus:border-primary disabled:cursor-not-allowed disabled:opacity-60'
export const AREA = 'mt-1 w-full rounded-[10px] border border-border bg-surface px-2.5 py-2 text-[13px] font-normal normal-case tracking-normal text-text-1 outline-none placeholder:text-text-3 focus:border-primary disabled:opacity-60'
export const LABEL = 'block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3'
export const BAR_BTN = 'inline-flex h-11 items-center gap-1.5 rounded-[12px] border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2'
export const OUTLINE_BTN = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-border bg-surface px-4 text-[13px] font-medium text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50'
const GO_BTN = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40'
export const ROUND_BTN = 'grid h-9 w-9 place-items-center rounded-full border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1'

/** A labelled field; the error under it when there is one. */
export function Field({ label, error, hint, children, className }: {
  label: ReactNode
  error?: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label className={LABEL}>
        {label}
        {children}
      </label>
      {hint && !error && <p className="mt-1 text-[11.5px] leading-4 text-text-3">{hint}</p>}
      {error && <p className="mt-1 text-[11.5px] leading-4 text-danger" data-field-error="">{error}</p>}
    </div>
  )
}

/** A read-only line of a panel: the label over the value, skipped when there is no value. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  if (children === '' || children === null || children === undefined || children === false) return null
  return (
    <div className="border-b border-border py-2.5 last:border-b-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-text-1">{children}</dd>
    </div>
  )
}

// The two-press: the first press arms and says what the second does; "Not yet" disarms.
export function TwoPress({ id, armed, onArm, busy = false, disabled = false, label, armedLabel, icon, tone = 'go', className }: {
  id: string
  armed: string
  onArm: (armed: string, act: boolean) => void
  busy?: boolean
  disabled?: boolean
  label: string
  armedLabel: string
  icon?: ReactNode
  tone?: 'go' | 'primary' | 'outline' | 'danger'
  className?: string
}) {
  const on = armed === id
  const look = on ? 'bg-primary hover:bg-primary-hover'
    : tone === 'go' ? 'bg-[var(--success)] hover:opacity-90'
      : tone === 'primary' ? 'bg-primary hover:bg-primary-hover'
        : tone === 'danger' ? 'bg-danger hover:opacity-90' : ''
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-2', className)}>
      {on && !busy && (
        <button type="button" onClick={() => onArm('', false)} className="text-[12.5px] text-text-3 hover:text-text-1">Not yet</button>
      )}
      <button type="button" disabled={disabled || busy} data-press={id} data-armed={on ? '' : undefined}
        onClick={() => { const p = nextPress(armed, id); onArm(p.armed, p.act) }}
        className={tone === 'outline' && !on ? OUTLINE_BTN : cn(GO_BTN, look)}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : icon}
        {on ? `${armedLabel} — press again` : label}
      </button>
    </span>
  )
}

/** The panel's last row, kept in view while the form scrolls: Cancel, then whatever the panel files. */
export function PanelActions({ onCancel, cancelLabel = 'Cancel', children }: {
  onCancel: () => void
  cancelLabel?: string
  children?: ReactNode
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-bg px-4 py-3" data-panel-actions="">
      <button type="button" onClick={onCancel} className={OUTLINE_BTN}>{cancelLabel}</button>
      {children}
    </div>
  )
}

/** A refusal or a "not possible", said where the press was. */
export function Refusal({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-5 text-danger" data-refusal="">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" /> <span>{children}</span>
    </p>
  )
}

export function Muted({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null
  return <p className={cn('text-[12px] leading-[1.45] text-text-3', className)}>{children}</p>
}

/** A trip's or a vehicle's word in its tone. */
export function StatusPill({ word, tone, className }: { word: string; tone: Tone; className?: string }) {
  if (!word) return <span className="text-text-3">—</span>
  return (
    <span data-status={word} className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold', TONE_PILL[tone], className)}>
      {word}
    </span>
  )
}

/** The vehicle's own colour, as a dot. */
export function TintDot({ tint, className }: { tint: VehicleTint; className?: string }) {
  return <span aria-hidden className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', className)} style={{ background: TINT_VAR[TINT[tint]] }} />
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
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', STEP_TONE[s.state])} data-step={s.id}>
            <StepIcon state={s.state} /> {s.label}
          </span>
          {i < steps.length - 1 && <span className="h-px w-3 bg-border" />}
        </li>
      ))}
    </ol>
  )
}

const SMALL_SELECT = 'mt-1 h-10 rounded-[10px] border border-border bg-surface px-2 text-[13px] text-text-1 outline-none focus:border-primary disabled:opacity-60'

/** A date, then the hour (1–12), the minute (00/15/30/45) and AM/PM — an Eastern wall clock, part by part. */
export function WallInput({ label, value, onChange, error, min, disabled = false, id }: {
  label: string
  value: WallParts
  onChange: (next: WallParts) => void
  error?: string
  min?: string
  disabled?: boolean
  id: string
}) {
  const minutes: string[] = MINUTES.includes(value.minute as (typeof MINUTES)[number]) ? [...MINUTES] : [...MINUTES, value.minute].sort()
  return (
    <fieldset className="min-w-0" data-wall={id} disabled={disabled}>
      <legend className={LABEL}>{label}</legend>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-1.5">
        <input type="date" value={value.date} min={min} aria-label={`${label} date`} onChange={(e) => onChange({ ...value, date: e.target.value })}
          className={cn(FIELD, 'min-w-0')} />
        <select aria-label={`${label} hour`} value={value.hour} onChange={(e) => onChange({ ...value, hour: e.target.value })} className={SMALL_SELECT}>
          <option value="">Hour</option>
          {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <select aria-label={`${label} minute`} value={value.minute} onChange={(e) => onChange({ ...value, minute: e.target.value })} className={SMALL_SELECT}>
          {minutes.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select aria-label={`${label} AM or PM`} value={value.ampm} onChange={(e) => onChange({ ...value, ampm: e.target.value === 'PM' ? 'PM' : 'AM' })} className={SMALL_SELECT}>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
      {error && <p className="mt-1 text-[11.5px] leading-4 text-danger" data-field-error="">{error}</p>}
    </fieldset>
  )
}

/** A checkbox and its sentence. */
export function CheckLine({ checked, onChange, children, disabled = false, id }: {
  checked: boolean
  onChange: (v: boolean) => void
  children: ReactNode
  disabled?: boolean
  id: string
}) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-border bg-surface px-3 py-2.5 text-[13px] text-text-1',
      disabled && 'cursor-not-allowed opacity-60')} data-check={id}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]" />
      <span className="min-w-0">{children}</span>
    </label>
  )
}

/** A verdict line under a picker: the word in its tone, then why. */
export function VerdictLine({ verdict, prefix }: { verdict: { word: string; tone: Tone; why: string } | null; prefix?: string }) {
  if (!verdict) return null
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] leading-4 text-text-2" data-verdict={verdict.word}>
      {prefix && <span className="text-text-3">{prefix}</span>}
      <StatusPill word={verdict.word} tone={verdict.tone} />
      {verdict.why && <span>{verdict.why}</span>}
    </p>
  )
}

/** A person, as every list on the platform draws one: the round avatar, then the name, then a quiet line. */
export function PersonLine({ name, line, size = 'xs' }: { name: string; line?: ReactNode; size?: 'xs' | 'sm' }) {
  if (!name) return <span className="text-text-3">—</span>
  return (
    <span className="flex min-w-0 items-center gap-2" data-person={name}>
      <Avatar name={name} size={size} />
      <span className="grid min-w-0">
        <span className="truncate text-[13px] font-medium text-text-1">{name}</span>
        {line && <span className="truncate text-[11.5px] text-text-3">{line}</span>}
      </span>
    </span>
  )
}
